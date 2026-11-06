/**
 * doctor.ts · `npm run doctor` : dit EXACTEMENT ce qui manque pour faire tourner LWS, et comment le réparer.
 *
 * Une ligne par point : ✓ prêt · ⚠ optionnel ou à surveiller · ✗ bloquant (« manque X ⇒ fais Y »).
 * Exit 0 si aucun bloquant, 1 sinon. Aucune requête payante : la seule sonde réseau vers un modèle est la lecture
 * de l'évènement d'init d'un `claude -p` (process tué avant toute réponse), et pour l'API Claude un GET /v1/models
 * (gratuit) qui prouve que la clé est vivante.
 *
 * Usage : npm run doctor                       l'agence complète (worker 24/7 : base de données comprise)
 *         npm run doctor -- --for first-site   seulement ce qu'il faut pour `npm run first-site` (pas de base)
 *         npm run doctor -- --json             sortie machine (une entrée par point)
 *         npm run doctor -- --offline          sans aucune sonde réseau ni process claude -p
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { selectProvider, resolveModel, ROLES, ROLE_USES, type ProviderName } from "../packages/llm/index.ts"
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

function nodeCheck(): Check {
  const [maj, min] = process.versions.node.split(".").map(Number)
  const ok = maj > MIN_NODE[0] || (maj === MIN_NODE[0] && min >= MIN_NODE[1])
  return ok
    ? { id: "node", status: "ok", label: "Node", detail: `v${process.versions.node}${maj < 24 ? " (24 recommandé, comme l'image Docker)" : ""}` }
    : { id: "node", status: "fail", label: "Node", detail: `v${process.versions.node} < ${MIN_NODE.join(".")}`, fix: "installe Node 24 (nvm install 24 && nvm use 24), puis npm ci" }
}

function depsCheck(cwd: string): Check {
  const missing = ["@anthropic-ai/sdk", "playwright", "postgres", "tsx"].filter((p) => !existsSync(join(cwd, "node_modules", p, "package.json")))
  if (missing.length) return { id: "deps", status: "fail", label: "Dépendances npm", detail: `manque ${missing.join(", ")}`, fix: "npm ci" }
  const sdk = JSON.parse(readFileSync(join(cwd, "node_modules", "@anthropic-ai/sdk", "package.json"), "utf8")).version as string
  if (Number(sdk.split(".")[0]) < 1) return { id: "deps", status: "fail", label: "Dépendances npm", detail: `@anthropic-ai/sdk ${sdk} (< 1.0)`, fix: "npm ci (le lockfile épingle la 1.x)" }
  return { id: "deps", status: "ok", label: "Dépendances npm", detail: `installées (@anthropic-ai/sdk ${sdk})` }
}

function chromiumCheck(cwd: string): Check {
  try {
    const req = createRequire(join(cwd, "package.json"))
    const { chromium } = req("playwright") as typeof import("playwright")
    const exe = chromium.executablePath()
    if (exe && existsSync(exe)) return { id: "chromium", status: "ok", label: "Chromium (Playwright)", detail: "installé" }
    return { id: "chromium", status: "fail", label: "Chromium (Playwright)", detail: "navigateur absent (scoring, parsing, captures, verify)", fix: "npx playwright install chromium (Linux nu : npx playwright install --with-deps chromium)" }
  } catch (e) {
    return { id: "chromium", status: "fail", label: "Chromium (Playwright)", detail: `playwright illisible : ${(e as Error).message.split("\n")[0]}`, fix: "npm ci && npx playwright install chromium" }
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

function claudeCodeChecks(auth: ClaudeAuth, env: DoctorOptions["env"], role: "voie LLM" | "composer"): Check[] {
  const out: Check[] = []
  const bin = env.CLAUDE_BIN || "claude"
  if (!auth.installed) {
    out.push({ id: "claude-code", status: "fail", label: `Claude Code (${role})`, detail: `introuvable (${bin})`, fix: "curl -fsSL https://claude.ai/install.sh | bash (installateur natif, mises à jour auto) ou npm i -g @anthropic-ai/claude-code" })
    return out
  }
  if (!auth.loggedIn) {
    out.push({ id: "claude-code", status: "fail", label: `Claude Code (${role})`, detail: `v${auth.version} · ${auth.label}`, fix: "claude auth login (ton abonnement Pro/Max) ; sur un serveur : claude setup-token puis CLAUDE_CODE_OAUTH_TOKEN=… dans .env" })
  } else {
    out.push({ id: "claude-code", status: "ok", label: `Claude Code (${role})`, detail: `v${auth.version} · ${auth.label}` })
  }
  if (env.ANTHROPIC_API_KEY) out.push({ id: "claude-api-key", status: "info", label: "ANTHROPIC_API_KEY", detail: "présente : le produit la RETIRE de chaque `claude -p` (sinon Claude Code facturerait l'API avant le plan)" })
  return out
}

function bareCheck(env: DoctorOptions["env"]): Check[] {
  const args = workerClaudeArgs(env)
  const out: Check[] = []
  const risk = bareRisk(args, env)
  out.push(risk
    ? { id: "bare", status: "fail", label: "Mode --bare", detail: `${risk} : Claude Code n'y lit ni le login du plan, ni CLAUDE_CODE_OAUTH_TOKEN, ni les skills du dépôt`, fix: "retire --bare de WORKER_CLAUDE_ARGS et CLAUDE_CODE_SIMPLE de l'environnement" }
    : { id: "bare", status: "ok", label: "Mode --bare", detail: "absent (le worker refuse de démarrer en --bare ; il deviendra le défaut de -p dans une future version : relire les notes de version avant de mettre Claude Code à jour sur la box)" })
  const stale = args.filter((a) => STALE_TOOLS[a])
  if (stale.length) out.push({ id: "worker-tools", status: "warn", label: "Outils du worker", detail: `WORKER_CLAUDE_ARGS cite ${stale.map((t) => `${t} (${STALE_TOOLS[t]})`).join(", ")}`, fix: "retire WORKER_CLAUDE_ARGS pour reprendre la liste à jour (worker/claude-args.ts)" })
  return out
}

async function workflowCheck(auth: ClaudeAuth, o: DoctorOptions): Promise<Check> {
  if (!auth.installed || !auth.loggedIn) return { id: "workflow", status: "warn", label: "Outil Workflow (composer multi-agents)", detail: "non vérifié (Claude Code absent ou non connecté)", fix: "règle Claude Code d'abord, puis relance npm run doctor" }
  if (o.offline) return { id: "workflow", status: "info", label: "Outil Workflow (composer multi-agents)", detail: "non vérifié (--offline)" }
  const init = await initProbe(o.env.CLAUDE_BIN || "claude", o.env, 45_000, o.cwd)
  if (!init.ok) return { id: "workflow", status: "warn", label: "Outil Workflow (composer multi-agents)", detail: `sonde claude -p sans réponse : ${init.error}`, fix: "lance `claude -p \"ok\"` à la main pour voir l'erreur" }
  if (init.tools.includes("Workflow")) return { id: "workflow", status: "ok", label: "Outil Workflow (composer multi-agents)", detail: `disponible (${init.tools.filter((t) => !t.startsWith("mcp__")).length} outils intégrés · modèle de session ${init.model ?? "?"})` }
  return { id: "workflow", status: "warn", label: "Outil Workflow (composer multi-agents)", detail: "absent de cette session Claude Code", fix: "abonnement Pro : /config → « Dynamic workflows » ; sinon first-site bascule tout seul sur le moteur local (un agent à la fois, --engine local)" }
}

async function llmChecks(o: DoctorOptions): Promise<{ checks: Check[]; provider: ProviderName | null; auth: ClaudeAuth | null }> {
  const checks: Check[] = []
  let choice
  try { choice = selectProvider(o.env) } catch (e) {
    checks.push({ id: "llm", status: "fail", label: "Voie LLM (skills JSON)", detail: (e as Error).message, fix: "LWS_LLM=claude-code | codex | anthropic | anthropic-compatible | openai-compatible" })
    return { checks, provider: null, auth: null }
  }
  checks.push({ id: "llm", status: "ok", label: "Voie LLM (skills JSON)", detail: `${choice.name} — ${choice.why}` })
  for (const role of ROLES) {
    try {
      const m = resolveModel(role, choice.name, o.env)
      checks.push({ id: `model-${role}`, status: "info", label: `Modèle ${role}`, detail: `${m.model} (${m.source}) · ${ROLE_USES[role]}` })
    } catch (e) {
      checks.push({ id: `model-${role}`, status: "fail", label: `Modèle ${role}`, detail: (e as Error).message, fix: `pose LWS_MODEL_${role.toUpperCase()}=<modèle> ou LWS_MODEL=<modèle> dans .env` })
    }
  }
  // Claude Code : la voie par défaut des skills ET le moteur du composer (agents), quelle que soit la voie choisie
  const auth = claudeAuth(o.env.CLAUDE_BIN || "claude", o.env)
  if (choice.name === "claude-code") checks.push(...claudeCodeChecks(auth, o.env, "voie LLM"))
  else checks.push(...claudeCodeChecks(auth, o.env, "composer").map((c) => c.id === "claude-code" && c.status === "fail" ? { ...c, detail: c.detail + " · le composer (agents) a besoin de Claude Code même si les skills passent ailleurs" } : c))

  if (choice.name === "codex") {
    const cx = codexAuth(o.env.LWS_CODEX_BIN || "codex", o.env)
    if (!cx.installed) checks.push({ id: "llm-auth", status: "fail", label: "Codex CLI (voie LLM)", detail: cx.label, fix: "npm i -g @openai/codex puis `codex login` (abonnement ChatGPT) · ou LWS_LLM=claude-code" })
    else if (!cx.loggedIn) checks.push({ id: "llm-auth", status: "fail", label: "Codex CLI (voie LLM)", detail: `v${cx.version} · ${cx.label}`, fix: "codex login (abonnement ChatGPT)" })
    else checks.push({ id: "llm-auth", status: cx.source === "api-key" ? "warn" : "ok", label: "Codex CLI (voie LLM)", detail: `v${cx.version} · ${cx.label}` })
  } else if (choice.name === "anthropic") {
    const key = o.env.ANTHROPIC_API_KEY || o.env.ANTHROPIC_AUTH_TOKEN
    if (!key) checks.push({ id: "llm-auth", status: "fail", label: "API Claude", detail: "manque ANTHROPIC_API_KEY", fix: "platform.claude.com → API keys, puis ANTHROPIC_API_KEY=… dans .env (ou LWS_LLM=claude-code pour ton abonnement)" })
    else if (o.offline) checks.push({ id: "llm-auth", status: "info", label: "API Claude", detail: "clé présente (non vérifiée : --offline)" })
    else {
      const base = (o.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "")
      const r = await getJson(`${base}/v1/models?limit=1`, { authorization: `Bearer ${key}`, "anthropic-version": "2026-10-21" })
      checks.push(r.ok
        ? { id: "llm-auth", status: "ok", label: "API Claude", detail: "clé acceptée (GET /v1/models, gratuit)" }
        : { id: "llm-auth", status: "fail", label: "API Claude", detail: r.status ? `clé refusée (${r.status})` : `injoignable : ${r.error}`, fix: "régénère la clé sur platform.claude.com, ou LWS_LLM=claude-code (abonnement)" })
    }
  } else if (choice.name === "anthropic-compatible" || choice.name === "openai-compatible") {
    const compat = choice.name === "anthropic-compatible"
    const base = compat ? o.env.ANTHROPIC_BASE_URL?.replace(/\/+$/, "") : (o.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "")
    if (!base) checks.push({ id: "llm-auth", status: "fail", label: "Serveur compatible", detail: "manque ANTHROPIC_BASE_URL", fix: "ANTHROPIC_BASE_URL=http://127.0.0.1:11434 (Ollama) + ANTHROPIC_AUTH_TOKEN=ollama + LWS_MODEL=<modèle>" })
    else if (o.offline) checks.push({ id: "llm-auth", status: "info", label: "Serveur compatible", detail: `${base} (non vérifié : --offline)` })
    else {
      const token = compat ? (o.env.ANTHROPIC_AUTH_TOKEN || o.env.ANTHROPIC_API_KEY) : o.env.OPENAI_API_KEY
      const r = await getJson(`${base}${compat ? "/v1/models" : "/models"}`, token ? { authorization: `Bearer ${token}` } : {})
      const ids: string[] = Array.isArray(r.body?.data) ? r.body.data.map((m: any) => String(m.id)) : []
      checks.push(r.ok
        ? { id: "llm-auth", status: "ok", label: "Serveur compatible", detail: `${base} répond${ids.length ? ` (${ids.slice(0, 4).join(", ")}${ids.length > 4 ? "…" : ""})` : ""}` }
        : { id: "llm-auth", status: "fail", label: "Serveur compatible", detail: `${base} : ${r.status ? `HTTP ${r.status}` : r.error}`, fix: compat ? "lance le serveur (ollama serve) et vérifie ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN" : "vérifie OPENAI_BASE_URL / OPENAI_API_KEY" })
    }
  }
  return { checks, provider: choice.name, auth }
}

async function dbCheck(o: DoctorOptions): Promise<Check> {
  const url = o.env.DATABASE_URL
  if (!url) return { id: "db", status: "fail", label: "Base Postgres", detail: "manque DATABASE_URL (sans base : la Station lit le disque, mais ni CRM, ni file de batchs, ni worker)", fix: "pose DATABASE_URL=postgres://… (n'importe quel Postgres 14+ : docker, Neon, Supabase…) puis npm run db:init" }
  if (o.offline) return { id: "db", status: "info", label: "Base Postgres", detail: "DATABASE_URL posée (non vérifiée : --offline)" }
  const { default: postgres } = await import("postgres")
  const { pgSsl, onPgNotice } = await import("../packages/shared/pg-options.mjs")
  const { TABLES } = await import("../db/init.ts")
  const sql = postgres(url, { ssl: pgSsl(url, o.env as NodeJS.ProcessEnv), onnotice: onPgNotice, prepare: false, max: 1, connect_timeout: 8, idle_timeout: 2 })
  try {
    const rows = await sql<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY(${[...TABLES] as string[]})`
    const have = new Set(rows.map((r) => r.table_name))
    const missing = TABLES.filter((t) => !have.has(t))
    return missing.length
      ? { id: "db", status: "fail", label: "Base Postgres", detail: `joignable, schéma incomplet : manque ${missing.join(", ")}`, fix: "npm run db:init (idempotent, non destructif)" }
      : { id: "db", status: "ok", label: "Base Postgres", detail: `joignable, schéma complet (${TABLES.length} tables)` }
  } catch (e) {
    return { id: "db", status: "fail", label: "Base Postgres", detail: `connexion impossible : ${(e as Error).message.split("\n")[0]}`, fix: "vérifie DATABASE_URL et DB_SSL (disable pour un Postgres local sans TLS)" }
  } finally { await sql.end({ timeout: 2 }).catch(() => {}) }
}

function mediaChecks(env: DoctorOptions["env"]): Check[] {
  const img = imageEngine(env), vid = videoEngine(env)
  const chosen = (why: string) => /^LWS_(IMAGE|VIDEO)=none$/.test(why) // coupé VOLONTAIREMENT : rien à signaler
  const out: Check[] = [
    img.engine === "none" && chosen(img.why)
      ? { id: "image", status: "info", label: "Boost image (optionnel)", detail: "coupé (LWS_IMAGE=none) : le composer garde les vraies photos" }
      : img.engine === "none"
      ? { id: "image", status: "warn", label: "Boost image (optionnel)", detail: `coupé (${img.why}) : le composer garde les vraies photos telles quelles`, fix: "OPENAI_API_KEY=… (ou LWS_IMAGE=openai + OPENAI_IMAGE_BASE_URL pour une API Images compatible)" }
      : { id: "image", status: "ok", label: "Boost image (optionnel)", detail: `OpenAI Images (${img.why}) · modèle ${env.OPENAI_IMAGE_MODEL || "gpt-image-2"}` },
    vid.engine === "none" && chosen(vid.why)
      ? { id: "video", status: "info", label: "Héros vidéo (optionnel)", detail: "coupé (LWS_VIDEO=none) : héros en photo" }
      : vid.engine === "none"
      ? { id: "video", status: "warn", label: "Héros vidéo (optionnel)", detail: `coupé (${vid.why}) : héros en photo`, fix: "CLI Higgsfield (higgsfield auth login, compte Ultra) ou HIGGSFIELD_API_KEY ; LWS_VIDEO=none pour le taire" }
      : { id: "video", status: "ok", label: "Héros vidéo (optionnel)", detail: `Higgsfield (${vid.why})` },
  ]
  if (vid.engine !== "none" && !onPath("ffmpeg", env)) out.push({ id: "ffmpeg", status: "warn", label: "ffmpeg (poster vidéo)", detail: "absent : le héros vidéo n'aura pas d'image poster", fix: "apt install ffmpeg" })
  return out
}

function outreachChecks(o: DoctorOptions): Check[] {
  const out: Check[] = []
  let dry = true
  try { dry = JSON.parse(readFileSync(join(o.cwd, "outreach", "sequencer", "config.json"), "utf8")).dryRun !== false } catch { /* pas de config : dry-run */ }
  const live = o.env.LWS_LIVE_SEND === "1"
  out.push(!dry && live
    ? { id: "send", status: "warn", label: "Envoi de mails", detail: "RÉEL (dryRun:false + LWS_LIVE_SEND=1) : la cage 24/7 doit être en place", fix: "vérifie warmup, domaines (SPF/DKIM/DMARC) et plafonds avant de laisser tourner" }
    : { id: "send", status: "ok", label: "Envoi de mails", detail: `dry-run (rien ne part : dryRun ${dry ? "absent/true" : "false"}, LWS_LIVE_SEND ${live ? "=1" : "absent"})` })
  // tracking : sans lui, un envoi RÉEL part sans désinscription 1-clic (List-Unsubscribe, exigé par Gmail/Yahoo pour les
  // envois en nombre) et aucun clic n'est vu, donc les étapes gatées au clic ne se débloquent jamais (test blitz du 24/10)
  const tc = trackConfig(o.env), base = (o.env.TRACK_BASE || "").trim(), secret = (o.env.LWS_TRACK_SECRET || "").trim()
  const why = !base ? "TRACK_BASE absent" : !trackBase(o.env) ? `TRACK_BASE « ${base} » n'est pas une URL http(s)` : !secret ? "LWS_TRACK_SECRET absent" : secret.length < 32 ? `LWS_TRACK_SECRET trop court (${secret.length} < 32 caractères)` : ""
  const trackFix = "TRACK_BASE=https://<l'URL publique du cockpit> + LWS_TRACK_SECRET=$(openssl rand -hex 32) dans .env (cf. outreach/tracking/README.md)"
  out.push(tc
    ? { id: "tracking", status: "ok", label: "Tracking (clics, désinscription 1-clic)", detail: `actif → ${tc.base}/t/…` }
    : !dry && live
    ? { id: "tracking", status: "fail", label: "Tracking (clics, désinscription 1-clic)", detail: `${why} : les mails RÉELS partiraient sans List-Unsubscribe et sans clic suivi (l'escalade gatée au clic ne se débloque jamais)`, fix: trackFix }
    : { id: "tracking", status: "info", label: "Tracking (clics, désinscription 1-clic)", detail: `coupé (${why}) : sans effet tant que l'envoi est en dry-run`, fix: trackFix })
  if (o.env.TELEGRAM_BOT_TOKEN && !o.env.TELEGRAM_ALLOWED_CHAT_IDS?.trim()) out.push({ id: "telegram", status: "warn", label: "Bot Telegram", detail: "token posé mais aucune liste blanche : le bot ne sert personne", fix: "TELEGRAM_ALLOWED_CHAT_IDS=<ton id> (le bot journalise l'id des chats refusés)" })
  return out
}

