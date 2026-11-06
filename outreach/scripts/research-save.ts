/**
 * research-save.ts · persiste le BRIEF + le SCRIPT D'APPEL produits par le skill `/account-research`
 * dans la DB partagée (`crm_leads`), pour que le CRM `/outreach` les affiche (script à lire pendant l'appel).
 *
 * Le skill (réflexion/LLM) écrit `data/research/<id>.json` = { callScript: "...", research: {...} } ;
 * ce script (mécanique) le lit et l'UPSERT dans `crm_leads`. La DB étant partagée local↔box, le script
 * apparaît dans le cockpit/outreach de la VM sans git ni rsync.
 *
 * CLI : npm run research:save -- <id>
 */
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { getDb, closeDb } from "../../packages/shared/db.ts"

try { process.loadEnvFile() } catch { /* pas de .env → la DB lèvera */ }

const VALID = /^[\w.-]+$/

export async function saveResearch(id: string, payload: { callScript?: string; research?: unknown }): Promise<void> {
  const cs = typeof payload.callScript === "string" ? payload.callScript.slice(0, 20000) : null
  const rj = payload.research != null ? JSON.stringify(payload.research).slice(0, 60000) : null
  await getDb().prepare(
    `INSERT INTO crm_leads(prospect_id, call_script, research_json, updated_at) VALUES (?,?,?,?)
     ON CONFLICT (prospect_id) DO UPDATE SET
       call_script = COALESCE(EXCLUDED.call_script, crm_leads.call_script),
       research_json = COALESCE(EXCLUDED.research_json, crm_leads.research_json),
       updated_at = EXCLUDED.updated_at`,
  ).run(id, cs, rj, Date.now())
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const id = process.argv[2]
  if (!id || !VALID.test(id)) { console.error("usage: npm run research:save -- <id>"); process.exit(1) }
  const path = join("data", "research", `${id}.json`)
  if (!existsSync(path)) { console.error(`✗ ${path} introuvable · le skill /account-research doit l'écrire d'abord`); process.exit(1) }
  const payload = JSON.parse(await readFile(path, "utf8"))
  await saveResearch(id, payload)
  console.log(`✓ recherche + script d'appel enregistrés pour ${id} → crm_leads (visible dans /outreach)`)
  closeDb()
}
