/**
 * Test blitz (24/10) · CONCURRENCE du séquenceur, en envoi « réel » sur le transport SIMULÉ (aucun mail ne part).
 *
 * Sur la box, le timer systemd passe par run-guarded.sh (flock par job). Mais un tick lancé À LA MAIN
 * (`npm run sequencer -- tick`, /out, un opérateur pressé) pendant celui du timer chargeait le même état et
 * envoyait la même étape deux fois au même prospect. Le séquenceur prend désormais lui-même un verrou exclusif
 * (data/sequencer/.lock) pour toute commande qui écrit l'état : le second tick attend, puis voit l'étape déjà faite.
 */
import { test } from "node:test"
import { hostname } from "node:os"
import assert from "node:assert/strict"
import { tsx } from "../helpers/proc.ts"
import { makeWorkspace, type Workspace } from "../helpers/workspace.ts"
import { crowd } from "../helpers/crowd.ts"

const ORVANE = "orvane-piscines-valmont-sur-lys"
const BRISANE = "atelier-brisane-menuiserie-sornac-le-haut"
const SECRET = "secret-de-test-fictif-concurrence-0123456789"

function liveWs(): Workspace {
  const ws = makeWorkspace({ seed: ["agency"] })
  const cfg = JSON.parse(ws.read("outreach/sequencer/config.json"))
  cfg.dryRun = false
  cfg.inboxes = { A: [{ email: "a1@agence.example", throttlePerDay: 40 }], B: [{ email: "b1@agence.example", throttlePerDay: 40 }] }
  ws.write("outreach/sequencer/config.json", JSON.stringify(cfg, null, 2))
  const mail = (subject: string) => JSON.stringify({ senderName: "Camille (fictive)", subject, body: "Bonjour,\n\nJ'ai refait votre page d'accueil : https://demo.agence.example/\n\nCamille" })
  ws.write(`data/savior/${ORVANE}.json`, mail("Une idée pour votre site"))
  ws.write(`data/savior/${BRISANE}.json`, mail("Une idée pour votre atelier"))
  return ws
}
// 150 ms par envoi simulé (latence d'une API) : un tick de 13-14 envois dure ~2 s, les deux process se chevauchent à coup sûr
const ENV = { TRACK_BASE: "https://cockpit.agence.example", LWS_TRACK_SECRET: SECRET, LWS_MAIL_TRANSPORT: "simulated", LWS_LIVE_SEND: "1", LWS_SIMULATED_DELAY_MS: "150" }
const seq = (ws: Workspace, args: string[], extra: NodeJS.ProcessEnv = {}) => tsx(ws.dir, "outreach/scripts/sequencer.ts", args, { env: { ...ENV, ...extra }, timeoutMs: 90_000 })
const lines = (ws: Workspace, f: string) => (ws.exists(f) ? ws.read(f).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [])

test("deux ticks RÉELS lancés en même temps sur 14 prospects : chaque prospect reçoit son mail UNE fois (3 essais)", { timeout: 240_000 }, async () => {
  for (let round = 0; round < 3; round++) {
    const ws = liveWs()
    try {
      const ids = [ORVANE, BRISANE, ...crowd(ws, 12)]
      assert.equal((await seq(ws, ["enroll", ids.join(","), "--now", "2026-10-26T08:00:00.000Z"])).code, 0)
      const [a, b] = await Promise.all([
        seq(ws, ["tick", "--now", "2026-10-26T09:00:00.000Z"]),
        seq(ws, ["tick", "--now", "2026-10-26T09:00:00.000Z"]),
      ])
      assert.equal(a.code, 0, a.out); assert.equal(b.code, 0, b.out)
      const to = lines(ws, "data/sequencer/transport.jsonl").map((c) => c.to)
      assert.equal(to.length, new Set(to).size, `essai ${round + 1} : un seul envoi par prospect (${to.length} envois pour ${new Set(to).size} prospects)`)
      assert.equal(to.length, ids.length)
      assert.equal(lines(ws, "data/sequencer/sends.jsonl").length, ids.length)
      assert.ok(ws.json<any[]>("data/sequencer/state.json").every((s) => s.step === 1))
    } finally { ws.cleanup() }
  }
})

