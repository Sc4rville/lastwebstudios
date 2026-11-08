/**
 * warmup.ts · a home-made warmup engine for the 6 Google Workspace mailboxes (same keys/delegation as the sequencer).
 * The mailboxes write to each other HUMAN-looking 1:1 email (no bulk footer, no List-Unsubscribe),
 * with threaded replies → an engagement signal that builds the domains' reputation BEFORE the first cold email.
 * Ramp-up: day 1 = 2 emails/mailbox/day, +2 each day, cap 20 (≈10 days to warm up).
 *
 * KNOWN LIMITS (honesty, no false comfort):
 *  - INTRA-ORG warmup (6 mailboxes, 3 domains, the same Google tenant): weaker than an EXTERNAL (paid) pool.
 *    Google discounts internal mail. It beats nothing and it is free; real cold email still waits ~10-14 days.
 *  - Marking read/important + RESCUING FROM SPAM needs the gmail.modify scope (not delegated yet). Here send+reply only.
 *    Adding gmail.modify in the Google admin (1 toggle on the client ID already delegated) unlocks the spam rescue.
 *  - The warmup emails themselves are French colleague-to-colleague notes (the team's own mailboxes): content, kept as is.
 *
 * DRY-RUN BY DEFAULT (fail-closed): without `LWS_LIVE_SEND=1`, NOTHING goes out (no send, no reply, no
 * Gmail rescue) and nothing is written to data/warmup/; the tick says what it WOULD have done. On the box, the warmup's
 * systemd unit must therefore carry `Environment=LWS_LIVE_SEND=1` (see NIGHT/REPORT.md « À faire au merge »).
 *
 * Usage:
 *   npm run warmup                       # one tick (dry-run unless LWS_LIVE_SEND=1): today's target (ramp) + a few replies
 *   npm run warmup -- tick               # the same, explicit
 *   npm run warmup -- status             # where it stands: ramp day, target/day, sent today (read only)
 *   npm run warmup -- digest             # today's report sent to DIGEST_TO (REQUIRED, no default recipient)
 *   npm run warmup -- once <from> <to>   # test: a single email from one mailbox to another (real only if LWS_LIVE_SEND=1)
 *
 * STOP (the `STOP` file at the root or the cockpit's button, see packages/shared/cage.ts): tick, digest and once do
 * NOTHING while it is set (status stays readable). Resumes on its own at the next timer once lifted.
 */
import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { stopState } from "../../packages/shared/cage.ts"
import { closeDb } from "../../packages/shared/db.ts"
import { acquireLock } from "../../packages/shared/lock.ts"
import { selectTransport } from "./lib/smtp.ts"

try { process.loadEnvFile() } catch { /* no .env: read the environment (systemd unit) */ }

/** Real sending only if LWS_LIVE_SEND=1 (read at call time: the tests and the systemd unit set it). */
const isLive = () => process.env.LWS_LIVE_SEND === "1"

const SA_KEY = "outreach/sequencer/sa-key.json"
const CONFIG = "outreach/sequencer/config.json"
const DIR = "data/warmup"
const LOG = `${DIR}/log.jsonl`
const STATE = `${DIR}/state.json`

const PER_TICK = 2          // at most 2 sends/mailbox/tick (the timer runs ~10 times/day → smoothing)
const REPLY_PROB = 0.45     // share of received emails that get a reply
const REPLY_CAP = 3         // at most 3 replies/mailbox/tick
const REPLY_MIN_AGE_MIN = 25 // only reply to an email received > 25 min ago (natural)

type LogEntry = { at: string; from: string; to: string; kind: "send" | "reply"; msgId: string; inReplyTo?: string }

