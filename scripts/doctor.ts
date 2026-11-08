/**
 * doctor.ts · `npm run doctor`: says EXACTLY what is missing to run LWS on this machine, and how to fix it.
 *
 * One line per check: ✓ ready · ⚠ optional or worth a look · ✗ blocking ("missing X ⇒ do Y"). Exit 0 when nothing
 * blocks, 1 otherwise. No paid request: the only model-side probe reads the init event of a `claude -p` (the
 * process is killed before any answer), and the Claude API check is a free GET /v1/models proving the key is alive.
 *
 * Profiles (--for):
 *   (default) / first-site   getting started: sandbox + `npm run first-site` on your subscription. No database needed.
 *   agency / 24-7            the always-on agency: database, sending, tracking, worker details on top.
 *
 * Usage: npm run doctor [-- --for first-site|agency] [--json] [--offline] [--help]
 */
import { demoLeftovers, readExamples, EXAMPLE_FILES } from "../packages/shared/agency-demo.mjs"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { selectProvider, resolveModel, ROLES, type ProviderName } from "../packages/llm/index.ts"
import { bareRisk } from "../packages/llm/adapters/claude-code.ts"
import { claudeAuth, initProbe, type ClaudeAuth } from "../packages/llm/claude-code-status.ts"
import { codexAuth } from "../packages/llm/codex-status.ts"
import { imageEngine, videoEngine, onPath } from "../packages/shared/media.mjs"
import { workerClaudeArgs, STALE_TOOLS } from "../worker/claude-args.ts"
import { trackConfig, trackBase } from "../outreach/tracking/links.ts"

export type Status = "ok" | "warn" | "fail" | "info"
export type Check = { id: string; status: Status; label: string; detail: string; fix?: string }
export type DoctorOptions = { target: "agency" | "first-site"; offline: boolean; env: Record<string, string | undefined>; cwd: string }
export type DoctorReport = { ok: boolean; target: DoctorOptions["target"]; failures: number; warnings: number; provider: ProviderName | null; checks: Check[] }

const MIN_NODE: [number, number] = [20, 12]

/** What each model role does, in user words (the roles themselves live in packages/llm/models.ts). */
const ROLE_WORDS: Record<string, string> = {
  smart: "writes the sites, the edits and the sales email",
  fast: "reads a business's site into what the agency knows about it",
  judge: "compares screenshots of the old and the new site",
}
/** the line's name : what that AI does, never the role's code name */
const ROLE_LABEL: Record<string, string> = { smart: "AI that writes the sites", fast: "AI that reads their site", judge: "AI that compares old and new" }

function nodeCheck(): Check {
  const [maj, min] = process.versions.node.split(".").map(Number)
  const ok = maj > MIN_NODE[0] || (maj === MIN_NODE[0] && min >= MIN_NODE[1])
  return ok
    ? { id: "node", status: "ok", label: "Node", detail: `v${process.versions.node}${maj < 24 ? " (24 recommended, same as the Docker image)" : ""}` }
    : { id: "node", status: "fail", label: "Node", detail: `v${process.versions.node} < ${MIN_NODE.join(".")}`, fix: "install Node 24 (nvm install 24 && nvm use 24), then npm ci" }
}

function depsCheck(cwd: string): Check {
  const missing = ["@anthropic-ai/sdk", "playwright", "postgres", "tsx"].filter((p) => !existsSync(join(cwd, "node_modules", p, "package.json")))
  if (missing.length) return { id: "deps", status: "fail", label: "npm packages", detail: `missing ${missing.join(", ")}`, fix: "npm ci" }
  const sdk = JSON.parse(readFileSync(join(cwd, "node_modules", "@anthropic-ai/sdk", "package.json"), "utf8")).version as string
  if (Number(sdk.split(".")[0]) < 1) return { id: "deps", status: "fail", label: "npm packages", detail: `@anthropic-ai/sdk ${sdk} (< 1.0)`, fix: "npm ci (the lockfile pins 1.x)" }
  return { id: "deps", status: "ok", label: "npm packages", detail: "installed" }
}

