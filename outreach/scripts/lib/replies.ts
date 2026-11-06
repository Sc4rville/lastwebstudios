/**
 * replies.ts · LE LECTEUR DE RÉPONSES du séquenceur, branchable. Au tick, le séquenceur lit les boîtes
 * d'envoi, classe chaque message reçu, et ferme la boucle du film : réponse ⇒ séquence stoppée (`replied`) +
 * Hot Lead en tête de la file d'appel ; « STOP » ⇒ désinscription ; bounce ⇒ adresse morte, sortie + disjoncteur.
 *
 *   LWS_REPLY_READER = gmail | file | none
 *     gmail  l'API Gmail en lecture seule (./imap.ts, même compte de service que l'envoi). Défaut si la clé
 *            `outreach/sequencer/sa-key.json` est là.
 *     file   un faux lecteur : `data/sequencer/inbox.jsonl`, une ligne par message reçu
 *            {inbox, from, subject, text, at, id?} (tests, répétitions, ou un autre fournisseur qui y écrit).
 *     none   rien n'est lu (défaut sans clé) : réponses à marquer à la main (`npm run sequencer -- reply <id>`).
 *
 * Classement (pur, testable) : bounce (mailer-daemon / avis de non-remise, rattaché par l'adresse citée),
 * réponse automatique (absence, congés : IGNORÉE, ce n'est pas un intérêt), désinscription (« STOP »,
 * « ne plus me contacter »…), sinon réponse. Un expéditeur inconnu du séquenceur est ignoré.
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
        } catch { /* ligne cassée */ }
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
// répondeur d'absence qui garde l'objet « Re: … » (Gmail, Outlook) : une formule d'absence ET un marqueur de répondeur
// (date de retour, « pour toute urgence », « réponse automatique »), dans le début du message. « Je suis absent cette
// semaine mais rappelez-moi lundi » reste une VRAIE réponse (un humain intéressé, pas un robot).
const AUTO_BODY_ABSENT = /(je suis (actuellement )?absente?|absente? du bureau|actuellement absente?|en cong[ée]s?|out of (the )?office|i am (currently )?(away|out of)|en d[ée]placement)/i
const AUTO_BODY_MARK = /(jusqu'?au|jusqu'?à (lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|\d)|de retour le|retour pr[ée]vu|pour toute (demande )?urgen|en cas d'urgence|r[ée]ponse automatique|message automatique|automatic reply|until|back on|acc[eè]s (limit[ée]|restreint) (à|a) (mes|ma) (e-?)?mails?|messagerie)/i
// « STOP » en tête du message ou en objet (la consigne du pied légal), ou une demande d'opposition explicite
const STOP_WORD = /^\s*(re\s*:\s*)*(stop|unsubscribe|d[ée]sabonn\w*|d[ée]sinscri\w*)\b/i
const OPT_OUT = /d[ée]sinscri|ne (plus|pas) (me |nous )?(contacter|écrire|ecrire|solliciter|recevoir)|retirez[- ](moi|nous)|supprimez[- ](moi|nous|mon adresse)|opposition au traitement/i
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi

/** Classe un message reçu. `known` = e-mail (minuscule) → prospectId, pour les séquences encore vivantes. */
export function classifyInbound(m: Inbound, known: Map<string, string>): Classified {
  const from = m.from.toLowerCase()
  const blob = `${m.subject}\n${m.text}`
  if (BOUNCE_FROM.test(from) || BOUNCE_SUBJ.test(m.subject)) {
    for (const e of blob.match(EMAIL) ?? []) {
      const id = known.get(e.toLowerCase())
      if (id) return { kind: "bounce", prospectId: id, email: e.toLowerCase() }
    }
    return { kind: "ignore", why: "avis de non-remise sans destinataire connu" }
  }
  const id = known.get(from)
  if (!id) return { kind: "ignore", why: "expéditeur hors séquence" }
  if (m.auto) return { kind: "ignore", why: "réponse automatique (en-têtes Auto-Submitted / X-Autoreply / Precedence)" }
  if (AUTO_REPLY.test(m.subject)) return { kind: "ignore", why: "réponse automatique (absence)" }
  const head = m.text.trim().slice(0, 400)
  if (AUTO_BODY_ABSENT.test(head.slice(0, 300)) && AUTO_BODY_MARK.test(head)) return { kind: "ignore", why: "réponse automatique (absence, dans le message)" }
  if (STOP_WORD.test(m.subject) || STOP_WORD.test(head) || OPT_OUT.test(head)) return { kind: "unsub", prospectId: id, email: from }
  return { kind: "reply", prospectId: id, email: from }
}
