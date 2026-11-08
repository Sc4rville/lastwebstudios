/**
 * smtp.ts · BUILDING and SENDING an outreach email (Gmail API: service account + domain-wide
 * delegation). One Google Workspace mailbox = one sender, impersonated by the service account (gmail.send scope).
 *
 *   buildMessage(o)          the COMPLETE RFC 822 message, identical in dry-run and for real: links rewritten as signed
 *                            click links + legal footer with an unsubscribe link + the headers
 *                            `List-Unsubscribe` (https + mailto) et `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
 *                            (RFC 8058: Gmail's / Yahoo's native "unsubscribe" button). In dry-run the sequencer writes
 *                            this message as an `.eml`: what you review is exactly what would go out.
 *   sendMail(o, {transport}) SENDING. Refuses without LWS_LIVE_SEND=1 (defence in depth: the sequencer already checks
 *                            config.dryRun + LWS_LIVE_SEND; this lock holds even if another caller forgets).
 *   transports               `gmail` (real) · `simulated` (LWS_MAIL_TRANSPORT=simulated: logs the call to
 *                            data/sequencer/transport.jsonl, sends nothing; for tests and rehearsals).
 *                            `LWS_SIMULATED_DELAY_MS=<ms>`: each simulated send takes that long (an API's latency).
 *                            `LWS_SIMULATED_FAIL=<text>`: the simulated transport fails for any recipient that
 *                            contains this text (rehearse a sending failure without touching Gmail).
 *
 * Tracking (see outreach/tracking/): on only when TRACK_BASE + LWS_TRACK_SECRET are set. Otherwise: links
 * left as they are, unsubscribe by replying "STOP" + a mailto header (the earlier behaviour).
 *
 * Prerequisites for real sending (done on 2026-07-12): the service account key in `outreach/sequencer/sa-key.json`
 * (gitignored), domain-wide delegation granted (client ID + gmail.send scope), `google-auth-library` installed.
 */
