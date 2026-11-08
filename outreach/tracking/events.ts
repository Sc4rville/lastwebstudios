/**
 * events.ts · THE LOG of outreach events: what the prospect does after the email (click, unsubscribe,
 * reply) and what the mailbox sends back (bounce, complaint). One shape, two homes:
 *
 *   · the `outreach_events` table of the shared database (db/schema.sql) when DATABASE_URL is set: the cockpit
 *     (which receives the clicks, in its container) and the sequencer (on the box) share no disk;
 *   · the fallback `data/sequencer/events.jsonl` without a database (everything on one machine) or if the database goes down.
 *
 * Writers: the cockpit's public /t/ endpoint (click, unsubscribe), the sequencer's reply reader
 * (reply, "STOP" unsubscribe, bounce), the CLI (`npm run sequencer -- bounce|complaint <id>`), the CRM
 * (a call's outcome, type `outcome`, mirrored for learning). Readers: the sequencer (escalation, stop, Hot Lead),
 * the circuit breaker, the Machine view.
 *
 * CAPS (F-3): at most PER_TRACKING events of one type per send, user agent and URL truncated,
 * a fallback file capped at FILE_CAP bytes. Beyond that, the event is refused ("capped"), never an error.
 */
import { appendFile, mkdir, readFile, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import { createHash, randomUUID } from "node:crypto"
import { dirname } from "node:path"
import { tryDb } from "../../packages/shared/db.ts"

export const EVENTS_FILE = "data/sequencer/events.jsonl"
export const EVENT_TYPES = ["click", "unsub", "reply", "bounce", "complaint", "outcome"] as const
export type EventType = (typeof EVENT_TYPES)[number]
export const CAPS = { perTracking: 20, fileBytes: 20_000_000, ua: 300, url: 2000, data: 4000 }

export type OutreachEvent = {
  id: string
  trackingId: string // the send concerned (sends.jsonl); "" for an event tied to the prospect only
  prospectId?: string | null
  type: EventType
  at: string // ISO
  url?: string
  ua?: string
  suspect?: boolean // a likely link-scanner click (mail gateway, antivirus): ignored by the escalation
  source: "track" | "reader" | "cli" | "crm"
  data?: Record<string, unknown>
}

/** A STABLE event id from a key (e.g. the Gmail message id): replaying a reader doubles nothing. */
export const stableId = (key: string) => "ev-" + createHash("sha256").update(key).digest("hex").slice(0, 24)

// gateways and scanners that "click" every link of an email to analyse it (fake clicks)
const SCANNER_UA = /(bot|crawl|spider|slurp|preview|scan|safelinks|barracuda|mimecast|proofpoint|urldefense|fireeye|symantec|trendmicro|sophos|forcepoint|ironport|zscaler|cloudmark|curl\/|wget|python-requests|go-http-client|okhttp|headless|phantomjs|httpclient|java\/)/i
export function suspectUa(ua: string | undefined): boolean { return !ua || !ua.trim() || SCANNER_UA.test(ua) }

function normalize(e: Partial<OutreachEvent> & { type: EventType; source: OutreachEvent["source"] }): OutreachEvent {
  const data = e.data && JSON.stringify(e.data).length <= CAPS.data ? e.data : undefined
  return {
    id: e.id || randomUUID(), trackingId: String(e.trackingId || "").slice(0, 64), prospectId: e.prospectId ? String(e.prospectId).slice(0, 200) : null,
    type: e.type, at: e.at || new Date().toISOString(), source: e.source,
    ...(e.url ? { url: String(e.url).slice(0, CAPS.url) } : {}),
    ...(e.ua ? { ua: String(e.ua).slice(0, CAPS.ua) } : {}),
    ...(e.suspect ? { suspect: true } : {}),
    ...(data ? { data } : {}),
  }
}

async function readFileEvents(): Promise<OutreachEvent[]> {
  if (!existsSync(EVENTS_FILE)) return []
  const out: OutreachEvent[] = []
  for (const l of (await readFile(EVENTS_FILE, "utf8")).split("\n")) {
    if (!l.trim()) continue
    try {
      const e = JSON.parse(l)
      if (!e || typeof e.type !== "string" || typeof e.at !== "string") continue
      // the earlier shape (edge function / cockpit v1): {trackingId, type, at} with no id or source
      out.push({ ...e, id: e.id || stableId(l), source: e.source || "track", trackingId: String(e.trackingId || "") })
    } catch { /* broken line: ignored */ }
  }
  return out
}

async function appendFileEvent(e: OutreachEvent): Promise<"file" | "capped"> {
  try { if ((await stat(EVENTS_FILE)).size >= CAPS.fileBytes) return "capped" } catch { /* no file yet */ }
  if (e.trackingId) {
    const same = (await readFileEvents()).filter((x) => x.trackingId === e.trackingId && x.type === e.type)
    if (same.length >= CAPS.perTracking || same.some((x) => x.id === e.id)) return "capped"
  }
  await mkdir(dirname(EVENTS_FILE), { recursive: true })
  await appendFile(EVENTS_FILE, JSON.stringify(e) + "\n")
  return "file"
}

const rowToEvent = (r: any): OutreachEvent => {
  let data: Record<string, unknown> | undefined
  try { data = r.data_json ? JSON.parse(r.data_json) : undefined } catch { /* */ }
  return normalize({
    id: r.id, trackingId: r.tracking_id || "", prospectId: r.prospect_id, type: r.type, at: new Date(Number(r.at)).toISOString(),
    url: r.url || undefined, ua: r.ua || undefined, suspect: !!r.suspect, source: r.source || "track", data,
  })
}

/**
 * Records an event. Database first (if DATABASE_URL), file fallback if the database is missing or goes down.
 * `stored`: "db" | "file" | "capped" (refused by a cap, or a duplicate of a stable id).
 */
export async function recordEvent(input: Partial<OutreachEvent> & { type: EventType; source: OutreachEvent["source"] }): Promise<{ stored: "db" | "file" | "capped"; event: OutreachEvent }> {
  const e = normalize(input)
  // "count then write" is only safe one request at a time: a burst of simultaneous clicks on the same link
  // all got under the cap (34 written for 20, blitz test of 10/24). So the writes for one send are
  // queued in this process (the cockpit is the only one serving /t/).
  return serialized(e.trackingId || e.id, () => store(e))
}

const queues = new Map<string, Promise<unknown>>()
function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const tail = run.catch(() => { /* the error stays with the caller */ })
  queues.set(key, tail)
  tail.then(() => { if (queues.get(key) === tail) queues.delete(key) })
  return run
}

