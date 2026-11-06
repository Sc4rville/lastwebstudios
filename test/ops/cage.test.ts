/**
 * G12 (sans base) : LA CAGE 24/7. Le fichier STOP arrête le séquenceur, le warmup et le boost média ; le budget
 * du jour se lit dans le registre de dépense ; le disjoncteur s'ouvre aux seuils de funnel-strategy §6, reste
 * verrouillé, et se voit dans /api/sequences et /api/cage.
 */
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, rmSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { makeWorkspace, type Workspace } from "../helpers/workspace.ts"
import { tsx, run } from "../helpers/proc.ts"
import { startCockpit } from "../helpers/cockpit.ts"
import { stopFileState, recordSpend, budgetStatus, jobBudgetUsd, mediaGate, readSpend } from "../../packages/shared/cage.mjs"
import { evaluateBreaker, resetBreaker, BREAKER_DEFAULTS } from "../../packages/shared/breaker.ts"

const ORVANE = "orvane-piscines-valmont-sur-lys"
const NOW = "2026-10-24T12:00:00.000Z"

describe("registre de dépense + budget du jour", () => {
  test("le budget additionne les dépenses du jour UTC, par type ; sans plafond : jamais atteint", () => {
    const ws = makeWorkspace()
    try {
      const file = ws.path("data/logs/spend.jsonl")
      recordSpend({ kind: "agent", source: "worker:composer", usd: 2.5, at: "2026-10-24T01:00:00.000Z" }, { file })
      recordSpend({ kind: "image", source: "openai-image", usd: 0.25, at: "2026-10-24T02:00:00.000Z" }, { file })
      recordSpend({ kind: "video", source: "higgsfield", usd: 1.5, at: "2026-10-23T23:59:00.000Z" }, { file }) // la veille
      assert.equal(recordSpend({ kind: "agent", source: "x", usd: -1 }, { file }), null, "montant négatif refusé")
      const b = budgetStatus(NOW, { LWS_BUDGET_USD_DAY: "3" }, { file })
      assert.equal(b.spentUsd, 2.75)
      assert.deepEqual(b.byKind, { agent: 2.5, llm: 0, image: 0.25, video: 0 })
      assert.equal(b.reached, false)
      assert.equal(b.remainingUsd, 0.25)
      assert.equal(b.resetsAt, "2026-10-25T00:00:00.000Z")
      assert.equal(budgetStatus(NOW, { LWS_BUDGET_USD_DAY: "2.75" }, { file }).reached, true)
      assert.equal(budgetStatus(NOW, {}, { file }).reached, false)
      assert.equal(readSpend("2026-10-23", { file }).length, 1)
    } finally { ws.cleanup() }
  })
  test("plafond d'un job = min(LWS_JOB_MAX_USD, reste du jour) ; null sans aucun plafond", () => {
    const ws = makeWorkspace()
    try {
      const file = ws.path("spend.jsonl")
      recordSpend({ kind: "agent", source: "x", usd: 18, at: NOW }, { file })
      assert.equal(jobBudgetUsd(NOW, { LWS_BUDGET_USD_DAY: "20", LWS_JOB_MAX_USD: "5" }, { file }), 2)
      assert.equal(jobBudgetUsd(NOW, { LWS_JOB_MAX_USD: "5" }, { file }), 5)
      assert.equal(jobBudgetUsd(NOW, {}, { file }), null)
      assert.equal(jobBudgetUsd(NOW, { LWS_BUDGET_USD_DAY: "10" }, { file }), 0, "épuisé")
    } finally { ws.cleanup() }
  })
  test("boost média : refusé si STOP, ou si le reste ne couvre pas le coût estimé", () => {
    const ws = makeWorkspace()
    try {
      const file = ws.path("spend.jsonl")
      recordSpend({ kind: "agent", source: "x", usd: 19.9, at: NOW }, { file })
      assert.equal(mediaGate("image", { LWS_BUDGET_USD_DAY: "20", LWS_STOP_FILE: ws.path("STOP") }, NOW, { file }).ok, false, "0,10 $ restant < 0,25 $")
      assert.equal(mediaGate("image", { LWS_BUDGET_USD_DAY: "20", LWS_IMAGE_USD: "0.05", LWS_STOP_FILE: ws.path("STOP") }, NOW, { file }).ok, true)
      ws.write("STOP", "incident délivrabilité\n")
      const g = mediaGate("video", { LWS_STOP_FILE: ws.path("STOP") }, NOW, { file })
      assert.equal(g.ok, false); assert.match(g.why, /STOP \(incident délivrabilité\)/)
    } finally { ws.cleanup() }
  })
})