function chromiumCheck(cwd: string): Check {
  try {
    const req = createRequire(join(cwd, "package.json"))
    const { chromium } = req("playwright") as typeof import("playwright")
    const exe = chromium.executablePath()
    if (exe && existsSync(exe)) return { id: "chromium", status: "ok", label: "Chromium (Playwright)", detail: "installed" }
    return { id: "chromium", status: "fail", label: "Chromium (Playwright)", detail: "browser missing (needed to read sites, take screenshots and check builds)", fix: "npx playwright install chromium (bare Linux: npx playwright install --with-deps chromium)" }
  } catch (e) {
    return { id: "chromium", status: "fail", label: "Chromium (Playwright)", detail: `playwright unreadable: ${(e as Error).message.split("\n")[0]}`, fix: "npm ci && npx playwright install chromium" }
  }
}

async function getJson(url: string, headers: Record<string, string>): Promise<{ ok: boolean; status: number; body: any; error?: string }> {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) })
    const txt = await r.text()
    let body: any = null; try { body = JSON.parse(txt) } catch { body = txt.slice(0, 200) }
    return { ok: r.ok, status: r.status, body }
  } catch (e) { return { ok: false, status: 0, body: null, error: (e as Error).message } }
}

/** The login line, in plain words: what a `claude -p` started by the product will run on. */
export function describeAuth(auth: ClaudeAuth, env: DoctorOptions["env"]): string {
  const v = auth.version ? `v${auth.version} · ` : ""
  switch (auth.source) {
    case "plan-login": return `${v}logged in (claude.ai${auth.subscription ? `, ${auth.subscription} plan` : ""})`
    case "plan-token": return `${v}logged in (CLAUDE_CODE_OAUTH_TOKEN from claude setup-token)`
    case "api-key": return `${v}logged in via an API key (billed per token, not your plan)`
    case "auth-token": return `${v}ANTHROPIC_AUTH_TOKEN${env.ANTHROPIC_BASE_URL ? ` → ${env.ANTHROPIC_BASE_URL}` : ""} (gateway or local server, not your plan)`
    case "cloud": return `${v}cloud provider (Bedrock / Vertex / Foundry)`
    default: return `${v}not logged in`
  }
}

function claudeCodeChecks(auth: ClaudeAuth, env: DoctorOptions["env"], role: "LLM way" | "composer"): Check[] {
  const out: Check[] = []
  const bin = env.CLAUDE_BIN || "claude"
  const label = role === "composer" ? "Claude Code (builds the sites)" : "Claude Code"
  if (!auth.installed) {
    out.push({ id: "claude-code", status: "fail", label, detail: `not found (${bin})`, fix: "curl -fsSL https://claude.ai/install.sh | bash (native installer, auto-updates) or npm i -g @anthropic-ai/claude-code" })
    return out
  }
  if (!auth.loggedIn) {
    out.push({ id: "claude-code", status: "fail", label, detail: describeAuth(auth, env), fix: "claude auth login (your Pro or Max subscription); on a server: claude setup-token, then CLAUDE_CODE_OAUTH_TOKEN=… in .env" })
  } else {
    out.push({ id: "claude-code", status: "ok", label, detail: describeAuth(auth, env) })
  }
  if (env.ANTHROPIC_API_KEY) out.push({ id: "claude-api-key", status: "info", label: "ANTHROPIC_API_KEY", detail: "present: the product removes it from every `claude -p` (otherwise Claude Code would bill the API instead of your plan)" })
  return out
}

function bareCheck(env: DoctorOptions["env"], target: DoctorOptions["target"]): Check[] {
  const args = workerClaudeArgs(env)
  const out: Check[] = []
  const risk = bareRisk(args, env)
  if (risk) out.push({ id: "bare", status: "fail", label: "Claude Code `--bare` mode", detail: `${risk}: in that mode Claude Code reads neither your login, nor CLAUDE_CODE_OAUTH_TOKEN, nor the repository's skills`, fix: "remove --bare from WORKER_CLAUDE_ARGS and CLAUDE_CODE_SIMPLE from the environment" })
  else if (target === "agency") out.push({ id: "bare", status: "ok", label: "Claude Code `--bare` mode", detail: "off (good: the worker needs your login and the repository's skills)" })
  const stale = args.filter((a) => STALE_TOOLS[a])
  if (stale.length) out.push({ id: "worker-tools", status: "warn", label: "Worker tools", detail: `WORKER_CLAUDE_ARGS names ${stale.map((t) => `${t} (${STALE_TOOLS[t]})`).join(", ")}`, fix: "remove WORKER_CLAUDE_ARGS to get the current list back (worker/claude-args.ts)" })
  return out
}

