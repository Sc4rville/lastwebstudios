/**
 * test-reply.ts · lit les expéditeurs des réponses reçues sur 24 h dans UNE boîte (lecture seule, Gmail API).
 * Usage : npx tsx outreach/scripts/test-reply.ts [inbox]   (défaut : la 1re boîte de outreach/sequencer/config.json)
 */
import { readFileSync } from "node:fs"
import { fetchReplyFroms } from "./lib/imap.ts"

function firstInbox(): string {
  try {
    const cfg = JSON.parse(readFileSync("outreach/sequencer/config.json", "utf8"))
    return [...(cfg.inboxes?.B ?? []), ...(cfg.inboxes?.A ?? [])][0]?.email || ""
  } catch { return "" }
}
const inbox = process.argv[2] || firstInbox()
if (!inbox) { console.error("usage : npx tsx outreach/scripts/test-reply.ts <inbox> (aucune boîte dans outreach/sequencer/config.json)"); process.exit(1) }
const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
try {
  const froms = await fetchReplyFroms(inbox, since)
  console.log("✅ lecture réponses OK:", froms.length ? froms : "(aucun expéditeur reçu sur 24h, normal)")
} catch (e: any) {
  console.error("ERREUR:", e?.message || e)
}
