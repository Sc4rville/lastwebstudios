/**
 * sequencer.ts · le SÉQUENCEUR cold-email : joue le funnel tout seul, et ferme les boucles du film.
 *
 * Funnel HONNÊTE (4 étapes, cf. outreach/sequencer/config.json ; les faux mails de plainte sont retirés) :
 *   mail-parfait → [clic] demo-perso → [clic] article-seo → [clic] contenu
 * Répondre à tout stade → stop (replied) + Hot Lead. À une étape GATÉE ("clicked"), si le prospect n'a pas
 * cliqué depuis le mail précédent → escalade stoppée (nurturing). Rotation des boîtes + throttle (anti-spam).
 *
 * ENVOI RÉEL = DEUX CLÉS, sinon DRY-RUN (fail-closed) :
 *   1. `outreach/sequencer/config.json` porte `"dryRun": false` (absent, faute de frappe, autre valeur → dry-run)
 *   2. l'environnement porte `LWS_LIVE_SEND=1`
 * `dryRun:false` sans `LWS_LIVE_SEND=1` → refus EXPLICITE (code 2, rien n'avance). En dry-run, le tick écrit le
 * message COMPLET qui partirait (liens signés, en-têtes de désinscription) dans data/sequencer/outbox/*.eml et
 * le trace dans data/sequencer/sends.jsonl (dryRun:true). Aucun appel au transport mail.
 *
 * CONTENU MANQUANT = ÉTAPE TENUE, jamais de placeholder : si le mail d'une étape (data/<source>/<id>.json)
 * n'existe pas encore, ou si le prospect n'a pas d'e-mail, la séquence passe en `waiting-content` et reprend
 * d'elle-même au tick qui suit l'arrivée du contenu. Rien n'est envoyé ni tracé entre-temps.
 *
 * UN TICK, DANS L'ORDRE :
 *   0. STOP (fichier `STOP` ou bouton du cockpit) → le tick ne fait RIEN (cf. packages/shared/cage.ts)
 *   1. lecteur de réponses (LWS_REPLY_READER = gmail | file | none, cf. lib/replies.ts) → évènements
 *   2. évènements (tracking /t/ du cockpit, lecteur, CLI ; cf. outreach/tracking/events.ts) → état :
 *      clic → débloque l'escalade · réponse → replied + Hot Lead + learning · désinscription / bounce /
 *      plainte → sortie du prospect
 *   3. disjoncteur (seuils de docs/funnel-strategy.md §6, cf. packages/shared/breaker.ts) : ouvert → aucun envoi
 *   4. envois dus (throttle par boîte et par jour, `perTickPerInbox` optionnel)
 *
 * CLI :
 *   npm run sequencer -- enroll <id|id1,id2,...>   inscrit des prospects (exige leur fiche data/prospects/<id>.json)
 *   npm run sequencer -- tick [--now <ISO>]        un tick (--now simule le temps)
 *   (enroll ne ré-inscrit JAMAIS un désinscrit ni une plainte ; ni une adresse en bounce tant que la fiche la garde ;
 *    ni un prospect qui a répondu, sauf --force)
 *   npm run sequencer -- click <id> [--now <ISO>]  le prospect a cliqué (à la main) → débloque l'escalade
 *   npm run sequencer -- reply <id>                le prospect a répondu (à la main) → stoppe, Hot Lead
 *   npm run sequencer -- drop <id>                 bloque / spam / STOP → sort le prospect
 *   npm run sequencer -- bounce <id> | complaint <id>   adresse morte / plainte spam → sort + compte au disjoncteur
 *   npm run sequencer -- breaker [reset]           état du disjoncteur ; `reset` = réarmement humain
 *   npm run sequencer -- status                    imprime l'état
 *
 * Une seule commande qui écrit l'état à la fois (verrou data/sequencer/.lock + bail `meta.sequencer.lock` en base) :
 * la seconde attend (LWS_SEQ_LOCK_WAIT_MS, défaut 3 min) puis sort en code 75 sans rien faire.
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

const CONFIG = "outreach/sequencer/config.json"
const STATE = "data/sequencer/state.json"
const SENDS = "data/sequencer/sends.jsonl"
const OUTBOX = "data/sequencer/outbox"
const CURSOR = "data/sequencer/reader.json"
const PROSPECTS = "data/prospects"
const PERSONAS = "data/personas"
// où lire le mail selon la source d'un step (persona:* est traité à part)
const SOURCE_DIR: Record<string, string> = { savior: "data/savior", demo: "data/demo", seo: "data/seo", contenu: "data/contenu" }
const SOURCE_LABEL: Record<string, string> = { savior: "mail parfait", demo: "démo perso", seo: "article SEO", contenu: "contenu perso" }
// un « clic » arrivé moins de 60 s après l'envoi = la passerelle mail du destinataire qui scanne les liens
const SCANNER_WINDOW_MS = 60_000

type Step = { id: string; pool: "A" | "B"; delayDays: number; source: string; gate?: "clicked" }
type Inbox = { email: string; throttlePerDay: number }
type Config = { dryRun?: unknown; steps: Step[]; inboxes: { A: Inbox[]; B: Inbox[] }; perTickPerInbox?: number; breaker?: Partial<BreakerThresholds> }
type Send = { prospectId: string; step: string; pool: string; inbox: string; to: string; subject: string; at: string; dryRun: boolean; trackingId: string; tracked?: boolean; links?: number }
type Status = "active" | "waiting-content" | "done" | "dropped" | "replied" | "nurturing"
type Waiting = { step: string; reason: "contenu" | "destinataire"; detail: string; since: string }
type Seq = {
  prospectId: string; step: number; status: Status; enrolledAt: string; nextRunAt: string; clicks: string[]
  sends: { step: string; inbox: string; at: string; trackingId?: string }[]; waiting?: Waiting
  stoppedBy?: { type: string; at: string }
}

/** Une séquence encore « vivante » (peut encore envoyer) : active, ou tenue faute de contenu. */
const isLive = (s: Seq) => s.status === "active" || s.status === "waiting-content"

