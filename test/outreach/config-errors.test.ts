/**
 * Test blitz (24/10) · une config du séquenceur ABÎMÉE (faute de frappe sur la box) : JSON cassé, `steps` absent ou
 * vide, pool de boîtes inconnu, délai négatif. Attendu : message clair qui nomme le fichier et la faute, code ≠ 0,
 * RIEN n'est lu, envoyé ni avancé, et jamais une pile d'exception brute.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { tsx } from "../helpers/proc.ts"
import { makeWorkspace } from "../helpers/workspace.ts"

const ORVANE = "orvane-piscines-valmont-sur-lys"
const CASES: [string, (cfg: any) => string][] = [
  ["JSON cassé", (cfg) => JSON.stringify(cfg).slice(0, -3)],
  ["steps absent", (cfg) => { delete cfg.steps; return JSON.stringify(cfg) }],
  ["steps vide", (cfg) => JSON.stringify({ ...cfg, steps: [] })],
  ["pool inconnu", (cfg) => JSON.stringify({ ...cfg, steps: [{ ...cfg.steps[0], pool: "C" }, ...cfg.steps.slice(1)] })],
  ["inboxes absent", (cfg) => { delete cfg.inboxes; return JSON.stringify(cfg) }],
  ["délai négatif", (cfg) => JSON.stringify({ ...cfg, steps: [cfg.steps[0], { ...cfg.steps[1], delayDays: -3 }] })],
]

for (const [label, mutate] of CASES) {
  test(`config du séquenceur : ${label} → message clair, rien ne part`, { timeout: 60_000 }, async () => {
    const ws = makeWorkspace({ seed: ["agency"] })
    try {
      const cfg = JSON.parse(ws.read("outreach/sequencer/config.json"))
      cfg.inboxes = { A: [], B: [{ email: "b1@agence.example", throttlePerDay: 8 }] }
      ws.write("outreach/sequencer/config.json", JSON.stringify(cfg))
      ws.write(`data/savior/${ORVANE}.json`, JSON.stringify({ senderName: "Camille (fictive)", subject: "Une idée", body: "Bonjour, l'aperçu : https://demo.agence.example/" }))
      assert.equal((await tsx(ws.dir, "outreach/scripts/sequencer.ts", ["enroll", ORVANE, "--now", "2026-10-24T08:00:00.000Z"])).code, 0)
      ws.write("outreach/sequencer/config.json", mutate(JSON.parse(ws.read("outreach/sequencer/config.json"))))
      const r = await tsx(ws.dir, "outreach/scripts/sequencer.ts", ["tick", "--now", "2026-10-24T09:00:00.000Z"], { env: { LWS_MAIL_TRANSPORT: "simulated" } })
      assert.equal(r.code, 78, r.out) // EX_CONFIG
      assert.match(r.out, /outreach\/sequencer\/config\.json/, "le fichier fautif est nommé")
      assert.doesNotMatch(r.out, /\n\s+at .*\.ts:\d+:\d+/, `pas de pile brute :\n${r.out.slice(-600)}`)
      assert.equal(ws.exists("data/sequencer/sends.jsonl"), false, "rien n'est parti (même en simulé)")
      assert.equal(ws.json<any[]>("data/sequencer/state.json")[0].step, 0, "rien n'a avancé")
    } finally { ws.cleanup() }
  })
}

test("la config livrée passe la validation (et chaque faute est nommée une par une)", async () => {
  const { configProblems } = await import("../../outreach/scripts/sequencer.ts")
  const { readFileSync } = await import("node:fs")
  assert.deepEqual(configProblems(JSON.parse(readFileSync("outreach/sequencer/config.json", "utf8"))), [])
  const p = configProblems({ inboxes: { B: [{ email: "pas-un-mail", throttlePerDay: 0 }] }, steps: [{ id: "a", pool: "B", delayDays: 0, source: "savior" }, { id: "a", pool: "Z", delayDays: "3", source: "fax", gate: "ouvert" }] })
  assert.deepEqual(p, [
    "inboxes.B[0].email invalide", "inboxes.B[0].throttlePerDay doit être un nombre > 0",
    "steps[1] (a).id en double", "steps[1] (a).pool « Z » inconnu (pools : B)", "steps[1] (a).delayDays doit être un nombre ≥ 0",
    "steps[1] (a).source « fax » inconnue (savior, demo, seo, contenu, persona:<slot>)", "steps[1] (a).gate « ouvert » inconnu (seul « clicked » existe)",
  ])
})
