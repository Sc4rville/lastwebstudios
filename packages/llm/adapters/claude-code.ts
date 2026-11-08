/**
 * claude-code · `claude -p` (headless Claude Code): the PLAN way, on the operator's Claude subscription.
 *
 * The skill's prompt + the input blocks go on stdin. Native structured output: `--json-schema` →
 * the `structured_output` field of the JSON envelope; if it's missing (refusal, old CLI, local model), the JSON is
 * extracted from the `result` text (fallback). Images are written to a temporary folder that the agent reads with
 * the Read tool (the only tool allowed, and only in that case).
 *
 * Auth: we REMOVE ANTHROPIC_API_KEY from the subprocess's environment. With `-p`, Claude Code always uses
 * an API key that is present, before the plan's token and the claude.ai login (docs "Authentication precedence"):
 * leaving it would bill the API instead of the plan, or fail if the key is dead. ANTHROPIC_AUTH_TOKEN and
 * ANTHROPIC_BASE_URL (gateway, local server) stay: they are explicit choices.
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

/** The environment of a `claude -p` on the plan: no API key (otherwise API billing), the rest untouched. */
export function planEnv(env: Env = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env }
  delete out.ANTHROPIC_API_KEY
  return out
}

/** `--bare` (or CLAUDE_CODE_SIMPLE=1): no plan login, no CLAUDE_CODE_OAUTH_TOKEN, no skills. Reported. */
export function bareRisk(args: string[], env: Env = process.env): string | null {
  if (args.includes("--bare")) return "`--bare` in claude's arguments"
  if (env.CLAUDE_CODE_SIMPLE === "1") return "CLAUDE_CODE_SIMPLE=1 in the environment"
  return null
}

export function spawnClaude(bin: string, args: string[], stdin: string, o: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env: o.env ?? planEnv(), cwd: o.cwd, stdio: ["pipe", "pipe", "pipe"] })
    // bytes accumulated, then decoded ONCE: an "é" split between two pipe reads would otherwise stay "��" in the sheet
    const stdout = textCollector(), stderr = textCollector(1_000_000)
    const timer = o.timeoutMs ? setTimeout(() => { try { child.kill("SIGTERM") } catch { /* */ } }, o.timeoutMs) : null
    child.stdout.on("data", (b: Buffer) => stdout.push(b))
    child.stderr.on("data", (b: Buffer) => stderr.push(b))
    child.on("error", (e) => { if (timer) clearTimeout(timer); reject(new LlmError(`spawn ${bin}: ${e.message} (is Claude Code installed? npm run doctor)`, "claude-code")) })
    child.on("close", (code) => { if (timer) clearTimeout(timer); resolve({ code: code ?? -1, stdout: stdout.text(), stderr: stderr.text() }) })
    child.stdin.on("error", () => { /* the process left before the write finished: the exit code will say why */ })
    child.stdin.write(stdin)
    child.stdin.end()
  })
}

export function claudeCodeAdapter(env: Env = process.env): LlmAdapter {
  const bin = env.CLAUDE_BIN || "claude"
  return {
    name: "claude-code",
    async complete(req: LlmRequest): Promise<LlmResponse> {
      // a PURE call (a JSON skill, not an agent): no built-in tool except Read for images, no MCP server
      // (neither the repo's .mcp.json nor the claude.ai connectors), PROJECT settings only (not the user's hooks or
      // plugins). Measured on 24/10: ~25 k → ~0.9 k context tokens per call on the plan.
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
          prompt += `\n\n## SCREENSHOTS TO ANALYSE\nRead these images with the Read tool, then apply the instructions:\n` + paths.map((p) => `- ${p}`).join("\n")
          args.push("--tools", "Read", "--allowedTools", "Read", "--add-dir", dir)
        } else {
          args.push("--tools", "") // skills without images need NO tool
        }
        prompt += req.schema
          ? `\n\n———\nAnswer with the JSON requested above (structured output).`
          : `\n\n———\nAnswer ONLY with the JSON requested above, with no text around it and no backticks.`

        const r = await spawnClaude(bin, args, prompt, { env: planEnv(env) })
        let envl: any
        try { envl = JSON.parse(r.stdout) } catch {
          throw new LlmError(`claude -p (code ${r.code}): the output is not JSON:\n${(r.stdout || r.stderr).slice(0, 500)}`, "claude-code")
        }
        if (envl.is_error || envl.subtype !== "success") {
          const why = String(envl.result ?? r.stderr ?? "").slice(0, 300)
          throw new LlmError(`claude -p failed (subtype=${envl.subtype}, api_error=${envl.api_error_status ?? "?"}): ${why}`, "claude-code", envl.api_error_status ?? undefined)
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
