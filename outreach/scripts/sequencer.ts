/**
 * sequencer.ts · the cold email SEQUENCER: plays the funnel on its own, and closes the film's loops.
 *
 * HONEST funnel (4 steps, see outreach/sequencer/config.json; the fake complaint emails are gone):
 *   mail-parfait → [click] demo-perso → [click] article-seo → [click] contenu
 * A reply at any step → stop (replied) + Hot Lead. At a GATED step ("clicked"), if the prospect has not
 * clicked since the previous email → escalation stopped (nurturing). Mailbox rotation + throttle (anti-spam).
 *
 * REAL SENDING = TWO KEYS, otherwise DRY-RUN (fail-closed):
 *   1. `outreach/sequencer/config.json` says `"dryRun": false` (missing, a typo, any other value → dry-run)
 *   2. the environment has `LWS_LIVE_SEND=1`
 * `dryRun:false` without `LWS_LIVE_SEND=1` → an EXPLICIT refusal (exit code 2, nothing moves). In dry-run, the tick writes
 * the COMPLETE message that would go out (signed links, unsubscribe headers) to data/sequencer/outbox/*.eml and
 * logs it in data/sequencer/sends.jsonl (dryRun:true). No call to the mail transport.
 *
 * MISSING CONTENT = STEP HELD, never a placeholder: if a step's email (data/<source>/<id>.json)
 * does not exist yet, or if the prospect has no email address, the sequence goes to `waiting-content` and resumes
 * on its own at the tick after the content arrives. Nothing is sent or logged in the meantime.
 *
 * ONE TICK, IN ORDER:
 *   0. STOP (the `STOP` file or the cockpit's button) → the tick does NOTHING (see packages/shared/cage.ts)
 *   1. reply reader (LWS_REPLY_READER = gmail | file | none, see lib/replies.ts) → events
 *   2. events (the cockpit's /t/ tracking, the reader, the CLI; see outreach/tracking/events.ts) → state:
 *      click → unlocks the escalation · reply → replied + Hot Lead + learning · unsubscribe / bounce /
 *      complaint → the prospect exits
 *   3. circuit breaker (thresholds of docs/funnel-strategy.md §6, see packages/shared/breaker.ts): open → no sending
 *   4. sends that are due (throttle per mailbox and per day, optional `perTickPerInbox`)
 *
 * CLI:
 *   npm run sequencer -- enroll <id|id1,id2,...>   enrolls prospects (needs their record data/prospects/<id>.json)
 *   npm run sequencer -- tick [--now <ISO>]        one tick (--now simulates the time)
 *   (enroll NEVER enrolls again someone who unsubscribed or complained; nor a bouncing address while the record keeps it;
 *    nor a prospect who replied, except with --force)
 *   npm run sequencer -- click <id> [--now <ISO>]  the prospect clicked (by hand) → unlocks the escalation
 *   npm run sequencer -- reply <id>                the prospect replied (by hand) → stops, Hot Lead
 *   npm run sequencer -- drop <id>                 blocked / spam / STOP → takes the prospect out
 *   npm run sequencer -- bounce <id> | complaint <id>   dead address / spam complaint → out + counted by the breaker
 *   npm run sequencer -- breaker [reset]           the circuit breaker's state; `reset` = a human re-arms it
 *   npm run sequencer -- stop <id> <reason>        the owner's own act stops the emails (reason: meeting | won | lost |
 *                                                  skipped | manual) : status « stopped », the reason kept and shown
 *   npm run sequencer -- status                    prints the state
 *
 * SENDING HOURS : a next email is scheduled inside the agency's sending window (default Mon–Fri 9:00–17:00, its time
 * zone ; agency.config.json › mail.sendHours, cf. ./lib/window.ts), never at 1:20 in the night.
 *
 * Only one command that writes the state at a time (lock data/sequencer/.lock + lease `meta.sequencer.lock` in the database):
 * the second one waits (LWS_SEQ_LOCK_WAIT_MS, default 3 min) then exits with code 75 having done nothing.
 */
import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import { tryDb, closeDb } from "../../packages/shared/db.ts"
import { stopState, loadBreaker, saveBreaker } from "../../packages/shared/cage.ts"
import { evaluateBreaker, resetBreaker, type BreakerThresholds } from "../../packages/shared/breaker.ts"
import { readEvents, recordEvent, stableId, type OutreachEvent } from "../tracking/events.ts"
import { buildMessage, sendMail, type BuiltMessage } from "./lib/smtp.ts"
import { selectReader, classifyInbound, type ReplyReader } from "./lib/replies.ts"
import { recordOutcome } from "../../learning/scripts/record.ts"
import { agency } from "../../packages/shared/agency.mjs"
import { acquireLock } from "../../packages/shared/lock.ts"
import { trackConfig } from "../tracking/links.ts"
import { optOuts } from "./lib/optout.ts"
import { scheduleIso, sendWindow } from "./lib/window.ts"

const CONFIG = "outreach/sequencer/config.json"
const STATE = "data/sequencer/state.json"
const SENDS = "data/sequencer/sends.jsonl"
const OUTBOX = "data/sequencer/outbox"
const CURSOR = "data/sequencer/reader.json"
const PROSPECTS = "data/prospects"
const PERSONAS = "data/personas"
// where to read the email for a step's source (persona:* is handled separately)
const SOURCE_DIR: Record<string, string> = { savior: "data/savior", demo: "data/demo", seo: "data/seo", contenu: "data/contenu" }
const SOURCE_LABEL: Record<string, string> = { savior: "first email", demo: "personal demo", seo: "SEO article", contenu: "personal content" }
// a "click" less than 60 s after the send = the recipient's mail gateway scanning the links
const SCANNER_WINDOW_MS = 60_000

