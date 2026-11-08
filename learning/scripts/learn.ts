/**
 * Learning — RECOMPUTES the rules from real-world outcomes (`data/outcomes.jsonl`) → `learning/rules/rules.json`
 * (+ a readable report `learning/analysis/report.md`). The next scoring run then applies them. The loop is closed.
 *
 *   npm run learn          # reads the outcomes → writes the rules + the report
 *
 * Sources: `data/outcomes.jsonl` + (if DATABASE_URL) the `outreach_events` mirror of type `outcome` written by the
 * cockpit's CRM, which often runs on another machine than this script (the lws-learn nightly timer on the box).
 * Merged and deduplicated (prospect + outcome + timestamp).
 *
 * PHILOSOPHY — the loop REFINES, it doesn't decide:
 *  • Small-n shrinkage: a delta is multiplied by the confidence n/(n+prior). 2 outcomes ≈ 0; it takes
 *    volume to move a baseline. This is the guard against overfitting on an anecdote.
 *  • Tight bounds: |value delta| ≤ 15, signal multiplier ∈ [0.5, 1.5]. The human rule stays the foundation.
 *  • Two things learned: (1) which TRADES really convert → nuances their ticket value;
 *    (2) which free SIGNALS predict the sale → adjusts their bonus.
 */
import { writeFile, mkdir } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { OUTCOME_WEIGHT, type Outcome, type RulesFile } from "./types.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..")
const OUTCOMES_PATH = join(ROOT, "data", "outcomes.jsonl")
const RULES_PATH = join(HERE, "..", "rules", "rules.json")
const REPORT_PATH = join(HERE, "..", "analysis", "report.md")

// — calibration constants (the caution is deliberate) —
const VALUE_SCALE = 30 // `value` delta points per unit of conversion lift (lift 0.3 → +9 before shrinkage)
const IND_PRIOR = 8 // strength of the trade prior: the n of outcomes to reach 50 % confidence
const IND_CAP = 15 // max |value delta| per trade
const SIG_SCALE = 1.0 // amplitude of the signal multiplier
const SIG_PRIOR = 5 // signal prior (on min(nWith, nWithout))
const SIG_MIN = 0.5
const SIG_MAX = 1.5

const SIGNAL_KEYS = ["gallery", "quoteCta", "social", "premium", "multiSite", "ecommerce", "booking", "blog"] as const

const clampN = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const succ = (o: Outcome) => OUTCOME_WEIGHT[o.outcome] ?? 0

type IndEvidence = { industry: string; n: number; rate: number; conf: number; valueDelta: number }
type SigEvidence = { signal: string; nWith: number; nWithout: number; lift: number; conf: number; mult: number }

/** Rank in the funnel: a TERMINAL outcome (won/lost) beats a meeting, a meeting beats a reply, a reply beats "sent". */
const STAGE: Record<string, number> = { sent: 0, reply: 1, meeting: 2, won: 3, lost: 3 }

/**
 * ONE trial per prospect: its FINAL STATE. A prospect leaves several lines along the funnel (sent → reply →
 * meeting → won, or … → lost); counting them as as many trials made a lost meeting a "half success" (0.3 on
 * average) and weighed every sale three times (blitz test of 24/10). The final state = the MOST ADVANCED funnel stage
 * (timestamps only decide at an equal stage, won against lost for instance): the sequencer (the box) and the CRM
 * (the cockpit) don't share a clock, a "reply" stamped later than a "won" must not erase it.
 */
export function finalOutcomes(outcomes: Outcome[]): Outcome[] {
  const best = new Map<string, Outcome>()
  const rank = (o: Outcome) => [STAGE[o.outcome] ?? 0, o.ts || "", succ(o)] as const
  const better = (a: Outcome, b: Outcome) => { const ra = rank(a), rb = rank(b); return ra[0] !== rb[0] ? ra[0] > rb[0] : ra[1] !== rb[1] ? ra[1] > rb[1] : ra[2] > rb[2] }
  for (const o of outcomes) {
    const cur = best.get(o.id)
    if (!cur) { best.set(o.id, o); continue }
    // the final state, with the most complete features known for this prospect
    const win = better(o, cur) ? o : cur, other = win === o ? cur : o
    best.set(o.id, { ...win, industry: win.industry && win.industry !== "?" ? win.industry : other.industry, signals: win.signals && Object.keys(win.signals).length ? win.signals : other.signals, axes: win.axes ?? other.axes })
  }
  return [...best.values()]
}

