/**
 * Learning — the loop's types (link 9). Shared by `record` (writes the outcomes) and
 * `learn` (recomputes the rules). The SHAPE of the rules belongs to the scoring (`model.ts`, `LearnedRules`):
 * the loop PRODUCES what the scoring CONSUMES (see ARCHITECTURE § dependencies). Type-only import → zero
 * runtime coupling, `model.ts` stays pure/testable.
 */
import type { LearnedRules, Axes, Signals } from "../../leadengine/2_scoring/scripts/model.ts"
export type { LearnedRules, Axes, Signals }

/** The outcome of a contacted prospect. This is the GROUND TRUTH the loop learns from. */
export const OUTCOMES = ["sent", "reply", "meeting", "won", "lost"] as const
export type OutcomeKind = (typeof OUTCOMES)[number]

/** The "success" weight of each outcome (0–1). A meeting beats a reply, a sale is worth everything. */
export const OUTCOME_WEIGHT: Record<OutcomeKind, number> = {
  sent: 0, // contacted, no reaction (yet) → a trial at 0
  reply: 0.3, // they answer → engagement
  meeting: 0.6, // meeting → real interest
  won: 1, // sold → the golden signal
  lost: 0, // declined → a failed trial
}

/** A line of `data/outcomes.jsonl`: the outcome + the features that predicted it (at scoring time). */
export type Outcome = {
  id: string
  industry: string
  value?: number
  tier?: string
  axes?: Axes
  signals?: Signals
  outcome: OutcomeKind
  ts: string
}

/** The rules file on disk: the rules the scoring reads + transparency metadata. */
export type RulesFile = LearnedRules & {
  updatedAt: string
  totalOutcomes: number
  /** distinct prospects = trials (one per prospect, its final state) */
  prospects?: number
  evidence?: unknown // the counts/rates per trade & signal — so the calibration is readable, not a black box
}