type Step = { id: string; pool: "A" | "B"; delayDays: number; source: string; gate?: "clicked" }
type Inbox = { email: string; throttlePerDay: number }
type Config = { dryRun?: unknown; steps: Step[]; inboxes: { A: Inbox[]; B: Inbox[] }; perTickPerInbox?: number; breaker?: Partial<BreakerThresholds> }
type Send = { prospectId: string; step: string; pool: string; inbox: string; to: string; subject: string; at: string; dryRun: boolean; trackingId: string; tracked?: boolean; links?: number }
type Status = "active" | "waiting-content" | "done" | "dropped" | "replied" | "nurturing" | "stopped"
/** why the owner stopped a sequence (the card says « Emails stopped: meeting booked ») */
export const STOP_REASONS = ["meeting", "won", "lost", "skipped", "manual"] as const
type Waiting = { step: string; reason: "contenu" | "destinataire"; detail: string; since: string }
type Seq = {
  prospectId: string; step: number; status: Status; enrolledAt: string; nextRunAt: string; clicks: string[]
  sends: { step: string; inbox: string; at: string; trackingId?: string }[]; waiting?: Waiting
  stoppedBy?: { type: string; at: string }
}

/** A sequence still "alive" (it can still send): active, or held for lack of content. */
const isLive = (s: Seq) => s.status === "active" || s.status === "waiting-content"

/**
 * Sending mode, FAIL-CLOSED. Real only if config.dryRun === false (strict boolean) AND LWS_LIVE_SEND=1.
 * `refused` = the operator asked for real sending in the config but the environment does not confirm it.
 */
export function sendMode(cfg: Pick<Config, "dryRun">, env: NodeJS.ProcessEnv = process.env): { live: boolean; refused: boolean } {
  const wantsLive = cfg.dryRun === false
  const envOk = env.LWS_LIVE_SEND === "1"
  return { live: wantsLive && envOk, refused: wantsLive && !envOk }
}

const flag = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined }
const dayKey = (iso: string) => iso.slice(0, 10)
const addDays = (iso: string, d: number) => { const t = new Date(iso); t.setUTCDate(t.getUTCDate() + d); return t.toISOString() }

/**
 * The VALIDATED config, or the list of its faults. Before (blitz test of 10/24): broken JSON, missing `steps` or `inboxes`
 * = a stack trace in the middle of a tick (after reading the replies); `steps: []` SILENTLY ended every
 * active sequence; an unknown pool passed for "full today"; a negative delay was accepted.
 */
export function configProblems(cfg: any): string[] {
  const out: string[] = []
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return ["the root must be a JSON object"]
  const pools = cfg.inboxes && typeof cfg.inboxes === "object" && !Array.isArray(cfg.inboxes) ? cfg.inboxes : null
  if (!pools) out.push("\"inboxes\" is missing (expected: { \"A\": [...], \"B\": [...] })")
  else for (const [k, v] of Object.entries(pools)) {
    if (!Array.isArray(v)) { out.push(`inboxes.${k} must be a list`); continue }
    v.forEach((b: any, i: number) => {
      if (!b || typeof b.email !== "string" || !EMAIL_RE.test(b.email)) out.push(`inboxes.${k}[${i}].email is invalid`)
      if (!(Number(b?.throttlePerDay) > 0)) out.push(`inboxes.${k}[${i}].throttlePerDay must be a number > 0`)
    })
  }
  if (!Array.isArray(cfg.steps) || !cfg.steps.length) out.push("\"steps\" is missing or empty (at least one step; empty, every active sequence would be closed)")
  else {
    const ids = new Set<string>()
    cfg.steps.forEach((st: any, i: number) => {
      const at = `steps[${i}]${st && typeof st.id === "string" ? ` (${st.id})` : ""}`
      if (!st || typeof st.id !== "string" || !st.id.trim()) out.push(`${at}.id is missing`)
      else if (ids.has(st.id)) out.push(`${at}.id is a duplicate`)
      else ids.add(st.id)
      if (pools && !Array.isArray(pools[st?.pool])) out.push(`${at}.pool "${st?.pool}" is unknown (pools: ${Object.keys(pools).join(", ") || "none"})`)
      if (typeof st?.delayDays !== "number" || !Number.isFinite(st.delayDays) || st.delayDays < 0) out.push(`${at}.delayDays must be a number ≥ 0`)
      if (typeof st?.source !== "string" || !(st.source in SOURCE_DIR || /^persona:[\w-]+$/.test(st.source))) out.push(`${at}.source "${st?.source}" is unknown (${Object.keys(SOURCE_DIR).join(", ")}, persona:<slot>)`)
      if (st?.gate !== undefined && st.gate !== "clicked") out.push(`${at}.gate "${st.gate}" is unknown (only "clicked" exists)`)
    })
  }
  if (cfg.perTickPerInbox !== undefined && !(Number(cfg.perTickPerInbox) > 0)) out.push("perTickPerInbox must be a number > 0")
  return out
}