/**
 * Mode d'envoi, FAIL-CLOSED. Réel seulement si config.dryRun === false (booléen strict) ET LWS_LIVE_SEND=1.
 * `refused` = l'opérateur a demandé le réel dans la config mais l'environnement ne le confirme pas.
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
 * La config VALIDÉE, ou la liste de ses fautes. Avant (test blitz du 24/10) : JSON cassé, `steps` ou `inboxes` absents
 * = pile d'exception en plein tick (après la lecture des réponses) ; `steps: []` terminait SILENCIEUSEMENT toutes les
 * séquences actives ; un pool inconnu passait pour « plein aujourd'hui » ; un délai négatif était accepté.
 */
export function configProblems(cfg: any): string[] {
  const out: string[] = []
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return ["la racine doit être un objet JSON"]
  const pools = cfg.inboxes && typeof cfg.inboxes === "object" && !Array.isArray(cfg.inboxes) ? cfg.inboxes : null
  if (!pools) out.push("« inboxes » manque (attendu : { \"A\": [...], \"B\": [...] })")
  else for (const [k, v] of Object.entries(pools)) {
    if (!Array.isArray(v)) { out.push(`inboxes.${k} doit être une liste`); continue }
    v.forEach((b: any, i: number) => {
      if (!b || typeof b.email !== "string" || !EMAIL_RE.test(b.email)) out.push(`inboxes.${k}[${i}].email invalide`)
      if (!(Number(b?.throttlePerDay) > 0)) out.push(`inboxes.${k}[${i}].throttlePerDay doit être un nombre > 0`)
    })
  }
  if (!Array.isArray(cfg.steps) || !cfg.steps.length) out.push("« steps » manque ou est vide (au moins une étape ; vide, chaque séquence active serait close)")
  else {
    const ids = new Set<string>()
    cfg.steps.forEach((st: any, i: number) => {
      const at = `steps[${i}]${st && typeof st.id === "string" ? ` (${st.id})` : ""}`
      if (!st || typeof st.id !== "string" || !st.id.trim()) out.push(`${at}.id manque`)
      else if (ids.has(st.id)) out.push(`${at}.id en double`)
      else ids.add(st.id)
      if (pools && !Array.isArray(pools[st?.pool])) out.push(`${at}.pool « ${st?.pool} » inconnu (pools : ${Object.keys(pools).join(", ") || "aucun"})`)
      if (typeof st?.delayDays !== "number" || !Number.isFinite(st.delayDays) || st.delayDays < 0) out.push(`${at}.delayDays doit être un nombre ≥ 0`)
      if (typeof st?.source !== "string" || !(st.source in SOURCE_DIR || /^persona:[\w-]+$/.test(st.source))) out.push(`${at}.source « ${st?.source} » inconnue (${Object.keys(SOURCE_DIR).join(", ")}, persona:<slot>)`)
      if (st?.gate !== undefined && st.gate !== "clicked") out.push(`${at}.gate « ${st.gate} » inconnu (seul « clicked » existe)`)
    })
  }
  if (cfg.perTickPerInbox !== undefined && !(Number(cfg.perTickPerInbox) > 0)) out.push("perTickPerInbox doit être un nombre > 0")
  return out
}

