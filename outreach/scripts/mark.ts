/**
 * Outreach · writes the result of creating the Gmail draft back into the record.
 *
 * The `outreach-mail` skill (the only one holding the Gmail/MCP connector) creates the draft, then calls
 * this to record the draft's `id` + the status in `data/outreach/<id>.json`. Idempotent.
 *
 * CLI : npm run outreach:mark -- <id> <gmailDraftId> [drafted|sent]
 */
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { getDb } from "../../packages/shared/db.ts"

try { process.loadEnvFile() } catch { /* no .env → DB status skipped (the json is still written) */ }

const OUTREACH = join("data", "outreach")

export async function markDraft(id: string, gmailDraftId: string, status: "drafted" | "sent" = "drafted") {
  const path = join(OUTREACH, `${id}.json`)
  const rec = JSON.parse(await readFile(path, "utf8"))
  rec.gmailDraftId = gmailDraftId
  rec.status = status
  rec.draftedAt = new Date().toISOString()
  rec.draftedGenDir = rec.genDir // the build THIS draft was made for (→ freshness check at the next /out)
  rec.pendingGmail = false       // the outreach platform's queue is drained for this prospect
  await writeFile(path, JSON.stringify(rec, null, 2))
  // shared DB status (the cockpit reads it): "drafted" = a real Gmail draft was created · "sent" = sent by hand
  if (rec.genDir && process.env.DATABASE_URL) {
    try { await getDb().prepare("UPDATE generations SET status=?, status_changed_at=? WHERE prospect_id=? AND dir_slug=?").run(status, Date.now(), id, rec.genDir) } catch { /* DB best-effort */ }
  }
  return rec
}

// --- CLI ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [id, draftId, status] = process.argv.slice(2)
  if (!id || !draftId) { console.error("usage: npm run outreach:mark -- <id> <gmailDraftId> [drafted|sent]"); process.exit(1) }
  const rec = await markDraft(id, draftId, status === "sent" ? "sent" : "drafted")
  console.log(`✓ ${id} → ${rec.status} (draft ${draftId})`)
}
