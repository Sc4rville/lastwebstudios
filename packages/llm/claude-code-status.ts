/**
 * claude-code-status.ts · the state of the PLAN path, without spending a model request (except the init probe).
 *
 *   claudeVersion(bin)       `claude --version` (installed? which version?)
 *   claudeAuth(bin, env)     `claude auth status` + variables: what will a `claude -p` bill?
 *   initProbe(bin, env)      runs `claude -p --output-format stream-json`, reads the system/init event
 *                            (available tools, Workflow among them; model), then kills the process before the answer.
 *
 * Claude Code's auth order (code.claude.com/docs/en/authentication, "Authentication precedence"):
 * cloud provider > ANTHROPIC_AUTH_TOKEN > ANTHROPIC_API_KEY (always used with -p) > apiKeyHelper >
 * CLAUDE_CODE_OAUTH_TOKEN > profiles > claude.ai login. With `--bare`, neither OAuth nor the login is read.
 */
import { spawn, spawnSync } from "node:child_process"
import { planEnv } from "./adapters/claude-code.ts"
import { lineSplitter } from "../shared/lines.mjs"

type Env = Record<string, string | undefined>

export type ClaudeAuth = {
  installed: boolean
  version?: string
  loggedIn: boolean
  /** "plan-token" (CLAUDE_CODE_OAUTH_TOKEN) · "plan-login" (claude.ai) · "api-key" · "auth-token" · "cloud" · "none" */
  source: "plan-token" | "plan-login" | "api-key" | "auth-token" | "cloud" | "none"
  subscription?: string
  label: string
  raw?: unknown
}

export function claudeVersion(bin: string, env: Env = process.env): string | null {
  const r = spawnSync(bin, ["--version"], { encoding: "utf8", env: env as NodeJS.ProcessEnv, timeout: 20_000 })
  if (r.status !== 0 || !r.stdout) return null
  return (/(\d+\.\d+\.\d+)/.exec(r.stdout)?.[1]) ?? r.stdout.trim()
}

/**
 * What a `claude -p` STARTED BY THE PRODUCT will use (the product removes ANTHROPIC_API_KEY, see planEnv).
 * Replaces the old "plan OFF (API)" shown whenever CLAUDE_CODE_OAUTH_TOKEN was missing, even when signed in.
 */
export function claudeAuth(bin: string, env: Env = process.env): ClaudeAuth {
  const version = claudeVersion(bin, env)
  if (!version) return { installed: false, loggedIn: false, source: "none", label: `Claude Code not found (${bin})` }
  const e = planEnv(env)
  if (e.CLAUDE_CODE_USE_BEDROCK || e.CLAUDE_CODE_USE_VERTEX || e.CLAUDE_CODE_USE_FOUNDRY) return { installed: true, version, loggedIn: true, source: "cloud", label: "cloud provider (Bedrock / Vertex / Foundry)" }
  if (e.ANTHROPIC_AUTH_TOKEN) return { installed: true, version, loggedIn: true, source: "auth-token", label: `ANTHROPIC_AUTH_TOKEN${e.ANTHROPIC_BASE_URL ? ` → ${e.ANTHROPIC_BASE_URL}` : ""} (gateway / local server, not the plan)` }
  if (e.CLAUDE_CODE_OAUTH_TOKEN) return { installed: true, version, loggedIn: true, source: "plan-token", label: "subscription ✓ (CLAUDE_CODE_OAUTH_TOKEN, claude setup-token)" }
  const r = spawnSync(bin, ["auth", "status"], { encoding: "utf8", env: e, timeout: 20_000 })
  let raw: any = null
  try { raw = JSON.parse(r.stdout) } catch { /* text output (other versions) */ }
  const loggedIn = raw ? raw.loggedIn === true : /logged in|connecté/i.test(r.stdout || "") && !/not logged in/i.test(r.stdout || "")
  if (loggedIn) {
    const method = String(raw?.authMethod ?? "claude.ai")
    const sub = raw?.subscriptionType ? String(raw.subscriptionType) : undefined
    const isPlan = /claude\.ai|oauth|subscription/i.test(method)
    return { installed: true, version, loggedIn: true, source: isPlan ? "plan-login" : "api-key", subscription: sub, raw,
      label: isPlan ? `subscription ✓ (signed in with ${method}${sub ? `, ${sub}` : ""})` : `signed in with ${method} (billed per token, not the subscription)` }
  }
  return { installed: true, version, loggedIn: false, source: "none", raw, label: "not signed in (no claude.ai login, no CLAUDE_CODE_OAUTH_TOKEN): run `claude auth login`" }
}

export type InitInfo = { ok: boolean; tools: string[]; model?: string; apiKeySource?: string; error?: string }

/** Reads a `claude -p`'s `system/init` event, then kills it: the list of the tools really available. */
export function initProbe(bin: string, env: Env = process.env, timeoutMs = 45_000, cwd?: string): Promise<InitInfo> {
  return new Promise((resolve) => {
    const child = spawn(bin, ["-p", "--output-format", "stream-json", "--verbose", "--strict-mcp-config"], { env: planEnv(env), cwd, stdio: ["pipe", "pipe", "pipe"] })
    let done = false
    const finish = (r: InitInfo) => { if (done) return; done = true; clearTimeout(timer); try { child.kill("SIGKILL") } catch { /* */ } resolve(r) }
    const timer = setTimeout(() => finish({ ok: false, tools: [], error: `no init event within ${Math.round(timeoutMs / 1000)} s` }), timeoutMs)
    const lines = lineSplitter((line) => {
      if (done) return
      let e: any; try { e = JSON.parse(line) } catch { return }
      if (e.type === "system" && e.subtype === "init") return finish({ ok: true, tools: Array.isArray(e.tools) ? e.tools.map(String) : [], model: e.model, apiKeySource: e.apiKeySource })
      if (e.type === "result") return finish({ ok: false, tools: [], error: String(e.result ?? "a result without init").slice(0, 200) })
    })
    child.stdout.on("data", (b: Buffer) => lines.push(b))
    child.on("error", (e) => finish({ ok: false, tools: [], error: e.message }))
    child.on("close", (code) => { lines.end(); finish({ ok: false, tools: [], error: `claude -p exited (code ${code}) before the init` }) })
    child.stdin.on("error", () => { /* */ })
    child.stdin.write("Reply only: ok")
    child.stdin.end()
  })
}
