/**
 * G4 : `npm run pipeline` sur un seed fictif retient le prospect (> 0/100) et écrit sa fiche. De bout en bout,
 * hors réseau : vieux site fictif servi en local, SIRENE simulé (homonyme cessé), structuration par le FAUX
 * `claude` (chemin plan), Playwright pour le parsing. DESIGN=0 (s'arrête à la fiche).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import { serveDir, jsonRoutes } from "../helpers/server.ts"
import { makeWorkspace, FIXTURES } from "../helpers/workspace.ts"
import { npmRun } from "../helpers/proc.ts"

test("pipeline (seed fictif, DESIGN=0) : Orvane Piscines RETENU, fiche structurée écrite", { timeout: 180_000 }, async () => {
  const site = await serveDir(join(FIXTURES, "sites", "orvane-piscines"))
  const sirene = await jsonRoutes({ "GET /search": () => ({ json: JSON.parse(readFileSync(join(FIXTURES, "sirene", "homonym-ceased.json"), "utf8")) }) })
  const ws = makeWorkspace()
  try {
    ws.write("data/raw/test.seed.csv", `name,city,website,phone,industry,email\nOrvane Piscines,Valmont-sur-Lys,${site.url}/,03 53 01 24 68,pisciniste,contact@orvane-piscines.example\n`)
    const log = ws.path("claude.log")
    const r = await npmRun(ws.dir, "pipeline", [], {
      env: { SEED: "data/raw/test.seed.csv", DESIGN: "0", VISUAL: "0", LLM_VIA: "plan", LWS_SIRENE: "1", LWS_SIRENE_URL: `${sirene.url}/search`, FAKE_CLAUDE_LOG: log },
      timeoutMs: 170_000,
    })
    assert.equal(r.code, 0, r.out)
    const m = /FICHE \((\d+)\/100\)/.exec(r.stdout)
    assert.ok(m, `pas de FICHE : ${r.out.slice(-1500)}`)
    assert.ok(Number(m![1]) > 0)
    const id = "orvane-piscines-valmont-sur-lys"
    const fiche = ws.json(`data/prospects/${id}.json`)
    assert.equal(fiche.industry, "pisciniste")
    assert.ok(fiche.content.services.length >= 3)
    assert.ok(fiche.assets.photos.length >= 2, "photos SVG fictives récupérées par le parsing")
    assert.ok(ws.exists(`data/assets/${id}/avant.png`))
    assert.ok(sirene.hits.length >= 1, "la qualification a bien interrogé le faux SIRENE")
    assert.match(ws.read("claude.log"), /TEXTE BRUT/, "la structuration est passée par le faux claude (plan)")
  } finally { ws.cleanup(); await site.close(); await sirene.close() }
})
