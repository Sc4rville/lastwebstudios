/**
 * claude-code-status.ts · l'état du chemin PLAN, sans dépenser de requête modèle (sauf la sonde d'init).
 *
 *   claudeVersion(bin)       `claude --version` (installé ? quelle version ?)
 *   claudeAuth(bin, env)     `claude auth status` + variables : sur quoi un `claude -p` va-t-il facturer ?
 *   initProbe(bin, env)      lance `claude -p --output-format stream-json`, lit l'évènement system/init
 *                            (outils dispo, dont Workflow ; modèle) puis tue le process, avant la réponse.
 *
 * Ordre d'auth de Claude Code (code.claude.com/docs/en/authentication, « Authentication precedence ») :
 * fournisseur cloud > ANTHROPIC_AUTH_TOKEN > ANTHROPIC_API_KEY (toujours utilisée en -p) > apiKeyHelper >
 * CLAUDE_CODE_OAUTH_TOKEN > profils > login claude.ai. En `--bare`, ni OAuth ni login ne sont lus.
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
 * Ce qu'un `claude -p` LANCÉ PAR LE PRODUIT utilisera (le produit retire ANTHROPIC_API_KEY, cf. planEnv).
 * Remplace l'ancien « plan OFF (API) » affiché dès que CLAUDE_CODE_OAUTH_TOKEN manquait, même connecté.
 */
export function claudeAuth(bin: string, env: Env = process.env): ClaudeAuth {
  const version = claudeVersion(bin, env)
  if (!version) return { installed: false, loggedIn: false, source: "none", label: `Claude Code introuvable (${bin})` }
  const e = planEnv(env)
  if (e.CLAUDE_CODE_USE_BEDROCK || e.CLAUDE_CODE_USE_VERTEX || e.CLAUDE_CODE_USE_FOUNDRY) return { installed: true, version, loggedIn: true, source: "cloud", label: "fournisseur cloud (Bedrock / Vertex / Foundry)" }
  if (e.ANTHROPIC_AUTH_TOKEN) return { installed: true, version, loggedIn: true, source: "auth-token", label: `ANTHROPIC_AUTH_TOKEN${e.ANTHROPIC_BASE_URL ? ` → ${e.ANTHROPIC_BASE_URL}` : ""} (passerelle / serveur local, pas le plan)` }
  if (e.CLAUDE_CODE_OAUTH_TOKEN) return { installed: true, version, loggedIn: true, source: "plan-token", label: "plan ✓ (CLAUDE_CODE_OAUTH_TOKEN, claude setup-token)" }
  const r = spawnSync(bin, ["auth", "status"], { encoding: "utf8", env: e, timeout: 20_000 })
  let raw: any = null
  try { raw = JSON.parse(r.stdout) } catch { /* sortie texte (autres versions) */ }
  const loggedIn = raw ? raw.loggedIn === true : /logged in|connecté/i.test(r.stdout || "") && !/not logged in/i.test(r.stdout || "")
  if (loggedIn) {
    const method = String(raw?.authMethod ?? "claude.ai")
    const sub = raw?.subscriptionType ? String(raw.subscriptionType) : undefined
    const isPlan = /claude\.ai|oauth|subscription/i.test(method)
    return { installed: true, version, loggedIn: true, source: isPlan ? "plan-login" : "api-key", subscription: sub, raw,
      label: isPlan ? `plan ✓ (login ${method}${sub ? `, ${sub}` : ""})` : `connecté via ${method} (facturation API, pas le plan)` }
  }
  return { installed: true, version, loggedIn: false, source: "none", raw, label: "non connecté (ni login claude.ai ni CLAUDE_CODE_OAUTH_TOKEN)" }
}

export type InitInfo = { ok: boolean; tools: string[]; model?: string; apiKeySource?: string; error?: string }

/** Lit l'évènement `system/init` d'un `claude -p` puis le tue : la liste des outils réellement disponibles. */
export function initProbe(bin: string, env: Env = process.env, timeoutMs = 45_000, cwd?: string): Promise<InitInfo> {
  return new Promise((resolve) => {
    const child = spawn(bin, ["-p", "--output-format", "stream-json", "--verbose", "--strict-mcp-config"], { env: planEnv(env), cwd, stdio: ["pipe", "pipe", "pipe"] })
    let done = false
    const finish = (r: InitInfo) => { if (done) return; done = true; clearTimeout(timer); try { child.kill("SIGKILL") } catch { /* */ } resolve(r) }
    const timer = setTimeout(() => finish({ ok: false, tools: [], error: `pas d'évènement init en ${Math.round(timeoutMs / 1000)} s` }), timeoutMs)
    const lines = lineSplitter((line) => {
      if (done) return
      let e: any; try { e = JSON.parse(line) } catch { return }
      if (e.type === "system" && e.subtype === "init") return finish({ ok: true, tools: Array.isArray(e.tools) ? e.tools.map(String) : [], model: e.model, apiKeySource: e.apiKeySource })
      if (e.type === "result") return finish({ ok: false, tools: [], error: String(e.result ?? "résultat sans init").slice(0, 200) })
    })
    child.stdout.on("data", (b: Buffer) => lines.push(b))
    child.on("error", (e) => finish({ ok: false, tools: [], error: e.message }))
    child.on("close", (code) => { lines.end(); finish({ ok: false, tools: [], error: `claude -p sorti (code ${code}) avant l'init` }) })
    child.stdin.on("error", () => { /* */ })
    child.stdin.write("Réponds seulement : ok")
    child.stdin.end()
  })
}
