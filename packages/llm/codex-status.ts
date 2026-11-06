/**
 * codex-status.ts · l'état de la voie CODEX (abonnement ChatGPT), sans dépenser de requête modèle.
 *
 *   codexVersion(bin)      `codex --version` (installé ? quelle version ?)
 *   codexAuth(bin, env)    `codex login status` : connecté ? par abonnement ChatGPT ou par clé API ?
 *
 * Le produit retire OPENAI_API_KEY de l'environnement de ses `codex exec` (cf. adapters/codex.ts) : une clé dans
 * le .env ne fait donc pas basculer la facturation vers l'API ; seul le login compte ici.
 */
import { spawnSync } from "node:child_process"
import { codexEnv } from "./adapters/codex.ts"

type Env = Record<string, string | undefined>

export type CodexAuth = {
  installed: boolean
  version?: string
  loggedIn: boolean
  /** "chatgpt" (abonnement) · "api-key" (clé enregistrée dans Codex) · "none" */
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
  if (!version) return { installed: false, loggedIn: false, source: "none", label: `Codex CLI introuvable (${bin})` }
  const r = spawnSync(bin, ["login", "status"], { encoding: "utf8", env: codexEnv(env), timeout: 20_000 })
  const out = `${r.stdout || ""}\n${r.stderr || ""}`.trim()
  if (r.status === 0 && /logged in/i.test(out) && !/not logged in/i.test(out)) {
    const api = /api key/i.test(out)
    return { installed: true, version, loggedIn: true, source: api ? "api-key" : "chatgpt", raw: out,
      label: api ? "connecté par clé API (facturation API, pas l'abonnement)" : "abonnement ChatGPT ✓ (codex login)" }
  }
  return { installed: true, version, loggedIn: false, source: "none", raw: out, label: "non connecté (codex login)" }
}