// colleague-to-colleague looking emails, short, no spammy word (French content: the team's own mailboxes).
const THREADS: { subject: string; body: string }[] = [
  { subject: "Point rapide", body: "Hello,\n\nJe fais le point cet aprèm sur les sites en cours, tu veux qu'on cale 15 min ?\n\nÀ tout." },
  { subject: "Le doc est prêt", body: "Salut,\n\nJ'ai fini la partie que tu attendais, dis-moi ce que tu en penses quand tu as un moment.\n\nMerci !" },
  { subject: "Retour client", body: "Hello,\n\nLe client a répondu, globalement content, deux ajustements à voir ensemble. On en parle demain ?\n\n++" },
  { subject: "Idée pour la home", body: "Salut,\n\nJ'ai une idée pour le haut de la page d'accueil, je te montre vite fait tout à l'heure.\n\nÀ toi." },
  { subject: "On cale le call ?", body: "Hello,\n\nTu es dispo jeudi ou vendredi pour le point hebdo ? Je bloque le créneau.\n\nMerci." },
  { subject: "Récap semaine", body: "Salut,\n\nPetit récap : deux sites livrés, un en relecture. Le reste avance bien. Bonne journée !" },
  { subject: "Relecture", body: "Hello,\n\nTu peux jeter un œil au texte avant que je l'envoie ? C'est pas long, 5 min max.\n\nMerci d'avance." },
  { subject: "Petite question", body: "Salut,\n\nRapide : on part sur quelle version pour la couleur du bouton ? J'hésite encore.\n\nDis-moi." },
]
const REPLIES = [
  "Oui c'est bon pour moi, on fait comme ça.",
  "Nickel, merci ! Je regarde ça et je te dis.",
  "Ça marche. Je te rappelle après.",
  "Parfait, rien à ajouter de mon côté.",
  "Ok pour moi, cale le créneau quand tu veux.",
  "Vu, c'est clair. On avance.",
]

function pick<T>(a: T[]): T { return a[Math.floor(Math.random() * a.length)] }
function dayKey(iso: string): string { return iso.slice(0, 10) }
function domainOf(email: string): string { return email.split("@")[1] }
function msgId(email: string): string { return `<${Math.random().toString(36).slice(2)}.${Date.now()}@${domainOf(email)}>` }
function nameOf(email: string): string { const u = email.split("@")[0].split(".")[0]; return u.charAt(0).toUpperCase() + u.slice(1) }

function hdr(v: string): string { return /^[\x00-\x7F]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=` }

type Mail = { from: string; to: string; subject: string; body: string; msgId: string; inReplyTo?: string }

/** The SINGLE sending point: dry-run (log only) unless LWS_LIVE_SEND=1. */
async function deliver(o: Mail): Promise<void> {
  if (!isLive()) { console.log(`  DRY-RUN: ${o.from} → ${o.to} "${o.subject}"${o.inReplyTo ? " (reply)" : ""}`); return }
  await sendRaw(o)
}

async function sendRaw(o: Mail): Promise<void> {
  const bodyB64 = Buffer.from(o.body, "utf8").toString("base64").replace(/(.{1,76})/g, "$1\r\n")
  const lines = [
    `From: ${hdr(nameOf(o.from))} <${o.from}>`,
    `To: ${o.to}`,
    `Subject: ${hdr(o.subject)}`,
    `Message-ID: ${o.msgId}`,
  ]
  if (o.inReplyTo) { lines.push(`In-Reply-To: ${o.inReplyTo}`, `References: ${o.inReplyTo}`) }
  lines.push(`MIME-Version: 1.0`, `Content-Type: text/plain; charset="UTF-8"`, `Content-Transfer-Encoding: base64`, ``, bodyB64)
  const raw = Buffer.from(lines.join("\r\n"), "utf8").toString("base64url")
  // the transport shared with the sequencer (lib/smtp.ts): Gmail in production, `simulated` in tests (LWS_MAIL_TRANSPORT)
  await selectTransport().send(o.from, raw, { to: o.to, subject: o.subject, trackingId: "" })
}

// gmail.modify scope token (spam rescue + marking) · needs the scope delegated in the Google admin.
async function modToken(inbox: string): Promise<string> {
  const sa = JSON.parse(await readFile(SA_KEY, "utf8"))
  const { JWT }: any = await import("google-auth-library")
  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ["https://www.googleapis.com/auth/gmail.modify"], subject: inbox })
  const { access_token } = await jwt.authorize()
  if (!access_token) throw new Error(`no modify token for ${inbox} (gmail.modify scope delegated?)`)
  return access_token
}

// RESCUE: takes the warmup emails out of spam, marks them read + important (the strongest engagement signals).
// Handles the emails received from the 3 home domains over 2 days. Returns the number of emails handled.
async function rescue(box: string, domains: string[]): Promise<number> {
  const t = await modToken(box)
  const auth = { Authorization: `Bearer ${t}` }
  const q = encodeURIComponent(`in:anywhere newer_than:2d from:(${domains.map((d) => "@" + d).join(" OR ")})`)
  const list = await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=100`, { headers: auth })).json()
  const ids = (list.messages ?? []).map((m: any) => m.id)
  if (!ids.length) return 0
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify", {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ ids, addLabelIds: ["INBOX", "IMPORTANT"], removeLabelIds: ["SPAM", "UNREAD"] }),
  })
  if (!r.ok) throw new Error(`batchModify ${r.status} (${box}): ${(await r.text()).slice(0, 200)}`)
  return ids.length
}

