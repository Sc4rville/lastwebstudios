/**
 * events.ts · LE JOURNAL des évènements outreach : ce que le prospect fait après le mail (clic, désinscription,
 * réponse) et ce que la boîte renvoie (bounce, plainte). Une seule forme, deux maisons :
 *
 *   · la table `outreach_events` de la base partagée (db/schema.sql) quand DATABASE_URL est posée : le cockpit
 *     (qui reçoit les clics, dans son conteneur) et le séquenceur (sur la box) ne partagent pas de disque ;
 *   · le repli `data/sequencer/events.jsonl` sans base (tout sur une machine) ou si la base tombe.
 *
 * Écrivains : l'endpoint public /t/ du cockpit (clic, désinscription), le lecteur de réponses du séquenceur
 * (réponse, désinscription « STOP », bounce), la CLI (`npm run sequencer -- bounce|complaint <id>`), le CRM
 * (issue d'un appel, type `outcome`, miroir du learning). Lecteurs : le séquenceur (escalade, arrêt, Hot Lead),
 * le disjoncteur, la vue Machine.
 *
 * PLAFONDS (F-3) : au plus PER_TRACKING évènements d'un même type par envoi, un user-agent et une URL tronqués,
 * un fichier de repli borné à FILE_CAP octets. Au-delà, l'évènement est refusé (« capped »), jamais d'erreur.
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
  trackingId: string // l'envoi concerné (sends.jsonl) ; "" pour un évènement rattaché au seul prospect
  prospectId?: string | null
  type: EventType
  at: string // ISO
  url?: string
  ua?: string
  suspect?: boolean // clic probable d'un scanner de liens (passerelle mail, antivirus) : ignoré par l'escalade
  source: "track" | "reader" | "cli" | "crm"
  data?: Record<string, unknown>
}

/** Un id d'évènement STABLE à partir d'une clé (ex. id du message Gmail) : rejouer un lecteur ne double rien. */
export const stableId = (key: string) => "ev-" + createHash("sha256").update(key).digest("hex").slice(0, 24)

// passerelles et scanners qui « cliquent » chaque lien d'un mail pour l'analyser (faux clics)
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
      // forme d'avant (edge function / v1 du cockpit) : {trackingId, type, at} sans id ni source
      out.push({ ...e, id: e.id || stableId(l), source: e.source || "track", trackingId: String(e.trackingId || "") })
    } catch { /* ligne cassée : ignorée */ }
  }
  return out
}

async function appendFileEvent(e: OutreachEvent): Promise<"file" | "capped"> {
  try { if ((await stat(EVENTS_FILE)).size >= CAPS.fileBytes) return "capped" } catch { /* pas encore de fichier */ }
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
 * Enregistre un évènement. Base d'abord (si DATABASE_URL), repli fichier si la base manque ou tombe.
 * `stored` : "db" | "file" | "capped" (refusé par un plafond, ou doublon d'un id stable).
 */
export async function recordEvent(input: Partial<OutreachEvent> & { type: EventType; source: OutreachEvent["source"] }): Promise<{ stored: "db" | "file" | "capped"; event: OutreachEvent }> {
  const e = normalize(input)
  // « compter puis écrire » n'est sûr qu'une requête à la fois : une rafale de clics simultanés sur le même lien
  // passait toute sous le plafond (34 écrits pour 20, test blitz du 24/10). Les écritures d'un même envoi sont donc
  // mises en file dans ce process (le cockpit est le seul à servir /t/).
  return serialized(e.trackingId || e.id, () => store(e))
}

const queues = new Map<string, Promise<unknown>>()
function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const tail = run.catch(() => { /* l'erreur reste à l'appelant */ })
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
    } catch { /* table absente / base down → repli fichier (jamais perdre un clic) */ }
  }
  return { stored: await appendFileEvent(e), event: e }
}

/** Tous les évènements connus (base + fichier, dédoublonnés par id), triés par date. */
export async function readEvents(o: { sinceIso?: string; types?: EventType[] } = {}): Promise<OutreachEvent[]> {
  const byId = new Map<string, OutreachEvent>()
  const db = tryDb()
  if (db) {
    try {
      const since = o.sinceIso ? new Date(o.sinceIso).getTime() : 0
      const rows = await db.prepare("SELECT id, tracking_id, prospect_id, type, at, url, ua, suspect, source, data_json FROM outreach_events WHERE at >= ? ORDER BY at ASC LIMIT 50000").all(since)
      for (const r of rows) { const e = rowToEvent(r); byId.set(e.id, e) }
    } catch { /* pas de table → fichier seul */ }
  }
  for (const e of await readFileEvents()) if (!byId.has(e.id)) byId.set(e.id, e)
  let out = [...byId.values()]
  if (o.sinceIso) out = out.filter((e) => e.at >= o.sinceIso!)
  if (o.types) out = out.filter((e) => (o.types as string[]).includes(e.type))
  return out.sort((a, b) => a.at.localeCompare(b.at))
}
