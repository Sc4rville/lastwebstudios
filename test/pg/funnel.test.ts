/**
 * G11 + G12 + G13 (avec base) : LA BOUCLE COMPLÈTE DU FILM sur un Postgres neuf, process réels, données fictives.
 *
 *   approuvé ✓ ⇒ Hot Lead · Call 0 ⇒ séquenceur J0 (mail parfait, lien signé) ⇒ clic (évènement dans outreach_events)
 *   ⇒ J+3 démo perso débloquée ⇒ réponse (faux lecteur) ⇒ replied + Hot Lead (sort du nurturing) + issue `reply`
 *   ⇒ RDV calé (meeting) ⇒ Signature (won) ; « perdu » (lost) ⇒ data/outcomes.jsonl + miroir base
 *   ⇒ `npm run learn` sur une AUTRE machine (pas de fichier) relit la base et change le poids du métier
 *   + STOP posé depuis le cockpit (drapeau partagé) ⇒ le séquenceur de la box ne tick pas ; vue Machine en mode base.
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
  for (let i = 0; i < 300 && !/index DB →/.test(cockpit.output()); i++) await sleep(100)
})
after(async () => { await cockpit?.stop(); ws?.cleanup(); await db?.drop() })

test("approuvé ⇒ séquence J0 : le mail parfait part (dry-run) avec un lien signé ; l'état est dans la base partagée", async () => {
  for (const [id, date] of [[ORVANE, O_DATE], [BRISANE, B_DATE]]) assert.equal((await api("/api/status", { id, date, status: "approved" })).status, 200)
  const crm = (await api("/api/crm")).json
  assert.deepEqual(crm.hot.call0.map((l: any) => l.id).sort(), [BRISANE, ORVANE])
  assert.equal((await seq(["enroll", `${ORVANE},${BRISANE}`, "--now", "2026-10-24T08:00:00.000Z"])).code, 0)
  const j0 = await seq(["tick", "--now", "2026-10-24T09:00:00.000Z"])
  assert.equal(j0.code, 0, j0.out)
  assert.match(j0.stdout, /2 lien\(s\)|1 lien\(s\) suivi\(s\)/)
  const rows = await db.sql`SELECT prospect_id, data FROM sequencer_state ORDER BY prospect_id`
  assert.equal(rows.length, 2)
  assert.equal(rows.find((r) => r.prospect_id === ORVANE)!.data.step, 1)
})

test("le clic (lien du .eml) ⇒ 302 + évènement dans outreach_events ; J+3 : démo perso DÉBLOQUÉE, le CRM le note", async () => {
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
  assert.equal(ws.exists("data/sequencer/events.jsonl"), false, "avec une base : rien dans le fichier de repli")
  await db.sql`UPDATE outreach_events SET at = ${Date.parse("2026-10-25T11:00:00.000Z")}` // le clic, à l'horloge simulée
  const j3 = await seq(["tick", "--now", "2026-10-27T09:30:00.000Z"])
  assert.match(j3.stdout, /DRY-RUN → \[demo-perso\]/, j3.out)
  assert.match(j3.stdout, /⏹  atelier-brisane.* pas de clic sur le mail précédent → escalade stoppée \(nurturing\)/)
  const notes = JSON.parse((await db.sql`SELECT notes_json FROM crm_leads WHERE prospect_id = ${ORVANE}`)[0].notes_json)
  assert.ok(notes.some((n: any) => n.outcome === "mail" && /a cliqué \(tracking\)/.test(n.text)), JSON.stringify(notes))
})

test("réponses (faux lecteur) ⇒ replied + Hot Lead : un lead en nurturing revient en Call 0 ; issue `reply` en fichier ET en base", async () => {
  // Brisane : séquence gelée en nurturing, carte CRM déplacée en nurturing par l'opérateur
  assert.equal((await api("/api/crm/stage", { id: BRISANE, pipeline: "hot", stage: "nurturing" })).status, 200)
  // le séquenceur ne relit que les séquences vivantes : on réactive celle de Brisane (cas « réponse tardive au mail 1 »)
  const st = (await db.sql`SELECT data FROM sequencer_state WHERE prospect_id = ${BRISANE}`)[0].data
  st.status = "active"; st.nextRunAt = "2026-11-30T00:00:00.000Z"
  await db.sql`UPDATE sequencer_state SET data = ${db.sql.json(st)} WHERE prospect_id = ${BRISANE}`
  ws.write("data/sequencer/inbox.jsonl", [
    { inbox: "b1@agence.example", id: "r1", from: "contact@orvane-piscines.example", subject: "Re: La démo de votre nouveau site", text: "Superbe. Appelez-moi.", at: "2026-10-28T10:00:00.000Z" },
    { inbox: "b1@agence.example", id: "r2", from: "bonjour@atelier-brisane.example", subject: "Re: Une idée pour votre atelier", text: "Finalement oui, rappelez-moi.", at: "2026-10-28T10:30:00.000Z" },
  ].map((m) => JSON.stringify(m)).join("\n") + "\n")
  const j4 = await seq(["tick", "--now", "2026-10-28T11:00:00.000Z"])
  assert.match(j4.stdout, /📬 évènements : 0 clic\(s\), 2 réponse\(s\)/, j4.out)
  const states = await db.sql`SELECT prospect_id, data->>'status' AS status FROM sequencer_state ORDER BY prospect_id`
  assert.deepEqual(states.map((r) => r.status), ["replied", "replied"])
  const crm = (await api("/api/crm")).json
  assert.ok(crm.hot.call0.some((l: any) => l.id === BRISANE && l.mail.status === "replied"), "sorti du nurturing, en tête : Call 0")
  const out = ws.read("data/outcomes.jsonl").trim().split("\n").map((l) => JSON.parse(l))
  assert.deepEqual(out.map((o) => o.outcome), ["reply", "reply"])
  assert.equal(Number((await db.sql`SELECT COUNT(*)::int AS n FROM outreach_events WHERE type = 'outcome'`)[0].n), 2)
  assert.equal(Number((await db.sql`SELECT COUNT(*)::int AS n FROM outreach_events WHERE type = 'reply' AND source = 'reader'`)[0].n), 2)
})

test("CRM : RDV calé ⇒ meeting, Signature ⇒ won (une seule fois), perdu ⇒ lost + nurturing ; tout part au learning", async () => {
  const rdv = await api("/api/crm/outcome", { id: ORVANE, outcome: "rdv", rdvAt: Date.parse("2026-10-30T09:00:00.000Z"), note: "démo jeudi" })
  assert.deepEqual(rdv.json, { ok: true, learned: { outcome: "meeting", recorded: true } })
  for (const stage of ["propal", "nego", "signature"]) assert.equal((await api("/api/crm/stage", { id: ORVANE, pipeline: "closing", stage })).status, 200)
  const again = await api("/api/crm/stage", { id: ORVANE, pipeline: "closing", stage: "signature" })
  assert.deepEqual(again.json.learned, { outcome: "won", recorded: false }, "re-poser en Signature ne recompte pas")
  const lost = await api("/api/crm/outcome", { id: BRISANE, outcome: "lost", note: "a choisi un concurrent" })
  assert.deepEqual(lost.json, { ok: true, learned: { outcome: "lost", recorded: true } })
  const crm = (await api("/api/crm")).json
  assert.ok(crm.closing.signature.some((l: any) => l.id === ORVANE))
  const b = crm.hot.nurturing.find((l: any) => l.id === BRISANE)
  assert.ok(b && b.nurturingUntil > Date.now(), "perdu → nurturing (re-contact léger)")
  assert.equal(b.lastNote.outcome, "lost"); assert.equal(b.lastNote.text, "a choisi un concurrent")
  const out = ws.read("data/outcomes.jsonl").trim().split("\n").map((l) => JSON.parse(l))
  assert.deepEqual(out.map((o) => `${o.id.split("-")[0]}:${o.outcome}`), ["orvane:reply", "atelier:reply", "orvane:meeting", "orvane:won", "atelier:lost"])
  assert.equal(Number((await db.sql`SELECT COUNT(*)::int AS n FROM outreach_events WHERE type = 'outcome'`)[0].n), 5)
})

test("npm run learn sur une autre machine (pas de fichier) : relit les 5 issues dans la base, la porte change", async () => {
  rmSync(ws.path("data/outcomes.jsonl"))
  const r = await npmRun(ws.dir, "learn", [], { env: { DATABASE_URL: db.url, DB_SSL: "disable" } })
  assert.equal(r.code, 0, r.out)
  assert.match(r.stdout, /\+ 5 retour\(s\) lus dans la base/)
  assert.match(r.stdout, /règles recalculées depuis 5 retour\(s\)/)
  const rules = ws.json("learning/rules/rules.json")
  assert.ok(rules.industries.pisciniste.value > 0, JSON.stringify(rules.industries))
  assert.ok(rules.industries.menuisier.value < 0, JSON.stringify(rules.industries))
})

test("vue Machine en mode base : les 7 étages ont un compteur non nul et un dernier évènement", async () => {
  const mx = (await api("/api/machine")).json
  assert.equal(mx.source, "db")
  assert.deepEqual(mx.stages.map((s: any) => s.key), ["find", "score", "extract", "build", "judge", "sell", "learn"])
  for (const s of mx.stages) { assert.ok(s.count > 0, `${s.key} = 0 (${s.note || ""})`); assert.ok(s.last?.at, `${s.key} sans dernier évènement`) }
  const judge = mx.stages.find((s: any) => s.key === "judge")
  assert.equal(judge.count, 2); assert.equal(judge.unit, "approuvés")
  assert.ok(mx.feed.length >= 7)
  assert.equal(mx.cage.breaker.open, false)
})

test("STOP posé depuis le cockpit (drapeau en base) : le séquenceur d'une autre machine ne tick pas ; « reprendre » le lève", async () => {
  const on = await api("/api/cage/stop", { on: true, reason: "incident délivrabilité" })
  assert.equal(on.json.stop.source, "cockpit")
  assert.equal(ws.exists("STOP"), false, "avec une base : drapeau partagé, pas de fichier local")
  const r = await seq(["tick", "--now", "2026-10-29T09:00:00.000Z"])
  assert.match(r.stdout, /⏹ STOP \(cockpit : incident délivrabilité\) : le séquenceur ne tick pas/)
  assert.deepEqual((await api("/api/cage")).json.alerts, ["stop"])
  assert.equal((await api("/api/cage/stop", { on: false })).json.stop.on, false)
  assert.doesNotMatch((await seq(["tick", "--now", "2026-10-29T09:00:00.000Z"])).stdout, /⏹ STOP/)
  const meta = await db.sql`SELECT key FROM meta WHERE key IN ('cage.stop', 'sequencer.breaker') ORDER BY key`
  assert.deepEqual(meta.map((m) => m.key), ["cage.stop", "sequencer.breaker"], "le disjoncteur aussi est partagé")
})
