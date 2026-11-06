/**
 * G11 (boucle learning, sans base) : une issue enregistrée AUTOMATIQUEMENT (recordOutcome, appelé par le CRM et le
 * séquenceur) n'est comptée qu'une fois par prospect, porte les features du scoring, et `npm run learn` en tire
 * une règle qui CHANGE le poids du métier (bornée et atténuée par la confiance).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { makeWorkspace } from "../helpers/workspace.ts"
import { tsx, npmRun } from "../helpers/proc.ts"

const ORVANE = "orvane-piscines-valmont-sur-lys"

test("recordOutcome : dédoublonné par prospect et par issue, features du scoring jointes (fiche + score brut)", async () => {
  const ws = makeWorkspace({ seed: ["agency", "machine"] })
  try {
    ws.write("probe.ts", `import { recordOutcome } from "./learning/scripts/record.ts"
const a = await recordOutcome("${ORVANE}", "won", { source: "test" })
const b = await recordOutcome("${ORVANE}", "won", { source: "test" })
const c = await recordOutcome("${ORVANE}", "meeting", { source: "test" })
console.log(JSON.stringify([a.recorded, b.recorded, b.reason, c.recorded]))`)
    const r = await tsx(ws.dir, "probe.ts")
    assert.equal(r.code, 0, r.out)
    assert.deepEqual(JSON.parse(r.stdout.trim().split("\n").pop()!), [true, false, "déjà enregistré", true])
    const lines = ws.read("data/outcomes.jsonl").trim().split("\n").map((l) => JSON.parse(l))
    assert.deepEqual(lines.map((o) => o.outcome), ["won", "meeting"])
    assert.equal(lines[0].industry, "pisciniste")
    assert.equal(lines[0].value, 83, "valeur de la fiche")
    assert.equal(lines[0].axes.besoin, 98, "axes complétés par data/raw/<id>.score.json")
  } finally { ws.cleanup() }
})

test("Signature ⇒ « won » ⇒ npm run learn : le poids du métier bouge (borné, atténué), le rapport le dit", async () => {
  const ws = makeWorkspace({ seed: ["agency", "machine"] })
  try {
    // l'historique : 4 essais ratés (aucun métier ne se distingue → aucune règle)
    const prior = [["fictif-c1", "cuisiniste"], ["fictif-c2", "cuisiniste"], ["fictif-c3", "cuisiniste"], ["fictif-p1", "pisciniste"]]
      .map(([id, industry]) => JSON.stringify({ id, industry, outcome: "lost", ts: "2026-10-01T10:00:00.000Z", signals: {} }))
    ws.write("data/outcomes.jsonl", prior.join("\n") + "\n")
    assert.equal((await npmRun(ws.dir, "learn")).code, 0)
    const before = ws.json("learning/rules/rules.json")
    assert.equal(before.industries.pisciniste, undefined)
    // la carte d'Orvane posée en Signature (ce que fait le CRM, cf. test/pg/funnel.test.ts) → une issue « won »
    ws.write("probe.ts", `import { recordOutcome } from "./learning/scripts/record.ts"\nawait recordOutcome("${ORVANE}", "won", { source: "crm" })`)
    assert.equal((await tsx(ws.dir, "probe.ts")).code, 0)
    const r = await npmRun(ws.dir, "learn")
    assert.equal(r.code, 0, r.out)
    assert.match(r.stdout, /règles recalculées depuis 5 retour\(s\)/)
    const after = ws.json("learning/rules/rules.json")
    assert.deepEqual(after.industries.pisciniste, { value: 2 }, "+2 : 1 vente sur 2 essais, confiance 2/10")
    assert.deepEqual(after.industries.cuisiniste, { value: -2 })
    assert.match(ws.read("learning/analysis/report.md"), /\| pisciniste \| 2 \| 0\.5 \| 0\.2 \| \+2 \|/)
  } finally { ws.cleanup() }
})

test("npm run learn:record (CLI) garde son contrat : une ligne par appel, usage clair sinon", async () => {
  const ws = makeWorkspace({ seed: ["agency"] })
  try {
    assert.equal((await npmRun(ws.dir, "learn:record", [ORVANE, "reply"])).code, 0)
    assert.equal((await npmRun(ws.dir, "learn:record", [ORVANE, "reply"])).code, 0)
    assert.equal(ws.read("data/outcomes.jsonl").trim().split("\n").length, 2)
    const bad = await npmRun(ws.dir, "learn:record", [ORVANE, "gagné"])
    assert.equal(bad.code, 1)
    assert.match(bad.stderr, /usage: npm run learn:record/)
  } finally { ws.cleanup() }
})

test("buildRules : UN essai par prospect, son état final (un RDV perdu n'est pas un demi-succès, une vente ne compte pas 3 fois)", async () => {
  // test blitz du 24/10 : chaque ligne comptait comme un essai ; reply (0,3) + meeting (0,6) + lost (0) d'un même
  // prospect faisaient 0,3 de « succès » moyen pour une affaire PERDUE
  const { buildRules, finalOutcomes } = await import("../../learning/scripts/learn.ts")
  const row = (id: string, industry: string, outcome: string, ts: string) => ({ id, industry, outcome, ts, signals: {} }) as any
  const rows = [
    row("p-perdu", "pisciniste", "sent", "2026-10-01T09:00:00Z"), row("p-perdu", "pisciniste", "reply", "2026-10-02T09:00:00Z"),
    row("p-perdu", "pisciniste", "meeting", "2026-10-05T09:00:00Z"), row("p-perdu", "pisciniste", "lost", "2026-10-09T09:00:00Z"),
    row("c-1", "cuisiniste", "sent", "2026-10-01T09:00:00Z"), row("c-1", "cuisiniste", "reply", "2026-10-03T09:00:00Z"),
    row("c-2", "cuisiniste", "reply", "2026-10-03T09:00:00Z"), row("c-2", "cuisiniste", "sent", "2026-10-04T09:00:00Z"), // « sent » après coup ne remplace pas la réponse
    row("m-1", "menuisier", "sent", "2026-10-01T09:00:00Z"), row("m-1", "menuisier", "reply", "2026-10-02T09:00:00Z"),
    row("m-1", "menuisier", "meeting", "2026-10-04T09:00:00Z"), row("m-1", "menuisier", "won", "2026-10-08T09:00:00Z"),
    // horloges différentes (séquenceur sur la box en avance, CRM sur le cockpit) : le « reply » daté APRÈS le « won »
    row("m-1", "menuisier", "reply", "2026-10-30T09:00:00Z"),
  ]
  const fin = finalOutcomes(rows)
  assert.deepEqual(fin.map((o) => [o.id, o.outcome]).sort(), [["c-1", "reply"], ["c-2", "reply"], ["m-1", "won"], ["p-perdu", "lost"]])
  const r = buildRules(rows, "2026-10-24T00:00:00Z") as any
  assert.equal(r.totalOutcomes, 13)
  assert.equal(r.prospects, 4)
  const ev = Object.fromEntries(r.evidence.industries.map((x: any) => [x.industry, x]))
  assert.deepEqual([ev.pisciniste.n, ev.pisciniste.rate], [1, 0], "l'affaire perdue vaut 0, sur UN essai")
  assert.deepEqual([ev.cuisiniste.n, ev.cuisiniste.rate], [2, 0.3])
  assert.deepEqual([ev.menuisier.n, ev.menuisier.rate], [1, 1], "la vente compte une fois")
  assert.ok(ev.pisciniste.valueDelta <= ev.cuisiniste.valueDelta, "le métier qui perd ses RDV ne passe jamais devant celui qui répond (shrinkage : -1 et -1 ici)")
})

test("séquenceur : le 1er VRAI mail fait du prospect un essai « sent » (une fois) ; jamais en dry-run", { timeout: 120_000 }, async () => {
  const mk = (live: boolean) => {
    const ws = makeWorkspace({ seed: ["agency"] })
    const cfg = JSON.parse(ws.read("outreach/sequencer/config.json"))
    cfg.dryRun = !live
    cfg.inboxes = { A: [], B: [{ email: "b1@agence.example", throttlePerDay: 8 }] }
    ws.write("outreach/sequencer/config.json", JSON.stringify(cfg))
    for (const [src, subject] of [["savior", "Une idée pour votre site"], ["demo", "La démo de votre site"]]) ws.write(`data/${src}/${ORVANE}.json`, JSON.stringify({ senderName: "Camille (fictive)", subject, body: "Bonjour, l'aperçu : https://demo.agence.example/" }))
    return ws
  }
  const env = { LWS_MAIL_TRANSPORT: "simulated", LWS_LIVE_SEND: "1" }
  const live = mk(true), dry = mk(false)
  try {
    for (const ws of [live, dry]) {
      const seq = (args: string[]) => tsx(ws.dir, "outreach/scripts/sequencer.ts", args, { env })
      assert.equal((await seq(["enroll", ORVANE, "--now", "2026-10-24T08:00:00.000Z"])).code, 0)
      assert.equal((await seq(["tick", "--now", "2026-10-24T09:00:00.000Z"])).code, 0)
      assert.equal((await seq(["click", ORVANE, "--now", "2026-10-25T09:00:00.000Z"])).code, 0)
      const t2 = await seq(["tick", "--now", "2026-10-28T09:00:00.000Z"])
      assert.equal(t2.code, 0, t2.out)
    }
    const rows = live.read("data/outcomes.jsonl").trim().split("\n").map((l) => JSON.parse(l))
    assert.deepEqual(rows.map((o) => [o.id, o.outcome, o.industry]), [[ORVANE, "sent", "pisciniste"]], "un seul « sent », au 1er mail")
    assert.equal(rows[0].ts, "2026-10-24T09:00:00.000Z")
    assert.equal(live.read("data/sequencer/transport.jsonl").trim().split("\n").length, 2, "deux mails partis (J0 + démo)")
    assert.equal(dry.exists("data/outcomes.jsonl"), false, "dry-run : aucune issue inventée")
  } finally { live.cleanup(); dry.cleanup() }
})