class ConfigError extends Error {}
async function loadConfig(): Promise<Config> {
  let raw = ""
  try { raw = await readFile(CONFIG, "utf8") } catch (e) { throw new ConfigError(`✗ ${CONFIG} introuvable (${(e as NodeJS.ErrnoException).code})`) }
  let cfg: unknown
  try { cfg = JSON.parse(raw) } catch (e) { throw new ConfigError(`✗ ${CONFIG} illisible (JSON) : ${(e as Error).message}`) }
  const problems = configProblems(cfg)
  if (problems.length) throw new ConfigError(`✗ ${CONFIG} : ${problems.length} faute(s), rien n'est lu, envoyé ni avancé :\n${problems.map((p) => `  · ${p}`).join("\n")}`)
  return cfg as Config
}
/* L'ÉTAT vit dans la DB PARTAGÉE (table sequencer_state) : le funnel mail est visible depuis TOUTES les
   machines (CRM de Naly, cockpit VM…), pas seulement celle qui fait tourner le séquenceur. Le fichier
   local reste écrit en trace/repli (pas de DATABASE_URL = mode dry-run local pur). */
async function loadState(): Promise<Seq[]> {
  const db = tryDb()
  if (db) {
    try {
      const rows = await db.prepare("SELECT data FROM sequencer_state").all()
      if (rows.length) return rows.map((r: any) => (typeof r.data === "string" ? JSON.parse(r.data) : r.data) as Seq)
    } catch { /* table absente / DB down → repli fichier */ }
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
  } catch { /* best-effort : ne JAMAIS casser un tick pour un souci DB */ }
}
async function loadSends(): Promise<Send[]> {
  if (!existsSync(SENDS)) return []
  return (await readFile(SENDS, "utf8")).split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) as Send } catch { return null } }).filter((x): x is Send => !!x)
}
async function appendSend(s: Send) { await mkdir("data/sequencer", { recursive: true }); await appendFile(SENDS, JSON.stringify(s) + "\n") }

// remonte l'événement mail dans crm_leads.notes_json (outcome 'mail') → visible dans le cockpit d'appel de Yann,
// mêlé aux tentatives d'appel. Best-effort : si pas de DATABASE_URL (local/dry-run), on se contente du log.
async function notifyCrm(id: string, event: string) {
  console.log(`   ↳ CRM ← ${id} : ${event}`)
  const db = tryDb()
  if (!db) return
  try {
    const now = Date.now()
    await db.prepare("INSERT INTO crm_leads(prospect_id, updated_at) VALUES (?,?) ON CONFLICT (prospect_id) DO NOTHING").run(id, now)
    const row = (await db.prepare("SELECT notes_json FROM crm_leads WHERE prospect_id=?").get(id)) as { notes_json?: string } | undefined
    let notes: unknown[] = []
    try { notes = row?.notes_json ? JSON.parse(row.notes_json) : [] } catch { /* json cassé → repart vide */ }
    notes.push({ at: now, outcome: "mail", text: event })
    await db.prepare("UPDATE crm_leads SET notes_json=?, updated_at=? WHERE prospect_id=?").run(JSON.stringify(notes), now, id)
  } catch { /* best-effort : ne JAMAIS casser le tick pour un souci DB */ }
}

// RÉPONSE ⇒ HOT LEAD : le prospect remonte en tête de la file d'appel (« répondu > clic > créneau »). Le badge
// vient de l'état `replied` ; en base, on garantit la carte du CRM (hot / Call 0) et on sort du nurturing.
async function hotLead(id: string) {
  const db = tryDb()
  if (!db) return
  try {
    const now = Date.now()
    await db.prepare("INSERT INTO crm_leads(prospect_id, pipeline, stage, updated_at) VALUES (?,?,?,?) ON CONFLICT (prospect_id) DO NOTHING").run(id, "hot", "call0", now)
    await db.prepare("UPDATE crm_leads SET stage='call0', nurturing_until=NULL, updated_at=? WHERE prospect_id=? AND pipeline='hot' AND stage='nurturing'").run(now, id)
  } catch { /* best-effort */ }
}

// un mail exploitable : objet + corps non vides, et aucun gabarit « [... à générer ...] » oublié dedans
const usable = (m: { subject?: unknown; body?: unknown } | null | undefined): m is { senderName: string; subject: string; body: string } =>
  !!m && typeof m.subject === "string" && typeof m.body === "string" && !!m.subject.trim() && !!m.body.trim()
  && !/\[[^\]]*(à générer|a generer|à vérifier|inconnu)[^\]]*\]/i.test(m.subject + "\n" + m.body)