describe("disjoncteur (seuils §6 : bounce < 1 %, plainte < 0,1 % ; désinscription 2 %)", () => {
  const sends = (n: number) => Array.from({ length: n }, (_, i) => ({ at: new Date(Date.parse(NOW) - (i + 1) * 3600_000).toISOString() }))
  const evs = (type: string, n: number) => Array.from({ length: n }, () => ({ type, at: "2026-10-24T11:00:00.000Z" }))
  test("sous les seuils : fermé (1 bounce sur 100 = 1 %, pas > 1 %)", () => {
    const b = evaluateBreaker({ sends: sends(100), events: evs("bounce", 1), now: NOW })
    assert.equal(b.open, false); assert.deepEqual(b.reasons, [])
  })
  test("bounces 2 / 120 envois → ouvert, raison chiffrée", () => {
    const b = evaluateBreaker({ sends: sends(120), events: evs("bounce", 2), now: NOW })
    assert.equal(b.open, true)
    assert.match(b.reasons[0], /^bounces 2 \/ 120 envoi\(s\) sur 7 j = 1,7 % > 1 %$/)
  })
  test("une seule plainte sur un petit volume → ouvert (plancher de 100 envois)", () => {
    assert.equal(evaluateBreaker({ sends: sends(12), events: evs("complaint", 1), now: NOW }).open, true)
  })
  test("désinscriptions : 2 / 100 fermé, 3 / 100 ouvert ; hors fenêtre de 7 j : non compté", () => {
    assert.equal(evaluateBreaker({ sends: sends(100), events: evs("unsub", 2), now: NOW }).open, false)
    assert.equal(evaluateBreaker({ sends: sends(100), events: evs("unsub", 3), now: NOW }).open, true)
    const old = Array.from({ length: 5 }, () => ({ type: "unsub", at: "2026-10-10T00:00:00.000Z" }))
    assert.equal(evaluateBreaker({ sends: sends(100), events: old, now: NOW }).open, false)
  })
  test("VERROUILLÉ : reste ouvert quand la fenêtre glisse ; le réarmement humain repart de zéro", () => {
    const opened = evaluateBreaker({ sends: sends(120), events: evs("bounce", 3), now: NOW })
    const later = evaluateBreaker({ sends: [], events: [], now: "2026-11-10T00:00:00.000Z", prev: opened })
    assert.equal(later.open, true); assert.equal(later.openedAt, NOW)
    const reset = resetBreaker(later, "2026-11-10T00:00:00.000Z")
    const after = evaluateBreaker({ sends: sends(120), events: evs("bounce", 3), now: "2026-11-10T01:00:00.000Z", prev: reset })
    assert.equal(after.open, false, "les bounces d'avant le réarmement ne comptent plus")
  })
  test("seuils réglables par la config, défauts = §6", () => {
    assert.deepEqual(BREAKER_DEFAULTS, { windowDays: 7, minSends: 100, bounceRate: 0.01, complaintRate: 0.001, unsubRate: 0.02 })
    assert.equal(evaluateBreaker({ sends: sends(100), events: evs("bounce", 2), now: NOW, thresholds: { bounceRate: 0.05 } }).open, false)
  })
})

