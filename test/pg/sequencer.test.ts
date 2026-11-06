/**
 * Séquenceur avec la base partagée : l'état part dans sequencer_state (visible de toutes les machines) et
 * chaque mail SIMULÉ laisse une note « dry-run » au CRM. Toujours en dry-run.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { freshDatabase } from "../helpers/pg.ts"
import { npmRun, tsx } from "../helpers/proc.ts"
import { makeWorkspace } from "../helpers/workspace.ts"
import { crowd } from "../helpers/crowd.ts"

const ID = "orvane-piscines-valmont-sur-lys"

test("enroll + tick avec base : état partagé en base, note CRM « mail simulé (dry-run) »", async () => {
  const db = await freshDatabase()
  const ws = makeWorkspace({ seed: ["agency"] })
  try {
    assert.equal((await npmRun(ws.dir, "db:init", [], { env: { DATABASE_URL: db.url, DB_SSL: "disable" } })).code, 0)
    const cfg = JSON.parse(ws.read("outreach/sequencer/config.json"))
    cfg.inboxes = { A: [], B: [{ email: "b1@agence.example", throttlePerDay: 8 }] }
    ws.write("outreach/sequencer/config.json", JSON.stringify(cfg))
    ws.write(`data/savior/${ID}.json`, JSON.stringify({ senderName: "Camille (fictive)", subject: "Une idée pour votre site", body: "Bonjour, voici l'aperçu." }))
    const env = { DATABASE_URL: db.url, DB_SSL: "disable" }
    assert.equal((await tsx(ws.dir, "outreach/scripts/sequencer.ts", ["enroll", ID, "--now", "2026-10-24T08:00:00.000Z"], { env })).code, 0)
    const r = await tsx(ws.dir, "outreach/scripts/sequencer.ts", ["tick", "--now", "2026-10-24T09:00:00.000Z"], { env })
    assert.equal(r.code, 0, r.out)
    const st = await db.sql`SELECT data FROM sequencer_state WHERE prospect_id = ${ID}`
    assert.equal(st.length, 1)
    assert.equal(st[0].data.step, 1)
    const crm = await db.sql`SELECT notes_json FROM crm_leads WHERE prospect_id = ${ID}`
    assert.ok(JSON.parse(crm[0].notes_json).some((n: any) => n.outcome === "mail" && /dry-run/.test(n.text)))
  } finally { ws.cleanup(); await db.drop() }
})

test("DEUX MACHINES sur la même base tiquent en même temps (réel, transport simulé) : un seul envoi par prospect (bail en base)", { timeout: 120_000 }, async () => {
  // test blitz du 24/10 : le verrou fichier ne voit pas l'autre machine ; seul le bail `meta.sequencer.lock` la voit
  const db = await freshDatabase()
  const mk = () => {
    const ws = makeWorkspace({ seed: ["agency"] })
    const cfg = JSON.parse(ws.read("outreach/sequencer/config.json"))
    cfg.dryRun = false
    cfg.inboxes = { A: [], B: [{ email: "b1@agence.example", throttlePerDay: 40 }] }
    ws.write("outreach/sequencer/config.json", JSON.stringify(cfg))
    ws.write(`data/savior/${ID}.json`, JSON.stringify({ senderName: "Camille (fictive)", subject: "Une idée pour votre site", body: "Bonjour, voici l'aperçu." }))
    crowd(ws, 12) // 13 envois par tick : assez long pour que les deux machines se chevauchent
    return ws
  }
  const box = mk(), laptop = mk()
  try {
    const env = { DATABASE_URL: db.url, DB_SSL: "disable", LWS_MAIL_TRANSPORT: "simulated", LWS_LIVE_SEND: "1", LWS_SIMULATED_DELAY_MS: "80" }
    assert.equal((await npmRun(box.dir, "db:init", [], { env })).code, 0)
    const ids = [ID, ...Array.from({ length: 12 }, (_, i) => `bassin-fictif-${String(i + 1).padStart(2, "0")}-valmont-sur-lys`)]
    assert.equal((await tsx(box.dir, "outreach/scripts/sequencer.ts", ["enroll", ids.join(","), "--now", "2026-10-24T08:00:00.000Z"], { env })).code, 0)
    const [a, b] = await Promise.all([box, laptop].map((ws) => tsx(ws.dir, "outreach/scripts/sequencer.ts", ["tick", "--now", "2026-10-24T09:00:00.000Z"], { env })))
    assert.equal(a.code, 0, a.out); assert.equal(b.code, 0, b.out)
    const sent = [box, laptop].flatMap((ws) => (ws.exists("data/sequencer/transport.jsonl") ? ws.read("data/sequencer/transport.jsonl").trim().split("\n") : []))
    const to = sent.map((l) => JSON.parse(l).to)
    assert.equal(to.length, new Set(to).size, `un seul mail par prospect (box : ${a.out.slice(-300)} | portable : ${b.out.slice(-300)})`)
    assert.equal(to.length, ids.length)
    assert.equal((await db.sql`SELECT data FROM sequencer_state WHERE prospect_id = ${ID}`)[0].data.step, 1)
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM meta WHERE key = 'sequencer.lock'`)[0].n, 0, "bail rendu")
  } finally { box.cleanup(); laptop.cleanup(); await db.drop() }
})