import { readFile, appendFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { dirname } from "node:path"
import { trackConfig, rewriteLinks, unsubUrl, UUID_RE, type TrackConfig } from "../../tracking/links.ts"
import { agency, postalAddress } from "../../../packages/shared/agency.mjs"

const SA_KEY = "outreach/sequencer/sa-key.json"
const SCOPES = ["https://www.googleapis.com/auth/gmail.send"]
export const SIMULATED_LOG = "data/sequencer/transport.jsonl"

export type SendOpts = { inbox: string; to: string; subject: string; body: string; senderName: string; trackingId: string; prospectId?: string }
export type BuiltMessage = { rfc822: string; raw: string; headers: Record<string, string>; text: string; links: string[]; tracked: boolean }
export type Transport = { name: string; send: (inbox: string, raw: string, meta: { to: string; subject: string; trackingId: string }) => Promise<void> }

// Legal footer BY COUNTRY (agency.config.json › country). FR/BE/CH: LCEN B2B opt-out + GDPR art. 14 (docs/mailing-lia.md),
// written in French since it goes to French-speaking businesses.
// US: CAN-SPAM (identity, POSTAL ADDRESS required, clear opt-out); CA: CASL; GB/IE/AU/NZ: opt-out + identity + address.
// Identity: mail.legalIdentity; address: postalAddress (fallback invoice.seller.address).
export function legalFooter(unsub: string | null, env: NodeJS.ProcessEnv = process.env): string {
  const a = agency(env)
  const address = postalAddress(env)
  if (a.country === "FR" || a.country === "BE" || a.country === "CH" || a.language === "fr") {
    const optOut = unsub
      ? `Pour ne plus être contacté, un clic suffit : ${unsub} (ou répondez simplement « STOP »).`
      : "Pour ne plus être contacté, répondez simplement « STOP » à ce message."
    return `\n\n \n${a.mail.legalIdentity}${address ? `, ${address}` : ""}. Vous recevez ce message parce que votre activité professionnelle correspond à nos services (coordonnées issues de sources professionnelles publiques). ${optOut}`
  }
  const optOut = unsub
    ? `To stop receiving these messages, one click is enough: ${unsub} (or simply reply "STOP").`
    : 'To stop receiving these messages, simply reply "STOP".'
  const why = a.country === "CA"
    ? "You are receiving this message because your business is publicly listed and relevant to our services (CASL: this is a commercial electronic message)."
    : "You are receiving this message because your business is publicly listed and relevant to our services."
  return `\n\n \n${a.mail.legalIdentity}${address ? `, ${address}` : ""}. ${why} ${optOut}`
}

/** Does the country allow a REAL send? US: CAN-SPAM requires a postal address in every email (otherwise: refused). */
export function liveSendProblem(env: NodeJS.ProcessEnv = process.env): string | null {
  const a = agency(env)
  if (a.country === "US" && !postalAddress(env)) return `live send refused: country=US and no postal address (CAN-SPAM requires the sender's physical address in every email) → set "postalAddress" in agency.config.json`
  return null
}

// encodes a header (From/Subject) as UTF-8 base64, RFC 2047 style, when it holds non-ASCII (accents).
function h(v: string): string {
  return /^[\x00-\x7F]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`
}
// a header must never carry a line break (header injection)
const oneLine = (v: string) => String(v).replace(/[\r\n]+/g, " ").trim()

/** The complete message. `cfg` = tracking config (default: TRACK_BASE + LWS_TRACK_SECRET from the environment). */
export function buildMessage(o: SendOpts, cfg: TrackConfig | null = trackConfig(), date = new Date(), env: NodeJS.ProcessEnv = process.env): BuiltMessage {
  const track = cfg && UUID_RE.test(o.trackingId) ? cfg : null
  const { text: body, links } = rewriteLinks(o.body, o.trackingId, track)
  const unsub = track ? unsubUrl(track, o.trackingId) : null
  const text = body + legalFooter(unsub, env)
  const bodyB64 = Buffer.from(text, "utf8").toString("base64").replace(/(.{1,76})/g, "$1\r\n")
  const headers: Record<string, string> = {
    From: `${h(oneLine(o.senderName))} <${oneLine(o.inbox)}>`,
    To: oneLine(o.to),
    Subject: h(oneLine(o.subject)),
    Date: date.toUTCString().replace("GMT", "+0000"),
    "List-Unsubscribe": unsub ? `<${unsub}>, <mailto:${oneLine(o.inbox)}?subject=Desabonnement>` : `<mailto:${oneLine(o.inbox)}?subject=Desabonnement>`,
    ...(unsub ? { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : {}),
    "MIME-Version": "1.0",
    "Content-Type": 'text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding": "base64",
  }
  const rfc822 = [...Object.entries(headers).map(([k, v]) => `${k}: ${v}`), "", bodyB64].join("\r\n")
  return { rfc822, raw: Buffer.from(rfc822, "utf8").toString("base64url"), headers, text, links, tracked: !!track }
}

// access token to SEND ON BEHALF OF `inbox` (impersonation through subject).
async function tokenFor(inbox: string): Promise<string> {
  if (!existsSync(SA_KEY)) throw new Error(`Gmail: service key ${SA_KEY} missing`)
  const sa = JSON.parse(await readFile(SA_KEY, "utf8"))
  const pkg = "google-auth-library"
  const { JWT }: any = await import(pkg).catch(() => { throw new Error("Gmail: run `npm i google-auth-library` first") })
  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: SCOPES, subject: inbox })
  const { access_token } = await jwt.authorize()
  if (!access_token) throw new Error(`Gmail: no token for ${inbox} (domain-wide delegation granted?)`)
  return access_token
}

export const gmailTransport: Transport = {
  name: "gmail",
  async send(inbox, raw, meta) {
    const token = await tokenFor(inbox)
    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    })
    if (!r.ok) throw new Error(`Gmail API ${r.status} (sending ${inbox} → ${meta.to}): ${(await r.text()).slice(0, 300)}`)
  },
}

/** SIMULATED transport: sends nothing, logs the call (to prove who calls the transport, and when). */
export function simulatedTransport(file = SIMULATED_LOG, env: NodeJS.ProcessEnv = process.env): Transport {
  const fail = (env.LWS_SIMULATED_FAIL || "").trim().toLowerCase()
  const delayMs = Math.max(0, Math.min(10_000, Number(env.LWS_SIMULATED_DELAY_MS) || 0)) // a real API's latency (concurrency tests)
  return {
    name: "simulated",
    async send(inbox, raw, meta) {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
      if (fail && meta.to.toLowerCase().includes(fail)) throw new Error(`simulated failure (LWS_SIMULATED_FAIL) for ${meta.to}`)
      await mkdir(dirname(file), { recursive: true })
      await appendFile(file, JSON.stringify({ at: new Date().toISOString(), inbox, ...meta, raw }) + "\n")
    },
  }
}

export function selectTransport(env: NodeJS.ProcessEnv = process.env): Transport {
  return env.LWS_MAIL_TRANSPORT === "simulated" ? simulatedTransport(SIMULATED_LOG, env) : gmailTransport
}

/** REAL SENDING. Throws without LWS_LIVE_SEND=1 (no call to the transport). Returns the sent message. */
export async function sendMail(opts: SendOpts, o: { transport?: Transport; env?: NodeJS.ProcessEnv; cfg?: TrackConfig | null } = {}): Promise<BuiltMessage> {
  const env = o.env ?? process.env
  if (env.LWS_LIVE_SEND !== "1") throw new Error("sending refused: LWS_LIVE_SEND=1 absent (dry-run by default, see outreach/scripts/sequencer.ts)")
  const problem = liveSendProblem(env)
  if (problem) throw new Error(problem)
  const msg = buildMessage(opts, o.cfg === undefined ? trackConfig(env) : o.cfg, new Date(), env)
  const transport = o.transport ?? selectTransport(env)
  await transport.send(opts.inbox, msg.raw, { to: opts.to, subject: opts.subject, trackingId: opts.trackingId })
  return msg
}
