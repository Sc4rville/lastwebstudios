/**
 * G5 (with a database): the cockpit on a fresh Postgres set up by db:init. The film's flows, for real:
 * ♥, scoring, Approve ⇒ Hot Lead · Call 0 + `research` job, kanban, start a batch ⇒ `queued` job.
 * All 200s, fictional data, random port, throwaway database.
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
  for (let i = 0; i < 300 && !/Indexed →/.test(cockpit.output()); i++) await sleep(100) // boot reindex
})
after(async () => { await cockpit?.stop(); ws?.cleanup(); await db?.drop() })

const api = async (path: string, body?: unknown) => {
  const r = await fetch(cockpit.url + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  const text = await r.text()
  let json: any = null; try { json = JSON.parse(text) } catch { /* html */ }
  return { status: r.status, json, text }
}

test("boot: reindex from disk into the database (3 prospects, 2 builds), no NOTICE", async () => {
  assert.match(cockpit.output(), /Indexed → 3 prospects · 2 sites/)
  assert.doesNotMatch(cockpit.output(), /NOTICE|already exists, skipping/)
  const sites = (await api("/api/sites")).json
  assert.equal(sites.length, 2)
  assert.equal(sites.find((s: any) => s.id === ID).name, "Orvane Piscines")
})

test("♥: POST /api/love then read back in /api/sites", async () => {
  const r = await api("/api/love", { id: ID, date: DATE, love: 3 })
  assert.equal(r.status, 200); assert.equal(r.json.love, 3)
  assert.equal((await api("/api/sites")).json.find((s: any) => s.id === ID).love, 3)
})

test("scoring: POST /api/score then an identical GET (0-100 bounds applied)", async () => {
  assert.equal((await api("/api/score", { id: ID, date: DATE, dims: { global: 82, typo: 140, "bad key!": 5 }, notes: { global: "le héros respire" } })).status, 200)
  const g = (await api(`/api/score?id=${ID}&date=${DATE}`)).json
  assert.deepEqual(g.dims, { global: 82, typo: 100 })
  assert.equal(g.notes.global, "le héros respire")
})

test("Approve ⇒ status approved, `research` job queued, Hot Lead · Call 0 in the CRM", async () => {
  assert.equal((await api("/api/status", { id: ID, date: DATE, status: "approved" })).status, 200)
  const jobs = await db.sql`SELECT mode, status, params_json FROM batch_requests WHERE mode = 'research'`
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].status, "queued")
  // the research job carries the lead's call opening (D6 words : the call script is written with it, on any machine)
  const rp = JSON.parse(jobs[0].params_json)
  assert.deepEqual(rp.ids, [ID])
  assert.ok(["built-it", "customers", "value"].includes(rp.openings?.[ID]), JSON.stringify(rp))
  const crm = (await api("/api/crm")).json
  assert.ok(crm.hot.call0.some((l: any) => l.id === ID && l.phone === "03 53 01 24 68"), JSON.stringify(crm.hot.call0))
  const sales = (await api("/api/sales")).json
  assert.ok(sales.items.some((i: any) => i.id === ID && i.love === 3))
})

test("kanban: move to closing/demo then a call note", async () => {
  assert.equal((await api("/api/crm/stage", { id: ID, pipeline: "closing", stage: "demo" })).status, 200)
  assert.equal((await api("/api/crm/stage", { id: ID, pipeline: "closing", stage: "nope" })).status, 400)
  assert.equal((await api("/api/crm/outcome", { id: ID, outcome: "reach", note: "rappeler jeudi", slot: "matin" })).status, 200)
  const crm = (await api("/api/crm")).json
  const lead = crm.closing.demo.find((l: any) => l.id === ID)
  assert.ok(lead, JSON.stringify(crm.closing))
  assert.equal(lead.answered, 1)
  assert.equal(lead.lastNote.text, "rappeler jeudi")
})

test("start a batch: POST /api/batch ⇒ `queued` job visible in /api/batches; without ids, the cockpit picks a NEW prospect, never a skipped one", async () => {
  // the only new kitchen designer is Lumeo : skipped, nothing new is left to build ; back, it is the one picked
  const LUMEO = "cuisines-lumeo-vereuil"
  assert.equal((await api("/api/prospects/skip", { id: LUMEO, on: true })).status, 200)
  const none = await api("/api/batch", { mode: "composer", industry: "cuisiniste", limit: 1 })
  assert.equal(none.status, 400, none.text); assert.match(none.json.error, /Nothing new to build/)
  assert.equal((await api("/api/prospects/skip", { id: LUMEO, on: false })).status, 200)
  const r = await api("/api/batch", { mode: "composer", industry: "cuisiniste", limit: 1 })
  assert.equal(r.status, 200, r.text)
  const b = (await api("/api/batches")).json.batches.find((x: any) => x.id === r.json.id)
  assert.equal(b.status, "queued"); assert.equal(b.mode, "composer"); assert.equal(b.industry, "cuisiniste"); assert.equal(b.lim, 1)
  assert.deepEqual(JSON.parse(b.params_json).ids, [LUMEO])
  // a mode the engine does not know, an empty or hostile list, a body that is not an object : refused, nothing queued
  for (const bad of [[], { mode: "rm -rf", ids: [] }, { ids: ["../../etc/passwd"] }, { mode: "composer", ids: [] }, { mode: "composer", ids: ["../../etc/passwd"] }]) assert.equal((await api("/api/batch", bad)).status, 400, JSON.stringify(bad))
})

