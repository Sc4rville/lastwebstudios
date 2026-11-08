/**
 * G11: the reply reader classifies each received message into the right loop: reply ⇒ Hot Lead,
 * "STOP" ⇒ unsubscribe, non-delivery report ⇒ bounce (matched by the quoted address), out of office ⇒ ignored.
 * The messages are French and English fixtures (the patterns match both).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { classifyInbound, selectReader, fileReader } from "../../outreach/scripts/lib/replies.ts"
import { makeWorkspace } from "../helpers/workspace.ts"

const known = new Map([["contact@orvane-piscines.example", "orvane-piscines-valmont-sur-lys"], ["bonjour@atelier-brisane.example", "atelier-brisane-menuiserie-sornac-le-haut"]])
const msg = (from: string, subject: string, text = "") => ({ inbox: "b1@agence.example", from, subject, text, at: "2026-10-28T10:00:00.000Z" })

test("a reply from a prospect in a sequence → reply", () => {
  assert.deepEqual(classifyInbound(msg("contact@orvane-piscines.example", "Re: Une idée pour votre site", "Bonjour, oui ça m'intéresse, appelez-moi jeudi."), known),
    { kind: "reply", prospectId: "orvane-piscines-valmont-sur-lys", email: "contact@orvane-piscines.example" })
  assert.equal(classifyInbound(msg("contact@orvane-piscines.example", "Re: Une idée", "Pas intéressé pour le moment, merci."), known).kind, "reply", "a « non merci » (no thanks) is still a reply (the sequence stops)")
})

test("\"STOP\" / opt-out request → unsub", () => {
  for (const [s, t] of [["STOP", ""], ["Re: Une idée pour votre site", "stop"], ["Re: x", "Merci de ne plus me contacter."], ["Désinscription", ""], ["Re: x", "Retirez-moi de votre liste svp"]]) {
    assert.equal(classifyInbound(msg("contact@orvane-piscines.example", s, t), known).kind, "unsub", `${s} / ${t}`)
  }
  assert.equal(classifyInbound(msg("contact@orvane-piscines.example", "Re: x", "On veut stopper l'hémorragie de clients, parlons-en"), known).kind, "reply")
})

test("non-delivery report → bounce tied to the quoted prospect; with no known address → ignored", () => {
  const dsn = msg("mailer-daemon@googlemail.com", "Delivery Status Notification (Failure)", "Address not found. Your message wasn't delivered to bonjour@atelier-brisane.example because the address couldn't be found")
  assert.deepEqual(classifyInbound(dsn, known), { kind: "bounce", prospectId: "atelier-brisane-menuiserie-sornac-le-haut", email: "bonjour@atelier-brisane.example" })
  assert.equal(classifyInbound(msg("postmaster@mx.example", "Undeliverable: x", "inconnu@ailleurs.example"), known).kind, "ignore")
})

test("auto-reply (out of office) and a sender outside any sequence → ignored", () => {
  assert.equal(classifyInbound(msg("contact@orvane-piscines.example", "Réponse automatique : absent jusqu'au 3 novembre"), known).kind, "ignore")
  assert.equal(classifyInbound(msg("contact@orvane-piscines.example", "Out of Office: back Monday"), known).kind, "ignore")
  assert.equal(classifyInbound(msg("quelquun@ailleurs.example", "Re: Une idée"), known).kind, "ignore")
})

test("reader choice: explicit, otherwise gmail only when the service key is there", () => {
  assert.equal(selectReader({ LWS_REPLY_READER: "file" }).name, "file")
  assert.equal(selectReader({ LWS_REPLY_READER: "none" }).name, "none")
  assert.equal(selectReader({ LWS_REPLY_READER: "gmail" }).name, "gmail")
  assert.equal(selectReader({}).name, "none", "no sa-key.json in the test workspace")
})

test("fake reader (file): filters by mailbox and by date", async () => {
  const ws = makeWorkspace()
  try {
    const f = ws.write("inbox.jsonl", [
      JSON.stringify({ inbox: "b1@agence.example", from: "A@X.example", subject: "s", text: "t", at: "2026-10-27T10:00:00.000Z" }),
      JSON.stringify({ inbox: "b1@agence.example", from: "b@x.example", subject: "s", text: "t", at: "2026-10-20T10:00:00.000Z" }),
      JSON.stringify({ inbox: "b2@agence.example", from: "c@x.example", subject: "s", text: "t", at: "2026-10-27T10:00:00.000Z" }),
      "not json",
    ].join("\n"))
    const got = await fileReader(f).fetch("b1@agence.example", "2026-10-25T00:00:00.000Z")
    assert.deepEqual(got.map((m) => m.from), ["a@x.example"])
  } finally { ws.cleanup() }
})

test("out-of-office responders that keep the « Re: … » subject: ignored (headers or text); an absent but interested human is still a reply", async () => {
  // blitz test of 10/24: only the SUBJECT was looked at; Gmail's responder keeps « Re: <subject> » and says it in the text
  // or through the Auto-Submitted header → a fake Hot Lead (and a fake "reply" learned)
  const { isAutoSubmitted } = await import("../../outreach/scripts/lib/imap.ts")
  const known = new Map([["contact@orvane-piscines.example", "orvane-piscines-valmont-sur-lys"]])
  const m = (text: string, extra: Record<string, unknown> = {}) => ({ inbox: "b1@agence.example", from: "contact@orvane-piscines.example", subject: "Re: Une idée pour votre site", text, at: "2026-10-26T10:00:00Z", ...extra })
  const robots = [
    "Bonjour, je suis absente du bureau jusqu'au 3 novembre. Pour toute urgence, contactez l'atelier au 03 53 01 24 68.",
    "Je suis actuellement en congés, de retour le lundi 4 novembre. Votre message sera traité à mon retour.",
    "Ceci est une réponse automatique : je suis en déplacement jusqu'à vendredi avec un accès limité à mes mails.",
    "I am currently out of the office until November 3rd with limited access to email.",
  ]
  for (const t of robots) assert.equal(classifyInbound(m(t), known).kind, "ignore", t)
  assert.equal(classifyInbound(m("Merci pour votre message.", { auto: true }), known).kind, "ignore", "Auto-Submitted header")
  const humans = [
    "Je suis absent cette semaine mais votre maquette me plaît, rappelez-moi lundi.",
    "Bonjour, oui ça m'intéresse. Je suis en congés, appelez plutôt mon associé.",
    "En l'absence de devis je ne peux rien décider, envoyez-moi un chiffrage.",
  ]
  for (const t of humans) assert.equal(classifyInbound(m(t), known).kind, "reply", t)
  const h = (o: Record<string, string>) => (n: string) => o[n] ?? ""
  assert.equal(isAutoSubmitted(h({ "auto-submitted": "auto-replied" })), true)
  assert.equal(isAutoSubmitted(h({ "auto-submitted": "no" })), false)
  assert.equal(isAutoSubmitted(h({ "x-autoreply": "yes" })), true)
  assert.equal(isAutoSubmitted(h({ precedence: "auto_reply" })), true)
  assert.equal(isAutoSubmitted(h({})), false)
})