async function workflowCheck(auth: ClaudeAuth, o: DoctorOptions): Promise<Check> {
  const label = "Agents in parallel (Max plan)"
  if (!auth.installed || !auth.loggedIn) return { id: "workflow", status: "warn", label, detail: "not checked (Claude Code missing or not logged in)", fix: "fix Claude Code first, then run npm run doctor again" }
  if (o.offline) return { id: "workflow", status: "info", label, detail: "not checked (--offline)" }
  const init = await initProbe(o.env.CLAUDE_BIN || "claude", o.env, 45_000, o.cwd)
  if (!init.ok) return { id: "workflow", status: "warn", label, detail: `the claude -p probe did not answer: ${init.error}`, fix: "run `claude -p \"ok\"` by hand to see the error" }
  if (init.tools.includes("Workflow")) return { id: "workflow", status: "ok", label, detail: "available: sites are built by several agents in parallel" }
  // not a problem : a Pro plan builds one agent at a time, and first-site picks that by itself (nothing to do)
  return { id: "workflow", status: "info", label, detail: "not on this plan (usual on Pro): sites are built one agent at a time, first-site picks that by itself (--engine local); nothing to do" }
}

async function llmChecks(o: DoctorOptions): Promise<{ checks: Check[]; provider: ProviderName | null; auth: ClaudeAuth | null }> {
  const checks: Check[] = []
  let choice
  try { choice = selectProvider(o.env) } catch (e) {
    checks.push({ id: "llm", status: "fail", label: "AI provider (LWS_LLM)", detail: (e as Error).message, fix: "LWS_LLM=claude-code | codex | anthropic | anthropic-compatible | openai-compatible" })
    return { checks, provider: null, auth: null }
  }
  const WAY: Record<ProviderName, string> = {
    "claude-code": "your Claude subscription, through Claude Code",
    codex: "your ChatGPT subscription, through the Codex CLI",
    anthropic: "the Claude API (billed per token)",
    "anthropic-compatible": "a Messages-API server (Ollama, LM Studio, LiteLLM, a gateway)",
    "openai-compatible": "a Chat-Completions server (OpenAI, OpenRouter, Groq, vLLM…)",
  }
  // ✓ only when that way can really answer : a Claude subscription with Claude Code signed out is not ready yet
  const auth0 = choice.name === "claude-code" ? claudeAuth(o.env.CLAUDE_BIN || "claude", o.env) : null
  const ready = !auth0 || (auth0.installed && auth0.loggedIn)
  const why = /^default/.test(choice.why) ? "" : ` (${choice.why})`
  checks.push({ id: "llm", status: ready ? "ok" : "warn", label: "AI for the lighter steps", detail: ready ? `${WAY[choice.name]}${why}` : `${WAY[choice.name]}, once Claude Code is ${auth0!.installed ? "signed in" : "installed and signed in"} (the Claude Code line below)${why}` })
  for (const role of ROLES) {
    try {
      const m = resolveModel(role, choice.name, o.env)
      checks.push({ id: `model-${role}`, status: "info", label: ROLE_LABEL[role] || role, detail: `${m.model || "the CLI's default"} (${m.source}): ${ROLE_WORDS[role]}` })
    } catch (e) {
      checks.push({ id: `model-${role}`, status: "fail", label: ROLE_LABEL[role] || role, detail: (e as Error).message, fix: `put LWS_MODEL_${role.toUpperCase()}=<model> or LWS_MODEL=<model> in .env (cp .env.example .env first)` })
    }
  }
  // Claude Code: the default way for the skills AND the engine of the composer (agents), whatever way the skills use
  const auth = auth0 || claudeAuth(o.env.CLAUDE_BIN || "claude", o.env)
  if (choice.name === "claude-code") checks.push(...claudeCodeChecks(auth, o.env, "LLM way"))
  else checks.push(...claudeCodeChecks(auth, o.env, "composer").map((c) => c.id === "claude-code" && c.status === "fail" ? { ...c, detail: c.detail + " · the composer (the agents that build the sites) needs Claude Code even when the skills run elsewhere" } : c))

  if (choice.name === "codex") {
    const cx = codexAuth(o.env.LWS_CODEX_BIN || "codex", o.env)
    if (!cx.installed) checks.push({ id: "llm-auth", status: "fail", label: "Codex CLI", detail: "not found", fix: "npm i -g @openai/codex, then `codex login` (ChatGPT subscription) · or LWS_LLM=claude-code" })
    else if (!cx.loggedIn) checks.push({ id: "llm-auth", status: "fail", label: "Codex CLI", detail: `v${cx.version} · not logged in`, fix: "codex login (ChatGPT subscription)" })
    else checks.push({ id: "llm-auth", status: cx.source === "api-key" ? "warn" : "ok", label: "Codex CLI", detail: `v${cx.version} · ${cx.source === "api-key" ? "logged in with an API key (billed per token, not your subscription)" : "logged in (ChatGPT subscription)"}`, ...(cx.source === "api-key" ? { fix: "codex logout, then codex login with your ChatGPT account" } : {}) })
  } else if (choice.name === "anthropic") {
    const key = o.env.ANTHROPIC_API_KEY || o.env.ANTHROPIC_AUTH_TOKEN
    if (!key) checks.push({ id: "llm-auth", status: "fail", label: "Claude API key", detail: "ANTHROPIC_API_KEY missing", fix: "platform.claude.com → API keys, then ANTHROPIC_API_KEY=… in .env (or LWS_LLM=claude-code for your subscription)" })
    else if (o.offline) checks.push({ id: "llm-auth", status: "info", label: "Claude API key", detail: "present (not checked: --offline)" })
    else {
      const base = (o.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "")
      const r = await getJson(`${base}/v1/models?limit=1`, { authorization: `Bearer ${key}`, "anthropic-version": "2026-10-21" })
      checks.push(r.ok
        ? { id: "llm-auth", status: "ok", label: "Claude API key", detail: "accepted (GET /v1/models, free)" }
        : { id: "llm-auth", status: "fail", label: "Claude API key", detail: r.status ? `key refused (${r.status})` : `unreachable: ${r.error}`, fix: "generate a new key on platform.claude.com, or LWS_LLM=claude-code (subscription)" })
    }
  } else if (choice.name === "anthropic-compatible" || choice.name === "openai-compatible") {
    const compat = choice.name === "anthropic-compatible"
    const base = compat ? o.env.ANTHROPIC_BASE_URL?.replace(/\/+$/, "") : (o.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "")
    if (!base) checks.push({ id: "llm-auth", status: "fail", label: "Model server", detail: "ANTHROPIC_BASE_URL missing", fix: "ANTHROPIC_BASE_URL=http://127.0.0.1:11434 (Ollama) + ANTHROPIC_AUTH_TOKEN=ollama + LWS_MODEL=<model>" })
    else if (o.offline) checks.push({ id: "llm-auth", status: "info", label: "Model server", detail: `${base} (not checked: --offline)` })
    else {
      const token = compat ? (o.env.ANTHROPIC_AUTH_TOKEN || o.env.ANTHROPIC_API_KEY) : o.env.OPENAI_API_KEY
      const r = await getJson(`${base}${compat ? "/v1/models" : "/models"}`, token ? { authorization: `Bearer ${token}` } : {})
      const ids: string[] = Array.isArray(r.body?.data) ? r.body.data.map((m: any) => String(m.id)) : []
      checks.push(r.ok
        ? { id: "llm-auth", status: "ok", label: "Model server", detail: `${base} answers${ids.length ? ` (${ids.slice(0, 4).join(", ")}${ids.length > 4 ? "…" : ""})` : ""}` }
        : { id: "llm-auth", status: "fail", label: "Model server", detail: `${base}: ${r.status ? `HTTP ${r.status}` : r.error}`, fix: compat ? "start the server (ollama serve) and check ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN" : "check OPENAI_BASE_URL / OPENAI_API_KEY" })
    }
  }
  return { checks, provider: choice.name, auth }
}

