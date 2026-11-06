/**
 * Test blitz (24/10) · facturation AVEC base (le mode de la box) : la numérotation légale reste pleine et sans écrasement
 * quand deux opérateurs (ou un double clic) créent des factures en même temps. Avant : `persist()` faisait un upsert
 * (ON CONFLICT DO UPDATE), donc la seconde facture remplaçait la première sous le même numéro, sans erreur.
 * Deux cockpits sur la même base (Naly et Yann) pour couvrir aussi deux process.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { freshDatabase } from "../helpers/pg.ts"
import { npmRun } from "../helpers/proc.ts"
import { makeWorkspace, type Workspace } from "../helpers/workspace.ts"
import { startCockpit } from "../helpers/cockpit.ts"
import type { Proc } from "../helpers/server.ts"

let db: Awaited<ReturnType<typeof freshDatabase>>, ws1: Workspace, ws2: Workspace, c1: Proc, c2: Proc

before(async () => {
  db = await freshDatabase()
  ws1 = makeWorkspace({ seed: ["agency"] }); ws2 = makeWorkspace({ seed: ["agency"] })
  const env = { DATABASE_URL: db.url, DB_SSL: "disable" }
  assert.equal((await npmRun(ws1.dir, "db:init", [], { env })).code, 0)
  ;[c1, c2] = await Promise.all([startCockpit(ws1.dir, env), startCockpit(ws2.dir, env)])
})
after(async () => { await c1?.stop(); await c2?.stop(); ws1?.cleanup(); ws2?.cleanup(); await db?.drop() })

test("deux cockpits sur la même base, 16 factures créées en même temps : 16 numéros, séquence pleine, aucune écrasée", async () => {
  const names = Array.from({ length: 16 }, (_, i) => `Client fictif ${i + 1}`)
  const created = await Promise.all(names.map((name, i) => fetch((i % 2 ? c2 : c1).url + "/api/invoices", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client: { name }, items: [{ label: "Site vitrine", qty: 1, unitPrice: 990 }], vatRate: 20 }),
  }).then((r) => r.json())))
  assert.equal(new Set(created.map((c: any) => c.number)).size, 16, created.map((c: any) => c.number).join(", "))
  const rows = await db.sql`SELECT number, data FROM invoices ORDER BY number`
  assert.equal(rows.length, 16)
  const year = new Date().toISOString().slice(0, 4)
  assert.deepEqual(rows.map((r: any) => r.number), names.map((_, i) => `${year}-${String(i + 1).padStart(3, "0")}`))
  assert.deepEqual(rows.map((r: any) => r.data.client.name).sort(), [...names].sort(), "chaque numéro garde SA facture")
})
