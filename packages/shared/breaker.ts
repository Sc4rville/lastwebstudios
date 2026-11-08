/**
 * breaker.ts · THE deliverability CIRCUIT BREAKER (pure computation, no I/O: testable, shared by the sequencer + cockpit).
 *
 * The rule comes from `docs/funnel-strategy.md` §6 ("discipline, or nothing"): a verified list, **bounces < 1 %**,
 * **complaints < 0.1 %**, and "red = immediate pause". Unsubscribes have no written threshold in §6: 2 % is
 * the threshold chosen here (beyond it, the targeting or the message displeases; tunable). The values live in
 * `outreach/sequencer/config.json` → `breaker` (otherwise the defaults below).
 *
 * Computation: over a sliding window (7 days by default, and never before the last reset), rate = events
 * / max(sends, minSends). The `minSends` floor (100) keeps ONE bounce out of 3 sends from cutting everything, but keeps
 * the intended severity on complaints: 1 complaint on a small volume = 1 % > 0.1 % → open.
 *
 * LATCHED: once open, it stays open until a HUMAN reset (`npm run sequencer -- breaker
 * reset` or the cockpit's button), even as the window slides. A red light gets looked at, it doesn't go out by itself.
 */

export type BreakerThresholds = {
  windowDays: number
  minSends: number
  bounceRate: number
  complaintRate: number
  unsubRate: number
}

/** §6: bounces < 1 %, complaints < 0.1 %; unsubscribes: 2 % (no written threshold in §6). */
export const BREAKER_DEFAULTS: BreakerThresholds = { windowDays: 7, minSends: 100, bounceRate: 0.01, complaintRate: 0.001, unsubRate: 0.02 }

export type BreakerKind = "bounce" | "complaint" | "unsub"
export const BREAKER_KINDS: BreakerKind[] = ["bounce", "complaint", "unsub"]
const LABEL: Record<BreakerKind, string> = { bounce: "bounces", complaint: "complaints", unsub: "unsubscribes" }
const LIMIT: Record<BreakerKind, keyof BreakerThresholds> = { bounce: "bounceRate", complaint: "complaintRate", unsub: "unsubRate" }

export type BreakerState = {
  open: boolean
  reasons: string[]
  openedAt: string | null
  resetAt: string | null
  evaluatedAt: string
  since: string
  counts: { sends: number; bounce: number; complaint: number; unsub: number }
  rates: { bounce: number; complaint: number; unsub: number }
  thresholds: BreakerThresholds
}

export function breakerThresholds(cfg?: Partial<BreakerThresholds> | null): BreakerThresholds {
  const t = { ...BREAKER_DEFAULTS }
  for (const k of Object.keys(t) as (keyof BreakerThresholds)[]) {
    const v = Number(cfg?.[k])
    if (cfg && cfg[k] !== undefined && Number.isFinite(v) && v >= 0) t[k] = v
  }
  return t
}

const pct = (x: number) => `${(Math.round(x * 1000) / 10).toLocaleString("en-US")}%`

/**
 * Evaluates the circuit breaker. `sends` = the sends (real or simulated: in dry-run, synthetic events must
 * open the breaker just as in a live run), `events` = timestamped bounces / complaints / unsubscribes.
 */
export function evaluateBreaker(input: {
  sends: { at: string }[]
  events: { type: string; at: string }[]
  now: string
  prev?: BreakerState | null
  thresholds?: Partial<BreakerThresholds> | null
}): BreakerState {
  const t = breakerThresholds(input.thresholds)
  const windowStart = new Date(new Date(input.now).getTime() - t.windowDays * 86_400_000).toISOString()
  const resetAt = input.prev?.resetAt ?? null
  const since = resetAt && resetAt > windowStart ? resetAt : windowStart
  const inWin = (at: string) => typeof at === "string" && at >= since && at <= input.now
  const sends = input.sends.filter((s) => inWin(s.at)).length
  const counts = { sends, bounce: 0, complaint: 0, unsub: 0 }
  for (const e of input.events) if ((BREAKER_KINDS as string[]).includes(e.type) && inWin(e.at)) counts[e.type as BreakerKind]++
  const denom = Math.max(sends, t.minSends, 1)
  const rates = { bounce: counts.bounce / denom, complaint: counts.complaint / denom, unsub: counts.unsub / denom }
  const reasons: string[] = []
  for (const k of BREAKER_KINDS) {
    const limit = t[LIMIT[k]] as number
    if (rates[k] > limit) reasons.push(`${LABEL[k]} ${counts[k]} / ${sends} send(s) over ${t.windowDays} days = ${pct(rates[k])} > ${pct(limit)}`)
  }
  const latched = input.prev?.open === true
  const open = latched || reasons.length > 0
  return {
    open,
    reasons: latched ? [...new Set([...(input.prev?.reasons ?? []), ...reasons])] : reasons,
    openedAt: latched ? input.prev?.openedAt ?? input.now : open ? input.now : null,
    resetAt,
    evaluatedAt: input.now,
    since,
    counts,
    rates,
    thresholds: t,
  }
}

/** The human reset: closed, and the window starts again now (earlier incidents no longer count). */
export function resetBreaker(prev: BreakerState | null, now: string): BreakerState {
  const t = prev?.thresholds ?? BREAKER_DEFAULTS
  return {
    open: false, reasons: [], openedAt: null, resetAt: now, evaluatedAt: now, since: now,
    counts: { sends: 0, bounce: 0, complaint: 0, unsub: 0 }, rates: { bounce: 0, complaint: 0, unsub: 0 }, thresholds: t,
  }
}