/**
 * The PURE computation (testable, no I/O): outcomes → bounded, shrunk rules (one trial per prospect).
 * `now` is injected to stay deterministic.
 */
export function buildRules(rows: Outcome[], now: string): RulesFile {
  const outcomes = finalOutcomes(rows)
  const file: RulesFile = { updatedAt: now, totalOutcomes: rows.length, prospects: outcomes.length, industries: {}, signals: {} }
  if (outcomes.length === 0) return file
  const globalRate = mean(outcomes.map(succ))

  // (1) TRADES: real conversion rate vs average → `value` delta (bounded, shrunk)
  const byInd = new Map<string, Outcome[]>()
  for (const o of outcomes) {
    const arr = byInd.get(o.industry) ?? []
    arr.push(o)
    byInd.set(o.industry, arr)
  }
  const indEvidence: IndEvidence[] = []
  for (const [industry, os] of byInd) {
    const n = os.length
    const rate = mean(os.map(succ))
    const conf = n / (n + IND_PRIOR)
    const valueDelta = clampN(Math.round((rate - globalRate) * VALUE_SCALE * conf), -IND_CAP, IND_CAP)
    if (valueDelta !== 0) file.industries![industry] = { value: valueDelta }
    indEvidence.push({ industry, n, rate: +rate.toFixed(2), conf: +conf.toFixed(2), valueDelta })
  }

  // (2) SIGNALS: lift (present vs absent) → bonus multiplier (bounded, shrunk)
  const sigEvidence: SigEvidence[] = []
  for (const k of SIGNAL_KEYS) {
    const withS = outcomes.filter((o) => o.signals?.[k])
    const without = outcomes.filter((o) => !o.signals?.[k])
    if (!withS.length || !without.length) continue // no contrast → nothing can be said
    const lift = mean(withS.map(succ)) - mean(without.map(succ))
    const nMin = Math.min(withS.length, without.length)
    const conf = nMin / (nMin + SIG_PRIOR)
    const mult = clampN(1 + lift * SIG_SCALE * conf, SIG_MIN, SIG_MAX)
    if (Math.abs(mult - 1) > 0.01) file.signals![k] = +mult.toFixed(2)
    sigEvidence.push({ signal: k, nWith: withS.length, nWithout: without.length, lift: +lift.toFixed(2), conf: +conf.toFixed(2), mult: +mult.toFixed(2) })
  }

  file.evidence = { globalRate: +globalRate.toFixed(2), industries: indEvidence, signals: sigEvidence }
  return file
}

function renderReport(file: RulesFile): string {
  const ev = file.evidence as { globalRate: number; industries: IndEvidence[]; signals: SigEvidence[] } | undefined
  const L: string[] = []
  L.push("# Learning — calibration report", "", `> Generated by \`npm run learn\` on ${file.updatedAt}. **Don't edit by hand** (regenerated).`, "")
  L.push(`**Outcomes analysed: ${file.totalOutcomes}, i.e. ${file.prospects ?? file.totalOutcomes} prospect(s) (one trial per prospect: its final state).** ${(file.prospects ?? file.totalOutcomes) < 10 ? "⚠ Small sample → deliberately tiny deltas (shrinkage). Keep recording outcomes." : ""}`, "")
  if (!file.totalOutcomes) {
    L.push("No outcome yet. The scoring runs on its human baselines (the default behaviour).", "", "Record an outcome: `npm run learn:record -- <id> <won|lost|reply|meeting|sent>`.")
    return L.join("\n") + "\n"
  }
  L.push(`Overall success rate: **${ev?.globalRate}** (each prospect's final state: won=1 · meeting=.6 · reply=.3 · sent/lost=0).`, "")
  L.push("## Trades — learned ticket-value delta", "", "| trade | prospects | rate | confidence | Δ value |", "|---|---:|---:|---:|---:|")
  for (const r of ev?.industries ?? []) L.push(`| ${r.industry} | ${r.n} | ${r.rate} | ${r.conf} | ${r.valueDelta >= 0 ? "+" : ""}${r.valueDelta} |`)
  L.push("", "## Free signals — learned bonus multiplier", "", "| signal | n with | n without | lift | confidence | ×mult |", "|---|---:|---:|---:|---:|---:|")
  for (const r of ev?.signals ?? []) L.push(`| ${r.signal} | ${r.nWith} | ${r.nWithout} | ${r.lift >= 0 ? "+" : ""}${r.lift} | ${r.conf} | ${r.mult} |`)
  L.push("", "_The deltas/multipliers are bounded (value ±15, mult 0.5–1.5) and damped by the confidence: the loop refines, it doesn't replace human judgement._")
  return L.join("\n") + "\n"
}

