/**
 * Learning — RECORDS a real-world outcome (the loop's fuel).
 *
 *   npm run learn:record -- <id> <sent|reply|meeting|won|lost> [industry]
 *
 * Takes the features at scoring time (axes + signals) from the prospect's sheet, and pairs them
 * with the outcome → an append-only line in `data/outcomes.jsonl`. This features↔outcome pairing is what
 * lets `learn` measure what really predicts a sale.
 *
 * AUTOMATIC since the night of 2026-10-24 (`recordOutcome`, importable): the CRM records
 * `meeting` (meeting booked), `won` (card dropped in Signature) and `lost` ("lost" in the call cockpit) itself, the
 * sequencer records `reply` (the reply reader). `dedupe`: the same outcome counts only ONCE
 * per prospect (dragging a card into Signature again doesn't inflate the rate). Mirrored in the shared database
 * (`outreach_events`, type `outcome`): the cockpit (a container) and `npm run learn` (the box, nightly timer) don't
 * share a disk; `learn` merges both sources.
 */
import { readFile, appendFile, mkdir } from "node:fs/promises"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { OUTCOMES, type Outcome, type OutcomeKind } from "./types.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
export const OUTCOMES_FILE = join(ROOT, "data", "outcomes.jsonl")

/** The enriched sheet (`prospects/<id>.json`, `.score` block), completed by the raw score (`raw/<id>.score.json`)
 *  for what the sheet lacks (axes, signals); the raw score alone if there is no sheet. */
async function readScored(id: string): Promise<any | null> {
  const read = async (p: string) => { try { return JSON.parse(await readFile(p, "utf8")) } catch { return null } }
  const sheet = await read(join(ROOT, "data", "prospects", `${id}.json`))
  const raw = await read(join(ROOT, "data", "raw", `${id}.score.json`))
  if (!sheet) return raw
  if (raw) sheet.score = { ...raw, ...(sheet.score || {}), axes: sheet.score?.axes ?? raw.axes, signals: sheet.score?.signals ?? raw.signals }
  return sheet
}

/** The outcomes in the file (broken lines ignored). */
export async function readOutcomesFile(file = OUTCOMES_FILE): Promise<Outcome[]> {
  try {
    return (await readFile(file, "utf8")).split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l) as Outcome } catch { return null } })
      .filter((o): o is Outcome => !!o && typeof o.id === "string" && OUTCOMES.includes(o.outcome))
  } catch { return [] }
}

export type RecordResult = { recorded: boolean; outcome: Outcome; reason?: string; mirrored?: boolean }

/**
 * Records an outcome for a prospect. `dedupe` (default: true): does nothing if this outcome is already
 * recorded for this prospect. Never throws over a problem writing the database mirror.
 */
export async function recordOutcome(id: string, kind: OutcomeKind, o: { industry?: string; dedupe?: boolean; source?: string; at?: string } = {}): Promise<RecordResult> {
  if (!OUTCOMES.includes(kind)) throw new Error(`unknown outcome: ${kind} (expected: ${OUTCOMES.join("|")})`)
  const rec = await readScored(id)
  const score = rec?.score ?? rec // prospects/<id>.json carries `.score`; raw/<id>.score.json IS the score
  const outcome: Outcome = {
    id,
    industry: o.industry ?? rec?.industry ?? "?",
    value: score?.value,
    tier: score?.tier,
    axes: score?.axes,
    signals: score?.signals ?? {},
    outcome: kind,
    ts: o.at ?? new Date().toISOString(),
  }
  if (o.dedupe !== false && (await readOutcomesFile()).some((x) => x.id === id && x.outcome === kind)) {
    return { recorded: false, outcome, reason: "already recorded" }
  }
  await mkdir(dirname(OUTCOMES_FILE), { recursive: true })
  await appendFile(OUTCOMES_FILE, JSON.stringify(outcome) + "\n")
  let mirrored = false
  if (process.env.DATABASE_URL) {
    try {
      const { recordEvent, stableId } = await import("../../outreach/tracking/events.ts")
      const r = await recordEvent({ id: stableId(`outcome\n${id}\n${kind}\n${outcome.ts}`), type: "outcome", source: "crm", prospectId: id, at: outcome.ts, data: { ...outcome, by: o.source ?? null } })
      mirrored = r.stored === "db"
    } catch { /* the file line is the reference */ }
  }
  return { recorded: true, outcome, mirrored, ...(rec ? {} : { reason: "no prospect sheet: empty features" }) }
}

// --- CLI ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile() } catch { /* no .env: the file alone */ }
  const [id, outcome, industryArg] = process.argv.slice(2)
  if (!id || !outcome || !OUTCOMES.includes(outcome as OutcomeKind)) {
    console.error(`usage: npm run learn:record -- <id> <${OUTCOMES.join("|")}> [industry]`)
    process.exit(1)
  }
  // the CLI keeps its original behaviour: each call = one line (no deduplication)
  const r = await recordOutcome(id, outcome as OutcomeKind, { industry: industryArg, dedupe: false, source: "cli" })
  if (r.reason === "no prospect sheet: empty features") console.warn(`⚠ no prospect sheet or score found for "${id}" — outcome recorded without features (empty axes/signals).`)
  console.log(`✓ outcome recorded: ${id} → ${outcome} (${r.outcome.industry}). Recompute the rules with: npm run learn`)
  const { closeDb } = await import("../../packages/shared/db.ts"); closeDb()
}
