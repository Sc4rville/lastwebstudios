/**
 * research-save.ts · saves the BRIEF + the CALL SCRIPT produced by the `/account-research` skill
 * into the shared DB (`crm_leads`), so the `/outreach` CRM shows them (a script to read during the call).
 *
 * The skill (thinking/LLM) writes `data/research/<id>.json` = { callScript: "...", research: {...} };
 * this script (mechanical) reads it and UPSERTs it into `crm_leads`. Since the DB is shared local↔box, the script
 * shows up in the VM's cockpit/outreach without git or rsync.
 *
 * CLI : npm run research:save -- <id>
 */
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { getDb, closeDb } from "../../packages/shared/db.ts"

try { process.loadEnvFile() } catch { /* no .env → the DB will throw */ }

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
  if (!existsSync(path)) { console.error(`✗ ${path} not found · the /account-research skill must write it first`); process.exit(1) }
  const payload = JSON.parse(await readFile(path, "utf8"))
  await saveResearch(id, payload)
  console.log(`✓ research + call script saved for ${id} → crm_leads (visible in /outreach)`)
  closeDb()
}
