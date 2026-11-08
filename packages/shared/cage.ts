/**
 * cage.ts · THE 24/7 CAGE, the overview (files + shared database). What keeps the machine from doing
 * damage when nobody is watching:
 *
 *   1. STOP        the emergency stop. Two sources, the first one that says "stop" wins:
 *                    · the `STOP` file at the root (local machine, or the box over SSH: `echo reason > STOP`)
 *                    · the database's `cage.stop` flag (set by the cockpit's STOP button, seen by the box)
 *                  Read by the worker (exits within ≤ 1 tick, kills the running agent), the sequencer and the warmup
 *                  (don't tick) and the media boost (spends nothing).
 *   2. BUDGET      $/day cap + the data/logs/spend.jsonl ledger (see ./cage.mjs).
 *   3. BREAKER     bounces / complaints / unsubscribes above the funnel-strategy §6 thresholds → no more
 *                  email goes out until a human reset (see ./breaker.ts). State: database (`sequencer.breaker`,
 *                  visible from the cockpit) + the data/sequencer/breaker.json file (no-database mode).
 *   4. SENDING     dry-run unless config.dryRun === false AND LWS_LIVE_SEND=1 (see outreach/scripts/sequencer.ts).
 * The values "fichier" (= file) / "cockpit" and "dry-run" / "réel" (= live) are stored and read by the cockpit: unchanged.
 */
import { existsSync, readFileSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { tryDb, getMeta, setMeta } from "./db.ts"
import { stopFile, stopFileState, budgetStatus, buildsStatus, type BudgetStatus, type BuildsStatus } from "./cage.mjs"
import type { BreakerState } from "./breaker.ts"

export { stopFile, stopFileState, budgetStatus, jobBudgetUsd, recordSpend, readSpend, mediaGate, budgetConfig, buildsStatus, buildsCap, buildUsd, recordBuild, readBuilds } from "./cage.mjs"

export const STOP_META = "cage.stop"
export const BREAKER_META = "sequencer.breaker"
export const BREAKER_FILE = "data/sequencer/breaker.json"
const SEQ_CONFIG = "outreach/sequencer/config.json"

export type StopState = { on: boolean; reason: string; since: string | null; source: "fichier" | "cockpit" | null; by?: string | null }

/** the reason said when nobody gave one : where the STOP came from (the command line or the cockpit) */
export const stoppedFrom = (by: unknown): string => (String(by || "").startsWith("cli") ? "Stopped from the command line" : "Stopped from the cockpit")
/** The emergency stop, the file first (the strongest: set by hand on the machine), then the database. */
export async function stopState(env: NodeJS.ProcessEnv = process.env): Promise<StopState> {
  const f = stopFileState(env)
  if (f.on) return { on: true, reason: f.reason, since: f.since, source: "fichier" }
  if (tryDb()) {
    try {
      const raw = await getMeta(STOP_META)
      const v = raw ? JSON.parse(raw) : null
      if (v?.on) return { on: true, reason: String(v.reason || stoppedFrom(v.by)), since: v.at || null, source: "cockpit", by: v.by || null }
    } catch { /* unreadable meta: don't block on broken JSON */ }
  }
  return { on: false, reason: "", since: null, source: null }
}

/**
 * Sets / lifts the STOP from the cockpit. With a database: the shared flag (the box sees it). Without one (everything on
 * one machine): the STOP file itself. Lifting also removes the local file if there is one.
 */
export async function setStop(on: boolean, reason = "", by = "cockpit", env: NodeJS.ProcessEnv = process.env): Promise<StopState> {
  const at = new Date().toISOString()
  const why = reason.replace(/[\r\n]+/g, " ").trim().slice(0, 200)
  if (tryDb()) {
    await setMeta(STOP_META, JSON.stringify({ on, reason: why, by, at }))
    if (!on && existsSync(stopFile(env))) await rm(stopFile(env), { force: true })
  } else if (on) {
    await writeFile(stopFile(env), `${why || stoppedFrom(by)}\n`)
  } else {
    await rm(stopFile(env), { force: true })
  }
  return stopState(env)
}

/** The breaker's state: the database (shared view) first, then the sequencer's local file. null = never evaluated. */
export async function loadBreaker(): Promise<BreakerState | null> {
  if (tryDb()) {
    try { const raw = await getMeta(BREAKER_META); if (raw) return JSON.parse(raw) as BreakerState } catch { /* fall back on the file */ }
  }
  try { if (existsSync(BREAKER_FILE)) return JSON.parse(await readFile(BREAKER_FILE, "utf8")) as BreakerState } catch { /* unreadable */ }
  return null
}

export async function saveBreaker(s: BreakerState): Promise<void> {
  await mkdir(dirname(BREAKER_FILE), { recursive: true })
  await writeFile(BREAKER_FILE, JSON.stringify(s, null, 2) + "\n")
  if (tryDb()) { try { await setMeta(BREAKER_META, JSON.stringify(s)) } catch { /* best-effort: locally, the file is the reference */ } }
}

export type SendModeView = { mode: "dry-run" | "réel"; detail: string }

/** The sending mode as the CONFIG declares it (the second key, LWS_LIVE_SEND, lives on the sequencer's machine). */
export function sendModeView(env: NodeJS.ProcessEnv = process.env): SendModeView {
  let dry: unknown = true
  try { dry = JSON.parse(readFileSync(SEQ_CONFIG, "utf8")).dryRun } catch { /* no config: dry-run */ }
  if (dry !== false) return { mode: "dry-run", detail: "test mode: nothing goes out (two switches turn it on: README › The cage)" }
  return env.LWS_LIVE_SEND === "1"
    ? { mode: "réel", detail: "LIVE: both switches are on, emails go out" }
    : { mode: "dry-run", detail: "test mode: the config allows sending but LWS_LIVE_SEND=1 is not set here, so nothing goes out" }
}

export type CageStatus = { at: string; stop: StopState; budget: BudgetStatus; builds: BuildsStatus; breaker: BreakerState | null; send: SendModeView; alerts: string[] }

/** The cage's whole state for the cockpit's banner and the Machine view. Empty `alerts` = nothing abnormal. */
export async function cageStatus(env: NodeJS.ProcessEnv = process.env, now = new Date().toISOString()): Promise<CageStatus> {
  const [stop, breaker] = await Promise.all([stopState(env), loadBreaker()])
  const budget = budgetStatus(now, env)
  // the daily cap said in builds (what a subscriber understands) : done today, the cap, what is left
  const builds = buildsStatus(now, env)
  const send = sendModeView(env)
  const alerts: string[] = []
  if (stop.on) alerts.push("stop")
  if (breaker?.open) alerts.push("breaker")
  if (budget.reached) alerts.push("budget")
  return { at: now, stop, budget, builds, breaker, send, alerts }
}
