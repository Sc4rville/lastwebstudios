/**
 * smtp.ts · CONSTRUCTION et ENVOI d'un mail outreach (API Gmail : compte de service + délégation à l'échelle du
 * domaine). Une boîte Google Workspace = un expéditeur, impersonné par le compte de service (scope gmail.send).
 *
 *   buildMessage(o)          le message RFC 822 COMPLET, identique en dry-run et en réel : liens réécrits en liens
 *                            de clic signés + pied légal avec lien de désinscription + en-têtes
 *                            `List-Unsubscribe` (https + mailto) et `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
 *                            (RFC 8058 : le bouton « se désabonner » natif de Gmail / Yahoo). Le séquenceur écrit ce
 *                            message en `.eml` en dry-run : ce qu'on relit est exactement ce qui partirait.
 *   sendMail(o, {transport}) ENVOI. Refuse sans LWS_LIVE_SEND=1 (défense en profondeur : le séquenceur vérifie déjà
 *                            config.dryRun + LWS_LIVE_SEND, ce verrou tient même si un autre appelant l'oublie).
 *   transports               `gmail` (réel) · `simulated` (LWS_MAIL_TRANSPORT=simulated : journalise l'appel dans
 *                            data/sequencer/transport.jsonl, n'envoie rien ; pour les tests et les répétitions).
 *                            `LWS_SIMULATED_DELAY_MS=<ms>` : chaque envoi simulé prend ce temps (latence d'une API).
 *                            `LWS_SIMULATED_FAIL=<texte>` : le transport simulé échoue pour tout destinataire qui
 *                            contient ce texte (répéter une panne d'envoi sans toucher à Gmail).
 *
 * Tracking (cf. outreach/tracking/) : actif seulement si TRACK_BASE + LWS_TRACK_SECRET sont posés. Sinon : liens
 * laissés tels quels, désinscription par réponse « STOP » + en-tête mailto (le comportement d'avant).
 *
 * Prérequis du réel (fait le 2026-07-12) : clé du compte de service dans `outreach/sequencer/sa-key.json`
 * (gitignoré), délégation domaine autorisée (ID client + scope gmail.send), `google-auth-library` installé.
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

// Pied légal PAR PAYS (agency.config.json › country). FR/BE/CH : LCEN opt-out B2B + RGPD art. 14 (docs/mailing-lia.md).
// US : CAN-SPAM (identité, ADRESSE POSTALE obligatoire, opt-out clair) ; CA : CASL ; GB/IE/AU/NZ : opt-out + identité + adresse.
// Identité : mail.legalIdentity ; adresse : postalAddress (repli invoice.seller.address).
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

/** Un envoi RÉEL est-il permis par le pays ? US : CAN-SPAM exige une adresse postale dans chaque mail (sinon : refus). */
export function liveSendProblem(env: NodeJS.ProcessEnv = process.env): string | null {
  const a = agency(env)
  if (a.country === "US" && !postalAddress(env)) return `envoi réel refusé : country=US et aucune adresse postale (CAN-SPAM exige l'adresse physique de l'expéditeur dans chaque mail) → pose "postalAddress" dans agency.config.json`
  return null
}

// encode un en-tête (From/Subject) en UTF-8 base64 façon RFC 2047 s'il contient du non-ASCII (accents).
function h(v: string): string {
  return /^[\x00-\x7F]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`
}
// un en-tête ne doit jamais porter de retour à la ligne (injection d'en-têtes)
const oneLine = (v: string) => String(v).replace(/[\r\n]+/g, " ").trim()

/** Le message complet. `cfg` = config de tracking (défaut : TRACK_BASE + LWS_TRACK_SECRET de l'environnement). */
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

// jeton d'accès pour ENVOYER AU NOM DE `inbox` (impersonation via subject).
async function tokenFor(inbox: string): Promise<string> {
  if (!existsSync(SA_KEY)) throw new Error(`Gmail : clé de service ${SA_KEY} manquante`)
  const sa = JSON.parse(await readFile(SA_KEY, "utf8"))
  const pkg = "google-auth-library"
  const { JWT }: any = await import(pkg).catch(() => { throw new Error("Gmail : lance `npm i google-auth-library` d'abord") })
  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: SCOPES, subject: inbox })
  const { access_token } = await jwt.authorize()
  if (!access_token) throw new Error(`Gmail : pas de jeton pour ${inbox} (délégation domaine autorisée ?)`)
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
    if (!r.ok) throw new Error(`Gmail API ${r.status} (envoi ${inbox} → ${meta.to}) : ${(await r.text()).slice(0, 300)}`)
  },
}

/** Transport SIMULÉ : n'envoie rien, journalise l'appel (pour prouver qui appelle le transport, et quand). */
export function simulatedTransport(file = SIMULATED_LOG, env: NodeJS.ProcessEnv = process.env): Transport {
  const fail = (env.LWS_SIMULATED_FAIL || "").trim().toLowerCase()
  const delayMs = Math.max(0, Math.min(10_000, Number(env.LWS_SIMULATED_DELAY_MS) || 0)) // latence d'une vraie API (tests de concurrence)
  return {
    name: "simulated",
    async send(inbox, raw, meta) {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
      if (fail && meta.to.toLowerCase().includes(fail)) throw new Error(`échec simulé (LWS_SIMULATED_FAIL) pour ${meta.to}`)
      await mkdir(dirname(file), { recursive: true })
      await appendFile(file, JSON.stringify({ at: new Date().toISOString(), inbox, ...meta, raw }) + "\n")
    },
  }
}

export function selectTransport(env: NodeJS.ProcessEnv = process.env): Transport {
  return env.LWS_MAIL_TRANSPORT === "simulated" ? simulatedTransport(SIMULATED_LOG, env) : gmailTransport
}

/** ENVOI RÉEL. Lève sans LWS_LIVE_SEND=1 (aucun appel au transport). Renvoie le message envoyé. */
export async function sendMail(opts: SendOpts, o: { transport?: Transport; env?: NodeJS.ProcessEnv; cfg?: TrackConfig | null } = {}): Promise<BuiltMessage> {
  const env = o.env ?? process.env
  if (env.LWS_LIVE_SEND !== "1") throw new Error("envoi refusé : LWS_LIVE_SEND=1 absent (dry-run par défaut, cf. outreach/scripts/sequencer.ts)")
  const problem = liveSendProblem(env)
  if (problem) throw new Error(problem)
  const msg = buildMessage(opts, o.cfg === undefined ? trackConfig(env) : o.cfg, new Date(), env)
  const transport = o.transport ?? selectTransport(env)
  await transport.send(opts.inbox, msg.raw, { to: opts.to, subject: opts.subject, trackingId: opts.trackingId })
  return msg
}