async function loadLog(): Promise<LogEntry[]> {
  if (!existsSync(LOG)) return []
  return (await readFile(LOG, "utf8")).split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) as LogEntry } catch { return null } }).filter((x): x is LogEntry => !!x)
}
// in dry-run NOTHING is logged (the log drives the ramp-up: a fake send would skew it)
async function log(e: LogEntry): Promise<void> { if (!isLive()) return; await mkdir(DIR, { recursive: true }); await appendFile(LOG, JSON.stringify(e) + "\n") }

async function boxes(): Promise<string[]> {
  const cfg = JSON.parse(await readFile(CONFIG, "utf8"))
  return [...cfg.inboxes.A, ...cfg.inboxes.B].map((b: any) => b.email)
}

// ramp-up day. The start date is WRITTEN only at the first REAL tick (status/dry-run: read only)
async function rampDay(persist = isLive()): Promise<{ start: string; day: number; target: number }> {
  let start: string
  if (existsSync(STATE)) { start = JSON.parse(await readFile(STATE, "utf8")).startDate }
  else {
    start = new Date().toISOString().slice(0, 10)
    if (persist) { await mkdir(DIR, { recursive: true }); await writeFile(STATE, JSON.stringify({ startDate: start }, null, 2)) }
  }
  const days = Math.floor((Date.now() - new Date(start + "T00:00:00Z").getTime()) / 86400000) + 1
  return { start, day: days, target: Math.min(2 * days, 20) }
}

async function tick(): Promise<void> {
  const all = await boxes()
  const domains = [...new Set(all.map(domainOf))]
  const { day, target } = await rampDay()
  const hist = await loadLog()
  const today = new Date().toISOString().slice(0, 10)
  const nowMs = Date.now()
  const repliedTo = new Set(hist.filter((e) => e.kind === "reply" && e.inReplyTo).map((e) => e.inReplyTo))
  let sent = 0, replied = 0, rescued = 0
  const live = isLive()
  if (!live) console.log("🟢 warmup DRY-RUN: no email goes out, nothing is logged (real sending: LWS_LIVE_SEND=1)")

  // 0) RESCUE: lift out of spam + mark read/important the warmups already received (gmail.modify scope). Real only.
  if (live && selectTransport().name === "gmail") for (const box of all) { try { rescued += await rescue(box, domains) } catch (e: any) { console.error(`  rescue ${box}: ${e.message}`) } }

  for (const from of all) {
    // 1) SENDS: fill today's target, capped per tick
    const doneToday = hist.filter((e) => e.kind === "send" && e.from === from && dayKey(e.at) === today).length
    const room = Math.max(0, target - doneToday)
    for (let i = 0; i < Math.min(PER_TICK, room); i++) {
      const to = pick(all.filter((b) => b !== from))
      const t = pick(THREADS)
      const id = msgId(from)
      await deliver({ from, to, subject: t.subject, body: t.body, msgId: id })
      const at = new Date().toISOString()
      await log({ at, from, to, kind: "send", msgId: id }); hist.push({ at, from, to, kind: "send", msgId: id }); sent++
    }
    // 2) REPLIES: reply to a few received emails (kind send, to=from), old enough, not already answered
    const inbox = hist.filter((e) => e.kind === "send" && e.to === from && !repliedTo.has(e.msgId)
      && (nowMs - new Date(e.at).getTime()) / 60000 > REPLY_MIN_AGE_MIN)
    let n = 0
    for (const orig of inbox) {
      if (n >= REPLY_CAP) break
      if (Math.random() > REPLY_PROB) continue
      const id = msgId(from)
      await deliver({ from, to: orig.from, subject: `Re: ${pick(THREADS).subject}`, body: pick(REPLIES), msgId: id, inReplyTo: orig.msgId })
      const at = new Date().toISOString()
      await log({ at, from, to: orig.from, kind: "reply", msgId: id, inReplyTo: orig.msgId })
      repliedTo.add(orig.msgId); replied++; n++
    }
  }
  console.log(`warmup day ${day} · target ${target}/mailbox · this tick: ${sent} ${live ? "sends" : "simulated sends"}, ${replied} ${live ? "replies" : "simulated replies"}, ${rescued} lifted from spam/marked`)
}