class ConfigError extends Error {}
async function loadConfig(): Promise<Config> {
  let raw = ""
  try { raw = await readFile(CONFIG, "utf8") } catch (e) { throw new ConfigError(`✗ ${CONFIG} not found (${(e as NodeJS.ErrnoException).code})`) }
  let cfg: unknown
  try { cfg = JSON.parse(raw) } catch (e) { throw new ConfigError(`✗ ${CONFIG} unreadable (JSON): ${(e as Error).message}`) }
  const problems = configProblems(cfg)
  if (problems.length) throw new ConfigError(`✗ ${CONFIG}: ${problems.length} fault(s), nothing is read, sent or moved:\n${problems.map((p) => `  · ${p}`).join("\n")}`)
  return cfg as Config
}
/* The STATE lives in the SHARED DB (table sequencer_state): the email funnel is visible from EVERY
   machine (a colleague's CRM, the server's cockpit…), not only the one running the sequencer. The local file
   is still written as a trace/fallback (no DATABASE_URL = pure local dry-run mode). */
async function loadState(): Promise<Seq[]> {
  const db = tryDb()
  if (db) {
    try {
      const rows = await db.prepare("SELECT data FROM sequencer_state").all()
      if (rows.length) return rows.map((r: any) => (typeof r.data === "string" ? JSON.parse(r.data) : r.data) as Seq)
    } catch { /* table missing / DB down → file fallback */ }
  }
  return existsSync(STATE) ? JSON.parse(await readFile(STATE, "utf8")) : []
}
async function saveState(s: Seq[]) {
  await mkdir("data/sequencer", { recursive: true }); await writeFile(STATE, JSON.stringify(s, null, 2))
  const db = tryDb(); if (!db) return
  try {
    const now = Date.now()
    for (const seq of s)
      await db.prepare("INSERT INTO sequencer_state(prospect_id, data, updated_at) VALUES (?,(?)::text::jsonb,?) ON CONFLICT (prospect_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at")
        .run(seq.prospectId, JSON.stringify(seq), now)
  } catch { /* best effort: NEVER break a tick over a DB problem */ }
}
async function loadSends(): Promise<Send[]> {
  if (!existsSync(SENDS)) return []
  return (await readFile(SENDS, "utf8")).split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) as Send } catch { return null } }).filter((x): x is Send => !!x)
}
async function appendSend(s: Send) { await mkdir("data/sequencer", { recursive: true }); await appendFile(SENDS, JSON.stringify(s) + "\n") }

// pushes the email event into crm_leads.notes_json (outcome 'mail') → visible in the call cockpit,
// mixed with the call attempts. Best effort: without DATABASE_URL (local/dry-run), the log is enough.
async function notifyCrm(id: string, event: string) {
  console.log(`   ↳ CRM ← ${id} : ${event}`)
  const db = tryDb()
  if (!db) return
  try {
    const now = Date.now()
    // a lead the emails write to and who is not on the board yet starts in « Emails » (the cockpit's lane for it ; a
    // click, a reply or the end of the emails puts it on the call list)
    await db.prepare("INSERT INTO crm_leads(prospect_id, pipeline, stage, updated_at) VALUES (?, 'hot', 'emails', ?) ON CONFLICT (prospect_id) DO NOTHING").run(id, now)
    const row = (await db.prepare("SELECT notes_json FROM crm_leads WHERE prospect_id=?").get(id)) as { notes_json?: string } | undefined
    let notes: unknown[] = []
    try { notes = row?.notes_json ? JSON.parse(row.notes_json) : [] } catch { /* broken json → start empty */ }
    notes.push({ at: now, outcome: "mail", text: event })
    await db.prepare("UPDATE crm_leads SET notes_json=?, updated_at=? WHERE prospect_id=?").run(JSON.stringify(notes), now, id)
  } catch { /* best effort: NEVER break the tick over a DB problem */ }
}

// REPLY ⇒ HOT LEAD: the prospect moves to the top of the call queue ("replied > clicked > time slot"). The badge
// comes from the `replied` state; in the database, the CRM card is guaranteed (hot / Call 0) and nurturing ends.
async function hotLead(id: string) {
  const db = tryDb()
  if (!db) return
  try {
    const now = Date.now()
    await db.prepare("INSERT INTO crm_leads(prospect_id, pipeline, stage, updated_at) VALUES (?,?,?,?) ON CONFLICT (prospect_id) DO NOTHING").run(id, "hot", "call0", now)
    await db.prepare("UPDATE crm_leads SET stage='call0', nurturing_until=NULL, updated_at=? WHERE prospect_id=? AND pipeline='hot' AND stage IN ('nurturing','emails')").run(now, id)
  } catch { /* best-effort */ }
}

// a usable email: non-empty subject + body, and no leftover « [... à générer ...] » template inside
const usable = (m: { subject?: unknown; body?: unknown } | null | undefined): m is { senderName: string; subject: string; body: string } =>
  !!m && typeof m.subject === "string" && typeof m.body === "string" && !!m.subject.trim() && !!m.body.trim()
  && !/\[[^\]]*(à générer|a generer|à vérifier|inconnu)[^\]]*\]/i.test(m.subject + "\n" + m.body)

