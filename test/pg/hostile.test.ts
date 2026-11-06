/**
 * Test blitz (24/10) · le cockpit AVEC base (le mode de la box) sous entrées hostiles : mêmes corps absurdes que
 * test/cockpit/hostile.test.ts sur toutes les routes POST, cette fois les routes CRM, batch, love, statut… écrivent en
 * base. Attendu : aucun 5xx, serveur vivant, et la base garde un état sain (aucune ligne au nom d'une traversée).
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { freshDatabase } from "../helpers/pg.ts"
import { npmRun } from "../helpers/proc.ts"
import { makeWorkspace, type Workspace } from "../helpers/workspace.ts"
import { startCockpit } from "../helpers/cockpit.ts"
import { hostileSweep } from "../helpers/hostile.ts"
import type { Proc } from "../helpers/server.ts"

let db: Awaited<ReturnType<typeof freshDatabase>>, ws: Workspace, cockpit: Proc
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
before(async () => {
  db = await freshDatabase()
  ws = makeWorkspace({ seed: ["agency"] })
  const env = { DATABASE_URL: db.url, DB_SSL: "disable" }
  assert.equal((await npmRun(ws.dir, "db:init", [], { env })).code, 0)
  cockpit = await startCockpit(ws.dir, env)
  for (let i = 0; i < 300 && !/index DB →/.test(cockpit.output()); i++) await sleep(100)
})
after(async () => { await cockpit?.stop(); ws?.cleanup(); await db?.drop() })

test("balayage hostile avec base : aucune réponse 5xx, serveur vivant, aucune ligne au nom d'une traversée", { timeout: 300_000 }, async () => {
  const { routes, bad } = await hostileSweep(cockpit.url)
  assert.ok(routes >= 35)
  assert.deepEqual(bad, [])
  for (const [table, col] of [["crm_leads", "prospect_id"], ["generations", "prospect_id"], ["prospects", "id"], ["batch_requests", "params_json"]] as const) {
    const rows = await db.sql.unsafe(`SELECT ${col} AS v FROM ${table}`)
    assert.deepEqual(rows.filter((r: any) => /\.\.\/|passwd|\u0000/.test(String(r.v))), [], `${table} sain`)
  }
})
