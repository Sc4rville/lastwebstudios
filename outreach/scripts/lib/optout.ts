/**
 * optout.ts · THE opt-out register, for EVERY sending path (the sequencer, the /out Gmail drafts).
 *
 * Someone who unsubscribed (one-click link, "STOP") or reported spam must NEVER again receive
 * prospecting (objection, GDPR art. 21); a bouncing address must not be emailed again while it stays the same.
 * Sources: the sequencer's state (stopped sequences) AND the event log (an unsubscribe that arrives after the
 * end of a sequence is only there). Before the blitz test of 10/24, only LIVE sequences were looked at:
 * bulk enrollment put an unsubscribed person back into a sequence, and /out could prepare a new draft for them.
 */
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tryDb } from "../../../packages/shared/db.ts"
import { readEvents, type OutreachEvent } from "../../tracking/events.ts"

export type OptOut = { type: "unsub" | "complaint" | "bounce"; at: string; to?: string }
type SeqLike = { prospectId: string; stoppedBy?: { type: string; at: string } }
type SendLike = { prospectId: string; trackingId: string; to: string }

const STATE = "data/sequencer/state.json"
const SENDS = "data/sequencer/sends.jsonl"

async function loadStateLike(): Promise<SeqLike[]> {
  const db = tryDb()
  if (db) {
    try {
      const rows = await db.prepare("SELECT data FROM sequencer_state").all()
      if (rows.length) return rows.map((r: any) => (typeof r.data === "string" ? JSON.parse(r.data) : r.data))
    } catch { /* database unavailable: the file */ }
  }
  try { return existsSync(STATE) ? JSON.parse(await readFile(STATE, "utf8")) : [] } catch { return [] }
}
async function loadSendsLike(): Promise<SendLike[]> {
  if (!existsSync(SENDS)) return []
  return (await readFile(SENDS, "utf8")).split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}

/** prospectId → their strongest opt-out (unsubscribe or complaint > bounce). */
export async function optOuts(o: { state?: SeqLike[]; sends?: SendLike[] } = {}): Promise<Map<string, OptOut>> {
  const state = o.state ?? await loadStateLike()
  const sends = o.sends ?? await loadSendsLike()
  const out = new Map<string, OptOut>()
  const lastTo = (pid: string) => sends.filter((x) => x.prospectId === pid).pop()?.to
  const put = (id: string, type: OptOut["type"], at: string, to?: string) => { const cur = out.get(id); if (!cur || (cur.type === "bounce" && type !== "bounce")) out.set(id, { type, at, ...(to ? { to } : {}) }) }
  for (const s of state) {
    const t = s.stoppedBy?.type
    if (t === "unsub" || t === "complaint" || t === "bounce") put(s.prospectId, t, s.stoppedBy!.at, t === "bounce" ? lastTo(s.prospectId) : undefined)
  }
  let events: OutreachEvent[] = []
  try { events = await readEvents({ types: ["unsub", "complaint", "bounce"] }) } catch { /* unreadable log: the state is enough */ }
  for (const ev of events) {
    const send = ev.trackingId ? sends.find((x) => x.trackingId === ev.trackingId) : undefined
    const pid = send?.prospectId || ev.prospectId
    if (pid && (ev.type === "unsub" || ev.type === "complaint" || ev.type === "bounce")) put(pid, ev.type, ev.at, ev.type === "bounce" ? send?.to ?? lastTo(pid) : undefined)
  }
  return out
}

/** May we write to `id` at the address `to`? A readable reason if not. */
export function blockedReason(b: OptOut | undefined, to: string): string {
  if (!b) return ""
  const day = b.at.slice(0, 10)
  if (b.type === "unsub") return `unsubscribed on ${day} (opt-out): never contact them again`
  if (b.type === "complaint") return `spam complaint on ${day} (opt-out): never contact them again`
  if (!b.to || b.to.toLowerCase() === to.toLowerCase()) return `address failing (bounced on ${day}${b.to ? `, ${b.to}` : ""}): fix the email on the prospect's record`
  return ""
}
