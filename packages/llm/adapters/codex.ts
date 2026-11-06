/**
 * codex · `codex exec` (Codex CLI d'OpenAI, non interactif) : la voie ABONNEMENT ChatGPT pour les skills JSON.
 *
 * Le prompt du skill + les blocs d'entrée partent sur stdin. Sortie structurée native : `--output-schema <fichier>`
 * contraint la réponse finale au schéma JSON du skill ; la réponse est lue dans le fichier `-o` (dernier message
 * de l'agent), jamais dans le flux d'évènements. Les images partent avec `-i` (pièces jointes du prompt).
 *
 * Appel PUR : bac à sable `read-only`, dossier de travail temporaire (l'agent ne voit pas le dépôt), session
 * éphémère (`--ephemeral`, rien n'est écrit dans ~/.codex/sessions), pas de vérification de dépôt git.
 *
 * Auth : on RETIRE OPENAI_API_KEY de l'environnement du sous-process. Avec une clé présente, Codex facture l'API
 * au lieu de l'abonnement ChatGPT (`codex login`). La clé reste utilisable par la voie openai-compatible.
 *
 * Modèle : `-m` seulement si un modèle est posé (LWS_MODEL_<RÔLE>, LWS_MODEL) ; sinon le défaut de la CLI
 * (config.toml de l'opérateur) — on ne devine jamais un ID de modèle OpenAI ici. Binaire : LWS_CODEX_BIN.
 */
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { LlmAdapter, LlmRequest, LlmResponse } from "../types.ts"
import { LlmError } from "../types.ts"
import { textCollector } from "../../shared/lines.mjs"
import { EXT_BY_MEDIA } from "./claude-code.ts"

type Env = Record<string, string | undefined>

/** L'environnement d'un `codex exec` sur l'abonnement : sans clé API (sinon facturation API), le reste intact. */
export function codexEnv(env: Env = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env }
  delete out.OPENAI_API_KEY
  return out
}

export function spawnCodex(bin: string, args: string[], stdin: string, o: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env: o.env ?? codexEnv(), cwd: o.cwd, stdio: ["pipe", "pipe", "pipe"] })
    const stdout = textCollector(), stderr = textCollector(1_000_000)
    const timer = o.timeoutMs ? setTimeout(() => { try { child.kill("SIGTERM") } catch { /* */ } }, o.timeoutMs) : null
    child.stdout.on("data", (b: Buffer) => stdout.push(b))
    child.stderr.on("data", (b: Buffer) => stderr.push(b))
    child.on("error", (e) => { if (timer) clearTimeout(timer); reject(new LlmError(`spawn ${bin} : ${e.message} (Codex CLI installé ? npm i -g @openai/codex, puis codex login · npm run doctor)`, "codex")) })
    child.on("close", (code) => { if (timer) clearTimeout(timer); resolve({ code: code ?? -1, stdout: stdout.text(), stderr: stderr.text() }) })
    child.stdin.on("error", () => { /* process parti avant la fin de l'écriture : le code de sortie dira pourquoi */ })
    child.stdin.write(stdin)
    child.stdin.end()
  })
}

/** Usage lu (au mieux) dans le flux d'évènements `--json` de Codex ; absent si le format ne le donne pas. */
export function usageFromEvents(jsonl: string): { inputTokens?: number; outputTokens?: number } {
  let input: number | undefined, output: number | undefined
  for (const line of jsonl.split("\n")) {
    if (!line.trim().startsWith("{")) continue
    let e: any; try { e = JSON.parse(line) } catch { continue }
    const u = e?.usage ?? e?.payload?.usage ?? e?.info?.total_token_usage ?? e?.total_token_usage
    if (u && typeof u === "object") {
      if (typeof u.input_tokens === "number") input = u.input_tokens
      if (typeof u.output_tokens === "number") output = u.output_tokens
    }
  }
  return { inputTokens: input, outputTokens: output }
}

export function codexAdapter(env: Env = process.env): LlmAdapter {
  const bin = env.LWS_CODEX_BIN || "codex"
  const timeoutMs = Number(env.LWS_LLM_TIMEOUT_MS) || 10 * 60_000
  return {
    name: "codex",
    async complete(req: LlmRequest): Promise<LlmResponse> {
      const dir = await mkdtemp(join(tmpdir(), "lws-codex-"))
      try {
        const outFile = join(dir, "last-message.txt")
        const args = ["exec", "--ephemeral", "--skip-git-repo-check", "--color", "never", "-s", "read-only", "-C", dir, "-o", outFile, "--json"]
        if (req.model && req.model.trim()) args.push("-m", req.model.trim())
        if (req.schema) {
          const schemaFile = join(dir, "schema.json")
          await writeFile(schemaFile, JSON.stringify(req.schema))
          args.push("--output-schema", schemaFile)
        }
        if (req.images?.length) {
          for (let i = 0; i < req.images.length; i++) {
            const img = req.images[i]
            const dst = join(dir, `img-${i}${EXT_BY_MEDIA[img.mediaType] ?? ".png"}`)
            await writeFile(dst, Buffer.from(img.data, "base64"))
            args.push("-i", dst)
          }
        }
        let prompt = `${req.system}\n\n${req.user}`
        if (req.images?.length) prompt += `\n\n## CAPTURES À ANALYSER\nLes ${req.images.length} image(s) jointes à ce message sont les captures à juger ; applique les instructions ci-dessus.`
        prompt += req.schema
          ? `\n\n———\nRéponds avec le JSON demandé ci-dessus (sortie structurée), sans aucun texte autour.`
          : `\n\n———\nRéponds UNIQUEMENT avec le JSON demandé ci-dessus, sans aucun texte autour, sans backticks.`
        args.push("-") // le prompt arrive sur stdin
        const r = await spawnCodex(bin, args, prompt, { env: codexEnv(env), cwd: dir, timeoutMs })
        let text = ""
        try { text = (await readFile(outFile, "utf8")).trim() } catch { /* pas de dernier message : erreur ci-dessous */ }
        if (r.code !== 0 && !text) {
          const why = (r.stderr || r.stdout).trim().slice(-600)
          const hint = /login|unauthori[sz]ed|not logged|sign in|401/i.test(why) ? " · `codex login` (abonnement ChatGPT) ou LWS_LLM=openai-compatible avec OPENAI_API_KEY" : ""
          throw new LlmError(`codex exec a échoué (code ${r.code})${hint} :\n${why}`, "codex")
        }
        if (!text) throw new LlmError(`codex exec (code ${r.code}) : aucun message final (fichier -o vide)`, "codex")
        let structured: unknown
        if (req.schema) { try { structured = JSON.parse(text) } catch { /* repli : extraction dans le texte par completeJson */ } }
        const usage = usageFromEvents(r.stdout)
        const model = req.model && req.model.trim() ? req.model.trim() : modelFromEvents(r.stdout) ?? "codex (défaut CLI)"
        return { provider: "codex", model, text, structured, usage }
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {})
      }
    },
  }
}

/** Le modèle annoncé par Codex dans ses évènements, si présent (`model` dans l'évènement de configuration). */
export function modelFromEvents(jsonl: string): string | undefined {
  for (const line of jsonl.split("\n")) {
    if (!line.trim().startsWith("{")) continue
    let e: any; try { e = JSON.parse(line) } catch { continue }
    const m = e?.model ?? e?.payload?.model ?? e?.config?.model ?? e?.session?.model
    if (typeof m === "string" && m) return m
  }
  return undefined
}
