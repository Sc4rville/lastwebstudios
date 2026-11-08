/**
 * P0-2/P0-3 + G2: the sequencer enrolls without personas, HOLDS a step whose content does not exist (never
 * a placeholder), and cannot send by accident: real = config.dryRun === false AND LWS_LIVE_SEND=1.
 * Everything runs in a throwaway workspace (data/sequencer/ is created there), without a database (file state).
 */
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { tsx } from "../helpers/proc.ts"
import { makeWorkspace, type Workspace } from "../helpers/workspace.ts"
import { sendMode } from "../../outreach/scripts/sequencer.ts"

const ORVANE = "orvane-piscines-valmont-sur-lys"
const BRISANE = "atelier-brisane-menuiserie-sornac-le-haut"
const LUMEO = "cuisines-lumeo-vereuil" // a record WITHOUT an email
const SEQ = "outreach/scripts/sequencer.ts"

function seqWs(cfgPatch: Record<string, unknown> = {}, drop: string[] = []): Workspace {
  const ws = makeWorkspace({ seed: ["agency"] })
  const cfg = JSON.parse(ws.read("outreach/sequencer/config.json"))
  for (const k of drop) delete cfg[k]
  Object.assign(cfg, cfgPatch)
  // fictional mailboxes: never the agency's real mailboxes in a test
  cfg.inboxes = { A: [{ email: "a1@agence.example", throttlePerDay: 8 }], B: [{ email: "b1@agence.example", throttlePerDay: 8 }, { email: "b2@agence.example", throttlePerDay: 8 }] }
  ws.write("outreach/sequencer/config.json", JSON.stringify(cfg, null, 2))
  return ws
}
const savior = (ws: Workspace, id: string) => ws.write(`data/savior/${id}.json`, JSON.stringify({ senderName: "Camille (fictive)", subject: "Une idée pour votre site", body: "Bonjour,\n\nJ'ai refait votre page d'accueil, voici l'aperçu.\n\nCamille" }))
const seq = (ws: Workspace, args: string[], env: NodeJS.ProcessEnv = {}) => tsx(ws.dir, SEQ, args, { env })
const state = (ws: Workspace) => ws.json<any[]>("data/sequencer/state.json")
const sendsRaw = (ws: Workspace) => (ws.exists("data/sequencer/sends.jsonl") ? ws.read("data/sequencer/sends.jsonl") : "")

describe("sendMode: real sending = two keys, otherwise dry-run (fail-closed)", () => {
  test("config without dryRun → dry-run", () => assert.deepEqual(sendMode({}, {}), { live: false, refused: false }))
  test("dryRun:true → dry-run, even with LWS_LIVE_SEND=1", () => assert.deepEqual(sendMode({ dryRun: true }, { LWS_LIVE_SEND: "1" }), { live: false, refused: false }))
  test("dryRun of the wrong type (\"false\", 0, null) → dry-run", () => {
    for (const v of ["false", 0, null, "no"]) assert.equal(sendMode({ dryRun: v }, { LWS_LIVE_SEND: "1" }).live, false, String(v))
  })
  test("dryRun:false without LWS_LIVE_SEND=1 → explicit refusal", () => {
    assert.deepEqual(sendMode({ dryRun: false }, {}), { live: false, refused: true })
    assert.deepEqual(sendMode({ dryRun: false }, { LWS_LIVE_SEND: "true" }), { live: false, refused: true })
  })
  test("dryRun:false + LWS_LIVE_SEND=1 → real", () => assert.deepEqual(sendMode({ dryRun: false }, { LWS_LIVE_SEND: "1" }), { live: true, refused: false }))
})

test("enrolling a fictional prospect WITHOUT data/personas/: enrolled", async () => {
  const ws = seqWs()
  try {
    assert.equal(ws.exists("data/personas"), false)
    const r = await seq(ws, ["enroll", ORVANE, "--now", "2026-10-24T08:00:00.000Z"])
    assert.equal(r.code, 0, r.out)
    assert.match(r.stdout, new RegExp(`✅ ${ORVANE} enrolled`))
    assert.equal(state(ws)[0].status, "active")
  } finally { ws.cleanup() }
})

test("enrolling an id with no record: refused, nothing enrolled", async () => {
  const ws = seqWs()
  try {
    const r = await seq(ws, ["enroll", "entreprise-qui-n-existe-pas"])
    assert.equal(r.code, 0)
    assert.match(r.stdout, /not found/)
    assert.deepEqual(state(ws), [])
  } finally { ws.cleanup() }
})

test("config WITHOUT a dryRun key: the tick is a dry-run (logged dryRun:true, no transport)", async () => {
  const ws = seqWs({}, ["dryRun"])
  try {
    savior(ws, ORVANE)
    await seq(ws, ["enroll", ORVANE, "--now", "2026-10-24T08:00:00.000Z"])
    const r = await seq(ws, ["tick", "--now", "2026-10-24T09:00:00.000Z"], { LWS_LIVE_SEND: "1" })
    assert.equal(r.code, 0, r.out)
    assert.match(r.stdout, /DRY-RUN/)
    const sends = sendsRaw(ws).trim().split("\n").map((l) => JSON.parse(l))
    assert.equal(sends.length, 1)
    assert.equal(sends[0].dryRun, true)
    assert.equal(sends[0].to, "contact@orvane-piscines.example")
  } finally { ws.cleanup() }
})

