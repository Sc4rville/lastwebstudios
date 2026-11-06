/**
 * P0-2/P0-3 + G2 : le séquenceur inscrit sans personas, TIENT une étape dont le contenu n'existe pas (jamais
 * de placeholder), et ne peut pas envoyer par accident : réel = config.dryRun === false ET LWS_LIVE_SEND=1.
 * Tout tourne dans un workspace jetable (data/sequencer/ y est créé), sans base (état fichier).
 */
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { tsx } from "../helpers/proc.ts"
import { makeWorkspace, type Workspace } from "../helpers/workspace.ts"
import { sendMode } from "../../outreach/scripts/sequencer.ts"

const ORVANE = "orvane-piscines-valmont-sur-lys"
const BRISANE = "atelier-brisane-menuiserie-sornac-le-haut"
const LUMEO = "cuisines-lumeo-vereuil" // fiche SANS e-mail
const SEQ = "outreach/scripts/sequencer.ts"

function seqWs(cfgPatch: Record<string, unknown> = {}, drop: string[] = []): Workspace {
  const ws = makeWorkspace({ seed: ["agency"] })
  const cfg = JSON.parse(ws.read("outreach/sequencer/config.json"))
  for (const k of drop) delete cfg[k]
  Object.assign(cfg, cfgPatch)
  // boîtes fictives : jamais les vraies boîtes de l'agence dans un test
  cfg.inboxes = { A: [{ email: "a1@agence.example", throttlePerDay: 8 }], B: [{ email: "b1@agence.example", throttlePerDay: 8 }, { email: "b2@agence.example", throttlePerDay: 8 }] }
  ws.write("outreach/sequencer/config.json", JSON.stringify(cfg, null, 2))
  return ws
}
const savior = (ws: Workspace, id: string) => ws.write(`data/savior/${id}.json`, JSON.stringify({ senderName: "Camille (fictive)", subject: "Une idée pour votre site", body: "Bonjour,\n\nJ'ai refait votre page d'accueil, voici l'aperçu.\n\nCamille" }))
const seq = (ws: Workspace, args: string[], env: NodeJS.ProcessEnv = {}) => tsx(ws.dir, SEQ, args, { env })
const state = (ws: Workspace) => ws.json<any[]>("data/sequencer/state.json")
const sendsRaw = (ws: Workspace) => (ws.exists("data/sequencer/sends.jsonl") ? ws.read("data/sequencer/sends.jsonl") : "")

describe("sendMode : envoi réel = deux clés, sinon dry-run (fail-closed)", () => {
  test("config sans dryRun → dry-run", () => assert.deepEqual(sendMode({}, {}), { live: false, refused: false }))
  test("dryRun:true → dry-run, même avec LWS_LIVE_SEND=1", () => assert.deepEqual(sendMode({ dryRun: true }, { LWS_LIVE_SEND: "1" }), { live: false, refused: false }))
  test("dryRun mal typé (\"false\", 0, null) → dry-run", () => {
    for (const v of ["false", 0, null, "no"]) assert.equal(sendMode({ dryRun: v }, { LWS_LIVE_SEND: "1" }).live, false, String(v))
  })
  test("dryRun:false sans LWS_LIVE_SEND=1 → refus explicite", () => {
    assert.deepEqual(sendMode({ dryRun: false }, {}), { live: false, refused: true })
    assert.deepEqual(sendMode({ dryRun: false }, { LWS_LIVE_SEND: "true" }), { live: false, refused: true })
  })
  test("dryRun:false + LWS_LIVE_SEND=1 → réel", () => assert.deepEqual(sendMode({ dryRun: false }, { LWS_LIVE_SEND: "1" }), { live: true, refused: false }))
})

test("enroll d'un prospect fictif SANS data/personas/ : inscrit", async () => {
  const ws = seqWs()
  try {
    assert.equal(ws.exists("data/personas"), false)
    const r = await seq(ws, ["enroll", ORVANE, "--now", "2026-10-24T08:00:00.000Z"])
    assert.equal(r.code, 0, r.out)
    assert.match(r.stdout, new RegExp(`✅ ${ORVANE} inscrit`))
    assert.equal(state(ws)[0].status, "active")
  } finally { ws.cleanup() }
})

test("enroll d'un id sans fiche : refusé, rien d'inscrit", async () => {
  const ws = seqWs()
  try {
    const r = await seq(ws, ["enroll", "entreprise-qui-n-existe-pas"])
    assert.equal(r.code, 0)
    assert.match(r.stdout, /introuvable/)
    assert.deepEqual(state(ws), [])
  } finally { ws.cleanup() }
})