// sends today's report BY EMAIL (from a pool mailbox to DIGEST_TO), simpler than a bot.
// DIGEST_TO is REQUIRED: no default recipient (otherwise every install would send its reports to a third party).
// Sender: DIGEST_FROM, otherwise the first mailbox of the config's pool B.
async function digest(): Promise<void> {
  const to = (process.env.DIGEST_TO || "").trim()
  if (!to) throw new Error("DIGEST_TO missing: no report sent (set DIGEST_TO=<your email> in .env or the systemd unit)")
  const all = await boxes()
  const cfg = JSON.parse(await readFile(CONFIG, "utf8"))
  const from = (process.env.DIGEST_FROM || cfg.inboxes?.B?.[0]?.email || all[0] || "").trim()
  if (!from) throw new Error("no sending mailbox (DIGEST_FROM or inboxes.B in outreach/sequencer/config.json)")
  const { start, day, target } = await rampDay()
  const hist = await loadLog()
  const today = new Date().toISOString().slice(0, 10)
  const lines = all.map((b) => {
    const s = hist.filter((e) => e.kind === "send" && e.from === b && dayKey(e.at) === today).length
    const r = hist.filter((e) => e.kind === "reply" && e.from === b && dayKey(e.at) === today).length
    return `  ${b}: ${s}/${target} sends, ${r} replies`
  })
  const body = `LWS warmup · report for ${today}\n\nStarted on ${start} · day ${day}/~10 · target ${target}/mailbox/day\n\n${lines.join("\n")}\n\nAll-time total: ${hist.length} emails.\n(automatic, from the box)`
  await deliver({ from, to, subject: `LWS warmup · day ${day} (${today})`, body, msgId: msgId(from) })
  console.log(isLive() ? `report sent to ${to}` : `report NOT sent (dry-run): recipient ${to}\n${body}`)
}

async function status(): Promise<void> {
  const all = await boxes()
  const { start, day, target } = await rampDay(false)
  const hist = await loadLog()
  const today = new Date().toISOString().slice(0, 10)
  console.log(`warmup started on ${start} · day ${day} · target ${target}/mailbox/day`)
  for (const b of all) {
    const s = hist.filter((e) => e.kind === "send" && e.from === b && dayKey(e.at) === today).length
    const r = hist.filter((e) => e.kind === "reply" && e.from === b && dayKey(e.at) === today).length
    console.log(`  ${b.padEnd(34)} today: ${s}/${target} sends, ${r} replies`)
  }
  console.log(`all-time total: ${hist.length} emails`)
}

const USAGE = "usage: npm run warmup [-- tick | status | digest | once <from> <to>]  (dry-run unless LWS_LIVE_SEND=1)"
const [cmd, ...a] = process.argv.slice(2)
try {
  const stop = cmd === "status" ? null : await stopState()
  if (stop?.on) console.log(`⏹ STOP (${stop.source}: ${stop.reason}): warmup stopped, nothing is sent or logged. Resumes at the next timer once STOP is lifted.`)
  else if (cmd === "status") await status()
  else if (cmd === "digest") await digest()
  else if (cmd === "once") {
    if (!a[0] || !a[1]) throw new Error(USAGE)
    await deliver({ from: a[0], to: a[1], subject: pick(THREADS).subject, body: pick(THREADS).body, msgId: msgId(a[0]) })
    console.log(isLive() ? `sent ${a[0]} → ${a[1]}` : `nothing sent (dry-run): ${a[0]} → ${a[1]}`)
  }
  else if (!cmd || cmd === "tick") {
    // for real, ONE tick at a time (lock shared by file + database, see packages/shared/lock.ts): two simultaneous ticks
    // read the same log and doubled today's target (ramp-up exceeded, blitz test of 10/24).
    // In dry-run nothing is written, the lock included.
    const lock = isLive() ? await acquireLock({ file: `${DIR}/.lock`, dbKey: "warmup.lock", cmd: "warmup tick", waitMs: Number(process.env.LWS_SEQ_LOCK_WAIT_MS) || 180_000 }) : null
    if (isLive() && !lock) { console.error("✗ another warmup tick is already running: this one does nothing."); closeDb(); process.exit(75) }
    try { await tick() } finally { await lock?.release() }
  }
  else throw new Error(`unknown command "${cmd}". ${USAGE}`)
} catch (e: any) { console.error("ERROR:", e.message); closeDb(); process.exit(1) }
closeDb()
