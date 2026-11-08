/**
 * G4: `npm run pipeline` on a fictional seed keeps the prospect (> 0/100) and writes its sheet. End to end,
 * offline: a fictional old site served locally, simulated SIRENE (a closed namesake), structuring by the FAKE
 * `claude` (plan path), Playwright for parsing. DESIGN=0 (stops at the sheet).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import { serveDir, jsonRoutes } from "../helpers/server.ts"
import { makeWorkspace, FIXTURES } from "../helpers/workspace.ts"
import { npmRun } from "../helpers/proc.ts"

test("pipeline (fictional seed, DESIGN=0): Orvane Piscines KEPT, structured sheet written", { timeout: 180_000 }, async () => {
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
    const m = /RECORD \((\d+)\/100\)/.exec(r.stdout)
    assert.ok(m, `no RECORD line: ${r.out.slice(-1500)}`)
    assert.ok(Number(m![1]) > 0)
    const id = "orvane-piscines-valmont-sur-lys"
    const fiche = ws.json(`data/prospects/${id}.json`)
    assert.equal(fiche.industry, "pisciniste")
    assert.ok(fiche.content.services.length >= 3)
    assert.ok(fiche.assets.photos.length >= 2, "fictional SVG photos collected by parsing")
    assert.ok(ws.exists(`data/assets/${id}/avant.png`))
    assert.ok(sirene.hits.length >= 1, "qualification really queried the fake SIRENE")
    assert.match(ws.read("claude.log"), /TEXTE BRUT/, "structuring went through the fake claude (plan)")
  } finally { ws.cleanup(); await site.close(); await sirene.close() }
})
