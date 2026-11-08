/**
 * Learning — the rules READER, used by the scoring (`score.ts`).
 * It is the only place where `leadengine/2_scoring` reads `learning/rules` (see ARCHITECTURE § dependencies).
 *
 * SAFETY INVARIANT: no rules (file missing / unreadable / empty) → `{}` → the scoring runs on
 * its human baselines, unchanged. The loop can NEVER break the gate, only refine it.
 */
import { readFile } from "node:fs/promises"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type { LearnedRules } from "../../leadengine/2_scoring/scripts/model.ts"

const RULES_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "rules", "rules.json")

let cache: LearnedRules | undefined // a single I/O per process

/** Loads the learned rules. Tolerates anything: no file, broken JSON, missing fields → `{}`. */
export async function loadRules(): Promise<LearnedRules> {
  if (cache) return cache
  try {
    const raw = JSON.parse(await readFile(RULES_PATH, "utf8"))
    cache = { industries: raw?.industries ?? {}, signals: raw?.signals ?? {} }
  } catch {
    cache = {}
  }
  return cache
}
