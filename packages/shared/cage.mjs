/**
 * cage.mjs · THE 24/7 CAGE, the "files" part (no database, no network): the STOP switch and the spend log. Shared by
 * the TypeScript (worker, sequencer, cockpit, warmup) and the .mjs scripts of the media boost (worker/openai-image.mjs,
 * worker/hero-cli.mjs). The database part (STOP set from the cockpit, the shared breaker) is in ./cage.ts.
 *
 *   STOP                      a file at the root of the repository (the services' cwd). While it exists: the worker
 *                             takes nothing more and exits, the sequencer and the warmup skip their tick, the media
 *                             boost spends nothing. Its first line (optional) is the reason. Another path:
 *                             LWS_STOP_FILE. Set: `echo "reason" > STOP` · lift: `rm STOP`.
 *   data/logs/spend.jsonl     one line per spend: { at, day, kind, source, usd, estimated, billing, … }
 *                             kind = agent (the worker's claude -p) | llm (skills) | image | video
 *   LWS_BUDGET_USD_DAY        daily cap in $ per UTC day, every spend included (absent or 0: no cap)
 *   LWS_JOB_MAX_USD           cap in $ for ONE agent job (passed as --max-budget-usd), bounded by what is left today
 *   LWS_IMAGE_USD / LWS_VIDEO_USD   estimated cost of an image / a video when the provider returns no price
 *                             (CAREFUL defaults, set them from your bill: $0.25 and $1.50)
 *   data/logs/builds.jsonl    one line per site built: { at, day, id, source, simulated? } (the cockpit's engine and
 *                             the worker write it)
 *   LWS_BUILDS_PER_DAY        the daily cap in BUILDS (what a subscriber understands). Absent: derived from
 *                             LWS_BUDGET_USD_DAY ÷ the estimate of one build (LWS_SITE_USD, default $3). Neither: no cap
 *
 * On a Claude subscription (`claude -p` on the plan), a job's cost is Claude Code's ESTIMATE (`total_cost_usd`): not
 * money billed but quota. The log marks it (`billing: "plan"`) and the cap counts it all the same: that is what keeps a
 * loop from burning a week of quota in one night.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs"
import { dirname } from "node:path"

export const STOP_FILE = "STOP"
export const SPEND_LOG = "data/logs/spend.jsonl"
export const SPEND_KINDS = ["agent", "llm", "image", "video"]
export const DEFAULT_IMAGE_USD = 0.25
export const DEFAULT_VIDEO_USD = 1.5
export const BUILDS_LOG = "data/logs/builds.jsonl"
/** what one site build uses of a Claude plan, estimated ($) : LWS_SITE_USD overrides it */
export const DEFAULT_BUILD_USD = 3

/** @param {Record<string, string | undefined>} env */
export function stopFile(env = process.env) { return env.LWS_STOP_FILE || STOP_FILE }

/**
 * The emergency stop set by FILE. A cheap synchronous read (called at every tick and during a job).
 * @returns {{ on: boolean, reason: string, since: string | null, source: "fichier" }}
 */
export function stopFileState(env = process.env) {
  const f = stopFile(env)
  if (!existsSync(f)) return { on: false, reason: "", since: null, source: "fichier" }
  let reason = "", since = null
  try { reason = readFileSync(f, "utf8").split("\n")[0].trim().slice(0, 200) } catch { /* unreadable: still a STOP */ }
  try { since = statSync(f).mtime.toISOString() } catch { /* */ }
  return { on: true, reason: reason || "a STOP file is present", since, source: "fichier" }
}

export const utcDay = (iso = new Date().toISOString()) => String(iso).slice(0, 10)

/** @param {string | undefined} v */
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null }

/** @returns {{ capUsd: number | null, jobMaxUsd: number | null }} */
export function budgetConfig(env = process.env) {
  return { capUsd: num(env.LWS_BUDGET_USD_DAY), jobMaxUsd: num(env.LWS_JOB_MAX_USD) }
}

/** the estimated cost of a media (image/video) when the provider returns no price. @param {"image"|"video"} kind */
export function mediaCostUsd(kind, env = process.env) {
  return kind === "image" ? (num(env.LWS_IMAGE_USD) ?? DEFAULT_IMAGE_USD) : (num(env.LWS_VIDEO_USD) ?? DEFAULT_VIDEO_USD)
}

/**
 * Writes a spend to the log (append-only). Never blocking: an unreadable log never breaks a job.
 * @param {{ kind: string, source: string, usd: number, estimated?: boolean, billing?: string, at?: string, [k: string]: unknown }} e
 * @param {{ file?: string }} [o]
 */
export function recordSpend(e, o = {}) {
  const usd = Number(e.usd)
  if (!Number.isFinite(usd) || usd < 0) return null
  const at = e.at || new Date().toISOString()
  const entry = { ...e, at, day: utcDay(at), kind: SPEND_KINDS.includes(e.kind) ? e.kind : "llm", usd: Math.round(usd * 10000) / 10000 }
  const file = o.file || SPEND_LOG
  try { mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, JSON.stringify(entry) + "\n") } catch { return null }
  return entry
}

/** The spends of one UTC day (all of them when `day` is absent). @param {string} [day] @param {{ file?: string }} [o] */
export function readSpend(day, o = {}) {
  const file = o.file || SPEND_LOG
  if (!existsSync(file)) return []
  /** @type {any[]} */
  const out = []
  for (const l of readFileSync(file, "utf8").split("\n")) {
    if (!l.trim()) continue
    try { const e = JSON.parse(l); if (!day || e.day === day) out.push(e) } catch { /* a broken line: skipped */ }
  }
  return out
}

