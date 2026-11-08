/**
 * codex-status.ts · the state of the CODEX way (ChatGPT subscription), without spending a model request.
 *
 *   codexVersion(bin)      `codex --version` (installed? which version?)
 *   codexAuth(bin, env)    `codex login status`: signed in? with a ChatGPT subscription or an API key?
 *
 * The product removes OPENAI_API_KEY from the environment of its `codex exec` runs (see adapters/codex.ts): a key in
 * the .env therefore doesn't switch billing to the API; only the login counts here.
 */
import { spawnSync } from "node:child_process"
import { codexEnv } from "./adapters/codex.ts"

type Env = Record<string, string | undefined>

export type CodexAuth = {
  installed: boolean
  version?: string
  loggedIn: boolean
  /** "chatgpt" (subscription) · "api-key" (a key saved in Codex) · "none" */
  source: "chatgpt" | "api-key" | "none"
  label: string
  raw?: string
}

export function codexVersion(bin: string, env: Env = process.env): string | null {
  const r = spawnSync(bin, ["--version"], { encoding: "utf8", env: env as NodeJS.ProcessEnv, timeout: 20_000 })
  if (r.status !== 0 || !r.stdout) return null
  return (/(\d+\.\d+\.\d+)/.exec(r.stdout)?.[1]) ?? r.stdout.trim()
}

export function codexAuth(bin: string, env: Env = process.env): CodexAuth {
  const version = codexVersion(bin, env)
  if (!version) return { installed: false, loggedIn: false, source: "none", label: `Codex CLI not found (${bin})` }
  const r = spawnSync(bin, ["login", "status"], { encoding: "utf8", env: codexEnv(env), timeout: 20_000 })
  const out = `${r.stdout || ""}\n${r.stderr || ""}`.trim()
  if (r.status === 0 && /logged in/i.test(out) && !/not logged in/i.test(out)) {
    const api = /api key/i.test(out)
    return { installed: true, version, loggedIn: true, source: api ? "api-key" : "chatgpt", raw: out,
      label: api ? "signed in with an API key (billed per token, not the subscription)" : "ChatGPT subscription ✓ (codex login)" }
  }
  return { installed: true, version, loggedIn: false, source: "none", raw: out, label: "not signed in: run `codex login`" }
}