// a step's email: persona A/B from data/personas/<id>.json, otherwise the generated record data/<source>/<id>.json.
// null if missing or unusable → the step is HELD (waiting-content), NEVER replaced by a placeholder.
async function mailFor(id: string, step: Step): Promise<{ senderName: string; subject: string; body: string } | null> {
  if (step.source.startsWith("persona:")) {
    const slot = step.source.split(":")[1]
    const p = join(PERSONAS, `${id}.json`)
    if (!existsSync(p)) return null
    const rec = JSON.parse(await readFile(p, "utf8"))
    const persona = (rec.personas || []).find((x: { slot?: string }) => x.slot === slot)
    const m = persona ? { senderName: persona.senderName, subject: persona.subject, body: persona.body } : null
    return usable(m) ? m : null
  }
  const dir = SOURCE_DIR[step.source]
  if (!dir) return null
  const f = join(dir, `${id}.json`)
  if (!existsSync(f)) return null
  let r: any
  try { r = JSON.parse(await readFile(f, "utf8")) } catch { return null }
  const m = { senderName: r?.senderName || agency().mail.senderName, subject: r?.subject, body: r?.body }
  return usable(m) ? m : null
}

const EMAIL_RE = /^[^\s@<>()[\]]+@[^\s@<>()[\]]+\.[a-z]{2,}$/i
// the prospect's email (record), or "" if missing/invalid → the step is held (never a send to a placeholder)
async function recipient(id: string): Promise<string> {
  const f = join(PROSPECTS, `${id}.json`)
  if (!existsSync(f)) return ""
  let fiche: any
  try { fiche = JSON.parse(await readFile(f, "utf8")) } catch { return "" }
  const email = String(fiche?.identity?.email || "").trim()
  return EMAIL_RE.test(email) ? email : ""
}

// picks the pool's mailbox with the FEWEST sends today, under the throttle (day + tick); null if all are full
function pickInbox(pool: "A" | "B", cfg: Config, sends: Send[], nowIso: string, thisTick: Map<string, number>): { box: Inbox | null; why: "jour" | "tick" } {
  const today = dayKey(nowIso)
  const boxes = cfg.inboxes[pool] || []
  const countToday = (email: string) => sends.filter((s) => s.inbox === email && dayKey(s.at) === today).length
  const underDay = boxes.filter((b) => countToday(b.email) < b.throttlePerDay)
  const perTick = Number(cfg.perTickPerInbox) > 0 ? Number(cfg.perTickPerInbox) : Infinity
  const avail = underDay.filter((b) => (thisTick.get(b.email) || 0) < perTick).sort((a, b) => countToday(a.email) - countToday(b.email))
  return { box: avail[0] || null, why: underDay.length ? "tick" : "jour" }
}

// the live sequence an event concerns: by the send (trackingId), otherwise by the prospect. An event
// older than the enrollment (an earlier sequence) does not touch a more recent sequence.
function seqFor(ev: OutreachEvent, state: Seq[], sends: Send[]): { seq: Seq; send?: Send } | null {
  const send = ev.trackingId ? sends.find((s) => s.trackingId === ev.trackingId) : undefined
  const pid = send?.prospectId || ev.prospectId
  if (!pid) return null
  const seq = state.find((s) => s.prospectId === pid && isLive(s) && ev.at >= s.enrolledAt)
  return seq ? { seq, send } : null
}

// what the CRM history says (the call panel shows it as is) : the owner's words, in English
const STOP_LABEL: Record<string, string> = { unsub: "Unsubscribed: no more emails", bounce: "The email bounced: no more emails to this address", complaint: "Marked the email as spam: no more emails" }
const STOPPED_SAY: Record<string, string> = { meeting: "Emails stopped: meeting booked", won: "Emails stopped: won", lost: "Emails stopped: marked lost", skipped: "Emails stopped: site skipped", manual: "Emails stopped" }

// applies ONE reply: stop, Hot Lead, learning. Idempotent (only from a live sequence).
async function applyReply(seq: Seq, at: string) {
  seq.status = "replied"; delete seq.waiting; seq.stoppedBy = { type: "reply", at }
  await notifyCrm(seq.prospectId, "Replied: call them")
  await hotLead(seq.prospectId)
  try { await recordOutcome(seq.prospectId, "reply", { source: "sequencer", at }) } catch { /* learning never breaks a tick */ }
}

// ingests the events (the cockpit's /t/ tracking, the reply reader, the CLI) → sequence state. Replayable:
// each transition starts from a live sequence, a click already counted (same timestamp) is not counted twice.
async function ingestEvents(state: Seq[], sends: Send[], events: OutreachEvent[]): Promise<{ clicks: number; replies: number; stops: number; scanners: number }> {
  const n = { clicks: 0, replies: 0, stops: 0, scanners: 0 }
  for (const ev of events) {
    const hit = seqFor(ev, state, sends)
    if (!hit) continue
    const { seq, send } = hit
    if (ev.type === "click") {
      const tooSoon = send && new Date(ev.at).getTime() - new Date(send.at).getTime() < SCANNER_WINDOW_MS
      if (ev.suspect || tooSoon) { n.scanners++; continue }
      seq.clicks = seq.clicks || []
      if (!seq.clicks.includes(ev.at)) { seq.clicks.push(ev.at); n.clicks++; await notifyCrm(seq.prospectId, "Clicked the link in the email") }
    } else if (ev.type === "reply") {
      await applyReply(seq, ev.at); n.replies++
    } else if (ev.type === "unsub" || ev.type === "bounce" || ev.type === "complaint") {
      seq.status = "dropped"; delete seq.waiting; seq.stoppedBy = { type: ev.type, at: ev.at }; n.stops++
      await notifyCrm(seq.prospectId, STOP_LABEL[ev.type])
    }
  }
  return n
}