/** Is the agency still a demo one : byte-identical to a shipped fictional agency, or still carrying its sender, phone,
 *  .example addresses, offer or <…> invoice placeholders ? (packages/shared/agency-demo.mjs, the cockpit lists the same) */
export function agencyCheck(cwd: string, env: DoctorOptions["env"]): Check {
  const file = env.LWS_AGENCY_CONFIG || "agency.config.json"
  const p = join(cwd, file)
  const settings = "open Settings in the cockpit (npm run backoffice, then ⋯ › Settings): it saves your agency to agency.config.json"
  // a fresh clone has no agency.config.json (it is yours, never committed) : the demo studio runs until Settings saves it
  if (!existsSync(p) && !env.LWS_AGENCY_CONFIG && existsSync(join(cwd, EXAMPLE_FILES[0]))) return { id: "agency", status: "warn", label: "Your agency", detail: `still the demo studio (${EXAMPLE_FILES[0]}): the sites, emails and invoices would carry a fictional studio's name`, fix: settings }
  if (!existsSync(p)) return { id: "agency", status: "warn", label: "Your agency", detail: `${file} not found: neutral defaults are used (no name, no legal footer)`, fix: settings }
  const current = readFileSync(p, "utf8")
  const same = EXAMPLE_FILES.find((ex) => existsSync(join(cwd, ex)) && readFileSync(join(cwd, ex), "utf8") === current)
  if (same) return { id: "agency", status: "warn", label: "Your agency", detail: `${file} is still the demo one (${same}): the sites, mails and invoices would carry a fictional studio's name`, fix: settings }
  let cfg: any
  try { cfg = JSON.parse(current) } catch { return { id: "agency", status: "fail", label: "Your agency", detail: `${file} is not valid JSON`, fix: "fix the JSON (compare with agency.config.example.us.json)" } }
  const name = String(cfg.name || "")
  const left = demoLeftovers(cfg, readExamples(cwd))
  if (left.length) return { id: "agency", status: "warn", label: "Your agency", detail: `${name || file}, but these still belong to the demo studio: ${left.map((x) => x.label.replace(/ \(.*\)$/, "").toLowerCase()).join(", ")}`, fix: settings }
  return { id: "agency", status: "ok", label: "Your agency", detail: name ? `${name} (${file})` : file }
}

