/**
 * claude-code · `claude -p` (Claude Code headless) : la voie PLAN, sur l'abonnement Claude de l'opérateur.
 *
 * Le prompt du skill + les blocs d'entrée partent sur stdin. Sortie structurée native : `--json-schema` →
 * champ `structured_output` de l'enveloppe JSON ; s'il manque (refus, vieille CLI, modèle local), le JSON est
 * extrait du texte `result` (repli). Les images sont écrites dans un dossier temporaire que l'agent lit avec
 * l'outil Read (seul outil autorisé, et seulement dans ce cas).
 *
 * Auth : on RETIRE ANTHROPIC_API_KEY de l'environnement du sous-process. En `-p`, Claude Code utilise toujours
 * une clé API présente, avant le token du plan et le login claude.ai (docs « Authentication precedence ») : la
 * laisser ferait facturer l'API au lieu du plan, ou échouer si la clé est morte. ANTHROPIC_AUTH_TOKEN et
 * ANTHROPIC_BASE_URL (passerelle, serveur local) restent : ce sont des choix explicites.
 */
import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { LlmAdapter, LlmRequest, LlmResponse } from "../types.ts"
import { LlmError } from "../types.ts"
import { textCollector } from "../../shared/lines.mjs"

type Env = Record<string, string | undefined>

export const EXT_BY_MEDIA: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" }

/** L'environnement d'un `claude -p` sur le plan : sans clé API (sinon facturation API), le reste intact. */
export function planEnv(env: Env = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env }
  delete out.ANTHROPIC_API_KEY
  return out
}

/** `--bare` (ou CLAUDE_CODE_SIMPLE=1) : ni login du plan, ni CLAUDE_CODE_OAUTH_TOKEN, ni skills. Signalé. */
export function bareRisk(args: string[], env: Env = process.env): string | null {
  if (args.includes("--bare")) return "`--bare` dans les arguments de claude"
  if (env.CLAUDE_CODE_SIMPLE === "1") return "CLAUDE_CODE_SIMPLE=1 dans l'environnement"
  return null
}

export function spawnClaude(bin: string, args: string[], stdin: string, o: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env: o.env ?? planEnv(), cwd: o.cwd, stdio: ["pipe", "pipe", "pipe"] })
    // octets accumulés puis décodés UNE fois : un « é » coupé entre deux lectures du tube resterait sinon « �� » dans la fiche
    const stdout = textCollector(), stderr = textCollector(1_000_000)
    const timer = o.timeoutMs ? setTimeout(() => { try { child.kill("SIGTERM") } catch { /* */ } }, o.timeoutMs) : null
    child.stdout.on("data", (b: Buffer) => stdout.push(b))
    child.stderr.on("data", (b: Buffer) => stderr.push(b))
    child.on("error", (e) => { if (timer) clearTimeout(timer); reject(new LlmError(`spawn ${bin} : ${e.message} (Claude Code installé ? npm run doctor)`, "claude-code")) })
    child.on("close", (code) => { if (timer) clearTimeout(timer); resolve({ code: code ?? -1, stdout: stdout.text(), stderr: stderr.text() }) })
    child.stdin.on("error", () => { /* process parti avant la fin de l'écriture : le code de sortie dira pourquoi */ })
    child.stdin.write(stdin)
    child.stdin.end()
  })
}

export function claudeCodeAdapter(env: Env = process.env): LlmAdapter {
  const bin = env.CLAUDE_BIN || "claude"
  return {
    name: "claude-code",
    async complete(req: LlmRequest): Promise<LlmResponse> {
      // appel PUR (un skill JSON, pas un agent) : aucun outil intégré sauf Read pour les images, aucun serveur MCP
      // (ni le .mcp.json du dépôt, ni les connecteurs claude.ai), réglages du PROJET seulement (pas les hooks ni
      // plugins de l'utilisateur). Mesuré le 24/10 : ~25 k → ~0,9 k jetons de contexte par appel sur le plan.
      const args = ["-p", "--output-format", "json", "--model", req.model, "--strict-mcp-config", "--setting-sources", env.LWS_CLAUDE_SETTING_SOURCES || "project"]
      if (req.schema) args.push("--json-schema", JSON.stringify(req.schema))
      let prompt = `${req.system}\n\n${req.user}`
      let dir: string | null = null
      try {
        if (req.images?.length) {
          dir = await mkdtemp(join(tmpdir(), "lws-skill-"))
          const paths: string[] = []
          for (let i = 0; i < req.images.length; i++) {
            const img = req.images[i]
            const dst = join(dir, `img-${i}${EXT_BY_MEDIA[img.mediaType] ?? ".png"}`)
            await writeFile(dst, Buffer.from(img.data, "base64"))
            paths.push(dst)
          }
          prompt += `\n\n## CAPTURES À ANALYSER\nLis ces images avec l'outil Read, puis applique les instructions :\n` + paths.map((p) => `- ${p}`).join("\n")
          args.push("--tools", "Read", "--allowedTools", "Read", "--add-dir", dir)
        } else {
          args.push("--tools", "") // les skills sans image n'ont besoin d'AUCUN outil
        }
        prompt += req.schema
          ? `\n\n———\nRéponds avec le JSON demandé ci-dessus (sortie structurée).`
          : `\n\n———\nRéponds UNIQUEMENT avec le JSON demandé ci-dessus, sans aucun texte autour, sans backticks.`

        const r = await spawnClaude(bin, args, prompt, { env: planEnv(env) })
        let envl: any
        try { envl = JSON.parse(r.stdout) } catch {
          throw new LlmError(`claude -p (code ${r.code}) : sortie non-JSON :\n${(r.stdout || r.stderr).slice(0, 500)}`, "claude-code")
        }
        if (envl.is_error || envl.subtype !== "success") {
          const why = String(envl.result ?? r.stderr ?? "").slice(0, 300)
          throw new LlmError(`claude -p a échoué (subtype=${envl.subtype}, api_error=${envl.api_error_status ?? "?"}) : ${why}`, "claude-code", envl.api_error_status ?? undefined)
        }
        const models = Object.keys(envl.modelUsage ?? {})
        return {
          provider: "claude-code",
          model: models[0] ?? req.model,
          text: typeof envl.result === "string" ? envl.result : "",
          structured: envl.structured_output ?? undefined,
          usage: { inputTokens: envl.usage?.input_tokens, outputTokens: envl.usage?.output_tokens, costUsd: typeof envl.total_cost_usd === "number" ? envl.total_cost_usd : undefined },
          stopReason: envl.stop_reason ?? undefined,
        }
      } finally {
        if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
      }
    },
  }
}
