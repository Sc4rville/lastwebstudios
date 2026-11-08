/**
 * imap.ts · detects REPLIES through the Gmail API (gmail.readonly scope, the same service account + delegation
 * as sending). The sequencer calls it on each tick to move the prospects who replied to "replied" (Hot Lead)
 * → they rise to the top for the call. (The "imap" name is kept for compatibility; it is no longer IMAP.)
 *
 * Read only (gmail.readonly scope): metadata + snippet, the mailbox is never modified.
 * Prerequisites (2026-07-12): service key in `outreach/sequencer/sa-key.json` + domain-wide delegation
 * granted for the gmail.readonly scope. Dynamic import → tsc stays green without the dependency.
 */
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"

const SA_KEY = "outreach/sequencer/sa-key.json"
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

async function tokenFor(inbox: string): Promise<string> {
  if (!existsSync(SA_KEY)) throw new Error(`Gmail: service key ${SA_KEY} missing`)
  const sa = JSON.parse(await readFile(SA_KEY, "utf8"))
  const pkg = "google-auth-library"
  const { JWT }: any = await import(pkg).catch(() => { throw new Error("Gmail : lance `npm i google-auth-library`") })
  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: SCOPES, subject: inbox })
  const { access_token } = await jwt.authorize()
  if (!access_token) throw new Error(`Gmail: no read token for ${inbox} (gmail.readonly delegation?)`)
  return access_token
}

/** A received message, as the sequencer's reply reader classifies it (see ./replies.ts). */
export type GmailInbound = { id: string; inbox: string; from: string; subject: string; text: string; at: string; auto?: boolean }

/** Sent by a robot (RFC 3834 Auto-Submitted, Exchange / Gmail / Zimbra autoresponder headers, Precedence). */
export function isAutoSubmitted(hdr: (name: string) => string): boolean {
  const as = hdr("auto-submitted").trim().toLowerCase()
  if (as && as !== "no") return true
  if (hdr("x-autoreply").trim() || hdr("x-autorespond").trim()) return true
  return /^(auto_reply|auto-reply|bulk|junk|list)$/i.test(hdr("precedence").trim())
}

// the messages received in the mailbox since `sinceIso` (inbox + spam: a bounce or a "STOP" can land there),
// as metadata only (From, Subject, date, snippet): never the full body, nothing is modified.
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

// returns the addresses (lowercase) that wrote to the mailbox since `sinceIso` = potential replies.
// (The original API, kept for compatibility; the sequencer goes through fetchInbound via ./replies.ts.)
export async function fetchReplyFroms(inbox: string, sinceIso: string): Promise<string[]> {
  return (await fetchInbound(inbox, sinceIso)).map((m) => m.from).filter(Boolean)
}