/** the 24/7 worker : alive (its heartbeat in the shared database is fresh), the cockpit doing the jobs itself, or nobody */
export function workerCheck(raw: string | null | undefined): Check {
  const label = "24/7 worker"
  let hb: { id?: string; at?: number } = {}
  try { hb = raw ? JSON.parse(raw) : {} } catch { /* */ }
  const age = hb.at ? Math.round((Date.now() - Number(hb.at)) / 1000) : null
  const fresh = age != null && age < 120
  if (fresh && !String(hb.id || "").startsWith("cockpit#")) return { id: "worker", status: "ok", label, detail: `alive (last seen ${age} s ago): it builds while you are away` }
  if (fresh) return { id: "worker", status: "info", label, detail: "none: the cockpit runs the jobs itself while it is open" }
  return { id: "worker", status: "warn", label, detail: `not running${age != null ? ` (last seen ${age > 5400 ? `${Math.round(age / 3600)} h` : `${Math.round(age / 60)} min`} ago)` : ""}: queued builds wait until the cockpit is open or a worker runs`, fix: "npm run worker on this machine, or on the server: architecture/scheduling/install-units.sh --enable core" }
}

async function dbCheck(o: DoctorOptions): Promise<Check[]> {
  const url = o.env.DATABASE_URL
  // no DATABASE_URL is not a failure : `npm run backoffice` keeps its own local database ; a shared one is for several
  // machines or a worker on another box (the same story as .env.example and the cockpit's start line)
  if (!url) return [
    { id: "db", status: "warn", label: "Shared database", detail: "DATABASE_URL not set: the cockpit uses its own local database (data/pglite) on this machine; a shared Postgres is needed only for a worker on another machine or a CRM shared between machines", fix: "for that: DATABASE_URL=postgres://… in .env (any Postgres 14+: docker, Neon, Supabase…), then npm run db:init" },
    { id: "worker", status: "info", label: "24/7 worker", detail: "none: without a shared database the cockpit runs the jobs itself, while it is open" },
  ]
  if (o.offline) return [{ id: "db", status: "info", label: "Shared database", detail: "DATABASE_URL set (not checked: --offline)" }, { id: "worker", status: "info", label: "24/7 worker", detail: "not checked (--offline)" }]
  const { default: postgres } = await import("postgres")
  const { pgSsl, onPgNotice } = await import("../packages/shared/pg-options.mjs")
  const { TABLES } = await import("../db/init.ts")
  const sql = postgres(url, { ssl: pgSsl(url, o.env as NodeJS.ProcessEnv), onnotice: onPgNotice, prepare: false, max: 1, connect_timeout: 8, idle_timeout: 2 })
  try {
    const rows = await sql<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY(${[...TABLES] as string[]})`
    const have = new Set(rows.map((r) => r.table_name))
    const missing = TABLES.filter((t) => !have.has(t))
    if (missing.length) return [{ id: "db", status: "fail", label: "Shared database", detail: `reachable, schema incomplete: missing ${missing.join(", ")}`, fix: "npm run db:init (idempotent, non-destructive)" }]
    const hb = await sql<{ value: string }[]>`SELECT value FROM meta WHERE key = 'worker.heartbeat'`.catch(() => [])
    return [{ id: "db", status: "ok", label: "Shared database", detail: `reachable, schema complete (${TABLES.length} tables)` }, workerCheck(hb[0]?.value)]
  } catch (e) {
    return [{ id: "db", status: "fail", label: "Shared database", detail: `cannot connect: ${(e as Error).message.split("\n")[0]}`, fix: "check DATABASE_URL and DB_SSL (disable for a local Postgres without TLS)" }]
  } finally { await sql.end({ timeout: 2 }).catch(() => {}) }
}

function mediaChecks(env: DoctorOptions["env"]): Check[] {
  const img = imageEngine(env), vid = videoEngine(env)
  const chosen = (why: string) => /^LWS_(IMAGE|VIDEO)=none$/.test(why) // switched off ON PURPOSE: nothing to report
  // optional add-ons, off by default ON PURPOSE (CLAUDE.md) : said as information with what turning them on costs,
  // never as a warning to fix
  const out: Check[] = [
    img.engine === "none"
      ? { id: "image", status: "info", label: "Image boost (optional)", detail: `off: the composer keeps the prospect's real photos${chosen(img.why) ? "" : ". To turn it on: put OPENAI_API_KEY=… in .env (cp .env.example .env first); OpenAI bills each image"}` }
      : { id: "image", status: "ok", label: "Image boost (optional)", detail: `OpenAI Images (${img.why}) · model ${env.OPENAI_IMAGE_MODEL || "gpt-image-2"} · billed per image` },
    vid.engine === "none"
      ? { id: "video", status: "info", label: "Hero video (optional)", detail: `off: photo heroes${chosen(vid.why) ? "" : ". To turn it on: a Higgsfield account and HIGGSFIELD_API_KEY=… in .env; Higgsfield bills each video"}` }
      : { id: "video", status: "ok", label: "Hero video (optional)", detail: `Higgsfield (${vid.why}) · billed per video` },
  ]
  if (vid.engine !== "none" && !onPath("ffmpeg", env)) out.push({ id: "ffmpeg", status: "warn", label: "ffmpeg (video poster)", detail: "missing: hero videos will have no poster image", fix: "apt install ffmpeg" })
  return out
}