// le mail d'un step : persona A/B depuis data/personas/<id>.json, sinon le record généré data/<source>/<id>.json.
// null si absent ou inexploitable → l'étape est TENUE (waiting-content), JAMAIS remplacée par un placeholder.
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
// l'e-mail du prospect (fiche), ou "" si absent/invalide → l'étape est tenue (jamais d'envoi à un placeholder)
async function recipient(id: string): Promise<string> {
  const f = join(PROSPECTS, `${id}.json`)
  if (!existsSync(f)) return ""
  let fiche: any
  try { fiche = JSON.parse(await readFile(f, "utf8")) } catch { return "" }
  const email = String(fiche?.identity?.email || "").trim()
  return EMAIL_RE.test(email) ? email : ""
}

// choisit la boîte du pool avec le MOINS d'envois aujourd'hui, sous le throttle (jour + tick) ; null si toutes pleines
function pickInbox(pool: "A" | "B", cfg: Config, sends: Send[], nowIso: string, thisTick: Map<string, number>): { box: Inbox | null; why: "jour" | "tick" } {
  const today = dayKey(nowIso)
  const boxes = cfg.inboxes[pool] || []
  const countToday = (email: string) => sends.filter((s) => s.inbox === email && dayKey(s.at) === today).length
  const underDay = boxes.filter((b) => countToday(b.email) < b.throttlePerDay)
  const perTick = Number(cfg.perTickPerInbox) > 0 ? Number(cfg.perTickPerInbox) : Infinity
  const avail = underDay.filter((b) => (thisTick.get(b.email) || 0) < perTick).sort((a, b) => countToday(a.email) - countToday(b.email))
  return { box: avail[0] || null, why: underDay.length ? "tick" : "jour" }
}

// la séquence vivante concernée par un évènement : par l'envoi (trackingId), sinon par le prospect. Un évènement
// antérieur à l'inscription (ancienne séquence) ne touche pas une séquence plus récente.
function seqFor(ev: OutreachEvent, state: Seq[], sends: Send[]): { seq: Seq; send?: Send } | null {
  const send = ev.trackingId ? sends.find((s) => s.trackingId === ev.trackingId) : undefined
  const pid = send?.prospectId || ev.prospectId
  if (!pid) return null
  const seq = state.find((s) => s.prospectId === pid && isLive(s) && ev.at >= s.enrolledAt)
  return seq ? { seq, send } : null
}

const STOP_LABEL: Record<string, string> = { unsub: "s'est désinscrit → drop", bounce: "adresse morte (bounce) → drop", complaint: "plainte spam → drop, et compte au disjoncteur" }

// applique UNE réponse : stop, Hot Lead, learning. Idempotent (seulement depuis une séquence vivante).
async function applyReply(seq: Seq, at: string) {
  seq.status = "replied"; delete seq.waiting; seq.stoppedBy = { type: "reply", at }
  await notifyCrm(seq.prospectId, "A RÉPONDU → Hot Lead, à appeler")
  await hotLead(seq.prospectId)
  try { await recordOutcome(seq.prospectId, "reply", { source: "sequencer", at }) } catch { /* le learning ne casse jamais un tick */ }
}

// ingère les évènements (tracking /t/ du cockpit, lecteur de réponses, CLI) → état des séquences. Rejouable :
// chaque transition part d'une séquence vivante, un clic déjà compté (même horodatage) ne l'est pas deux fois.
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
      if (!seq.clicks.includes(ev.at)) { seq.clicks.push(ev.at); n.clicks++; await notifyCrm(seq.prospectId, "a cliqué (tracking)") }
    } else if (ev.type === "reply") {
      await applyReply(seq, ev.at); n.replies++
    } else if (ev.type === "unsub" || ev.type === "bounce" || ev.type === "complaint") {
      seq.status = "dropped"; delete seq.waiting; seq.stoppedBy = { type: ev.type, at: ev.at }; n.stops++
      await notifyCrm(seq.prospectId, STOP_LABEL[ev.type])
    }
  }
  return n
}