test("un tick et un enroll concurrents : aucune inscription perdue (l'état n'est jamais écrasé par un process qui l'a lu avant)", { timeout: 120_000 }, async () => {
  const ws = liveWs()
  try {
    const crowdIds = crowd(ws, 12)
    assert.equal((await seq(ws, ["enroll", [ORVANE, ...crowdIds].join(","), "--now", "2026-10-26T08:00:00.000Z"])).code, 0)
    // l'inscription arrive PENDANT le tick (après son 1er envoi) : sans verrou, le tick réécrivait ensuite son état lu avant
    const tick = seq(ws, ["tick", "--now", "2026-10-26T09:00:00.000Z"])
    for (let i = 0; i < 300 && lines(ws, "data/sequencer/transport.jsonl").length < 1; i++) await new Promise((r) => setTimeout(r, 20))
    const [t, e] = await Promise.all([tick, seq(ws, ["enroll", BRISANE, "--now", "2026-10-26T09:00:00.000Z"])])
    assert.equal(t.code, 0, t.out); assert.equal(e.code, 0, e.out)
    const st = ws.json<any[]>("data/sequencer/state.json")
    assert.ok(st.some((s) => s.prospectId === BRISANE), "l'inscription concurrente n'est pas écrasée par le tick")
    assert.equal(st.length, 14)
    assert.equal(st.find((s) => s.prospectId === ORVANE).step, 1, "le mail d'Orvane est parti et compté")
  } finally { ws.cleanup() }
})

test("verrou orphelin repris : pid mort sur cette machine, ou verrou d'une autre machine vieux de 2 h ; rendu à la fin", { timeout: 90_000 }, async () => {
  const orphans = [
    { pid: 2_147_483_000, host: hostname(), at: new Date().toISOString(), cmd: "sequencer tick", why: /pid 2147483000 mort/ },
    { pid: 4242, host: "conteneur-d-avant", at: new Date(Date.now() - 2 * 3600_000).toISOString(), cmd: "sequencer tick", why: /vieux de 1\d\d min/ },
  ]
  for (const o of orphans) {
    const ws = liveWs()
    try {
      assert.equal((await seq(ws, ["enroll", ORVANE, "--now", "2026-10-26T08:00:00.000Z"])).code, 0)
      ws.write("data/sequencer/.lock", JSON.stringify(o))
      const r = await seq(ws, ["tick", "--now", "2026-10-26T09:00:00.000Z"], { LWS_SEQ_LOCK_WAIT_MS: "20000" })
      assert.equal(r.code, 0, r.out)
      assert.match(r.out, /verrou orphelin repris/)
      assert.match(r.out, o.why)
      assert.equal(lines(ws, "data/sequencer/transport.jsonl").length, 1)
      assert.equal(ws.exists("data/sequencer/.lock"), false, "verrou rendu à la fin")
    } finally { ws.cleanup() }
  }
})

test("verrou tenu par un process VIVANT plus longtemps que le délai : refus clair (code 75), rien n'est envoyé", { timeout: 60_000 }, async () => {
  const ws = liveWs()
  try {
    assert.equal((await seq(ws, ["enroll", ORVANE, "--now", "2026-10-26T08:00:00.000Z"])).code, 0)
    ws.write("data/sequencer/.lock", JSON.stringify({ pid: process.pid, host: hostname(), at: new Date().toISOString(), cmd: "tick" }))
    const r = await seq(ws, ["tick", "--now", "2026-10-26T09:00:00.000Z"], { LWS_SEQ_LOCK_WAIT_MS: "1500" })
    assert.equal(r.code, 75, r.out)
    assert.match(r.out, /déjà en cours/)
    assert.equal(lines(ws, "data/sequencer/transport.jsonl").length, 0)
  } finally { ws.cleanup() }
})

