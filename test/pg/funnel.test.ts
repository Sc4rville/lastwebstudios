/**
 * G11 + G12 + G13 (with a database): THE FILM'S WHOLE LOOP on a fresh Postgres, real processes, fictional data.
 *
 *   approved ✓ ⇒ Hot Lead · Call 0 ⇒ sequencer day 0 (perfect email, signed link) ⇒ click (event in outreach_events)
 *   ⇒ day 3 personal demo unlocked ⇒ reply (fake reader) ⇒ replied + Hot Lead (leaves nurturing) + `reply` outcome
 *   ⇒ meeting booked (meeting) ⇒ Signature (won); "lost" (lost) ⇒ data/outcomes.jsonl + database mirror
 *   ⇒ `npm run learn` on ANOTHER machine (no file) reads the database back and changes the trade's weight
 *   + STOP set from the cockpit (shared flag) ⇒ the box's sequencer does not tick; Machine view in database mode.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { rmSync } from "node:fs"
import { freshDatabase } from "../helpers/pg.ts"
import { npmRun, tsx } from "../helpers/proc.ts"
import { makeWorkspace, type Workspace } from "../helpers/workspace.ts"
import { startCockpit } from "../helpers/cockpit.ts"
import { freePort, type Proc } from "../helpers/server.ts"

const ORVANE = "orvane-piscines-valmont-sur-lys", O_DATE = "2026-10-20-composer"
const BRISANE = "atelier-brisane-menuiserie-sornac-le-haut", B_DATE = "2026-10-18"
const SECRET = "secret-de-test-fictif-pg-funnel-0123456789abcdef"
let db: Awaited<ReturnType<typeof freshDatabase>>, ws: Workspace, cockpit: Proc, base = ""
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const dbEnv = () => ({ DATABASE_URL: db.url, DB_SSL: "disable", TRACK_BASE: base, LWS_TRACK_SECRET: SECRET, LWS_REPLY_READER: "file", LWS_MAIL_TRANSPORT: "simulated" })
const seq = (args: string[]) => tsx(ws.dir, "outreach/scripts/sequencer.ts", args, { env: dbEnv() })
const api = async (path: string, body?: unknown) => {
  const r = await fetch(cockpit.url + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  const text = await r.text(); let json: any = null; try { json = JSON.parse(text) } catch { /* */ }
  return { status: r.status, json }
}

before(async () => {
  db = await freshDatabase()
  ws = makeWorkspace({ seed: ["agency", "machine"] })
  const cfg = JSON.parse(ws.read("outreach/sequencer/config.json"))
  cfg.inboxes = { A: [{ email: "a1@agence.example", throttlePerDay: 8 }], B: [{ email: "b1@agence.example", throttlePerDay: 8 }] }
  ws.write("outreach/sequencer/config.json", JSON.stringify(cfg, null, 2))
  const mail = (subject: string, link: string) => JSON.stringify({ senderName: "Camille (fictive)", subject, body: `Bonjour,\n\nL'aperçu : ${link}\n\nCamille` })
  ws.write(`data/savior/${ORVANE}.json`, mail("Une idée pour votre site", "https://demo.agence.example/orvane/"))
  ws.write(`data/demo/${ORVANE}.json`, mail("La démo de votre nouveau site", "https://demo.agence.example/orvane/video"))
  ws.write(`data/savior/${BRISANE}.json`, mail("Une idée pour votre atelier", "https://demo.agence.example/brisane/"))
  assert.equal((await npmRun(ws.dir, "db:init", [], { env: { DATABASE_URL: db.url, DB_SSL: "disable" } })).code, 0)
  const port = await freePort(); base = `http://127.0.0.1:${port}`
  cockpit = await startCockpit(ws.dir, { DATABASE_URL: db.url, DB_SSL: "disable", LWS_TRACK_SECRET: SECRET }, { port })
  for (let i = 0; i < 300 && !/Indexed →/.test(cockpit.output()); i++) await sleep(100)
})
after(async () => { await cockpit?.stop(); ws?.cleanup(); await db?.drop() })

test("approved ⇒ day-0 sequence: the perfect email goes out (dry-run) with a signed link; the state is in the shared database", async () => {
  for (const [id, date] of [[ORVANE, O_DATE], [BRISANE, B_DATE]]) assert.equal((await api("/api/status", { id, date, status: "approved" })).status, 200)
  const crm = (await api("/api/crm")).json
  assert.deepEqual(crm.hot.call0.map((l: any) => l.id).sort(), [BRISANE, ORVANE])
  assert.equal((await seq(["enroll", `${ORVANE},${BRISANE}`, "--now", "2026-10-24T08:00:00.000Z"])).code, 0)
  const j0 = await seq(["tick", "--now", "2026-10-24T09:00:00.000Z"])
  assert.equal(j0.code, 0, j0.out)
  assert.match(j0.stdout, /2 tracked link\(s\)|1 tracked link\(s\)/)
  const rows = await db.sql`SELECT prospect_id, data FROM sequencer_state ORDER BY prospect_id`
  assert.equal(rows.length, 2)
  assert.equal(rows.find((r) => r.prospect_id === ORVANE)!.data.step, 1)
})