// LECTEUR DE RÉPONSES : lit chaque boîte depuis son curseur, classe, et ÉCRIT des évènements (id stable par
// message → un message relu au tick suivant ne compte pas deux fois). Une boîte en panne ne casse pas le tick.
async function readReplies(reader: ReplyReader, cfg: Config, state: Seq[], sends: Send[], nowIso: string): Promise<{ read: number; recorded: number; ignored: number }> {
  const out = { read: 0, recorded: 0, ignored: 0 }
  if (reader.name === "none") return out
  const live = state.filter(isLive)
  if (!live.length) return out
  const known = new Map<string, string>()
  for (const s of sends) if (live.some((q) => q.prospectId === s.prospectId) && s.to) known.set(s.to.toLowerCase(), s.prospectId)
  for (const q of live) { const e = await recipient(q.prospectId); if (e) known.set(e.toLowerCase(), q.prospectId) }
  let cursor: Record<string, string> = {}
  try { if (existsSync(CURSOR)) cursor = JSON.parse(await readFile(CURSOR, "utf8")) } catch { /* repart du début */ }
  const oldest = live.map((q) => q.enrolledAt).sort()[0]
  const lastTid = (pid: string) => [...sends].reverse().find((s) => s.prospectId === pid)?.trackingId || ""
  const inboxes = [...new Set([...(cfg.inboxes.A || []), ...(cfg.inboxes.B || [])].map((b) => b.email))]
  for (const inbox of inboxes) {
    let msgs: Awaited<ReturnType<ReplyReader["fetch"]>> = []
    try { msgs = await reader.fetch(inbox, cursor[inbox] || oldest) }
    catch (e) { console.warn(`⚠ lecteur ${reader.name} : ${inbox} illisible (${(e as Error).message.slice(0, 160)})`); continue }
    for (const m of msgs) {
      if (m.at > nowIso) continue // --now simule le temps : un message « futur » sera lu plus tard
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

// a-t-il cliqué DEPUIS le dernier mail envoyé ? (gate de l'escalade)
function clickedSinceLastSend(seq: Seq): boolean {
  const lastSendAt = seq.sends.length ? seq.sends[seq.sends.length - 1].at : seq.enrolledAt
  return (seq.clicks || []).some((c) => c > lastSendAt)
}

// un évènement saisi à la main (CLI), rattaché au dernier envoi du prospect
async function manualEvent(type: "click" | "reply" | "unsub" | "bounce" | "complaint", id: string, sends: Send[], nowIso: string) {
  const last = [...sends].reverse().find((s) => s.prospectId === id)
  return recordEvent({ type, source: "cli", prospectId: id, trackingId: last?.trackingId || "", at: nowIso })
}

/** Les commandes qui ÉCRIVENT l'état (state.json, sends.jsonl, la base) : une seule à la fois (verrou). */
export function writesState(cmd: string | undefined, arg?: string): boolean {
  return ["enroll", "tick", "click", "reply", "drop", "bounce", "complaint"].includes(cmd || "") || (cmd === "breaker" && arg === "reset")
}

async function main() {
  try { process.loadEnvFile() } catch { /* pas de .env → notifyCrm restera en log-only */ }
  const cmd = process.argv[2]
  // VERROU : un tick à la main pendant celui du timer (ou d'une autre machine sur la même base) lisait le même état
  // et renvoyait la même étape au même prospect. Le second attend, puis voit l'étape faite (cf. packages/shared/lock.ts).
  if (!writesState(cmd, process.argv[3])) return run(cmd)
  const lock = await acquireLock({ file: "data/sequencer/.lock", dbKey: "sequencer.lock", cmd: `sequencer ${cmd}`, waitMs: Number(process.env.LWS_SEQ_LOCK_WAIT_MS) || 180_000 })
  if (!lock) {
    console.error(`✗ séquenceur déjà en cours ailleurs : « ${cmd} » n'a rien fait (ni lu, ni envoyé, ni avancé). Réessaie plus tard.`)
    process.exitCode = 75 // EX_TEMPFAIL : le timer réessaiera au prochain passage
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
    if (!ids.length) { console.error("usage : npm run sequencer -- enroll <id1,id2,...> [--force]"); process.exitCode = 1; return }
    const force = process.argv.includes("--force")
    // OPPOSITIONS (test blitz du 24/10) : enroll ne regardait que les séquences vivantes ; l'inscription en masse
    // remettait en séquence quelqu'un qui avait dit STOP (ou dont l'adresse rebondit), et le tick suivant lui réécrivait.
    const blocks = await optOuts({ state, sends: await loadSends() })
    for (const id of ids) {
      // le funnel honnête n'a plus besoin de personas (faux mails de plainte retirés) : il faut juste la fiche
      if (!/^[\w.-]+$/.test(id) || !existsSync(join(PROSPECTS, `${id}.json`))) { console.log(`⏭  ${id} : fiche data/prospects/${id}.json introuvable → pas inscrit`); continue }
      if (state.find((s) => s.prospectId === id && isLive(s))) { console.log(`⏭  ${id} : déjà en séquence active`); continue }
      const b = blocks.get(id)
      if (b && (b.type === "unsub" || b.type === "complaint")) { console.log(`⛔ ${id} : ${b.type === "unsub" ? "désinscrit" : "plainte spam"} le ${dayKey(b.at)} (opposition) → jamais ré-inscrit, même avec --force`); continue }
      if (b && b.type === "bounce" && (!b.to || b.to === (await recipient(id)))) { console.log(`⛔ ${id} : adresse en échec (bounce le ${dayKey(b.at)}${b.to ? `, ${b.to}` : ""}) → corrige l'e-mail de la fiche pour le ré-inscrire`); continue }
      const replied = state.find((s) => s.prospectId === id && s.status === "replied")
      if (replied && !force) { console.log(`⏭  ${id} : a déjà répondu (${dayKey(replied.stoppedBy?.at || replied.enrolledAt)}) → c'est au CRM de reprendre la main (--force pour relancer quand même)`); continue }
      state.push({ prospectId: id, step: 0, status: "active", enrolledAt: nowIso, nextRunAt: nowIso, clicks: [], sends: [] })
      console.log(`✅ ${id} inscrit (départ ${dayKey(nowIso)})`)
    }
    await saveState(state)
    return
  }

  if (cmd === "click") {
    const id = process.argv[3]
    const seq = state.find((s) => s.prospectId === id && isLive(s))
    if (!seq) { console.log(`${id} : pas de séquence active`); return }
    seq.clicks = seq.clicks || []
    seq.clicks.push(nowIso)
    await saveState(state)
    await manualEvent("click", id, await loadSends(), nowIso)
    console.log(`👆 ${id} : clic enregistré (${dayKey(nowIso)}) → l'escalade pourra continuer`)
    await notifyCrm(id, "a cliqué (lien RDV/site)")
    return
  }

  if (cmd === "reply" || cmd === "drop" || cmd === "bounce" || cmd === "complaint") {
    const id = process.argv[3]
    const seq = state.find((s) => s.prospectId === id && isLive(s))
    if (!seq) { console.log(`${id} : pas de séquence active`); return }
    if (cmd === "reply") { await manualEvent("reply", id, await loadSends(), nowIso); await applyReply(seq, nowIso) }
    else {
      if (cmd !== "drop") await manualEvent(cmd, id, await loadSends(), nowIso)
      seq.status = "dropped"; delete seq.waiting; seq.stoppedBy = { type: cmd, at: nowIso }
      if (cmd !== "drop") await notifyCrm(id, STOP_LABEL[cmd])
    }
    await saveState(state)
    console.log(`🛑 ${id} → ${seq.status} (séquence stoppée, plus aucun mail)${cmd === "bounce" || cmd === "complaint" ? " · compté au disjoncteur" : ""}`)
    return
  }

  if (cmd === "breaker") {
    if (process.argv[3] === "reset") {
      const s = resetBreaker(await loadBreaker(), nowIso)
      await saveBreaker(s)
      console.log(`🔁 disjoncteur réarmé (${nowIso}) : les incidents d'avant ne comptent plus. Vérifie la cause avant de relancer les envois.`)
      return
    }
    const b = await loadBreaker()
    if (!b) return console.log("disjoncteur : jamais évalué (aucun tick encore)")
    console.log(`disjoncteur : ${b.open ? "⛔ OUVERT" : "✓ fermé"} · ${b.counts.sends} envoi(s) depuis ${b.since.slice(0, 10)} · bounces ${b.counts.bounce} · plaintes ${b.counts.complaint} · désinscriptions ${b.counts.unsub}`)
    for (const r of b.reasons) console.log(`  · ${r}`)
    return
  }

  if (cmd === "status") {
    const stop = await stopState(), b = await loadBreaker()
    if (stop.on) console.log(`⏹ STOP actif (${stop.source} : ${stop.reason})`)
    if (b?.open) console.log(`⛔ disjoncteur ouvert : ${b.reasons.join(" ; ")}`)
    if (!state.length) return console.log("(aucune séquence)")
    for (const s of state) {
      const stepName = isLive(s) ? (cfg.steps[s.step]?.id ?? "fin") : s.status
      const wait = s.status === "waiting-content" && s.waiting ? ` · tenu : ${s.waiting.detail}` : ""
      console.log(`· ${s.prospectId.padEnd(34)} ${s.status.padEnd(15)} step ${s.step} (${stepName}) · prochain ${s.status === "active" ? dayKey(s.nextRunAt) : "-"} · ${s.sends.length} envoi(s) · ${(s.clicks || []).length} clic(s)${wait}`)
    }
    return
  }

  if (cmd === "tick") {
    // 0. l'arrêt d'urgence passe AVANT tout : rien n'est lu, envoyé, ni avancé
    const stop = await stopState()
    if (stop.on) {
      console.log(`⏹ STOP (${stop.source} : ${stop.reason}) : le séquenceur ne tick pas. Rien n'est lu, envoyé ni avancé.`)
      console.log(`  Reprendre : ${stop.source === "fichier" ? "rm STOP" : "bouton « reprendre » du cockpit"}`)
      return
    }
    const mode = sendMode(cfg)
    if (mode.refused) {
      console.error("✗ ENVOI RÉEL REFUSÉ : outreach/sequencer/config.json demande dryRun:false, mais LWS_LIVE_SEND=1 n'est pas posé.")
      console.error("  Rien n'a été envoyé ni avancé. Pour envoyer pour de vrai : LWS_LIVE_SEND=1 npm run sequencer -- tick")
      process.exitCode = 2
      return
    }
    console.log(mode.live ? "🔴 ENVOI RÉEL (config.dryRun=false + LWS_LIVE_SEND=1)" : "🟢 DRY-RUN : aucun mail ne part (envoi réel = config.dryRun:false ET LWS_LIVE_SEND=1)")
    // en réel sans tracking : ni désinscription 1-clic (List-Unsubscribe) ni clic suivi → l'escalade gatée meurt en silence
    if (mode.live && !trackConfig()) console.error("⚠ ENVOI RÉEL SANS TRACKING (TRACK_BASE + LWS_TRACK_SECRET ≥ 32 caractères) : pas de désinscription 1-clic dans les mails, aucun clic vu, les étapes « gatées au clic » ne partiront jamais. npm run doctor le signale.")
    const sends = await loadSends()

    // 1. réponses (lecteur branchable) → évènements
    const reader = selectReader()
    const rd = await readReplies(reader, cfg, state, sends, nowIso)
    if (reader.name !== "none") console.log(`📥 lecteur ${reader.name} : ${rd.read} message(s) lu(s), ${rd.recorded} évènement(s), ${rd.ignored} ignoré(s)`)

    // 2. évènements → état (clic, réponse, désinscription, bounce, plainte)
    const events = (await readEvents()).filter((e) => e.at <= nowIso)
    const ing = await ingestEvents(state, sends, events)
    if (ing.clicks || ing.replies || ing.stops || ing.scanners) console.log(`📬 évènements : ${ing.clicks} clic(s), ${ing.replies} réponse(s), ${ing.stops} sortie(s)${ing.scanners ? `, ${ing.scanners} clic(s) de scanner ignoré(s)` : ""}`)

    // 3. disjoncteur (verrouillé une fois ouvert)
    const breaker = evaluateBreaker({ sends, events, now: nowIso, prev: await loadBreaker(), thresholds: cfg.breaker })
    await saveBreaker(breaker)
    if (breaker.open) {
      console.log(`⛔ DISJONCTEUR OUVERT : ${breaker.reasons.join(" ; ")}`)
      console.log("  → aucun envoi tant qu'un humain n'a pas regardé (réarmer : npm run sequencer -- breaker reset, ou le cockpit)")
      await saveState(state)
      console.log(`\n✓ tick ${dayKey(nowIso)} : 0 envoi (disjoncteur ouvert).`)
      return
    }

    // 4. envois dus
    let acted = 0, deferred = 0, stopped = 0, held = 0, failed = 0
    const thisTick = new Map<string, number>()
    for (const seq of state) {
      if (!isLive(seq) || seq.nextRunAt > nowIso) continue
      if (seq.step >= cfg.steps.length) { seq.status = "done"; delete seq.waiting; continue }
      const step = cfg.steps[seq.step]
      // gate : on n'escalade que si le prospect a cliqué depuis le mail précédent
      if (step.gate === "clicked" && !clickedSinceLastSend(seq)) {
        seq.status = "nurturing"
        console.log(`⏹  ${seq.prospectId} : pas de clic sur le mail précédent → escalade stoppée (nurturing)`)
        await notifyCrm(seq.prospectId, "pas de clic → nurturing")
        stopped++
        continue
      }
      // CONTENU + DESTINATAIRE d'abord : sans eux l'étape est TENUE (jamais de placeholder envoyé ni tracé)
      const mail = await mailFor(seq.prospectId, step)
      const to = mail ? await recipient(seq.prospectId) : ""
      if (!mail || !to) {
        const label = SOURCE_LABEL[step.source] || step.source
        const waiting: Waiting = mail
          ? { step: step.id, reason: "destinataire", detail: `pas d'e-mail valide dans data/prospects/${seq.prospectId}.json`, since: seq.waiting?.since || nowIso }
          : { step: step.id, reason: "contenu", detail: `${label} pas encore généré (${SOURCE_DIR[step.source] || step.source}/${seq.prospectId}.json)`, since: seq.waiting?.since || nowIso }
        if (seq.status !== "waiting-content" || seq.waiting?.detail !== waiting.detail) {
          console.log(`⏸  ${seq.prospectId} : étape « ${step.id} » tenue, ${waiting.detail} → reprend dès qu'il existe`)
          await notifyCrm(seq.prospectId, `mail « ${step.id} » en attente : ${waiting.reason}`)
        }
        seq.status = "waiting-content"; seq.waiting = waiting
        held++
        continue
      }
      const { box, why } = pickInbox(step.pool, cfg, sends, nowIso, thisTick)
      if (!box) {
        if (why === "jour") { console.log(`⏳ ${seq.prospectId} : pool ${step.pool} plein aujourd'hui (throttle) → reporté à demain`); seq.nextRunAt = addDays(nowIso, 1) }
        else console.log(`⏳ ${seq.prospectId} : plafond par tick atteint → au prochain tick`)
        deferred++; continue
      }
      if (seq.status === "waiting-content") { seq.status = "active"; delete seq.waiting } // le contenu est arrivé
      const trackingId = randomUUID()
      const opts = { inbox: box.email, to, subject: mail.subject, body: mail.body, senderName: mail.senderName, trackingId, prospectId: seq.prospectId }
      // le message COMPLET (liens signés + en-têtes de désinscription) : écrit en .eml, envoyé tel quel en réel.
      // Un envoi qui échoue (API Gmail en panne, jeton refusé…) ne casse pas le tick : rien n'avance pour CE
      // prospect (réessai au tick suivant), les autres partent, et le tick finit en code 1 (alerte systemd).
      let msg: BuiltMessage
      try { msg = mode.live ? await sendMail(opts) : buildMessage(opts) }
      catch (e) {
        failed++
        console.error(`✗ ${seq.prospectId} : envoi « ${step.id} » échoué (${(e as Error).message.slice(0, 240)}) → réessai au prochain tick, rien n'avance`)
        await notifyCrm(seq.prospectId, `mail « ${step.id} » : échec d'envoi, réessai au prochain tick`)
        continue
      }
      await mkdir(OUTBOX, { recursive: true })
      const eml = join(OUTBOX, `${dayKey(nowIso)}-${trackingId}.eml`)
      await writeFile(eml, msg.rfc822)
      if (!mode.live) {
        console.log(`📨 DRY-RUN → [${step.id}] de ${box.email} → ${seq.prospectId} (${to})`)
        console.log(`      objet : « ${mail.subject} »  (signé ${mail.senderName}) · ${msg.tracked ? `${msg.links.length} lien(s) suivi(s), désinscription 1-clic` : "sans tracking (TRACK_BASE + LWS_TRACK_SECRET absents)"} · ${eml}`)
      }
      const send: Send = { prospectId: seq.prospectId, step: step.id, pool: step.pool, inbox: box.email, to, subject: mail.subject, at: nowIso, dryRun: !mode.live, trackingId, tracked: msg.tracked, links: msg.links.length }
      await appendSend(send)
      sends.push(send)
      thisTick.set(box.email, (thisTick.get(box.email) || 0) + 1)
      const firstMail = seq.sends.length === 0
      seq.sends.push({ step: step.id, inbox: box.email, at: nowIso, trackingId })
      await notifyCrm(seq.prospectId, mode.live ? `mail envoyé : ${step.id}` : `mail simulé (dry-run) : ${step.id}`)
      // learning : le 1er VRAI mail fait du prospect un essai (« sent »), même s'il ne répond jamais ; sans ça, la boucle
      // ne voyait que ceux qui réagissent. Jamais en dry-run (une simulation n'est pas un essai). Une fois par prospect.
      if (mode.live && firstMail) { try { await recordOutcome(seq.prospectId, "sent", { source: "sequencer", at: nowIso }) } catch { /* le learning ne casse jamais un tick */ } }
      seq.step++
      if (seq.step >= cfg.steps.length) seq.status = "done"
      else seq.nextRunAt = addDays(nowIso, cfg.steps[seq.step].delayDays)
      acted++
      // en réel, l'état est écrit APRÈS CHAQUE ENVOI : un tick tué en plein vol ne renverra jamais le même mail
      if (mode.live) await saveState(state)
    }
    await saveState(state)
    console.log(`\n${failed ? "✗" : "✓"} tick ${dayKey(nowIso)} : ${acted} ${mode.live ? "envoi(s)" : "envoi(s) simulé(s)"}, ${held} tenu(s) (contenu manquant), ${deferred} reporté(s), ${stopped} arrêté(s) (pas de clic)${failed ? `, ${failed} échec(s) d'envoi (réessai au prochain tick)` : ""}.`)
    if (failed) process.exitCode = 1
    return
  }

  console.error(`${cmd ? `cmd inconnue « ${cmd} ». ` : ""}usage : npm run sequencer -- enroll <ids> | tick [--now <ISO>] | click <id> | reply <id> | drop <id> | bounce <id> | complaint <id> | breaker [reset] | status`)
  process.exitCode = 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().then(() => closeDb()).catch((e) => {
  if (e instanceof ConfigError) { console.error(e.message); closeDb(); process.exit(78) } // EX_CONFIG : à corriger par un humain
  console.error(e); closeDb(); process.exit(1)
})
