/**
 * G2 / F-5 : le warmup n'envoie RIEN sans LWS_LIVE_SEND=1 (ni envoi, ni réponse, ni rescue Gmail, ni journal)
 * et le compte rendu exige DIGEST_TO (aucun destinataire par défaut, jamais l'adresse d'un mainteneur).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { tsx } from "../helpers/proc.ts"
import { makeWorkspace, type Workspace } from "../helpers/workspace.ts"

const W = "outreach/scripts/warmup.ts"
function wws(): Workspace {
  const ws = makeWorkspace()
  const cfg = JSON.parse(ws.read("outreach/sequencer/config.json"))
  cfg.inboxes = { A: [{ email: "a1@agence.example", throttlePerDay: 8 }], B: [{ email: "b1@agence.example", throttlePerDay: 8 }, { email: "b2@agence.example", throttlePerDay: 8 }] }
  ws.write("outreach/sequencer/config.json", JSON.stringify(cfg))
  return ws
}

test("`npm run warmup` sans argument : dry-run annoncé, rien n'est envoyé ni écrit", async () => {
  const ws = wws()
  try {
    const r = await tsx(ws.dir, W)
    assert.equal(r.code, 0, r.out)
    assert.match(r.stdout, /DRY-RUN/)
    assert.match(r.stdout, /aucun mail ne part/)
    assert.match(r.stdout, /envois simulés/)
    assert.equal(ws.exists("data/warmup"), false, "ni journal ni état écrits en dry-run")
  } finally { ws.cleanup() }
})

test("digest sans DIGEST_TO : refus clair, aucun destinataire par défaut", async () => {
  const ws = wws()
  try {
    const r = await tsx(ws.dir, W, ["digest"])
    assert.equal(r.code, 1)
    assert.match(r.stderr, /DIGEST_TO manquant/)
  } finally { ws.cleanup() }
})

test("digest avec DIGEST_TO en dry-run : dit à qui il l'aurait envoyé, n'envoie pas", async () => {
  const ws = wws()
  try {
    const r = await tsx(ws.dir, W, ["digest"], { env: { DIGEST_TO: "ops@agence.example" } })
    assert.equal(r.code, 0, r.out)
    assert.match(r.stdout, /NON envoyé \(dry-run\) : destinataire ops@agence\.example/)
    assert.match(r.stdout, /DRY-RUN : b1@agence\.example → ops@agence\.example/)
  } finally { ws.cleanup() }
})

test("`once` sans LWS_LIVE_SEND : rien n'est envoyé", async () => {
  const ws = wws()
  try {
    const r = await tsx(ws.dir, W, ["once", "a1@agence.example", "b1@agence.example"])
    assert.equal(r.code, 0, r.out)
    assert.match(r.stdout, /rien envoyé \(dry-run\)/)
  } finally { ws.cleanup() }
})

test("commande inconnue : usage, exit 1", async () => {
  const ws = wws()
  try {
    const r = await tsx(ws.dir, W, ["envoie-tout"])
    assert.equal(r.code, 1)
    assert.match(r.stderr, /usage : npm run warmup/)
  } finally { ws.cleanup() }
})

test("aucune adresse personnelle ni boîte en dur comme destinataire/expéditeur du digest", () => {
  const src = readFileSync(W, "utf8")
  const digest = src.slice(src.indexOf("async function digest"), src.indexOf("async function status"))
  assert.doesNotMatch(digest, /@[a-z0-9-]+\.(com|fr|net|org)"/i)
  assert.doesNotMatch(src, /gmail\.com"/)
})

test("warmup RÉEL (transport simulé) : deux ticks simultanés ne dépassent pas la cible du jour (verrou), rescue Gmail sauté", { timeout: 90_000 }, async () => {
  // test blitz du 24/10 : deux ticks lisaient le même journal et doublaient les envois du jour (rampe dépassée)
  const ws = wws()
  try {
    const env = { LWS_LIVE_SEND: "1", LWS_MAIL_TRANSPORT: "simulated", LWS_SIMULATED_DELAY_MS: "150" }
    const [a, b] = await Promise.all([tsx(ws.dir, W, ["tick"], { env }), tsx(ws.dir, W, ["tick"], { env })])
    assert.equal(a.code, 0, a.out); assert.equal(b.code, 0, b.out)
    const log = ws.read("data/warmup/log.jsonl").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "send")
    const perBox = new Map<string, number>()
    for (const e of log) perBox.set(e.from, (perBox.get(e.from) || 0) + 1)
    assert.ok([...perBox.values()].every((n) => n <= 2), `jour 1, cible 2 par boîte : ${JSON.stringify([...perBox])}`)
    const sent = ws.read("data/sequencer/transport.jsonl").trim().split("\n").length
    assert.equal(sent, log.length + ws.read("data/warmup/log.jsonl").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "reply").length, "chaque envoi journalisé est passé par le transport")
    assert.ok(sent <= 6, `${sent} mails pour 3 boîtes × 2`)
    assert.doesNotMatch(a.out + b.out, /rescue|sa-key/, "pas de rescue Gmail sur le transport simulé")
    assert.equal(ws.exists("data/warmup/.lock"), false, "verrou rendu")
  } finally { ws.cleanup() }
})
