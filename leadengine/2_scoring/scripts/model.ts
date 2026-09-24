/**
 * Scoring — THE MODEL: five weighted axes. Pure, no I/O, unit-tested.
 *
 *   NEED          30  is their site weak? (tech probe + visual judge, computed upstream)
 *   LEVERAGE      25  does a beautiful site change the game for this trade?
 *   VALUE         20  what the deal is worth — industry baseline ± size and premium signals
 *   REACHABILITY  15  can we actually reach a single decision-maker?
 *   EXPANSION     10  future potential (booking, e-commerce, recurring)
 *
 * Tiers: hot ≥ 60 · warm ≥ 35 · cold < 35.
 * Learned rules (from learning/) are BOUNDED deltas on top of the human baselines — never a replacement.
 */
import type { Axes, Signals, Tier } from "../../../packages/shared/prospect.ts"
import { industryProfile, normalizeIndustry } from "./industries.ts"

export type { Axes, Signals, Tier }

export const WEIGHTS = { need: 30, leverage: 25, value: 20, reachability: 15, expansion: 10 } as const

/** What the scoring knows about a prospect BEFORE paying for the expensive steps. */
export type Meta = { industry: string; email?: string; phone?: string; headcount?: number | null }

/**
 * Rules LEARNED by the feedback loop. Absent → {} → behaviour is STRICTLY the human baseline.
 *   industries[trade] = deltas on the baselines
 *   signals[name]     = multiplier on that signal's bonus
 */
export type LearnedRules = {
  industries?: Record<string, Partial<Record<"leverage" | "value" | "expansion", number>>>
  signals?: Record<string, number>
}

const NO_RULES: LearnedRules = {}
const delta = (r: LearnedRules, ind: string, axis: "leverage" | "value" | "expansion") =>
  r.industries?.[normalizeIndustry(ind)]?.[axis] ?? 0
const mult = (r: LearnedRules, name: string) => r.signals?.[name] ?? 1
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

/** REACHABILITY: a phone is the essential, an e-mail is a bonus, a small team means one decision-maker. */
export function reachability(meta: Meta): number {
  let v = 0
  if (meta.phone) v += 65
  if (meta.email) v += 20
  if (meta.headcount == null || meta.headcount <= 20) v += 15
  return clamp(v)
}

export function leverageAxis(meta: Meta, sig: Signals = {}, rules = NO_RULES): number {
  let v = (industryProfile(meta.industry)?.leverage ?? 50) + delta(rules, meta.industry, "leverage")
  if (sig.gallery) v += 8 * mult(rules, "gallery") // the portfolio sells for them
  if (sig.quoteCta) v += 6 * mult(rules, "quoteCta") // the site already generates leads
  if (sig.social) v += 4 * mult(rules, "social")
  if (!sig.gallery && !sig.quoteCta) v -= 10 // an inert brochure site: the web weighs less
  return clamp(v)
}

export function valueAxis(meta: Meta, sig: Signals = {}, rules = NO_RULES): number {
  let v = (industryProfile(meta.industry)?.value ?? 50) + delta(rules, meta.industry, "value")
  if (meta.headcount != null) v += meta.headcount >= 50 ? 15 : meta.headcount <= 2 ? -10 : 0
  if (sig.premium) v += 12 * mult(rules, "premium") // bespoke / high-end positioning
  if (sig.multiSite) v += 8 * mult(rules, "multiSite") // several showrooms: a structure that can pay
  return clamp(v)
}

export function expansionAxis(meta: Meta, sig: Signals = {}, rules = NO_RULES): number {
  let v = (industryProfile(meta.industry)?.expansion ?? 30) + delta(rules, meta.industry, "expansion")
  if (sig.ecommerce) v += 15 * mult(rules, "ecommerce")
  if (sig.booking) v += 10 * mult(rules, "booking")
  if (sig.blog) v += 5 * mult(rules, "blog")
  return clamp(v)
}

export function buildAxes(need: number, meta: Meta, sig: Signals = {}, rules = NO_RULES): Axes {
  return {
    need: clamp(need),
    leverage: leverageAxis(meta, sig, rules),
    value: valueAxis(meta, sig, rules),
    reachability: reachability(meta),
    expansion: expansionAxis(meta, sig, rules),
  }
}

export function weighted(a: Axes): number {
  return Math.round(
    (a.need * WEIGHTS.need + a.leverage * WEIGHTS.leverage + a.value * WEIGHTS.value +
      a.reachability * WEIGHTS.reachability + a.expansion * WEIGHTS.expansion) / 100,
  )
}

/** Expected value — sorts the queue: two "hot" prospects are not worth the same. */
export const expectedValue = (a: Axes) => Math.round(a.value * (a.need / 100) * (a.reachability / 100))

export const tierOf = (value: number): Tier => (value >= 60 ? "hot" : value >= 35 ? "warm" : "cold")

/**
 * ROI-aware NEED floor: below it, the site is "already fine → no opportunity".
 * A high-value trade justifies chasing a more moderate need, so the floor drops as value rises.
 */
export const needFloor = (value: number) => Math.max(25, Math.min(40, Math.round(45 - value * 0.2)))

/** Nobody to call and nobody to e-mail → never "hot": you literally cannot reach them. */
export function capUnreachable(tier: Tier, meta: Meta, reasons: string[]): Tier {
  if (!meta.phone && !meta.email && tier === "hot") {
    reasons.push("unreachable (no e-mail, no phone) → capped at warm")
    return "warm"
  }
  return tier
}
