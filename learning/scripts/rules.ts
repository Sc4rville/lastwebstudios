/**
 * Learning — the rules READER, consumed by the scoring. The only bridge from `learning/` to `leadengine/`.
 *
 * SAFETY INVARIANT: no rules (missing / unreadable / empty file) → `{}` → the scoring runs on its human
 * baselines, identically. The loop can never break the gate, only refine it.
 */
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { LearnedRules } from "./types.ts"

export const RULES_PATH = () => process.env.RULES_PATH || join(process.cwd(), "learning", "rules", "rules.json")

export async function loadRules(): Promise<LearnedRules> {
  try {
    const raw = JSON.parse(await readFile(RULES_PATH(), "utf8"))
    return { industries: raw?.industries ?? {}, signals: raw?.signals ?? {} }
  } catch {
    return {}
  }
}
