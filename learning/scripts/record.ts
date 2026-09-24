/**
 * Learning — RECORD one field outcome (the fuel of the loop).
 *
 *   npm run learn:record -- <id> <sent|reply|meeting|won|lost>
 *
 * Couples the outcome with the features the scoring saw (axes + signals, read from the prospect sheet)
 * → one append-only line in `data/outcomes.jsonl`. That coupling is what lets `learn` measure what
 * actually predicts a sale.
 */
import { readFile, appendFile, mkdir } from "node:fs/promises"
import { join, dirname } from "node:path"
import { OUTCOMES, type Outcome, type OutcomeKind } from "./types.ts"

const OUT = join("data", "outcomes.jsonl")

const [id, outcome] = process.argv.slice(2)
if (!id || !OUTCOMES.includes(outcome as OutcomeKind)) {
  console.error(`usage: npm run learn:record -- <id> <${OUTCOMES.join("|")}>`)
  process.exit(1)
}

let sheet: any = null
try {
  sheet = JSON.parse(await readFile(join("data", "prospects", `${id}.json`), "utf8"))
} catch {
  console.warn(`⚠ no prospect sheet for "${id}" — outcome recorded without features`)
}

const o: Outcome = {
  id,
  industry: sheet?.industry ?? "?",
  value: sheet?.score?.value,
  tier: sheet?.score?.tier,
  axes: sheet?.score?.axes,
  signals: sheet?.score?.signals ?? {},
  outcome: outcome as OutcomeKind,
  ts: new Date().toISOString(),
}
await mkdir(dirname(OUT), { recursive: true })
await appendFile(OUT, JSON.stringify(o) + "\n")
console.log(`✓ outcome recorded: ${id} → ${outcome}. Recompute the rules with: npm run learn`)