function seqWs(): Workspace {
  const ws = makeWorkspace({ seed: ["agency"] })
  const cfg = JSON.parse(ws.read("outreach/sequencer/config.json"))
  cfg.inboxes = { A: [{ email: "a1@agence.example", throttlePerDay: 8 }], B: [{ email: "b1@agence.example", throttlePerDay: 8 }] }
  ws.write("outreach/sequencer/config.json", JSON.stringify(cfg, null, 2))
  ws.write(`data/savior/${ORVANE}.json`, JSON.stringify({ senderName: "Camille (fictive)", subject: "Une idée pour votre site", body: "Bonjour,\nL'aperçu : https://demo.agence.example/orvane/\nCamille" }))
  return ws
}
const seq = (ws: Workspace, args: string[], env: NodeJS.ProcessEnv = {}) => tsx(ws.dir, "outreach/scripts/sequencer.ts", args, { env })

test("STOP posé : le séquenceur ne tick pas (« ⏹ STOP »), rien n'est lu, envoyé ni avancé ; levé : il reprend", async () => {
  const ws = seqWs()
  try {
    await seq(ws, ["enroll", ORVANE, "--now", "2026-10-24T08:00:00.000Z"])
    const before = ws.read("data/sequencer/state.json")
    ws.write("STOP", "test de l'arrêt d'urgence\n")
    const r = await seq(ws, ["tick", "--now", "2026-10-24T09:00:00.000Z"])
    assert.equal(r.code, 0, r.out)
    assert.match(r.stdout, /⏹ STOP \(fichier : test de l'arrêt d'urgence\) : le séquenceur ne tick pas/)
    assert.equal(ws.read("data/sequencer/state.json"), before)
    assert.equal(ws.exists("data/sequencer/sends.jsonl"), false)
    assert.equal(ws.exists("data/sequencer/outbox"), false)
    const st = await seq(ws, ["status"])
    assert.match(st.stdout, /⏹ STOP actif/)
    rmSync(ws.path("STOP"))
    const r2 = await seq(ws, ["tick", "--now", "2026-10-24T09:00:00.000Z"])
    assert.match(r2.stdout, /DRY-RUN → \[mail-parfait\]/)
  } finally { ws.cleanup() }
})

