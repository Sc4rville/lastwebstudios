/**
 * codex · `codex exec` (OpenAI's Codex CLI, non-interactive): the ChatGPT SUBSCRIPTION way for the JSON skills.
 *
 * The skill's prompt + the input blocks go on stdin. Native structured output: `--output-schema <file>`
 * constrains the final answer to the skill's JSON schema; the answer is read from the `-o` file (the agent's last
 * message), never from the event stream. Images go with `-i` (attachments to the prompt).
 *
 * A PURE call: `read-only` sandbox, a temporary working folder (the agent doesn't see the repo), an
 * ephemeral session (`--ephemeral`, nothing written to ~/.codex/sessions), no git repo check.
 *
 * Auth: we REMOVE OPENAI_API_KEY from the subprocess's environment. With a key present, Codex bills the API
 * instead of the ChatGPT subscription (`codex login`). The key stays usable by the openai-compatible way.
 *
 * Model: `-m` only if a model is set (LWS_MODEL_<ROLE>, LWS_MODEL); otherwise the CLI's default
 * (the operator's config.toml) — we never guess an OpenAI model ID here. Binary: LWS_CODEX_BIN.
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

/** The environment of a `codex exec` on the subscription: no API key (otherwise API billing), the rest untouched. */
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
    child.on("error", (e) => { if (timer) clearTimeout(timer); reject(new LlmError(`spawn ${bin}: ${e.message} (is the Codex CLI installed? npm i -g @openai/codex, then codex login · npm run doctor)`, "codex")) })
    child.on("close", (code) => { if (timer) clearTimeout(timer); resolve({ code: code ?? -1, stdout: stdout.text(), stderr: stderr.text() }) })
    child.stdin.on("error", () => { /* the process left before the write finished: the exit code will say why */ })
    child.stdin.write(stdin)
    child.stdin.end()
  })
}

/** Usage read (at best) from Codex's `--json` event stream; absent if the format doesn't give it. */
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
        if (req.images?.length) prompt += `\n\n## SCREENSHOTS TO ANALYSE\nThe ${req.images.length} image(s) attached to this message are the screenshots to judge; apply the instructions above.`
        prompt += req.schema
          ? `\n\n———\nAnswer with the JSON requested above (structured output), with no text around it.`
          : `\n\n———\nAnswer ONLY with the JSON requested above, with no text around it and no backticks.`
        args.push("-") // the prompt arrives on stdin
        const r = await spawnCodex(bin, args, prompt, { env: codexEnv(env), cwd: dir, timeoutMs })
        let text = ""
        try { text = (await readFile(outFile, "utf8")).trim() } catch { /* no last message: error below */ }
        if (r.code !== 0 && !text) {
          const why = (r.stderr || r.stdout).trim().slice(-600)
          const hint = /login|unauthori[sz]ed|not logged|sign in|401/i.test(why) ? " · `codex login` (ChatGPT subscription) or LWS_LLM=openai-compatible with OPENAI_API_KEY" : ""
          throw new LlmError(`codex exec failed (code ${r.code})${hint}:\n${why}`, "codex")
        }
        if (!text) throw new LlmError(`codex exec (code ${r.code}): no final message (empty -o file)`, "codex")
        let structured: unknown
        if (req.schema) { try { structured = JSON.parse(text) } catch { /* fallback: extraction from the text by completeJson */ } }
        const usage = usageFromEvents(r.stdout)
        const model = req.model && req.model.trim() ? req.model.trim() : modelFromEvents(r.stdout) ?? "codex (CLI default)"
        return { provider: "codex", model, text, structured, usage }
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {})
      }
    },
  }
}

/** The model Codex announces in its events, if present (`model` in the configuration event). */
export function modelFromEvents(jsonl: string): string | undefined {
  for (const line of jsonl.split("\n")) {
    if (!line.trim().startsWith("{")) continue
    let e: any; try { e = JSON.parse(line) } catch { continue }
    const m = e?.model ?? e?.payload?.model ?? e?.config?.model ?? e?.session?.model
    if (typeof m === "string" && m) return m
  }
  return undefined
}
