/**
 * Blitz test (24/10) · billing WITH a database (the box's mode): the legal numbering stays complete and never overwrites
 * when two operators (or a double click) create invoices at the same time. Before: `persist()` did an upsert
 * (ON CONFLICT DO UPDATE), so the second invoice replaced the first under the same number, without an error.
 * Two cockpits on the same database (two operators) to also cover two processes.
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
  // the seller's own details first (shared through the database) : an invoice never prints a <…> placeholder
  const r = await fetch(c1.url + "/api/invoice-settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Studio Fictif", address: "12 rue Fictive, 75011 Paris", siret: "000 000 000 00000" }) })
  assert.equal(r.status, 200)
})
after(async () => { await c1?.stop(); await c2?.stop(); ws1?.cleanup(); ws2?.cleanup(); await db?.drop() })

test("two cockpits on the same database, 16 invoices created at the same time: 16 numbers, complete sequence, none overwritten", async () => {
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
  assert.deepEqual(rows.map((r: any) => r.data.client.name).sort(), [...names].sort(), "each number keeps ITS invoice")
})
