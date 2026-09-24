/**
 * Learning — the types of the loop. The SHAPE of the rules belongs to the scoring (`LearnedRules`):
 * the loop PRODUCES what the scoring CONSUMES. Type-only import → zero runtime coupling.
 */
import type { LearnedRules } from "../../leadengine/2_scoring/scripts/model.ts"
import type { Axes, Signals } from "../../packages/shared/prospect.ts"
export type { LearnedRules, Axes, Signals }

/** What happened after a prospect was contacted. This is the GROUND TRUTH the loop learns from. */
export const OUTCOMES = ["sent", "reply", "meeting", "won", "lost"] as const
export type OutcomeKind = (typeof OUTCOMES)[number]

/** "Success" weight of each outcome (0–1). A meeting beats a reply; a signed deal is worth everything. */
export const OUTCOME_WEIGHT: Record<OutcomeKind, number> = { sent: 0, reply: 0.3, meeting: 0.6, won: 1, lost: 0 }

/** One line of `data/outcomes.jsonl`: the outcome + the features that predicted it at scoring time. */
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

/** The rules file on disk: what the scoring reads + the evidence, so calibration is never a black box. */
export type RulesFile = LearnedRules & { updatedAt: string; totalOutcomes: number; evidence?: unknown }
