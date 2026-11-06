/**
 * imap.ts · détecte les RÉPONSES via l'API Gmail (scope gmail.readonly, même compte de service + délégation
 * que l'envoi). Le séquenceur l'appelle au tick pour passer en "replied" (Hot Lead) les prospects qui ont
 * répondu → ils remontent à Yann pour l'appel. (Nom "imap" gardé pour compat ; ce n'est plus de l'IMAP.)
 *
 * Lecture seule (scope gmail.readonly) : métadonnées + extrait, jamais de modification de la boîte.
 * Prérequis (2026-07-12) : clé de service dans `outreach/sequencer/sa-key.json` + délégation domaine
 * autorisée pour le scope gmail.readonly. Import dynamique → tsc reste vert sans la dep.
 */
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"

const SA_KEY = "outreach/sequencer/sa-key.json"
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

async function tokenFor(inbox: string): Promise<string> {
  if (!existsSync(SA_KEY)) throw new Error(`Gmail : clé de service ${SA_KEY} manquante`)
  const sa = JSON.parse(await readFile(SA_KEY, "utf8"))
  const pkg = "google-auth-library"
  const { JWT }: any = await import(pkg).catch(() => { throw new Error("Gmail : lance `npm i google-auth-library`") })
  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: SCOPES, subject: inbox })
  const { access_token } = await jwt.authorize()
  if (!access_token) throw new Error(`Gmail : pas de jeton lecture pour ${inbox} (délégation gmail.readonly ?)`)
  return access_token
}

/** Un message reçu, tel que le lecteur de réponses du séquenceur le classe (cf. ./replies.ts). */
export type GmailInbound = { id: string; inbox: string; from: string; subject: string; text: string; at: string; auto?: boolean }

/** Envoyé par un robot (RFC 3834 Auto-Submitted, en-têtes des répondeurs Exchange / Gmail / Zimbra, Precedence). */
export function isAutoSubmitted(hdr: (name: string) => string): boolean {
  const as = hdr("auto-submitted").trim().toLowerCase()
  if (as && as !== "no") return true
  if (hdr("x-autoreply").trim() || hdr("x-autorespond").trim()) return true
  return /^(auto_reply|auto-reply|bulk|junk|list)$/i.test(hdr("precedence").trim())
}

// les messages reçus dans la boîte depuis `sinceIso` (inbox + spam : un bounce ou un « STOP » peut y tomber),
// en métadonnées seulement (From, Subject, date, extrait) : jamais le corps complet, rien n'est modifié.
export async function fetchInbound(inbox: string, sinceIso: string, max = 100): Promise<GmailInbound[]> {
  const token = await tokenFor(inbox)
  const auth = { Authorization: `Bearer ${token}` }
  const after = Math.floor(new Date(sinceIso).getTime() / 1000)
  const q = encodeURIComponent(`in:anywhere -from:me after:${after}`)
  const listR = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=${max}`, { headers: auth })
  if (!listR.ok) throw new Error(`Gmail list ${listR.status} (${inbox}) : ${(await listR.text()).slice(0, 200)}`)
  const list = await listR.json()
  const out: GmailInbound[] = []
  for (const m of (list.messages ?? [])) {
    const meta = ["From", "Subject", "Auto-Submitted", "X-Autoreply", "X-Autorespond", "Precedence"].map((h) => `metadataHeaders=${h}`).join("&")
    const mr = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&${meta}`, { headers: auth })
    if (!mr.ok) continue
    const md = await mr.json()
    const hdr = (n: string) => (md.payload?.headers ?? []).find((x: any) => x.name?.toLowerCase() === n)?.value ?? ""
    const fromH = hdr("from")
    const from = (fromH.match(/<([^>]+)>/)?.[1] ?? fromH.trim()).toLowerCase()
    const at = md.internalDate ? new Date(Number(md.internalDate)).toISOString() : new Date().toISOString()
    out.push({ id: String(m.id), inbox, from, subject: hdr("subject"), text: String(md.snippet || ""), at, auto: isAutoSubmitted(hdr) })
  }
  return out
}

// renvoie les adresses (minuscule) qui ont écrit dans la boîte depuis `sinceIso` = réponses potentielles.
// (API d'origine, gardée pour compat ; le séquenceur passe par fetchInbound via ./replies.ts.)
export async function fetchReplyFroms(inbox: string, sinceIso: string): Promise<string[]> {
  return (await fetchInbound(inbox, sinceIso)).map((m) => m.from).filter(Boolean)
}