async function store(e: OutreachEvent): Promise<{ stored: "db" | "file" | "capped"; event: OutreachEvent }> {
  const db = tryDb()
  if (db) {
    try {
      if (e.trackingId) {
        const r = await db.prepare("SELECT COUNT(*)::int AS n FROM outreach_events WHERE tracking_id = ? AND type = ?").get(e.trackingId, e.type) as { n: number } | undefined
        if ((r?.n ?? 0) >= CAPS.perTracking) return { stored: "capped", event: e }
      }
      const dup = await db.prepare("SELECT 1 AS x FROM outreach_events WHERE id = ?").get(e.id)
      if (dup) return { stored: "capped", event: e }
      await db.prepare(`INSERT INTO outreach_events (id, tracking_id, prospect_id, type, at, url, ua, suspect, source, data_json)
        VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT (id) DO NOTHING`).run(
        e.id, e.trackingId, e.prospectId ?? null, e.type, new Date(e.at).getTime(), e.url ?? null, e.ua ?? null, e.suspect ? 1 : 0, e.source, e.data ? JSON.stringify(e.data) : null)
      return { stored: "db", event: e }
    } catch { /* table missing / database down → file fallback (never lose a click) */ }
  }
  return { stored: await appendFileEvent(e), event: e }
}

/** Every known event (database + file, deduplicated by id), sorted by date. */
export async function readEvents(o: { sinceIso?: string; types?: EventType[] } = {}): Promise<OutreachEvent[]> {
  const byId = new Map<string, OutreachEvent>()
  const db = tryDb()
  if (db) {
    try {
      const since = o.sinceIso ? new Date(o.sinceIso).getTime() : 0
      const rows = await db.prepare("SELECT id, tracking_id, prospect_id, type, at, url, ua, suspect, source, data_json FROM outreach_events WHERE at >= ? ORDER BY at ASC LIMIT 50000").all(since)
      for (const r of rows) { const e = rowToEvent(r); byId.set(e.id, e) }
    } catch { /* no table → file only */ }
  }
  for (const e of await readFileEvents()) if (!byId.has(e.id)) byId.set(e.id, e)
  let out = [...byId.values()]
  if (o.sinceIso) out = out.filter((e) => e.at >= o.sinceIso!)
  if (o.types) out = out.filter((e) => (o.types as string[]).includes(e.type))
  return out.sort((a, b) => a.at.localeCompare(b.at))
}