export async function runDoctor(o: DoctorOptions): Promise<DoctorReport> {
  const checks: Check[] = [nodeCheck(), depsCheck(o.cwd), chromiumCheck(o.cwd)]
  const llm = await llmChecks(o)
  checks.push(...llm.checks)
  checks.push(...bareCheck(o.env))
  if (llm.auth) checks.push(await workflowCheck(llm.auth, o))
  if (o.target === "agency") checks.push(await dbCheck(o))
  checks.push(...mediaChecks(o.env))
  if (o.target === "agency") checks.push(...outreachChecks(o))
  const failures = checks.filter((c) => c.status === "fail").length
  const warnings = checks.filter((c) => c.status === "warn").length
  return { ok: failures === 0, target: o.target, failures, warnings, provider: llm.provider, checks }
}

const ICON: Record<Status, string> = { ok: "✓", warn: "⚠", fail: "✗", info: "·" }

export function formatReport(r: DoctorReport): string {
  const lines = [`LWS doctor · ${r.target === "first-site" ? "premier site (npm run first-site)" : "agence complète (worker 24/7)"}`, ""]
  for (const c of r.checks) {
    lines.push(`  ${ICON[c.status]} ${c.label} : ${c.detail}`)
    if (c.fix && (c.status === "fail" || c.status === "warn")) lines.push(`      ${c.status === "fail" ? "manque" : "option"} ⇒ fais : ${c.fix}`)
  }
  lines.push("", r.ok
    ? `✓ prêt${r.warnings ? ` (${r.warnings} point(s) optionnel(s) ci-dessus)` : ""}${r.target === "first-site" ? " · lance : npm run first-site -- <url du vieux site>" : ""}`
    : `✗ ${r.failures} point(s) bloquant(s) · corrige les lignes « manque … ⇒ fais … » puis relance npm run doctor`)
  return lines.join("\n")
}

// --- CLI ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile() } catch { /* pas de .env : l'environnement seul */ }
  const argv = process.argv.slice(2)
  const json = argv.includes("--json")
  const forIdx = argv.indexOf("--for")
  const target = forIdx >= 0 && argv[forIdx + 1] === "first-site" ? "first-site" : "agency"
  const report = await runDoctor({ target, offline: argv.includes("--offline"), env: process.env, cwd: process.cwd() })
  console.log(json ? JSON.stringify(report, null, 2) : formatReport(report))
  process.exit(report.ok ? 0 : 1)
}