function outreachChecks(o: DoctorOptions): Check[] {
  const out: Check[] = []
  let dry = true
  try { dry = JSON.parse(readFileSync(join(o.cwd, "outreach", "sequencer", "config.json"), "utf8")).dryRun !== false } catch { /* no config: dry-run */ }
  const live = o.env.LWS_LIVE_SEND === "1"
  out.push(!dry && live
    ? { id: "send", status: "warn", label: "Email sending", detail: "LIVE (dryRun:false + LWS_LIVE_SEND=1): the 24/7 cage must be in place", fix: "check the warmup, the domains (SPF/DKIM/DMARC) and the caps before leaving it unattended" }
    : { id: "send", status: "ok", label: "Email sending", detail: `test mode, nothing goes out (dryRun ${dry ? "absent/true" : "false"}, LWS_LIVE_SEND ${live ? "=1" : "absent"})` })
  // tracking: without it a LIVE send goes out with no one-click unsubscribe (List-Unsubscribe, required by Gmail and
  // Yahoo for bulk senders) and no click is ever seen, so the click-gated steps never unlock
  const tc = trackConfig(o.env), base = (o.env.TRACK_BASE || "").trim(), secret = (o.env.LWS_TRACK_SECRET || "").trim()
  const why = !base ? "TRACK_BASE missing" : !trackBase(o.env) ? `TRACK_BASE "${base}" is not an http(s) URL` : !secret ? "LWS_TRACK_SECRET missing" : secret.length < 32 ? `LWS_TRACK_SECRET too short (${secret.length} < 32 characters)` : ""
  const trackFix = "TRACK_BASE=https://<the cockpit's public URL> + LWS_TRACK_SECRET=$(openssl rand -hex 32) in .env (see outreach/tracking/README.md)"
  out.push(tc
    ? { id: "tracking", status: "ok", label: "Tracking (clicks, one-click unsubscribe)", detail: `on → ${tc.base}/t/…` }
    : !dry && live
    ? { id: "tracking", status: "fail", label: "Tracking (clicks, one-click unsubscribe)", detail: `${why}: LIVE mails would go out without List-Unsubscribe and without any click tracking (the click-gated steps never unlock)`, fix: trackFix }
    : { id: "tracking", status: "info", label: "Tracking (clicks, one-click unsubscribe)", detail: `off (${why}): no effect while sending is in test mode`, fix: trackFix })
  if (o.env.TELEGRAM_BOT_TOKEN && !o.env.TELEGRAM_ALLOWED_CHAT_IDS?.trim()) out.push({ id: "telegram", status: "warn", label: "Telegram bot", detail: "token set but no allow-list: the bot serves nobody", fix: "TELEGRAM_ALLOWED_CHAT_IDS=<your id> (the bot logs the id of refused chats)" })
  return out
}

