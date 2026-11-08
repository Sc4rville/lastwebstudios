/**
 * G5 (no database): what a stranger sees who clones and starts the cockpit WITHOUT DATABASE_URL. The sweep of
 * ALL the GET routes returns no 5xx; /api/leads lists the sheets on disk; /api/score answers "not
 * scored" instead of a 500. A throwaway workspace seeded with 3 fictional prospects.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { makeWorkspace, type Workspace } from "../helpers/workspace.ts"
import { startCockpit, cockpitGetRoutes } from "../helpers/cockpit.ts"
import type { Proc } from "../helpers/server.ts"

let ws: Workspace, cockpit: Proc
before(async () => { ws = makeWorkspace({ seed: ["agency"] }); cockpit = await startCockpit(ws.dir) })
after(async () => { await cockpit?.stop(); ws?.cleanup() })

const get = async (p: string) => { const r = await fetch(cockpit.url + p, { redirect: "manual", signal: AbortSignal.timeout(20_000) }); const body = await r.text(); return { status: r.status, body } }

test("sweep: every cockpit GET route, no 5xx answer without a database", async () => {
  const routes = cockpitGetRoutes()
  assert.ok(routes.length >= 30, `only ${routes.length} routes found`)
  const bad: string[] = []
  for (const p of routes) { const r = await get(p); if (r.status >= 500) bad.push(`${r.status} ${p} ${r.body.slice(0, 120)}`) }
  assert.deepEqual(bad, [])
})

test("/api/leads without a database: the 3 sheets on disk, sorted by score, exact hasSite", async () => {
  const j = JSON.parse((await get("/api/leads")).body)
  assert.equal(j.total, 3)
  assert.deepEqual(j.prospects.map((p: any) => p.id), ["orvane-piscines-valmont-sur-lys", "atelier-brisane-menuiserie-sornac-le-haut", "cuisines-lumeo-vereuil"])
  const by = Object.fromEntries(j.prospects.map((p: any) => [p.id, p]))
  assert.equal(by["orvane-piscines-valmont-sur-lys"].hasSite, true)
  assert.equal(by["cuisines-lumeo-vereuil"].hasSite, false)
  assert.equal(by["orvane-piscines-valmont-sur-lys"].oppScore, 83)
  assert.deepEqual(j.industries.map((i: any) => i.industry).sort(), ["cuisiniste", "menuisier", "pisciniste"])
})

test("/api/score without a database: 200 \"not scored\" ({}), no more 500 when a site opens", async () => {
  const r = await get("/api/score?id=orvane-piscines-valmont-sur-lys&date=2026-10-20-composer")
  assert.equal(r.status, 200)
  assert.deepEqual(JSON.parse(r.body), {})
  assert.equal((await get("/api/score?id=inconnu&date=2026-01-01")).status, 404)
})

test("/api/sites without a database: the 2 fictional builds, read from disk", async () => {
  const sites = JSON.parse((await get("/api/sites")).body)
  assert.deepEqual(sites.map((s: any) => `${s.id}/${s.date}`).sort(), ["atelier-brisane-menuiserie-sornac-le-haut/2026-10-18", "orvane-piscines-valmont-sur-lys/2026-10-20-composer"])
})

test("the live feed (/events) opens as text/event-stream", async () => {
  const ac = new AbortController()
  const r = await fetch(cockpit.url + "/events", { signal: ac.signal })
  assert.equal(r.status, 200)
  assert.match(r.headers.get("content-type") || "", /text\/event-stream/)
  ac.abort()
})

test("the cockpit announces disk mode, without a stack trace", () => {
  const out = cockpit.output()
  assert.match(out, /Cockpit →/)
  assert.doesNotMatch(out, /^\s+at .+:\d+:\d+\)?$/m)
})

test("no database: Find fails fast in English before any model call ; the live preview is the free parser", async () => {
  const post = (p: string, b: unknown) => fetch(cockpit.url + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b), signal: AbortSignal.timeout(20_000) })
  await post("/api/brief", { text: "warm-up" }) // first request of the process (module loading) is not the measure
  const t0 = performance.now()
  const r = await post("/api/prospects/find", { text: "roofers in Lyon" })
  const ms = performance.now() - t0
  const j = await r.json()
  assert.equal(r.status, 503); assert.equal(j.noDb, true)
  // the reason this cockpit has none, and the one fix that matches it (never « run npm run backoffice » to someone running it)
  assert.equal(j.error, "No database: start the cockpit with `npm run backoffice` (it keeps a local one), or set DATABASE_URL.")
  assert.ok(ms < 500, `answered in ${ms.toFixed(0)} ms`) // ~a few ms : the database is checked before anything else
  console.log(`# Find without a database answered in ${ms.toFixed(1)} ms`)
  const b = await post("/api/brief", { text: "roofers in Lyon" })
  const bj = await b.json()
  assert.equal(b.status, 200); assert.equal(bj.via, "parser"); assert.deepEqual(bj.trades, ["couvreur-zingueur"])
  for (const [p, body] of [["/api/batch", { mode: "composer", ids: ["orvane-piscines-valmont-sur-lys"] }], ["/api/handsoff/run", { ids: ["orvane-piscines-valmont-sur-lys"] }]] as const) {
    const x = await post(p, body); const xj = await x.json()
    assert.equal(x.status, 503, p); assert.match(xj.error, /^No database: /, p)
  }
  const nf = await fetch(cockpit.url + "/api/nope"); assert.equal(nf.status, 404); assert.match(nf.headers.get("content-type") || "", /json/)
  // the Prospects list carries the same reason (the banner and an Enter on Find say it, not something else)
  const pl = await (await fetch(cockpit.url + "/api/prospects")).json()
  assert.equal(pl.noDb, true); assert.equal(pl.noDbWhy, j.error)
})

test("no database because the local one is turned off (LWS_LOCAL_DB=0): the reason says so, not « run npm run backoffice »", async () => {
  const c2 = await startCockpit(ws.dir, { LWS_LOCAL_DB: "0" })
  try {
    const r = await fetch(c2.url + "/api/prospects/find", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "roofers in Lyon" }) })
    const j = await r.json()
    assert.equal(r.status, 503)
    assert.match(j.error, /turned off \(LWS_LOCAL_DB=0\)/)
    assert.doesNotMatch(j.error, /npm run backoffice/)
  } finally { await c2.stop() }
})
