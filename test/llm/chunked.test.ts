/**
 * Test blitz (24/10) · la sortie de `claude -p` coupée en petits morceaux (FAKE_CLAUDE_CHUNKED), comme sur un vrai tube
 * quand elle dépasse 64 Ko : chaque lecteur du produit doit rendre EXACTEMENT ce qu'il rend d'un bloc.
 *
 * Avant : la fiche gardait des « �� » à la place des accents (chemin plan de `npm run structure`), le moteur local du
 * composer et first-site pouvaient perdre le `result` final, la sonde d'init du doctor pouvait rater l'évènement init.
 * La dépense du worker (registre de la cage) est testée avec la vraie file : test/pg/worker-cage.test.ts.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { makeWorkspace, FIXTURES, type Workspace } from "../helpers/workspace.ts"
import { npmRun } from "../helpers/proc.ts"
import { serveDir, type Http } from "../helpers/server.ts"
import { claudeAgentRunner } from "../../architecture/orchestration/workflow-local.ts"
import { initProbe } from "../../packages/llm/claude-code-status.ts"
import { claudeCodeAdapter } from "../../packages/llm/adapters/claude-code.ts"

const ID = "orvane-piscines-valmont-sur-lys"
const RAW = {
  id: ID, url: "http://127.0.0.1:1/", title: "Orvane Piscines - Accueil", screenshot: `data/assets/${ID}/avant.png`, photos: [],
  text: "ORVANE PISCINES\nVotre piscine, notre savoir-faire depuis 1998\nConstruction de piscines - Rénovation de bassins\nTél : 03 53 01 24 68\nVallée de la Lys",
}

let ws: Workspace
before(() => { ws = makeWorkspace(); ws.write(`data/raw/${ID}.json`, JSON.stringify(RAW)) })
after(() => ws?.cleanup())

test("npm run structure (voie plan) avec une sortie coupée octet par octet : fiche identique, accents intacts, aucun « � »", { timeout: 90_000 }, async () => {
  const run = async (env: NodeJS.ProcessEnv) => {
    ws.write(`data/prospects/${ID}.json`, "{}")
    const r = await npmRun(ws.dir, "structure", [ID, "pisciniste", "Valmont-sur-Lys"], { env, timeoutMs: 80_000 })
    assert.equal(r.code, 0, r.out)
    return ws.read(`data/prospects/${ID}.json`)
  }
  const whole = JSON.parse(await run({}))
  const raw = await run({ FAKE_CLAUDE_CHUNKED: "1" })
  assert.ok(!raw.includes("�"), "aucun caractère de remplacement dans la fiche")
  const cut = JSON.parse(raw)
  assert.match(cut.content.about, /construit et rénove des piscines familiales dans la vallée de la Lys/)
  assert.deepEqual(cut.content, whole.content)
  assert.deepEqual(cut.identity, whole.identity)
})

test("adaptateur claude-code, sans schéma (repli regex) et sortie coupée en morceaux de 3 octets : même JSON qu'en un bloc", async () => {
  const env = { ...process.env, FAKE_CLAUDE_NO_STRUCTURED: "1" }
  const req = { model: "haiku", system: "## TEXTE BRUT", user: "Orvane", maxTokens: 1000 } as any
  const a = await claudeCodeAdapter(env).complete(req)
  const b = await claudeCodeAdapter({ ...env, FAKE_CLAUDE_CHUNKED: "3" }).complete(req)
  assert.equal(b.text, a.text)
  assert.ok(!b.text.includes("�"))
})

test("moteur local du composer (claudeAgentRunner) : valeur structurée et coût lus malgré une sortie stream-json coupée", async () => {
  const logs: string[] = []
  const runner = claudeAgentRunner({ env: { ...process.env, FAKE_CLAUDE_CHUNKED: "1", FAKE_CLAUDE_COST: "0.75" }, log: (s) => logs.push(s) })
  const r = await runner({ prompt: "DÉMARRE LE CHRONO DE GEN (faux diagnostic)", opts: { label: "diagnose", model: "sonnet", schema: { type: "object" } } } as any)
  assert.deepEqual((r.value as any).problems, ["tableaux de mise en page", "pas de viewport"])
  assert.equal((r.value as any).beauty_before.why, "site daté (faux)")
  assert.equal(r.costUsd, 0.75)
  assert.ok(!logs.join("\n").includes("�"))
})

test("sonde d'init du doctor : la liste d'outils (dont Workflow) est lue même quand l'évènement init arrive en morceaux de 2 octets", async () => {
  const bin = process.env.CLAUDE_BIN!
  const info = await initProbe(bin, { ...process.env, FAKE_CLAUDE_CHUNKED: "2" }, 30_000)
  assert.equal(info.ok, true, info.error)
  assert.ok(info.tools.includes("Workflow") && info.tools.includes("Agent"))
})

let site: Http
test("first-site, moteur workflow, sortie du lanceur coupée en morceaux de 4 octets : résultat du Workflow lu, gate PASS", { timeout: 240_000 }, async () => {
  site = await serveDir(join(FIXTURES, "sites", "orvane-piscines"))
  try {
    const r = await npmRun(ws.dir, "first-site", [`${site.url}/`, "--name", "Orvane Piscines", "--city", "Valmont-sur-Lys", "--industry", "pisciniste", "--phone", "03 53 01 24 68", "--date", "2026-10-28", "--engine", "workflow"],
      { env: { FAKE_CLAUDE_CHUNKED: "4" }, timeoutMs: 230_000 })
    assert.equal(r.code, 0, r.out.slice(-3000))
    const rep = JSON.parse(readFileSync(ws.path(`output/sites/${ID}/2026-10-28-composer/first-site.json`), "utf8"))
    assert.equal(rep.engine, "workflow")
    assert.equal(rep.gate.pass, true)
    assert.ok(!r.out.includes("�"))
  } finally { await site.close() }
})
