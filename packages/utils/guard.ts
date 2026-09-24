/**
 * guard.ts — kill switch + anti-thrash circuit (the cage).
 *
 * Checked at the top of every run AND before every prospect: a `touch STOP` at the repo root, or a budget
 * ceiling, stops the run CLEANLY between two prospects — never mid-flight.
 */
import { existsSync, appendFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"

export { assertBudget, BudgetExceeded } from "./meter.ts"

/** The operator's emergency brake: a file named `STOP` at the repo root. */
export const stopRequested = (): boolean => existsSync(join(process.cwd(), "STOP"))

/**
 * Anti-thrash circuit: returns `true` once the SAME error hits `limit` CONSECUTIVE prospects.
 * A success in between re-arms it. Stops the atelier from burning budget against a deterministic wall.
 */
export function createFailureCircuit(limit = 2): (msg: string, idx: number) => boolean {
  let lastErr = ""
  let same = 0
  let lastIdx = -2
  return (msg, idx) => {
    same = msg === lastErr && idx === lastIdx + 1 ? same + 1 : 1
    lastErr = msg
    lastIdx = idx
    return same >= limit
  }
}

/** Write a clean HALT into the run log (best effort). */
export function logHalt(reason: string): void {
  const path = process.env.RUNLOG_PATH || join(process.cwd(), "journal", "run-log.md")
  try {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, `\n> **HALT ${new Date().toISOString()}** — ${reason}\n`)
  } catch {
    /* best effort */
  }
}