// REPLY READER: reads each mailbox from its cursor, classifies, and WRITES events (a stable id per
// message → a message read again at the next tick does not count twice). A failing mailbox does not break the tick.
async function readReplies(reader: ReplyReader, cfg: Config, state: Seq[], sends: Send[], nowIso: string): Promise<{ read: number; recorded: number; ignored: number }> {
  const out = { read: 0, recorded: 0, ignored: 0 }
  if (reader.name === "none") return out
  const live = state.filter(isLive)
  if (!live.length) return out
  const known = new Map<string, string>()
  for (const s of sends) if (live.some((q) => q.prospectId === s.prospectId) && s.to) known.set(s.to.toLowerCase(), s.prospectId)
  for (const q of live) { const e = await recipient(q.prospectId); if (e) known.set(e.toLowerCase(), q.prospectId) }
  let cursor: Record<string, string> = {}
  try { if (existsSync(CURSOR)) cursor = JSON.parse(await readFile(CURSOR, "utf8")) } catch { /* start from the beginning */ }
  const oldest = live.map((q) => q.enrolledAt).sort()[0]
  const lastTid = (pid: string) => [...sends].reverse().find((s) => s.prospectId === pid)?.trackingId || ""
  const inboxes = [...new Set([...(cfg.inboxes.A || []), ...(cfg.inboxes.B || [])].map((b) => b.email))]
  for (const inbox of inboxes) {
    let msgs: Awaited<ReturnType<ReplyReader["fetch"]>> = []
    try { msgs = await reader.fetch(inbox, cursor[inbox] || oldest) }
    catch (e) { console.warn(`⚠ reader ${reader.name}: ${inbox} unreadable (${(e as Error).message.slice(0, 160)})`); continue }
    for (const m of msgs) {
      if (m.at > nowIso) continue // --now simulates the time: a "future" message is read later
      out.read++
      const c = classifyInbound(m, known)
      if (c.kind === "ignore") { out.ignored++; continue }
      const r = await recordEvent({
        id: stableId(`reader\n${inbox}\n${m.id || `${m.from}\n${m.at}\n${m.subject}`}`), type: c.kind, source: "reader",
        prospectId: c.prospectId, trackingId: lastTid(c.prospectId), at: m.at,
        data: { inbox, from: m.from, subject: m.subject.slice(0, 200), reader: reader.name },
      })
      if (r.stored !== "capped") out.recorded++
      if (!cursor[inbox] || m.at > cursor[inbox]) cursor[inbox] = m.at
    }
  }
  await mkdir("data/sequencer", { recursive: true })
  await writeFile(CURSOR, JSON.stringify(cursor, null, 2))
  return out
}

// did they click SINCE the last email sent? (the escalation's gate)
function clickedSinceLastSend(seq: Seq): boolean {
  const lastSendAt = seq.sends.length ? seq.sends[seq.sends.length - 1].at : seq.enrolledAt
  return (seq.clicks || []).some((c) => c > lastSendAt)
}

// an event entered by hand (CLI), tied to the prospect's last send
async function manualEvent(type: "click" | "reply" | "unsub" | "bounce" | "complaint", id: string, sends: Send[], nowIso: string) {
  const last = [...sends].reverse().find((s) => s.prospectId === id)
  return recordEvent({ type, source: "cli", prospectId: id, trackingId: last?.trackingId || "", at: nowIso })
}

/** The commands that WRITE the state (state.json, sends.jsonl, the database): one at a time (lock). */
export function writesState(cmd: string | undefined, arg?: string): boolean {
  return ["enroll", "tick", "click", "reply", "drop", "bounce", "complaint", "stop"].includes(cmd || "") || (cmd === "breaker" && arg === "reset")
}

async function main() {
  try { process.loadEnvFile() } catch { /* no .env → notifyCrm stays log-only */ }
  const cmd = process.argv[2]
  // LOCK: a tick by hand during the timer's (or another machine's on the same database) read the same state
  // and sent the same step to the same prospect again. The second waits, then sees the step done (see packages/shared/lock.ts).
  if (!writesState(cmd, process.argv[3])) return run(cmd)
  const lock = await acquireLock({ file: "data/sequencer/.lock", dbKey: "sequencer.lock", cmd: `sequencer ${cmd}`, waitMs: Number(process.env.LWS_SEQ_LOCK_WAIT_MS) || 180_000 })
  if (!lock) {
    console.error(`✗ the sequencer is already running elsewhere: "${cmd}" did nothing (nothing read, sent or moved). Try again later.`)
    process.exitCode = 75 // EX_TEMPFAIL: the timer tries again on its next run
    return
  }
  try { await run(cmd) } finally { await lock.release() }
}