/** The outcomes in the file + those in the database mirror (the cockpit's CRM), deduplicated. */
export async function loadOutcomes(): Promise<{ outcomes: Outcome[]; fromFile: number; fromDb: number }> {
  const { readOutcomesFile } = await import("./record.ts")
  const file = await readOutcomesFile(OUTCOMES_PATH)
  const key = (o: Outcome) => `${o.id}|${o.outcome}|${o.ts}`
  const seen = new Set(file.map(key))
  const all = [...file]
  let fromDb = 0
  if (process.env.DATABASE_URL) {
    try {
      const { readEvents } = await import("../../outreach/tracking/events.ts")
      for (const e of await readEvents({ types: ["outcome"] })) {
        const o = e.data as Outcome | undefined
        if (!o || typeof o.id !== "string" || typeof o.outcome !== "string" || seen.has(key(o))) continue
        seen.add(key(o)); all.push(o); fromDb++
      }
    } catch { /* database unavailable: the file alone */ }
  }
  return { outcomes: all, fromFile: file.length, fromDb }
}

/** Writes the rules (what the scoring reads) and the report from these outcomes. */
export async function writeRules(outcomes: Outcome[], now = new Date().toISOString()): Promise<RulesFile> {
  const file = buildRules(outcomes, now)
  await mkdir(dirname(RULES_PATH), { recursive: true })
  await mkdir(dirname(REPORT_PATH), { recursive: true })
  await writeFile(RULES_PATH, JSON.stringify(file, null, 2) + "\n")
  await writeFile(REPORT_PATH, renderReport(file))
  return file
}
/**
 * The loop closes at once : the cockpit calls this after each outcome it records (meeting, won, lost), so the picks and
 * what « What the agency learned » says about them agree right away (the nightly `npm run learn` does the same).
 */
export async function refreshRules(): Promise<RulesFile> {
  const { outcomes } = await loadOutcomes()
  return writeRules(outcomes)
}
/** The rules the scoring reads now (the file), {} when there is none. */
export function readRulesFile(): RulesFile | null {
  try { return JSON.parse(readFileSync(RULES_PATH, "utf8")) as RulesFile } catch { return null }
}

// --- CLI ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile() } catch { /* no .env: the file alone */ }
  const { outcomes, fromDb } = await loadOutcomes()
  if (fromDb) console.log(`  + ${fromDb} outcome(s) read from the database (the cockpit's CRM)`)

  const file = await writeRules(outcomes)

  const nInd = Object.keys(file.industries ?? {}).length
  const nSig = Object.keys(file.signals ?? {}).length
  console.log(`✓ rules recomputed from ${outcomes.length} outcome(s), ${file.prospects} prospect(s) → ${RULES_PATH}`)
  console.log(`  ${nInd} trade(s) adjusted, ${nSig} signal(s) adjusted. Report: learning/analysis/report.md`)
  if ((file.prospects ?? 0) < 10) console.log("  ⚠ small sample: deliberately tiny deltas (shrinkage). The scoring stays close to its baselines.")
  const { closeDb } = await import("../../packages/shared/db.ts"); closeDb()
}
