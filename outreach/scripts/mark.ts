/**
 * Outreach · écrit en retour le résultat de la création du draft Gmail dans le record.
 *
 * Le skill `outreach-mail` (qui seul tient le connecteur Gmail/MCP) crée le brouillon puis appelle
 * ceci pour graver l'`id` du draft + le statut dans `data/outreach/<id>.json`. Idempotent.
 *
 * CLI : npm run outreach:mark -- <id> <gmailDraftId> [drafted|sent]
 */
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { getDb } from "../../packages/shared/db.ts"

try { process.loadEnvFile() } catch { /* pas de .env → statut DB sauté (json quand même écrit) */ }

const OUTREACH = join("data", "outreach")

export async function markDraft(id: string, gmailDraftId: string, status: "drafted" | "sent" = "drafted") {
  const path = join(OUTREACH, `${id}.json`)
  const rec = JSON.parse(await readFile(path, "utf8"))
  rec.gmailDraftId = gmailDraftId
  rec.status = status
  rec.draftedAt = new Date().toISOString()
  rec.draftedGenDir = rec.genDir // la gen pour laquelle CE draft a été fait (→ check fraîcheur au prochain /out)
  rec.pendingGmail = false       // la file de la plateforme outreach est drainée pour ce prospect
  await writeFile(path, JSON.stringify(rec, null, 2))
  // statut DB partagée (le cockpit le lit) : "drafted" = vrai brouillon Gmail créé · "sent" = envoyé à la main
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