async function run(cmd: string | undefined) {
  const cfg = await loadConfig()
  const state = await loadState()
  const nowIso = flag("--now") || new Date().toISOString()

  if (cmd === "enroll") {
    const ids = (process.argv[3] || "").split(",").map((s) => s.trim()).filter(Boolean)
    if (!ids.length) { console.error("usage: npm run sequencer -- enroll <id1,id2,...> [--force]"); process.exitCode = 1; return }
    const force = process.argv.includes("--force")
    // OPT-OUTS (blitz test of 10/24): enroll only looked at live sequences; bulk enrollment put back into a
    // sequence someone who had said STOP (or whose address bounces), and the next tick wrote to them again.
    const blocks = await optOuts({ state, sends: await loadSends() })
    for (const id of ids) {
      // the honest funnel no longer needs personas (fake complaint emails removed): only the record is needed
      if (!/^[\w.-]+$/.test(id) || !existsSync(join(PROSPECTS, `${id}.json`))) { console.log(`⏭  ${id}: record data/prospects/${id}.json not found → not enrolled`); continue }
      if (state.find((s) => s.prospectId === id && isLive(s))) { console.log(`⏭  ${id}: already in an active sequence`); continue }
      const b = blocks.get(id)
      if (b && (b.type === "unsub" || b.type === "complaint")) { console.log(`⛔ ${id}: ${b.type === "unsub" ? "unsubscribed" : "spam complaint"} on ${dayKey(b.at)} (opt-out) → never enrolled again, even with --force`); continue }
      if (b && b.type === "bounce" && (!b.to || b.to === (await recipient(id)))) { console.log(`⛔ ${id}: address failing (bounced on ${dayKey(b.at)}${b.to ? `, ${b.to}` : ""}) → fix the email on the record to enroll them again`); continue }
      const replied = state.find((s) => s.prospectId === id && s.status === "replied")
      if (replied && !force) { console.log(`⏭  ${id}: already replied (${dayKey(replied.stoppedBy?.at || replied.enrolledAt)}) → the CRM takes it from here (--force to start again anyway)`); continue }
      // the owner stopped it (a meeting, won, lost) : never back in the emails on its own (--force to do it anyway)
      const owned = [...state].reverse().find((s) => s.prospectId === id && s.status === "stopped" && ["meeting", "won", "lost"].includes(String(s.stoppedBy?.type)))
      if (owned && !force) { console.log(`⏭  ${id}: emails stopped (${owned.stoppedBy?.type}) → not enrolled again (--force to do it anyway)`); continue }
      state.push({ prospectId: id, step: 0, status: "active", enrolledAt: nowIso, nextRunAt: nowIso, clicks: [], sends: [] })
      console.log(`✅ ${id} enrolled (starts ${dayKey(nowIso)})`)
    }
    await saveState(state)
    return
  }

  if (cmd === "click") {
    const id = process.argv[3]
    const seq = state.find((s) => s.prospectId === id && isLive(s))
    if (!seq) { console.log(`${id}: no active sequence`); return }
    seq.clicks = seq.clicks || []
    seq.clicks.push(nowIso)
    await saveState(state)
    await manualEvent("click", id, await loadSends(), nowIso)
    console.log(`👆 ${id}: click recorded (${dayKey(nowIso)}) → the escalation can go on`)
    await notifyCrm(id, "Clicked the link in the email")
    return
  }

  if (cmd === "reply" || cmd === "drop" || cmd === "bounce" || cmd === "complaint") {
    const id = process.argv[3]
    const seq = state.find((s) => s.prospectId === id && isLive(s))
    if (!seq) { console.log(`${id}: no active sequence`); return }
    if (cmd === "reply") { await manualEvent("reply", id, await loadSends(), nowIso); await applyReply(seq, nowIso) }
    else {
      if (cmd !== "drop") await manualEvent(cmd, id, await loadSends(), nowIso)
      seq.status = "dropped"; delete seq.waiting; seq.stoppedBy = { type: cmd, at: nowIso }
      if (cmd !== "drop") await notifyCrm(id, STOP_LABEL[cmd])
    }
    await saveState(state)
    console.log(`🛑 ${id} → ${seq.status} (sequence stopped, no more emails)${cmd === "bounce" || cmd === "complaint" ? " · counted by the circuit breaker" : ""}`)
    return
  }

  if (cmd === "stop") {
    // the owner's own act (a meeting booked, won, lost, the site skipped) : no more emails, the reason is kept
    const id = process.argv[3], reason = String(process.argv[4] || "manual")
    if (!(STOP_REASONS as readonly string[]).includes(reason)) { console.error(`usage: npm run sequencer -- stop <id> <${STOP_REASONS.join("|")}>`); process.exitCode = 1; return }
    const seq = state.find((s) => s.prospectId === id && isLive(s))
    if (!seq) { console.log(`${id}: no active sequence`); return }
    seq.status = "stopped"; delete seq.waiting; seq.stoppedBy = { type: reason, at: nowIso }
    await saveState(state)
    await notifyCrm(id, STOPPED_SAY[reason] || STOPPED_SAY.manual)
    console.log(`🛑 ${id} → stopped (${reason}): no more emails`)
    return
  }

  if (cmd === "breaker") {
    if (process.argv[3] === "reset") {
      const s = resetBreaker(await loadBreaker(), nowIso)
      await saveBreaker(s)
      console.log(`🔁 circuit breaker re-armed (${nowIso}): earlier incidents no longer count. Check the cause before sending again.`)
      return
    }
    const b = await loadBreaker()
    if (!b) return console.log("circuit breaker: never evaluated (no tick yet)")
    console.log(`circuit breaker: ${b.open ? "⛔ OPEN" : "✓ closed"} · ${b.counts.sends} send(s) since ${b.since.slice(0, 10)} · bounces ${b.counts.bounce} · complaints ${b.counts.complaint} · unsubscribes ${b.counts.unsub}`)
    for (const r of b.reasons) console.log(`  · ${r}`)
    return
  }

  if (cmd === "status") {
    const stop = await stopState(), b = await loadBreaker()
    if (stop.on) console.log(`⏹ STOP on (${stop.source}: ${stop.reason})`)
    if (b?.open) console.log(`⛔ circuit breaker open: ${b.reasons.join(" ; ")}`)
    if (!state.length) return console.log("(no sequence)")
    for (const s of state) {
      const stepName = isLive(s) ? (cfg.steps[s.step]?.id ?? "end") : s.status
      const wait = s.status === "waiting-content" && s.waiting ? ` · held: ${s.waiting.detail}` : ""
      console.log(`· ${s.prospectId.padEnd(34)} ${s.status.padEnd(15)} step ${s.step} (${stepName}) · next ${s.status === "active" ? dayKey(s.nextRunAt) : "-"} · ${s.sends.length} send(s) · ${(s.clicks || []).length} click(s)${wait}`)
    }
    return
  }

  if (cmd === "tick") {
    // 0. the emergency stop comes BEFORE everything: nothing is read, sent or moved
    const stop = await stopState()
    if (stop.on) {
      console.log(`⏹ STOP (${stop.source}: ${stop.reason}): the sequencer does not tick. Nothing is read, sent or moved.`)
      console.log(`  To resume: ${stop.source === "fichier" ? "rm STOP" : "the cockpit's Resume button"}`)
      return
    }
    const mode = sendMode(cfg)
    if (mode.refused) {
      console.error("✗ REAL SENDING REFUSED: outreach/sequencer/config.json asks for dryRun:false, but LWS_LIVE_SEND=1 is not set.")
      console.error("  Nothing was sent or moved. To send for real: LWS_LIVE_SEND=1 npm run sequencer -- tick")
      process.exitCode = 2
      return
    }
    console.log(mode.live ? "🔴 REAL SENDING (config.dryRun=false + LWS_LIVE_SEND=1)" : "🟢 DRY-RUN: no email goes out (real sending = config.dryRun:false AND LWS_LIVE_SEND=1)")
    // real sending without tracking: no one-click unsubscribe (List-Unsubscribe) and no tracked click → the gated escalation dies silently
    if (mode.live && !trackConfig()) console.error("⚠ REAL SENDING WITHOUT TRACKING (TRACK_BASE + LWS_TRACK_SECRET ≥ 32 characters): no one-click unsubscribe in the emails, no click seen, the steps \"gated on a click\" will never go out. npm run doctor flags it.")
    const sends = await loadSends()

    // 1. replies (pluggable reader) → events
    const reader = selectReader()
    const rd = await readReplies(reader, cfg, state, sends, nowIso)
    if (reader.name !== "none") console.log(`📥 reader ${reader.name}: ${rd.read} message(s) read, ${rd.recorded} event(s), ${rd.ignored} ignored`)

    // 2. events → state (click, reply, unsubscribe, bounce, complaint)
    const events = (await readEvents()).filter((e) => e.at <= nowIso)
    const ing = await ingestEvents(state, sends, events)
    if (ing.clicks || ing.replies || ing.stops || ing.scanners) console.log(`📬 events: ${ing.clicks} click(s), ${ing.replies} reply(ies), ${ing.stops} exit(s)${ing.scanners ? `, ${ing.scanners} scanner click(s) ignored` : ""}`)

    // 3. circuit breaker (locked once open)
    const breaker = evaluateBreaker({ sends, events, now: nowIso, prev: await loadBreaker(), thresholds: cfg.breaker })
    await saveBreaker(breaker)
    if (breaker.open) {
      console.log(`⛔ CIRCUIT BREAKER OPEN: ${breaker.reasons.join(" ; ")}`)
      console.log("  → no sending until a human has looked (re-arm: npm run sequencer -- breaker reset, or the cockpit)")
      await saveState(state)
      console.log(`\n✓ tick ${dayKey(nowIso)}: 0 sends (circuit breaker open).`)
      return
    }

    // 4. sends that are due
    let acted = 0, deferred = 0, stopped = 0, held = 0, failed = 0
    const thisTick = new Map<string, number>()
    const win = sendWindow()
    for (const seq of state) {
      if (!isLive(seq) || seq.nextRunAt > nowIso) continue
      if (seq.step >= cfg.steps.length) { seq.status = "done"; delete seq.waiting; continue }
      const step = cfg.steps[seq.step]
      // gate: escalate only if the prospect clicked since the previous email
      if (step.gate === "clicked" && !clickedSinceLastSend(seq)) {
        seq.status = "nurturing"
        console.log(`⏹  ${seq.prospectId}: no click on the previous email → escalation stopped (nurturing)`)
        await notifyCrm(seq.prospectId, "No click on the last email: emails paused")
        stopped++
        continue
      }
      // CONTENT + RECIPIENT first: without them the step is HELD (never a placeholder sent or logged)
      const mail = await mailFor(seq.prospectId, step)
      const to = mail ? await recipient(seq.prospectId) : ""
      if (!mail || !to) {
        const label = SOURCE_LABEL[step.source] || step.source
        const waiting: Waiting = mail
          ? { step: step.id, reason: "destinataire", detail: `no valid email address in data/prospects/${seq.prospectId}.json`, since: seq.waiting?.since || nowIso }
          : { step: step.id, reason: "contenu", detail: `${label} not written yet (${SOURCE_DIR[step.source] || step.source}/${seq.prospectId}.json)`, since: seq.waiting?.since || nowIso }
        if (seq.status !== "waiting-content" || seq.waiting?.detail !== waiting.detail) {
          console.log(`⏸  ${seq.prospectId}: step "${step.id}" held, ${waiting.detail} → resumes as soon as it exists`)
          await notifyCrm(seq.prospectId, waiting.reason === "destinataire" ? "Next email held: no valid email address" : `Next email held: the ${label} isn't written yet`)
        }
        seq.status = "waiting-content"; seq.waiting = waiting
        held++
        continue
      }
      const { box, why } = pickInbox(step.pool, cfg, sends, nowIso, thisTick)
      if (!box) {
        if (why === "jour") { console.log(`⏳ ${seq.prospectId}: pool ${step.pool} full today (throttle) → moved to tomorrow`); seq.nextRunAt = scheduleIso(addDays(nowIso, 1), win) }
        else console.log(`⏳ ${seq.prospectId}: per-tick cap reached → at the next tick`)
        deferred++; continue
      }
      if (seq.status === "waiting-content") { seq.status = "active"; delete seq.waiting } // the content has arrived
      const trackingId = randomUUID()
      const opts = { inbox: box.email, to, subject: mail.subject, body: mail.body, senderName: mail.senderName, trackingId, prospectId: seq.prospectId }
      // the COMPLETE message (signed links + unsubscribe headers): written as .eml, sent as is for real.
      // A failing send (Gmail API down, token refused…) does not break the tick: nothing moves for THIS
      // prospect (retried at the next tick), the others go out, and the tick ends with code 1 (systemd alert).
      let msg: BuiltMessage
      try { msg = mode.live ? await sendMail(opts) : buildMessage(opts) }
      catch (e) {
        failed++
        console.error(`✗ ${seq.prospectId}: sending "${step.id}" failed (${(e as Error).message.slice(0, 240)}) → retried at the next tick, nothing moves`)
        await notifyCrm(seq.prospectId, "The email could not be sent: tried again at the next round")
        continue
      }
      await mkdir(OUTBOX, { recursive: true })
      const eml = join(OUTBOX, `${dayKey(nowIso)}-${trackingId}.eml`)
      await writeFile(eml, msg.rfc822)
      if (!mode.live) {
        console.log(`📨 DRY-RUN → [${step.id}] from ${box.email} → ${seq.prospectId} (${to})`)
        console.log(`      subject: "${mail.subject}"  (signed ${mail.senderName}) · ${msg.tracked ? `${msg.links.length} tracked link(s), one-click unsubscribe` : "no tracking (TRACK_BASE + LWS_TRACK_SECRET not set)"} · ${eml}`)
      }
      const send: Send = { prospectId: seq.prospectId, step: step.id, pool: step.pool, inbox: box.email, to, subject: mail.subject, at: nowIso, dryRun: !mode.live, trackingId, tracked: msg.tracked, links: msg.links.length }
      await appendSend(send)
      sends.push(send)
      thisTick.set(box.email, (thisTick.get(box.email) || 0) + 1)
      const firstMail = seq.sends.length === 0
      seq.sends.push({ step: step.id, inbox: box.email, at: nowIso, trackingId })
      const label = SOURCE_LABEL[step.source] || step.id
      await notifyCrm(seq.prospectId, mode.live ? `Email ${seq.sends.length} sent: ${label}` : `Email ${seq.sends.length} written (test mode, not sent): ${label}`)
      // learning: the first REAL email makes the prospect a try ("sent"), even if they never answer; without it, the loop
      // only saw those who react. Never in dry-run (a simulation is not a try). Once per prospect.
      if (mode.live && firstMail) { try { await recordOutcome(seq.prospectId, "sent", { source: "sequencer", at: nowIso }) } catch { /* learning never breaks a tick */ } }
      seq.step++
      if (seq.step >= cfg.steps.length) seq.status = "done"
      // the next one inside the sending hours (agency clock), never in the middle of the night
      else seq.nextRunAt = scheduleIso(addDays(nowIso, cfg.steps[seq.step].delayDays), win)
      acted++
      // for real, the state is written AFTER EACH SEND: a tick killed mid-flight never sends the same email again
      if (mode.live) await saveState(state)
    }
    await saveState(state)
    console.log(`\n${failed ? "✗" : "✓"} tick ${dayKey(nowIso)}: ${acted} ${mode.live ? "send(s)" : "simulated send(s)"}, ${held} held (content missing), ${deferred} deferred, ${stopped} stopped (no click)${failed ? `, ${failed} failed send(s) (retried at the next tick)` : ""}.`)
    if (failed) process.exitCode = 1
    return
  }

  console.error(`${cmd ? `unknown command "${cmd}". ` : ""}usage: npm run sequencer -- enroll <ids> | tick [--now <ISO>] | click <id> | reply <id> | drop <id> | bounce <id> | complaint <id> | stop <id> <reason> | breaker [reset] | status`)
  process.exitCode = 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().then(() => closeDb()).catch((e) => {
  if (e instanceof ConfigError) { console.error(e.message); closeDb(); process.exit(78) } // EX_CONFIG: a human must fix it
  console.error(e); closeDb(); process.exit(1)
})
