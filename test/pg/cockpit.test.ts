/**
 * G5 (avec base) : le cockpit sur un Postgres neuf monté par db:init. Les flux du film, en vrai :
 * ♥, notation, Approuver ⇒ Hot Lead · Call 0 + job `research`, kanban, lancer un batch ⇒ job `queued`.
 * Tout en 200, données fictives, port aléatoire, base jetable.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { freshDatabase } from "../helpers/pg.ts"
import { npmRun } from "../helpers/proc.ts"
import { makeWorkspace, type Workspace } from "../helpers/workspace.ts"
import { startCockpit, cockpitGetRoutes } from "../helpers/cockpit.ts"
import type { Proc } from "../helpers/server.ts"

const ID = "orvane-piscines-valmont-sur-lys", DATE = "2026-10-20-composer"
let db: Awaited<ReturnType<typeof freshDatabase>>, ws: Workspace, cockpit: Proc
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

before(async () => {
  db = await freshDatabase()
  ws = makeWorkspace({ seed: ["agency"] })
  const r = await npmRun(ws.dir, "db:init", [], { env: { DATABASE_URL: db.url, DB_SSL: "disable" } })
  assert.equal(r.code, 0, r.out)
  cockpit = await startCockpit(ws.dir, { DATABASE_URL: db.url, DB_SSL: "disable" })
  for (let i = 0; i < 300 && !/index DB →/.test(cockpit.output()); i++) await sleep(100) // reindex de boot
})
after(async () => { await cockpit?.stop(); ws?.cleanup(); await db?.drop() })

const api = async (path: string, body?: unknown) => {
  const r = await fetch(cockpit.url + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  const text = await r.text()
  let json: any = null; try { json = JSON.parse(text) } catch { /* html */ }
  return { status: r.status, json, text }
}

test("boot : reindex du disque vers la base (3 prospects, 2 générations), sans NOTICE", async () => {
  assert.match(cockpit.output(), /index DB → 3 prospects · 2 générations/)
  assert.doesNotMatch(cockpit.output(), /NOTICE|already exists, skipping/)
  const sites = (await api("/api/sites")).json
  assert.equal(sites.length, 2)
  assert.equal(sites.find((s: any) => s.id === ID).name, "Orvane Piscines")
})

test("♥ : POST /api/love puis relu dans /api/sites", async () => {
  const r = await api("/api/love", { id: ID, date: DATE, love: 3 })
  assert.equal(r.status, 200); assert.equal(r.json.love, 3)
  assert.equal((await api("/api/sites")).json.find((s: any) => s.id === ID).love, 3)
})

test("notation : POST /api/score puis GET identique (bornes 0-100 appliquées)", async () => {
  assert.equal((await api("/api/score", { id: ID, date: DATE, dims: { global: 82, typo: 140, "bad key!": 5 }, notes: { global: "le héros respire" } })).status, 200)
  const g = (await api(`/api/score?id=${ID}&date=${DATE}`)).json
  assert.deepEqual(g.dims, { global: 82, typo: 100 })
  assert.equal(g.notes.global, "le héros respire")
})

test("Approuver ⇒ statut approved, job `research` empilé, Hot Lead · Call 0 au CRM", async () => {
  assert.equal((await api("/api/status", { id: ID, date: DATE, status: "approved" })).status, 200)
  const jobs = await db.sql`SELECT mode, status, params_json FROM batch_requests WHERE mode = 'research'`
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].status, "queued")
  assert.deepEqual(JSON.parse(jobs[0].params_json), { ids: [ID] })
  const crm = (await api("/api/crm")).json
  assert.ok(crm.hot.call0.some((l: any) => l.id === ID && l.phone === "03 53 01 24 68"), JSON.stringify(crm.hot.call0))
  const sales = (await api("/api/sales")).json
  assert.ok(sales.items.some((i: any) => i.id === ID && i.love === 3))
})

test("kanban : déplacement en closing/demo puis note d'appel", async () => {
  assert.equal((await api("/api/crm/stage", { id: ID, pipeline: "closing", stage: "demo" })).status, 200)
  assert.equal((await api("/api/crm/stage", { id: ID, pipeline: "closing", stage: "nope" })).status, 400)
  assert.equal((await api("/api/crm/outcome", { id: ID, outcome: "reach", note: "rappeler jeudi", slot: "matin" })).status, 200)
  const crm = (await api("/api/crm")).json
  const lead = crm.closing.demo.find((l: any) => l.id === ID)
  assert.ok(lead, JSON.stringify(crm.closing))
  assert.equal(lead.answered, 1)
  assert.equal(lead.lastNote.text, "rappeler jeudi")
})

test("lancer un batch : POST /api/batch ⇒ job `queued` visible dans /api/batches", async () => {
  const r = await api("/api/batch", { mode: "composer", industry: "pisciniste", limit: 1 })
  assert.equal(r.status, 200, r.text)
  const b = (await api("/api/batches")).json.batches.find((x: any) => x.id === r.json.id)
  assert.equal(b.status, "queued"); assert.equal(b.mode, "composer"); assert.equal(b.industry, "pisciniste"); assert.equal(b.lim, 1)
})

test("/api/leads depuis la base : les 3 fiches, le site d'Orvane détecté", async () => {
  const j = (await api("/api/leads")).json
  assert.equal(j.total, 3)
  assert.equal(j.prospects.find((p: any) => p.id === ID).hasSite, true)
})

test("balayage GET avec base : aucune réponse 5xx", async () => {
  const bad: string[] = []
  for (const p of cockpitGetRoutes()) { const r = await fetch(cockpit.url + p, { redirect: "manual" }); await r.arrayBuffer(); if (r.status >= 500) bad.push(`${r.status} ${p}`) }
  assert.deepEqual(bad, [])
})

test("redémarrage sur une base déjà montée : migrations de boot silencieuses (NOTICE filtrées)", async () => {
  const second = await startCockpit(ws.dir, { DATABASE_URL: db.url, DB_SSL: "disable" })
  try {
    for (let i = 0; i < 200 && !/index DB →/.test(second.output()); i++) await sleep(100)
    assert.doesNotMatch(second.output(), /NOTICE|already exists, skipping/)
  } finally { await second.stop() }
})