test("the click (link from the .eml) ⇒ 302 + event in outreach_events; day 3: personal demo UNLOCKED, the CRM notes it", async () => {
  const { readdirSync } = await import("node:fs")
  const sends = ws.read("data/sequencer/sends.jsonl").trim().split("\n").map((l) => JSON.parse(l))
  const s = sends.find((x) => x.prospectId === ORVANE)
  const file = readdirSync(ws.path("data/sequencer/outbox")).find((f) => f.includes(s.trackingId))!
  const raw = ws.read(`data/sequencer/outbox/${file}`)
  const text = Buffer.from(raw.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8")
  const link = text.match(new RegExp(`${base}/t/c/[A-Za-z0-9_.-]+[A-Za-z0-9_-]`))![0]
  const r = await fetch(link, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/133.0" } })
  assert.equal(r.status, 302)
  assert.equal(r.headers.get("location"), "https://demo.agence.example/orvane/")
  const ev = await db.sql`SELECT tracking_id, type, suspect, source FROM outreach_events`
  assert.deepEqual(ev.map((e) => ({ ...e })), [{ tracking_id: s.trackingId, type: "click", suspect: 0, source: "track" }])
  assert.equal(ws.exists("data/sequencer/events.jsonl"), false, "with a database: nothing in the fallback file")
  await db.sql`UPDATE outreach_events SET at = ${Date.parse("2026-10-25T11:00:00.000Z")}` // the click, on the simulated clock
  const j3 = await seq(["tick", "--now", "2026-10-27T09:30:00.000Z"])
  assert.match(j3.stdout, /DRY-RUN → \[demo-perso\]/, j3.out)
  assert.match(j3.stdout, /⏹  atelier-brisane.* no click on the previous email → escalation stopped \(nurturing\)/)
  const notes = JSON.parse((await db.sql`SELECT notes_json FROM crm_leads WHERE prospect_id = ${ORVANE}`)[0].notes_json)
  assert.ok(notes.some((n: any) => n.outcome === "mail" && /^Clicked the link in the email$/.test(n.text)), JSON.stringify(notes))
})

test("replies (fake reader) ⇒ replied + Hot Lead: a lead in nurturing comes back to Call 0; `reply` outcome in the file AND the database", async () => {
  // Brisane: sequence frozen in nurturing, CRM card moved to nurturing by the operator
  assert.equal((await api("/api/crm/stage", { id: BRISANE, pipeline: "hot", stage: "nurturing" })).status, 200)
  // the sequencer only reads live sequences: Brisane's is reactivated (the "late reply to email 1" case)
  const st = (await db.sql`SELECT data FROM sequencer_state WHERE prospect_id = ${BRISANE}`)[0].data
  st.status = "active"; st.nextRunAt = "2026-11-30T00:00:00.000Z"
  await db.sql`UPDATE sequencer_state SET data = ${db.sql.json(st)} WHERE prospect_id = ${BRISANE}`
  ws.write("data/sequencer/inbox.jsonl", [
    { inbox: "b1@agence.example", id: "r1", from: "contact@orvane-piscines.example", subject: "Re: La démo de votre nouveau site", text: "Superbe. Appelez-moi.", at: "2026-10-28T10:00:00.000Z" },
    { inbox: "b1@agence.example", id: "r2", from: "bonjour@atelier-brisane.example", subject: "Re: Une idée pour votre atelier", text: "Finalement oui, rappelez-moi.", at: "2026-10-28T10:30:00.000Z" },
  ].map((m) => JSON.stringify(m)).join("\n") + "\n")
  const j4 = await seq(["tick", "--now", "2026-10-28T11:00:00.000Z"])
  assert.match(j4.stdout, /📬 events: 0 click\(s\), 2 reply\(ies\)/, j4.out)
  const states = await db.sql`SELECT prospect_id, data->>'status' AS status FROM sequencer_state ORDER BY prospect_id`
  assert.deepEqual(states.map((r) => r.status), ["replied", "replied"])
  const crm = (await api("/api/crm")).json
  assert.ok(crm.hot.call0.some((l: any) => l.id === BRISANE && l.mail.status === "replied"), "out of nurturing, at the top: Call 0")
  const out = ws.read("data/outcomes.jsonl").trim().split("\n").map((l) => JSON.parse(l))
  assert.deepEqual(out.map((o) => o.outcome), ["reply", "reply"])
  assert.equal(Number((await db.sql`SELECT COUNT(*)::int AS n FROM outreach_events WHERE type = 'outcome'`)[0].n), 2)
  assert.equal(Number((await db.sql`SELECT COUNT(*)::int AS n FROM outreach_events WHERE type = 'reply' AND source = 'reader'`)[0].n), 2)
})

test("CRM: meeting booked ⇒ meeting, Signature ⇒ won (only once), lost ⇒ Lost (off the board); everything goes to learning", async () => {
  const rdv = await api("/api/crm/outcome", { id: ORVANE, outcome: "rdv", rdvAt: Date.parse("2026-10-30T09:00:00.000Z"), note: "démo jeudi" })
  assert.deepEqual(rdv.json, { ok: true, learned: { outcome: "meeting", recorded: true } })
  for (const stage of ["propal", "nego", "signature"]) assert.equal((await api("/api/crm/stage", { id: ORVANE, pipeline: "closing", stage })).status, 200)
  const again = await api("/api/crm/stage", { id: ORVANE, pipeline: "closing", stage: "signature" })
  assert.deepEqual(again.json.learned, { outcome: "won", recorded: false }, "dropping it in Signature again does not count twice")
  const lost = await api("/api/crm/outcome", { id: BRISANE, outcome: "lost", note: "a choisi un concurrent" })
  assert.deepEqual(lost.json, { ok: true, learned: { outcome: "lost", recorded: true } })
  const crm = (await api("/api/crm")).json
  assert.ok(crm.closing.signature.some((l: any) => l.id === ORVANE))
  // lost is its own place (audits 2026-11-06) : out of the call steps, Nurturing included
  const b = crm.lost.find((l: any) => l.id === BRISANE)
  assert.ok(b && b.stage === "lost", "lost → Lost, off the board")
  assert.ok(!Object.values(crm.hot).flat().some((l: any) => l.id === BRISANE), "never in Nurturing")
  assert.equal(b.lastNote.outcome, "lost"); assert.equal(b.lastNote.text, "a choisi un concurrent")
  const out = ws.read("data/outcomes.jsonl").trim().split("\n").map((l) => JSON.parse(l))
  assert.deepEqual(out.map((o) => `${o.id.split("-")[0]}:${o.outcome}`), ["orvane:reply", "atelier:reply", "orvane:meeting", "orvane:won", "atelier:lost"])
  assert.equal(Number((await db.sql`SELECT COUNT(*)::int AS n FROM outreach_events WHERE type = 'outcome'`)[0].n), 5)
})

test("npm run learn on another machine (no file): reads the 5 outcomes back from the database, the gate changes", async () => {
  rmSync(ws.path("data/outcomes.jsonl"))
  const r = await npmRun(ws.dir, "learn", [], { env: { DATABASE_URL: db.url, DB_SSL: "disable" } })
  assert.equal(r.code, 0, r.out)
  assert.match(r.stdout, /\+ 5 outcome\(s\) read from the database/)
  assert.match(r.stdout, /rules recomputed from 5 outcome\(s\)/)
  const rules = ws.json("learning/rules/rules.json")
  assert.ok(rules.industries.pisciniste.value > 0, JSON.stringify(rules.industries))
  assert.ok(rules.industries.menuisier.value < 0, JSON.stringify(rules.industries))
})

test("Machine view in database mode: the 7 stages have a non-zero counter and a latest event", async () => {
  const mx = (await api("/api/machine")).json
  assert.equal(mx.source, "db")
  assert.deepEqual(mx.stages.map((s: any) => s.key), ["find", "score", "extract", "build", "judge", "sell", "learn"])
  for (const s of mx.stages) { assert.ok(s.count > 0, `${s.key} = 0 (${s.note || ""})`); assert.ok(s.last?.at, `${s.key} without a latest event`) }
  const judge = mx.stages.find((s: any) => s.key === "judge")
  assert.equal(judge.count, 2); assert.equal(judge.unit, "approved")
  assert.ok(mx.feed.length >= 7)
  assert.equal(mx.cage.breaker.open, false)
})

test("STOP set from the cockpit (flag in the database): another machine's sequencer does not tick; \"resume\" lifts it", async () => {
  const on = await api("/api/cage/stop", { on: true, reason: "incident délivrabilité" })
  assert.equal(on.json.stop.source, "cockpit")
  assert.equal(ws.exists("STOP"), false, "with a database: a shared flag, no local file")
  const r = await seq(["tick", "--now", "2026-10-29T09:00:00.000Z"])
  assert.match(r.stdout, /⏹ STOP \(cockpit: incident délivrabilité\): the sequencer does not tick/)
  assert.deepEqual((await api("/api/cage")).json.alerts, ["stop"])
  assert.equal((await api("/api/cage/stop", { on: false })).json.stop.on, false)
  assert.doesNotMatch((await seq(["tick", "--now", "2026-10-29T09:00:00.000Z"])).stdout, /⏹ STOP/)
  const meta = await db.sql`SELECT key FROM meta WHERE key IN ('cage.stop', 'sequencer.breaker') ORDER BY key`
  assert.deepEqual(meta.map((m) => m.key), ["cage.stop", "sequencer.breaker"], "the circuit breaker is shared too")
})