test("/api/leads from the database: the 3 sheets, Orvane's site detected", async () => {
  const j = (await api("/api/leads")).json
  assert.equal(j.total, 3)
  assert.equal(j.prospects.find((p: any) => p.id === ID).hasSite, true)
})

test("GET sweep with a database: no 5xx answer", async () => {
  const bad: string[] = []
  for (const p of cockpitGetRoutes()) { const r = await fetch(cockpit.url + p, { redirect: "manual" }); await r.arrayBuffer(); if (r.status >= 500) bad.push(`${r.status} ${p}`) }
  assert.deepEqual(bad, [])
})

test("restart on a database already set up: silent boot migrations (NOTICEs filtered)", async () => {
  const second = await startCockpit(ws.dir, { DATABASE_URL: db.url, DB_SSL: "disable" })
  try {
    for (let i = 0; i < 200 && !/Indexed →/.test(second.output()); i++) await sleep(100)
    assert.doesNotMatch(second.output(), /NOTICE|already exists, skipping/)
  } finally { await second.stop() }
})

test("Find, Hands-off and Stop with a database: no model while typing, the same search twice is one job, Stop refuses every build, Hands-off off cancels what waits", async () => {
  // a fresh « external worker » heartbeat keeps the built-in engine away : the jobs stay queued (no real scraping here)
  const beat = () => db.sql`INSERT INTO meta(key, value, updated_at) VALUES ('worker.heartbeat', ${JSON.stringify({ id: "box#test", at: Date.now() })}, ${Date.now()}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`
  await beat()
  try {
    // the live preview is the parser, never the skill (no token spent while the owner types)
    const pv = await api("/api/brief", { text: "roofers in Lyon" })
    assert.equal(pv.status, 200); assert.equal(pv.json.via, "parser"); assert.deepEqual(pv.json.trades, ["couvreur-zingueur"])
    const gib = await api("/api/brief", { text: "asdkjh qwe" })
    assert.equal(gib.status, 200); assert.match(gib.json.error, /didn't catch a trade/)
    // the same search twice → one job, the second answer names it
    const brief = { trades: ["couvreur-zingueur"], place: "Lyon", country: "FR", count: 5, mix: false }
    const f1 = await api("/api/prospects/find", brief), f2 = await api("/api/prospects/find", brief)
    assert.equal(f1.status, 200, f1.text); assert.equal(f2.status, 200, f2.text)
    assert.equal(f2.json.duplicate, true); assert.equal(f2.json.id, f1.json.id)
    assert.equal((await api("/api/prospects/find", { trades: ["Banana"], place: "Lyon" })).status, 400)
    await db.sql`UPDATE batch_requests SET status = 'canceled' WHERE id = ${f1.json.id}`
    // Stop : find, build, hands-off and feedback are refused with the reason
    assert.equal((await api("/api/cage/stop", { on: true, reason: "test" })).status, 200)
    for (const [p, b] of [["/api/prospects/find", brief], ["/api/batch", { mode: "composer", ids: [ID], limit: 1 }], ["/api/handsoff/run", { ids: [ID] }], ["/api/refill", { id: ID, date: DATE }]] as const) {
      const r = await api(p, b)
      assert.equal(r.status, 409, `${p} ${r.text}`); assert.equal(r.json.error, "Paused — resume to run")
    }
    assert.equal((await api("/api/cage/stop", { on: false })).status, 200)
    // Hands-off : « Build N now » queues the good NEW prospects someone can contact (never one already built or in
    // outreach) ; off cancels what still waits
    await beat()
    assert.equal((await api("/api/handsoff/run", { ids: [ID] })).json.built, 0, "a prospect already in outreach is never built again by Hands-off")
    const run = await api("/api/handsoff/run", { ids: ["cuisines-lumeo-vereuil"] })
    assert.equal(run.status, 200, run.text); assert.equal(run.json.built, 1)
    assert.equal((await db.sql`SELECT status FROM batch_requests WHERE requested_by = 'hands-off'`)[0].status, "queued")
    const off = await api("/api/automatic", { on: false })
    assert.equal(off.json.automatic, false); assert.ok(off.json.canceled >= 1, off.text)
    assert.deepEqual((await db.sql`SELECT DISTINCT status FROM batch_requests WHERE requested_by = 'hands-off'`).map((r: any) => r.status), ["canceled"])
    // the same place in every view : /api/leads and /api/crm carry region + ZIP ; /api/prospects the Outreach badge
    const leads = (await api("/api/leads")).json.prospects
    assert.ok(leads.every((l: any) => typeof l.region === "string" && typeof l.zip === "string"))
    assert.equal(typeof (await api("/api/prospects")).json.toCall, "number")
  } finally { await db.sql`DELETE FROM meta WHERE key = 'worker.heartbeat'`; await api("/api/cage/stop", { on: false }) }
})