export async function runDoctor(o: DoctorOptions): Promise<DoctorReport> {
  const checks: Check[] = [nodeCheck(), depsCheck(o.cwd), chromiumCheck(o.cwd)]
  const llm = await llmChecks(o)
  checks.push(...llm.checks)
  checks.push(...bareCheck(o.env, o.target))
  if (llm.auth) checks.push(await workflowCheck(llm.auth, o))
  checks.push(agencyCheck(o.cwd, o.env))
  if (o.target === "agency") checks.push(...(await dbCheck(o)))
  checks.push(...mediaChecks(o.env))
  if (o.target === "agency") checks.push(...outreachChecks(o))
  const failures = checks.filter((c) => c.status === "fail").length
  const warnings = checks.filter((c) => c.status === "warn").length
  return { ok: failures === 0, target: o.target, failures, warnings, provider: llm.provider, checks }
}

const ICON: Record<Status, string> = { ok: "✓", warn: "⚠", fail: "✗", info: "·" }

export const NEXT_STEP = "npm run first-site -- --sample   (a fictional business of your agency's country, ≈10–14 min, ≈$3 of plan quota)  ·  or: npm run first-site -- <url> --industry <trade>"

export function formatReport(r: DoctorReport): string {
  const lines = [`LWS doctor · ${r.target === "first-site" ? "getting started (sandbox, your first site on your subscription)" : "always-on agency (database, worker, sending)"}`, ""]
  for (const c of r.checks) {
    lines.push(`  ${ICON[c.status]} ${c.label}: ${c.detail}`)
    if (c.fix && (c.status === "fail" || c.status === "warn")) lines.push(`      ${c.status === "fail" ? "missing" : "optional"} ⇒ do: ${c.fix}`)
  }
  lines.push("", r.ok
    ? `✓ ready${r.warnings ? ` (${r.warnings} optional point(s) above)` : ""}${r.target === "first-site" ? `\n  next: ${NEXT_STEP}` : ""}`
    : `✗ ${r.failures} blocking issue(s) · fix the "missing ⇒ do" lines above, then run npm run doctor again`)
  return lines.join("\n")
}

export const USAGE = `usage: npm run doctor [-- --for first-site|agency] [--json] [--offline]
  (default)          getting started: sandbox + your first site on your subscription (no database needed)
  --for agency       the always-on agency: shared database, the 24/7 worker, email sending, tracking
  --json             machine-readable report (one entry per check)
  --offline          no network probe and no claude -p probe`

// --- CLI ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile() } catch { /* no .env: the environment alone */ }
  const argv = process.argv.slice(2)
  if (argv.includes("--help") || argv.includes("-h")) { console.log(USAGE); process.exit(0) }
  const json = argv.includes("--json")
  const forIdx = argv.indexOf("--for")
  const want = forIdx >= 0 ? argv[forIdx + 1] : "first-site"
  if (!["first-site", "agency", "24-7", "24/7"].includes(want || "")) { console.error(`✗ unknown profile "${want}" · ${USAGE.split("\n")[0]}`); process.exit(2) }
  const target = want === "first-site" ? "first-site" : "agency"
  const report = await runDoctor({ target, offline: argv.includes("--offline"), env: process.env, cwd: process.cwd() })
  console.log(json ? JSON.stringify(report, null, 2) : formatReport(report))
  process.exit(report.ok ? 0 : 1)
}
