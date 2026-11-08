/**
 * Blitz test (10/24) · sequencer CONCURRENCY, with "real" sending on the SIMULATED transport (no email goes out).
 *
 * On the box, the systemd timer goes through run-guarded.sh (flock per job). But a tick started BY HAND
 * (`npm run sequencer -- tick`, /out, an operator in a hurry) during the timer's loaded the same state and
 * sent the same step twice to the same prospect. The sequencer now takes an exclusive lock itself
 * (data/sequencer/.lock) for any command that writes the state: the second tick waits, then sees the step already done.
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
// 150 ms per simulated send (an API's latency): a tick of 13-14 sends lasts ~2 s, the two processes surely overlap
const ENV = { TRACK_BASE: "https://cockpit.agence.example", LWS_TRACK_SECRET: SECRET, LWS_MAIL_TRANSPORT: "simulated", LWS_LIVE_SEND: "1", LWS_SIMULATED_DELAY_MS: "150" }
const seq = (ws: Workspace, args: string[], extra: NodeJS.ProcessEnv = {}) => tsx(ws.dir, "outreach/scripts/sequencer.ts", args, { env: { ...ENV, ...extra }, timeoutMs: 90_000 })
const lines = (ws: Workspace, f: string) => (ws.exists(f) ? ws.read(f).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [])

test("two REAL ticks started together on 14 prospects: each prospect gets its email ONCE (3 tries)", { timeout: 240_000 }, async () => {
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
      assert.equal(to.length, new Set(to).size, `try ${round + 1}: a single send per prospect (${to.length} sends for ${new Set(to).size} prospects)`)
      assert.equal(to.length, ids.length)
      assert.equal(lines(ws, "data/sequencer/sends.jsonl").length, ids.length)
      assert.ok(ws.json<any[]>("data/sequencer/state.json").every((s) => s.step === 1))
    } finally { ws.cleanup() }
  }
})

test("a tick and an enroll at the same time: no enrollment lost (the state is never overwritten by a process that read it earlier)", { timeout: 120_000 }, async () => {
  const ws = liveWs()
  try {
    const crowdIds = crowd(ws, 12)
    assert.equal((await seq(ws, ["enroll", [ORVANE, ...crowdIds].join(","), "--now", "2026-10-26T08:00:00.000Z"])).code, 0)
    // the enrollment arrives DURING the tick (after its first send): without a lock, the tick then rewrote the state it read earlier
    const tick = seq(ws, ["tick", "--now", "2026-10-26T09:00:00.000Z"])
    for (let i = 0; i < 300 && lines(ws, "data/sequencer/transport.jsonl").length < 1; i++) await new Promise((r) => setTimeout(r, 20))
    const [t, e] = await Promise.all([tick, seq(ws, ["enroll", BRISANE, "--now", "2026-10-26T09:00:00.000Z"])])
    assert.equal(t.code, 0, t.out); assert.equal(e.code, 0, e.out)
    const st = ws.json<any[]>("data/sequencer/state.json")
    assert.ok(st.some((s) => s.prospectId === BRISANE), "the concurrent enrollment is not overwritten by the tick")
    assert.equal(st.length, 14)
    assert.equal(st.find((s) => s.prospectId === ORVANE).step, 1, "Orvane's email went out and is counted")
  } finally { ws.cleanup() }
})

test("orphan lock taken over: a dead pid on this machine, or another machine's lock 2 h old; released at the end", { timeout: 90_000 }, async () => {
  const orphans = [
    { pid: 2_147_483_000, host: hostname(), at: new Date().toISOString(), cmd: "sequencer tick", why: /pid 2147483000 dead/ },
    { pid: 4242, host: "conteneur-d-avant", at: new Date(Date.now() - 2 * 3600_000).toISOString(), cmd: "sequencer tick", why: /1\d\d min old/ },
  ]
  for (const o of orphans) {
    const ws = liveWs()
    try {
      assert.equal((await seq(ws, ["enroll", ORVANE, "--now", "2026-10-26T08:00:00.000Z"])).code, 0)
      ws.write("data/sequencer/.lock", JSON.stringify(o))
      const r = await seq(ws, ["tick", "--now", "2026-10-26T09:00:00.000Z"], { LWS_SEQ_LOCK_WAIT_MS: "20000" })
      assert.equal(r.code, 0, r.out)
      assert.match(r.out, /orphan lock taken over/)
      assert.match(r.out, o.why)
      assert.equal(lines(ws, "data/sequencer/transport.jsonl").length, 1)
      assert.equal(ws.exists("data/sequencer/.lock"), false, "lock released at the end")
    } finally { ws.cleanup() }
  }
})

test("a lock held by a LIVE process for longer than the wait: a clear refusal (code 75), nothing is sent", { timeout: 60_000 }, async () => {
  const ws = liveWs()
  try {
    assert.equal((await seq(ws, ["enroll", ORVANE, "--now", "2026-10-26T08:00:00.000Z"])).code, 0)
    ws.write("data/sequencer/.lock", JSON.stringify({ pid: process.pid, host: hostname(), at: new Date().toISOString(), cmd: "tick" }))
    const r = await seq(ws, ["tick", "--now", "2026-10-26T09:00:00.000Z"], { LWS_SEQ_LOCK_WAIT_MS: "1500" })
    assert.equal(r.code, 75, r.out)
    assert.match(r.out, /already running elsewhere/)
    assert.equal(lines(ws, "data/sequencer/transport.jsonl").length, 0)
  } finally { ws.cleanup() }
})

test("REAL tick without tracking: a plain warning at every tick (no one-click unsubscribe, gated escalation impossible)", { timeout: 60_000 }, async () => {
  const ws = liveWs()
  try {
    assert.equal((await seq(ws, ["enroll", ORVANE, "--now", "2026-10-26T08:00:00.000Z"])).code, 0)
    const r = await seq(ws, ["tick", "--now", "2026-10-26T09:00:00.000Z"], { TRACK_BASE: "", LWS_TRACK_SECRET: "" })
    assert.equal(r.code, 0, r.out)
    assert.match(r.stderr, /⚠ REAL SENDING WITHOUT TRACKING/)
    const ok = await seq(ws, ["tick", "--now", "2026-10-26T10:00:00.000Z"])
    assert.doesNotMatch(ok.stderr, /WITHOUT TRACKING/, "with TRACK_BASE + secret: nothing to say")
  } finally { ws.cleanup() }
})

test("RE-ENROLLMENT: a prospect who unsubscribed, bounced or complained is NEVER enrolled again (GDPR objection); nor a \"replied\" one without --force", { timeout: 120_000 }, async () => {
  // blitz test of 10/24: enroll only looked at live sequences; bulk enrollment (~100 every 2 days)
  // put back into a sequence someone who had said STOP, and the next tick wrote to them again
  const ws = liveWs()
  try {
    const ids = [ORVANE, BRISANE, ...crowd(ws, 2)]
    assert.equal((await seq(ws, ["enroll", ids.join(","), "--now", "2026-10-26T08:00:00.000Z"])).code, 0)
    assert.equal((await seq(ws, ["tick", "--now", "2026-10-26T09:00:00.000Z"])).code, 0)
    await seq(ws, ["drop", ids[3], "--now", "2026-10-26T09:30:00.000Z"]) // a manual stop: can be enrolled again
    ws.write("data/sequencer/events.jsonl", [
      { type: "unsub", source: "track", prospectId: ORVANE, trackingId: "", at: "2026-10-26T10:00:00.000Z", id: "ev-u" },
      { type: "bounce", source: "reader", prospectId: BRISANE, trackingId: "", at: "2026-10-26T10:00:00.000Z", id: "ev-b" },
    ].map((e) => JSON.stringify(e)).join("\n") + "\n")
    assert.equal((await seq(ws, ["reply", ids[2], "--now", "2026-10-26T10:30:00.000Z"])).code, 0)
    assert.equal((await seq(ws, ["tick", "--now", "2026-10-26T11:00:00.000Z"])).code, 0)
    const sentBefore = lines(ws, "data/sequencer/transport.jsonl").length
    const again = await seq(ws, ["enroll", ids.join(","), "--now", "2026-10-28T08:00:00.000Z"])
    assert.equal(again.code, 0, again.out)
    assert.match(again.stdout, new RegExp(`⛔ ${ORVANE}: unsubscribed`))
    assert.match(again.stdout, new RegExp(`⛔ ${BRISANE}: address failing`))
    assert.match(again.stdout, new RegExp(`⏭  ${ids[2]}: already replied`))
    assert.match(again.stdout, new RegExp(`✅ ${ids[3]} enrolled`), "a manual stop (drop) can start again")
    assert.equal((await seq(ws, ["tick", "--now", "2026-10-28T09:00:00.000Z"])).code, 0)
    const sent = lines(ws, "data/sequencer/transport.jsonl").slice(sentBefore).map((c) => c.to)
    assert.deepEqual(sent, ["contact@bassin-fictif-2.example"], "only the prospect stopped by hand is written to again")
    const forced = await seq(ws, ["enroll", ORVANE, "--force", "--now", "2026-10-29T08:00:00.000Z"])
    assert.match(forced.stdout, /⛔ .* unsubscribed .* even with --force/, "--force never lifts an opt-out")
  } finally { ws.cleanup() }
})