/**
 * Where today's budget stands. `reached` = the cap is reached (no job may be claimed).
 * @param {string} [nowIso] @param {Record<string, string | undefined>} [env] @param {{ file?: string }} [o]
 */
export function budgetStatus(nowIso = new Date().toISOString(), env = process.env, o = {}) {
  const day = utcDay(nowIso)
  const entries = readSpend(day, o)
  /** @type {Record<string, number>} */
  const byKind = { agent: 0, llm: 0, image: 0, video: 0 }
  let spent = 0
  for (const e of entries) { const u = Number(e.usd) || 0; spent += u; byKind[e.kind] = (byKind[e.kind] || 0) + u }
  const round = (/** @type {number} */ n) => Math.round(n * 100) / 100
  const { capUsd, jobMaxUsd } = budgetConfig(env)
  const remaining = capUsd == null ? null : Math.max(0, capUsd - spent)
  const next = new Date(day + "T00:00:00.000Z"); next.setUTCDate(next.getUTCDate() + 1)
  return {
    day, spentUsd: round(spent), capUsd, jobMaxUsd, remainingUsd: remaining == null ? null : round(remaining),
    reached: capUsd != null && spent >= capUsd, resetsAt: next.toISOString(), entries: entries.length,
    byKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, round(v)])),
  }
}

/**
 * The $ cap to pass to `claude -p --max-budget-usd` for one job: min(LWS_JOB_MAX_USD, what is left today).
 * null = no cap (no daily budget, no per-job cap). 0 = budget spent (do not start).
 */
export function jobBudgetUsd(nowIso = new Date().toISOString(), env = process.env, o = {}) {
  const b = budgetStatus(nowIso, env, o)
  const caps = [b.jobMaxUsd, b.remainingUsd].filter((x) => x != null)
  if (!caps.length) return null
  return Math.max(0, Math.round(Math.min(...caps) * 100) / 100)
}

/**
 * May the media boost spend? Not under STOP, nor when what is left of the budget does not cover the media's
 * estimated cost. @param {"image"|"video"} kind
 * @returns {{ ok: boolean, why: string, costUsd: number }}
 */
export function mediaGate(kind, env = process.env, nowIso = new Date().toISOString(), o = {}) {
  const costUsd = mediaCostUsd(kind, env)
  const stop = stopFileState(env)
  if (stop.on) return { ok: false, why: `STOP (${stop.reason})`, costUsd }
  const b = budgetStatus(nowIso, env, o)
  if (b.remainingUsd != null && b.remainingUsd < costUsd) return { ok: false, why: `daily limit reached ($${b.spentUsd} of $${b.capUsd})`, costUsd }
  return { ok: true, why: "", costUsd }
}

/** the estimate of one site build in $ of plan usage (LWS_SITE_USD, default $3) */
export function buildUsd(env = process.env) { return num(env.LWS_SITE_USD) ?? DEFAULT_BUILD_USD }

/**
 * Today's cap in builds : LWS_BUILDS_PER_DAY, else the daily limit in $ ÷ the estimate of one build (rounded down),
 * else none. `from` says where it comes from ("builds" | "budget" | null).
 * @returns {{ cap: number | null, from: "builds" | "budget" | null }}
 */
export function buildsCap(env = process.env) {
  const n = num(env.LWS_BUILDS_PER_DAY)
  if (n != null) return { cap: Math.floor(n), from: "builds" }
  const usd = num(env.LWS_BUDGET_USD_DAY)
  if (usd != null) return { cap: Math.floor((usd + 1e-9) / buildUsd(env)), from: "budget" }
  return { cap: null, from: null }
}

/**
 * One site built, in the builds log (append-only, never blocking).
 * @param {{ id: string, source: string, simulated?: boolean, at?: string, [k: string]: unknown }} e @param {{ file?: string }} [o]
 */
export function recordBuild(e, o = {}) {
  if (!e || typeof e.id !== "string" || !e.id) return null
  const at = e.at || new Date().toISOString()
  const entry = { ...e, at, day: utcDay(at) }
  const file = o.file || BUILDS_LOG
  try { mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, JSON.stringify(entry) + "\n") } catch { return null }
  return entry
}

/** The builds of one UTC day (all of them when `day` is absent). @param {string} [day] @param {{ file?: string }} [o] */
export function readBuilds(day, o = {}) {
  const file = o.file || BUILDS_LOG
  if (!existsSync(file)) return []
  /** @type {any[]} */
  const out = []
  for (const l of readFileSync(file, "utf8").split("\n")) {
    if (!l.trim()) continue
    try { const e = JSON.parse(l); if (!day || e.day === day) out.push(e) } catch { /* a broken line: skipped */ }
  }
  return out
}

/**
 * Where today's builds stand : done, the cap, what is left, the estimate in $ of plan usage (an estimate, not a
 * charge). `reached` = no new build starts before `resetsAt` (midnight UTC, like the $ limit).
 * @param {string} [nowIso] @param {Record<string, string | undefined>} [env] @param {{ file?: string }} [o]
 */
export function buildsStatus(nowIso = new Date().toISOString(), env = process.env, o = {}) {
  const day = utcDay(nowIso)
  const done = readBuilds(day, o).length
  const { cap, from } = buildsCap(env)
  const perBuildUsd = buildUsd(env)
  const next = new Date(day + "T00:00:00.000Z"); next.setUTCDate(next.getUTCDate() + 1)
  return {
    day, done, cap, from, left: cap == null ? null : Math.max(0, cap - done), reached: cap != null && done >= cap,
    perBuildUsd, estimateUsd: Math.round(done * perBuildUsd * 100) / 100, resetsAt: next.toISOString(),
  }
}
