/**
 * G5 (sans base) : ce que voit un inconnu qui clone et lance le cockpit SANS DATABASE_URL. Le balayage de
 * TOUTES les routes GET ne renvoie aucun 5xx ; /api/leads liste les fiches du disque ; /api/score répond « non
 * noté » au lieu d'un 500. Workspace jetable semé de 3 prospects fictifs.
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

test("balayage : toutes les routes GET du cockpit, aucune réponse 5xx sans base", async () => {
  const routes = cockpitGetRoutes()
  assert.ok(routes.length >= 30, `seulement ${routes.length} routes trouvées`)
  const bad: string[] = []
  for (const p of routes) { const r = await get(p); if (r.status >= 500) bad.push(`${r.status} ${p} ${r.body.slice(0, 120)}`) }
  assert.deepEqual(bad, [])
})

test("/api/leads sans base : les 3 fiches du disque, triées par score, hasSite exact", async () => {
  const j = JSON.parse((await get("/api/leads")).body)
  assert.equal(j.total, 3)
  assert.deepEqual(j.prospects.map((p: any) => p.id), ["orvane-piscines-valmont-sur-lys", "atelier-brisane-menuiserie-sornac-le-haut", "cuisines-lumeo-vereuil"])
  const by = Object.fromEntries(j.prospects.map((p: any) => [p.id, p]))
  assert.equal(by["orvane-piscines-valmont-sur-lys"].hasSite, true)
  assert.equal(by["cuisines-lumeo-vereuil"].hasSite, false)
  assert.equal(by["orvane-piscines-valmont-sur-lys"].oppScore, 83)
  assert.deepEqual(j.industries.map((i: any) => i.industry).sort(), ["cuisiniste", "menuisier", "pisciniste"])
})

test("/api/score sans base : 200 « non noté » ({}), plus de 500 à l'ouverture d'un site", async () => {
  const r = await get("/api/score?id=orvane-piscines-valmont-sur-lys&date=2026-10-20-composer")
  assert.equal(r.status, 200)
  assert.deepEqual(JSON.parse(r.body), {})
  assert.equal((await get("/api/score?id=inconnu&date=2026-01-01")).status, 404)
})

test("/api/sites sans base : les 2 générations fictives, lues sur le disque", async () => {
  const sites = JSON.parse((await get("/api/sites")).body)
  assert.deepEqual(sites.map((s: any) => `${s.id}/${s.date}`).sort(), ["atelier-brisane-menuiserie-sornac-le-haut/2026-10-18", "orvane-piscines-valmont-sur-lys/2026-10-20-composer"])
})

test("le flux live (/events) s'ouvre en text/event-stream", async () => {
  const ac = new AbortController()
  const r = await fetch(cockpit.url + "/events", { signal: ac.signal })
  assert.equal(r.status, 200)
  assert.match(r.headers.get("content-type") || "", /text\/event-stream/)
  ac.abort()
})

test("le cockpit annonce le mode disque, sans pile d'exception", () => {
  const out = cockpit.output()
  assert.match(out, /station de contrôle/)
  assert.doesNotMatch(out, /^\s+at .+:\d+:\d+\)?$/m)
})