test("tick RÉEL sans tracking : averti en clair à chaque tick (désinscription 1-clic absente, escalade gatée impossible)", { timeout: 60_000 }, async () => {
  const ws = liveWs()
  try {
    assert.equal((await seq(ws, ["enroll", ORVANE, "--now", "2026-10-26T08:00:00.000Z"])).code, 0)
    const r = await seq(ws, ["tick", "--now", "2026-10-26T09:00:00.000Z"], { TRACK_BASE: "", LWS_TRACK_SECRET: "" })
    assert.equal(r.code, 0, r.out)
    assert.match(r.stderr, /⚠ ENVOI RÉEL SANS TRACKING/)
    const ok = await seq(ws, ["tick", "--now", "2026-10-26T10:00:00.000Z"])
    assert.doesNotMatch(ok.stderr, /SANS TRACKING/, "avec TRACK_BASE + secret : rien à dire")
  } finally { ws.cleanup() }
})

test("RÉ-INSCRIPTION : un prospect désinscrit, en bounce ou en plainte n'est JAMAIS ré-inscrit (opposition RGPD) ; un « replied » non plus sans --force", { timeout: 120_000 }, async () => {
  // test blitz du 24/10 : enroll ne regardait que les séquences vivantes ; l'inscription en masse (~100 tous les 2 jours)
  // remettait en séquence quelqu'un qui avait dit STOP, et le tick suivant lui réécrivait
  const ws = liveWs()
  try {
    const ids = [ORVANE, BRISANE, ...crowd(ws, 2)]
    assert.equal((await seq(ws, ["enroll", ids.join(","), "--now", "2026-10-26T08:00:00.000Z"])).code, 0)
    assert.equal((await seq(ws, ["tick", "--now", "2026-10-26T09:00:00.000Z"])).code, 0)
    await seq(ws, ["drop", ids[3], "--now", "2026-10-26T09:30:00.000Z"]) // arrêt manuel : ré-inscriptible
    ws.write("data/sequencer/events.jsonl", [
      { type: "unsub", source: "track", prospectId: ORVANE, trackingId: "", at: "2026-10-26T10:00:00.000Z", id: "ev-u" },
      { type: "bounce", source: "reader", prospectId: BRISANE, trackingId: "", at: "2026-10-26T10:00:00.000Z", id: "ev-b" },
    ].map((e) => JSON.stringify(e)).join("\n") + "\n")
    assert.equal((await seq(ws, ["reply", ids[2], "--now", "2026-10-26T10:30:00.000Z"])).code, 0)
    assert.equal((await seq(ws, ["tick", "--now", "2026-10-26T11:00:00.000Z"])).code, 0)
    const sentBefore = lines(ws, "data/sequencer/transport.jsonl").length
    const again = await seq(ws, ["enroll", ids.join(","), "--now", "2026-10-28T08:00:00.000Z"])
    assert.equal(again.code, 0, again.out)
    assert.match(again.stdout, new RegExp(`⛔ ${ORVANE} : désinscrit`))
    assert.match(again.stdout, new RegExp(`⛔ ${BRISANE} : adresse en échec`))
    assert.match(again.stdout, new RegExp(`⏭  ${ids[2]} : a déjà répondu`))
    assert.match(again.stdout, new RegExp(`✅ ${ids[3]} inscrit`), "un arrêt manuel (drop) peut repartir")
    assert.equal((await seq(ws, ["tick", "--now", "2026-10-28T09:00:00.000Z"])).code, 0)
    const sent = lines(ws, "data/sequencer/transport.jsonl").slice(sentBefore).map((c) => c.to)
    assert.deepEqual(sent, ["contact@bassin-fictif-2.example"], "seul le prospect arrêté à la main est réécrit")
    const forced = await seq(ws, ["enroll", ORVANE, "--force", "--now", "2026-10-29T08:00:00.000Z"])
    assert.match(forced.stdout, /⛔ .* désinscrit .* même avec --force/, "--force ne lève jamais une opposition")
  } finally { ws.cleanup() }
})