test("dryRun:false WITHOUT LWS_LIVE_SEND=1: explicit refusal (exit 2), nothing moves or goes out", async () => {
  const ws = seqWs({ dryRun: false })
  try {
    savior(ws, ORVANE)
    await seq(ws, ["enroll", ORVANE, "--now", "2026-10-24T08:00:00.000Z"])
    const before = ws.read("data/sequencer/state.json")
    const r = await seq(ws, ["tick", "--now", "2026-10-24T09:00:00.000Z"])
    assert.equal(r.code, 2)
    assert.match(r.stderr, /REAL SENDING REFUSED/)
    assert.match(r.stderr, /LWS_LIVE_SEND=1/)
    assert.equal(ws.read("data/sequencer/state.json"), before, "the state does not move")
    assert.equal(sendsRaw(ws), "", "no send logged")
  } finally { ws.cleanup() }
})

test("a step without content → waiting-content, NO placeholder logged; the content arrives → the sequence resumes", async () => {
  const ws = seqWs()
  try {
    await seq(ws, ["enroll", BRISANE, "--now", "2026-10-24T08:00:00.000Z"])
    const r1 = await seq(ws, ["tick", "--now", "2026-10-24T09:00:00.000Z"])
    assert.equal(r1.code, 0, r1.out)
    assert.match(r1.stdout, /held/)
    const s1 = state(ws)[0]
    assert.equal(s1.status, "waiting-content")
    assert.equal(s1.waiting.reason, "contenu")
    assert.equal(s1.step, 0)
    assert.equal(sendsRaw(ws), "")
    savior(ws, BRISANE) // the perfect email is generated
    const r2 = await seq(ws, ["tick", "--now", "2026-10-24T10:00:00.000Z"])
    assert.equal(r2.code, 0, r2.out)
    const s2 = state(ws)[0]
    assert.equal(s2.status, "active")
    assert.equal(s2.step, 1)
    assert.equal(s2.waiting, undefined)
    assert.match(sendsRaw(ws), /mail-parfait/)
  } finally { ws.cleanup() }
})

test("content that is only a « [... à générer ...] » template is treated as missing", async () => {
  const ws = seqWs()
  try {
    ws.write(`data/savior/${ORVANE}.json`, JSON.stringify({ senderName: "x", subject: `[mail parfait à générer pour ${ORVANE}]`, body: "[pas encore généré]" }))
    await seq(ws, ["enroll", ORVANE, "--now", "2026-10-24T08:00:00.000Z"])
    await seq(ws, ["tick", "--now", "2026-10-24T09:00:00.000Z"])
    assert.equal(state(ws)[0].status, "waiting-content")
    assert.equal(sendsRaw(ws), "")
  } finally { ws.cleanup() }
})

test("a prospect without a valid email: step held (destinataire), never a send to a placeholder", async () => {
  const ws = seqWs()
  try {
    savior(ws, LUMEO)
    await seq(ws, ["enroll", LUMEO, "--now", "2026-10-24T08:00:00.000Z"])
    await seq(ws, ["tick", "--now", "2026-10-24T09:00:00.000Z"])
    const s = state(ws)[0]
    assert.equal(s.status, "waiting-content")
    assert.equal(s.waiting.reason, "destinataire")
    assert.equal(sendsRaw(ws), "")
  } finally { ws.cleanup() }
})

test("the whole funnel in dry-run: day 0 perfect email → click → personal demo HELD (content missing), 0 « [démo perso à générer » line", async () => {
  const ws = seqWs()
  try {
    savior(ws, ORVANE)
    await seq(ws, ["enroll", ORVANE, "--now", "2026-10-24T08:00:00.000Z"])
    const j0 = await seq(ws, ["tick", "--now", "2026-10-24T09:00:00.000Z"])
    assert.match(j0.stdout, /DRY-RUN → \[mail-parfait\]/)
    await seq(ws, ["click", ORVANE, "--now", "2026-10-25T12:00:00.000Z"])
    const j3 = await seq(ws, ["tick", "--now", "2026-10-27T09:30:00.000Z"])
    assert.equal(j3.code, 0, j3.out)
    const s = state(ws)[0]
    assert.equal(s.status, "waiting-content")
    assert.equal(s.waiting.step, "demo-perso")
    const raw = sendsRaw(ws)
    assert.doesNotMatch(raw, /\[démo perso à générer/)
    assert.equal(raw.trim().split("\n").length, 1, "only the perfect email is logged")
    const st = await seq(ws, ["status"])
    assert.match(st.stdout, /waiting-content/)
  } finally { ws.cleanup() }
})

test("no click after the perfect email: the escalation stops (nurturing)", async () => {
  const ws = seqWs()
  try {
    savior(ws, ORVANE)
    await seq(ws, ["enroll", ORVANE, "--now", "2026-10-24T08:00:00.000Z"])
    await seq(ws, ["tick", "--now", "2026-10-24T09:00:00.000Z"])
    const r = await seq(ws, ["tick", "--now", "2026-10-27T09:30:00.000Z"])
    assert.match(r.stdout, /nurturing/)
    assert.equal(state(ws)[0].status, "nurturing")
  } finally { ws.cleanup() }
})

test("`npm run sequencer` with no argument: usage, exit 1", async () => {
  const ws = seqWs()
  try {
    const r = await seq(ws, [])
    assert.equal(r.code, 1)
    assert.match(r.stderr, /usage: npm run sequencer/)
    assert.equal(existsSync(ws.path("data/sequencer/sends.jsonl")), false)
  } finally { ws.cleanup() }
})

test("no « 2 plaintes / plainte 1 / 6 étapes » (2 complaints / complaint 1 / 6 steps) in the sequencer (honest funnel)", () => {
  const src = readFileSync(SEQ, "utf8")
  assert.doesNotMatch(src, /2 plaintes|plainte [12]|6 étapes|plainte-a|plainte-b|2 complaints|complaint [12]\b|6 steps/)
})