test("STOP posé : le warmup ne fait rien (tick, digest, once) ; status reste lisible", async () => {
  const ws = seqWs()
  try {
    ws.write("STOP", "pause\n")
    for (const args of [[], ["tick"], ["digest"], ["once", "a1@agence.example", "b1@agence.example"]]) {
      const r = await tsx(ws.dir, "outreach/scripts/warmup.ts", args, { env: { DIGEST_TO: "moi@agence.example", LWS_LIVE_SEND: "1" } })
      assert.equal(r.code, 0, r.out)
      assert.match(r.stdout, /⏹ STOP \(fichier : pause\) : warmup à l'arrêt/, args.join(" "))
    }
    assert.equal(ws.exists("data/warmup"), false)
    const s = await tsx(ws.dir, "outreach/scripts/warmup.ts", ["status"])
    assert.match(s.stdout, /warmup démarré le/)
  } finally { ws.cleanup() }
})

test("STOP posé : openai-image sort en « désactivé » (code 3) sans aucun appel réseau, même avec une clé", async () => {
  const ws = seqWs()
  try {
    ws.write("STOP", "pause\n")
    const r = await run(process.execPath, ["worker/openai-image.mjs", "--prompt", "x", "--out", "o.png"], { cwd: ws.dir, env: { OPENAI_API_KEY: "sk-fictive", OPENAI_IMAGE_BASE_URL: "http://127.0.0.1:9/v1" } })
    assert.equal(r.code, 3, r.out)
    assert.match(r.stdout, /cage : STOP \(pause\)/)
    assert.equal(ws.exists("o.png"), false)
  } finally { ws.cleanup() }
})

test("évènements synthétiques au-dessus du seuil : le tick ouvre le disjoncteur, n'envoie rien, et /api/sequences + /api/cage le montrent", async () => {
  const ws = seqWs()
  let cockpit: Awaited<ReturnType<typeof startCockpit>> | null = null
  try {
    // 120 envois simulés de la semaine + 3 bounces + 1 plainte (synthétiques, prospects fictifs)
    const sends: string[] = [], events: string[] = []
    for (let i = 0; i < 120; i++) sends.push(JSON.stringify({ prospectId: `fictif-${i}`, step: "mail-parfait", pool: "B", inbox: "b9@agence.example", to: `p${i}@fictif.example`, subject: "s", at: new Date(Date.parse("2026-10-24T08:00:00.000Z") - i * 3600_000).toISOString(), dryRun: true, trackingId: randomUUID() }))
    for (let i = 0; i < 3; i++) events.push(JSON.stringify({ id: randomUUID(), trackingId: "", prospectId: `fictif-${i}`, type: "bounce", at: "2026-10-24T07:00:00.000Z", source: "reader" }))
    events.push(JSON.stringify({ id: randomUUID(), trackingId: "", prospectId: "fictif-9", type: "complaint", at: "2026-10-24T07:30:00.000Z", source: "cli" }))
    ws.write("data/sequencer/sends.jsonl", sends.join("\n") + "\n")
    ws.write("data/sequencer/events.jsonl", events.join("\n") + "\n")
    await seq(ws, ["enroll", ORVANE, "--now", "2026-10-24T08:00:00.000Z"])
    const r = await seq(ws, ["tick", "--now", "2026-10-24T09:00:00.000Z"])
    assert.equal(r.code, 0, r.out)
    assert.match(r.stdout, /⛔ DISJONCTEUR OUVERT : bounces 3 \/ 120 envoi\(s\) sur 7 j = 2,5 % > 1 % ; plaintes 1 \/ 120 envoi\(s\) sur 7 j = 0,8 % > 0,1 %/)
    assert.equal(readFileSync(ws.path("data/sequencer/sends.jsonl"), "utf8").trim().split("\n").length, 120, "aucun nouvel envoi")
    assert.equal(ws.json("data/sequencer/state.json")[0].step, 0)
    assert.equal(ws.json("data/sequencer/breaker.json").open, true)
    cockpit = await startCockpit(ws.dir)
    const sq = await (await fetch(cockpit.url + "/api/sequences")).json()
    assert.equal(sq.breaker.open, true)
    assert.equal(sq.stats.bounces, 3); assert.equal(sq.stats.complaints, 1)
    const cage = await (await fetch(cockpit.url + "/api/cage")).json()
    assert.deepEqual(cage.alerts, ["breaker"])
    // réarmement humain depuis le cockpit → fermé ; le tick suivant ne recompte pas les incidents d'avant
    const reset = await (await fetch(cockpit.url + "/api/cage/breaker/reset", { method: "POST" })).json()
    assert.equal(reset.breaker.open, false)
    const r2 = await seq(ws, ["tick", "--now", "2026-10-24T09:30:00.000Z"])
    assert.doesNotMatch(r2.stdout, /DISJONCTEUR OUVERT/, r2.out)
    assert.match(r2.stdout, /DRY-RUN → \[mail-parfait\]/)
  } finally { await cockpit?.stop(); ws.cleanup() }
})

test("STOP depuis le cockpit (sans base) : pose le fichier STOP, le bandeau le dit, « reprendre » le lève", async () => {
  const ws = seqWs()
  const cockpit = await startCockpit(ws.dir)
  try {
    const on = await (await fetch(cockpit.url + "/api/cage/stop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on: true, reason: "test" }) })).json()
    assert.equal(on.stop.on, true); assert.equal(on.stop.source, "fichier")
    assert.equal(stopFileState({ LWS_STOP_FILE: ws.path("STOP") }).reason, "test")
    assert.deepEqual((await (await fetch(cockpit.url + "/api/cage")).json()).alerts, ["stop"])
    const bad = await fetch(cockpit.url + "/api/cage/stop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on: "oui" }) })
    assert.equal(bad.status, 400)
    const off = await (await fetch(cockpit.url + "/api/cage/stop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on: false }) })).json()
    assert.equal(off.stop.on, false)
    assert.equal(ws.exists("STOP"), false)
  } finally { await cockpit.stop(); ws.cleanup() }
})
