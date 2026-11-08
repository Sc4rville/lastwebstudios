/**
 * replies.ts · the sequencer's REPLY READER, pluggable. On each tick, the sequencer reads the sending
 * mailboxes, classifies each received message, and closes the film's loop: reply ⇒ sequence stopped (`replied`) +
 * Hot Lead at the top of the call queue; "STOP" ⇒ unsubscribe; bounce ⇒ dead address, exit + circuit breaker.
 *
 *   LWS_REPLY_READER = gmail | file | none
 *     gmail  the Gmail API, read only (./imap.ts, the same service account as sending). The default when the key
 *            `outreach/sequencer/sa-key.json` is there.
 *     file   a fake reader: `data/sequencer/inbox.jsonl`, one line per received message
 *            {inbox, from, subject, text, at, id?} (tests, rehearsals, or another provider that writes there).
 *     none   nothing is read (the default without a key): replies are marked by hand (`npm run sequencer -- reply <id>`).
 *
 * Classification (pure, testable): bounce (mailer-daemon / non-delivery report, matched by the quoted address),
 * auto-reply (out of office, holidays: IGNORED, it is not interest), unsubscribe ("STOP",
 * « ne plus me contacter »…), otherwise a reply. A sender the sequencer does not know is ignored.
 * The patterns match French and English mail, so they keep their French words.
 */
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"

export const INBOX_FILE = "data/sequencer/inbox.jsonl"
const SA_KEY = "outreach/sequencer/sa-key.json"

export type Inbound = { id?: string; inbox: string; from: string; subject: string; text: string; at: string; auto?: boolean }
export type ReplyReader = { name: "gmail" | "file" | "none"; fetch: (inbox: string, sinceIso: string) => Promise<Inbound[]> }

export const noReader: ReplyReader = { name: "none", fetch: async () => [] }

export function fileReader(file = INBOX_FILE): ReplyReader {
  return {
    name: "file",
    async fetch(inbox, sinceIso) {
      if (!existsSync(file)) return []
      const out: Inbound[] = []
      for (const l of (await readFile(file, "utf8")).split("\n")) {
        if (!l.trim()) continue
        try {
          const m = JSON.parse(l)
          if (String(m.inbox || "").toLowerCase() !== inbox.toLowerCase() || typeof m.at !== "string" || m.at < sinceIso) continue
          out.push({ id: m.id, inbox, from: String(m.from || "").toLowerCase(), subject: String(m.subject || ""), text: String(m.text || m.body || ""), at: m.at })
        } catch { /* broken line */ }
      }
      return out
    },
  }
}

export const gmailReader: ReplyReader = {
  name: "gmail",
  async fetch(inbox, sinceIso) {
    const { fetchInbound } = await import("./imap.ts")
    return fetchInbound(inbox, sinceIso)
  },
}

export function selectReader(env: NodeJS.ProcessEnv = process.env): ReplyReader {
  const v = (env.LWS_REPLY_READER || "").trim()
  if (v === "file") return fileReader()
  if (v === "none") return noReader
  if (v === "gmail") return gmailReader
  return existsSync(SA_KEY) ? gmailReader : noReader
}

export type Classified =
  | { kind: "reply" | "unsub"; prospectId: string; email: string }
  | { kind: "bounce"; prospectId: string; email: string }
  | { kind: "ignore"; why: string }

const BOUNCE_FROM = /(mailer-daemon|postmaster|mail-daemon)@/i
const BOUNCE_SUBJ = /(delivery status notification|undeliver|delivery (has )?failed|mail delivery (failed|subsystem)|returned mail|non remis|non distribu|échec de (la )?(remise|distribution)|message not delivered|address not found)/i
const AUTO_REPLY = /(out of (the )?office|auto(matic)?[- ]?reply|autoreply|réponse automatique|absence|absent du|en congés?|congés|vacances|i am away|je suis absent)/i
// an out-of-office responder that keeps the « Re: … » subject (Gmail, Outlook): an absence phrase AND a responder marker
// (return date, « pour toute urgence », « réponse automatique ») near the start of the message. « Je suis absent cette
// semaine mais rappelez-moi lundi » stays a REAL reply (an interested human, not a robot).
const AUTO_BODY_ABSENT = /(je suis (actuellement )?absente?|absente? du bureau|actuellement absente?|en cong[ée]s?|out of (the )?office|i am (currently )?(away|out of)|en d[ée]placement)/i
const AUTO_BODY_MARK = /(jusqu'?au|jusqu'?à (lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|\d)|de retour le|retour pr[ée]vu|pour toute (demande )?urgen|en cas d'urgence|r[ée]ponse automatique|message automatique|automatic reply|until|back on|acc[eè]s (limit[ée]|restreint) (à|a) (mes|ma) (e-?)?mails?|messagerie)/i
// "STOP" at the start of the message or in the subject (what the legal footer asks), or an explicit opt-out request
const STOP_WORD = /^\s*(re\s*:\s*)*(stop|unsubscribe|d[ée]sabonn\w*|d[ée]sinscri\w*)\b/i
const OPT_OUT = /d[ée]sinscri|ne (plus|pas) (me |nous )?(contacter|écrire|ecrire|solliciter|recevoir)|retirez[- ](moi|nous)|supprimez[- ](moi|nous|mon adresse)|opposition au traitement/i
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi

/** Classifies a received message. `known` = email (lowercase) → prospectId, for the sequences still alive. */
export function classifyInbound(m: Inbound, known: Map<string, string>): Classified {
  const from = m.from.toLowerCase()
  const blob = `${m.subject}\n${m.text}`
  if (BOUNCE_FROM.test(from) || BOUNCE_SUBJ.test(m.subject)) {
    for (const e of blob.match(EMAIL) ?? []) {
      const id = known.get(e.toLowerCase())
      if (id) return { kind: "bounce", prospectId: id, email: e.toLowerCase() }
    }
    return { kind: "ignore", why: "non-delivery report with no known recipient" }
  }
  const id = known.get(from)
  if (!id) return { kind: "ignore", why: "sender not in a sequence" }
  if (m.auto) return { kind: "ignore", why: "auto-reply (Auto-Submitted / X-Autoreply / Precedence headers)" }
  if (AUTO_REPLY.test(m.subject)) return { kind: "ignore", why: "auto-reply (out of office)" }
  const head = m.text.trim().slice(0, 400)
  if (AUTO_BODY_ABSENT.test(head.slice(0, 300)) && AUTO_BODY_MARK.test(head)) return { kind: "ignore", why: "auto-reply (out of office, in the message)" }
  if (STOP_WORD.test(m.subject) || STOP_WORD.test(head) || OPT_OUT.test(head)) return { kind: "unsub", prospectId: id, email: from }
  return { kind: "reply", prospectId: id, email: from }
}
