/**
 * Sequencer with the shared database: the state goes to sequencer_state (visible from every machine) and
 * each SIMULATED email leaves a "dry-run" note in the CRM. Always in dry-run.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { freshDatabase } from "../helpers/pg.ts"
import { npmRun, tsx } from "../helpers/proc.ts"
import { makeWorkspace } from "../helpers/workspace.ts"
import { crowd } from "../helpers/crowd.ts"

const ID = "orvane-piscines-valmont-sur-lys"

test("enroll + tick with a database: state shared in the database, CRM note \"Email 1 written (test mode, not sent)\"", async () => {
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
    assert.ok(JSON.parse(crm[0].notes_json).some((n: any) => n.outcome === "mail" && /^Email 1 written \(test mode, not sent\): first email$/.test(n.text)))
    // the next email is scheduled inside the agency's sending hours (Mon–Fri 9:00–17:00, its clock)
    const next = Date.parse(st[0].data.nextRunAt)
    const w = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", hourCycle: "h23", weekday: "short", hour: "2-digit" }).format(next)
    assert.match(w, /^(Mon|Tue|Wed|Thu|Fri),? (09|1[0-6])$/, w)
  } finally { ws.cleanup(); await db.drop() }
})

test("TWO MACHINES on the same database tick at the same time (live, simulated transport): one send per prospect (lease in the database)", { timeout: 120_000 }, async () => {
  // blitz test of 24/10: the file lock does not see the other machine; only the `meta.sequencer.lock` lease does
  const db = await freshDatabase()
  const mk = () => {
    const ws = makeWorkspace({ seed: ["agency"] })
    const cfg = JSON.parse(ws.read("outreach/sequencer/config.json"))
    cfg.dryRun = false
    cfg.inboxes = { A: [], B: [{ email: "b1@agence.example", throttlePerDay: 40 }] }
    ws.write("outreach/sequencer/config.json", JSON.stringify(cfg))
    ws.write(`data/savior/${ID}.json`, JSON.stringify({ senderName: "Camille (fictive)", subject: "Une idée pour votre site", body: "Bonjour, voici l'aperçu." }))
    crowd(ws, 12) // 13 sends per tick: long enough for the two machines to overlap
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
    assert.equal(to.length, new Set(to).size, `one email per prospect (box: ${a.out.slice(-300)} | laptop: ${b.out.slice(-300)})`)
    assert.equal(to.length, ids.length)
    assert.equal((await db.sql`SELECT data FROM sequencer_state WHERE prospect_id = ${ID}`)[0].data.step, 1)
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM meta WHERE key = 'sequencer.lock'`)[0].n, 0, "lease released")
  } finally { box.cleanup(); laptop.cleanup(); await db.drop() }
})