test("config SANS clé dryRun : le tick est un dry-run (trace dryRun:true, aucun transport)", async () => {
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

test("dryRun:false SANS LWS_LIVE_SEND=1 : refus explicite (exit 2), rien n'avance ni ne part", async () => {
  const ws = seqWs({ dryRun: false })
  try {
    savior(ws, ORVANE)
    await seq(ws, ["enroll", ORVANE, "--now", "2026-10-24T08:00:00.000Z"])
    const before = ws.read("data/sequencer/state.json")
    const r = await seq(ws, ["tick", "--now", "2026-10-24T09:00:00.000Z"])
    assert.equal(r.code, 2)
    assert.match(r.stderr, /ENVOI RÉEL REFUSÉ/)
    assert.match(r.stderr, /LWS_LIVE_SEND=1/)
    assert.equal(ws.read("data/sequencer/state.json"), before, "l'état ne bouge pas")
    assert.equal(sendsRaw(ws), "", "aucune trace d'envoi")
  } finally { ws.cleanup() }
})

test("étape sans contenu → waiting-content, AUCUN placeholder tracé ; le contenu arrive → la séquence reprend", async () => {
  const ws = seqWs()
  try {
    await seq(ws, ["enroll", BRISANE, "--now", "2026-10-24T08:00:00.000Z"])
    const r1 = await seq(ws, ["tick", "--now", "2026-10-24T09:00:00.000Z"])
    assert.equal(r1.code, 0, r1.out)
    assert.match(r1.stdout, /tenue/)
    const s1 = state(ws)[0]
    assert.equal(s1.status, "waiting-content")
    assert.equal(s1.waiting.reason, "contenu")
    assert.equal(s1.step, 0)
    assert.equal(sendsRaw(ws), "")
    savior(ws, BRISANE) // le mail parfait est généré
    const r2 = await seq(ws, ["tick", "--now", "2026-10-24T10:00:00.000Z"])
    assert.equal(r2.code, 0, r2.out)
    const s2 = state(ws)[0]
    assert.equal(s2.status, "active")
    assert.equal(s2.step, 1)
    assert.equal(s2.waiting, undefined)
    assert.match(sendsRaw(ws), /mail-parfait/)
  } finally { ws.cleanup() }
})

test("un contenu qui n'est qu'un gabarit « [... à générer ...] » est traité comme absent", async () => {
  const ws = seqWs()
  try {
    ws.write(`data/savior/${ORVANE}.json`, JSON.stringify({ senderName: "x", subject: `[mail parfait à générer pour ${ORVANE}]`, body: "[pas encore généré]" }))
    await seq(ws, ["enroll", ORVANE, "--now", "2026-10-24T08:00:00.000Z"])
    await seq(ws, ["tick", "--now", "2026-10-24T09:00:00.000Z"])
    assert.equal(state(ws)[0].status, "waiting-content")
    assert.equal(sendsRaw(ws), "")
  } finally { ws.cleanup() }
})

test("prospect sans e-mail valide : étape tenue (destinataire), jamais d'envoi à un placeholder", async () => {
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

test("funnel complet en dry-run : J0 mail parfait → clic → démo perso TENUE (contenu absent), 0 ligne « [démo perso à générer »", async () => {
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
    assert.equal(raw.trim().split("\n").length, 1, "seul le mail parfait est tracé")
    const st = await seq(ws, ["status"])
    assert.match(st.stdout, /waiting-content/)
  } finally { ws.cleanup() }
})

test("sans clic après le mail parfait : l'escalade s'arrête (nurturing)", async () => {
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

test("`npm run sequencer` sans argument : usage, exit 1", async () => {
  const ws = seqWs()
  try {
    const r = await seq(ws, [])
    assert.equal(r.code, 1)
    assert.match(r.stderr, /usage : npm run sequencer/)
    assert.equal(existsSync(ws.path("data/sequencer/sends.jsonl")), false)
  } finally { ws.cleanup() }
})

test("aucune chaîne « 2 plaintes / plainte 1 / 6 étapes » dans le séquenceur (funnel honnête)", () => {
  const src = readFileSync(SEQ, "utf8")
  assert.doesNotMatch(src, /2 plaintes|plainte [12]|6 étapes|plainte-a|plainte-b/)
})
