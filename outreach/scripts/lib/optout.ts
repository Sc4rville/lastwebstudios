/**
 * optout.ts · LE registre des oppositions, pour TOUTES les voies d'envoi (séquenceur, brouillons Gmail de /out).
 *
 * Une personne qui s'est désinscrite (lien 1-clic, « STOP ») ou a signalé un spam ne doit plus JAMAIS recevoir de
 * prospection (opposition, RGPD art. 21) ; une adresse qui rebondit ne doit plus être relancée tant qu'elle est la même.
 * Sources : l'état du séquenceur (séquences arrêtées) ET le journal d'évènements (une désinscription arrivée après la
 * fin d'une séquence n'est que là). Avant le test blitz du 24/10, seules les séquences VIVANTES étaient regardées :
 * l'inscription en masse remettait un désinscrit en séquence, et /out pouvait lui préparer un nouveau brouillon.
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
    } catch { /* base indisponible : le fichier */ }
  }
  try { return existsSync(STATE) ? JSON.parse(await readFile(STATE, "utf8")) : [] } catch { return [] }
}
async function loadSendsLike(): Promise<SendLike[]> {
  if (!existsSync(SENDS)) return []
  return (await readFile(SENDS, "utf8")).split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}

/** prospectId → son opposition la plus forte (désinscription ou plainte > bounce). */
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
  try { events = await readEvents({ types: ["unsub", "complaint", "bounce"] }) } catch { /* journal illisible : l'état suffit */ }
  for (const ev of events) {
    const send = ev.trackingId ? sends.find((x) => x.trackingId === ev.trackingId) : undefined
    const pid = send?.prospectId || ev.prospectId
    if (pid && (ev.type === "unsub" || ev.type === "complaint" || ev.type === "bounce")) put(pid, ev.type, ev.at, ev.type === "bounce" ? send?.to ?? lastTo(pid) : undefined)
  }
  return out
}

/** Peut-on écrire à `id` à l'adresse `to` ? Une raison lisible si non. */
export function blockedReason(b: OptOut | undefined, to: string): string {
  if (!b) return ""
  const day = b.at.slice(0, 10)
  if (b.type === "unsub") return `désinscrit le ${day} (opposition) : ne jamais le recontacter`
  if (b.type === "complaint") return `plainte spam le ${day} (opposition) : ne jamais le recontacter`
  if (!b.to || b.to.toLowerCase() === to.toLowerCase()) return `adresse en échec (bounce le ${day}${b.to ? `, ${b.to}` : ""}) : corrige l'e-mail de la fiche`
  return ""
}
