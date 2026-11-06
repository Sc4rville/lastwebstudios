/**
 * G11 : le lecteur de réponses classe chaque message reçu sans se tromper de boucle : réponse ⇒ Hot Lead,
 * « STOP » ⇒ désinscription, avis de non-remise ⇒ bounce (rattaché par l'adresse citée), absence ⇒ ignorée.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { classifyInbound, selectReader, fileReader } from "../../outreach/scripts/lib/replies.ts"
import { makeWorkspace } from "../helpers/workspace.ts"

const known = new Map([["contact@orvane-piscines.example", "orvane-piscines-valmont-sur-lys"], ["bonjour@atelier-brisane.example", "atelier-brisane-menuiserie-sornac-le-haut"]])
const msg = (from: string, subject: string, text = "") => ({ inbox: "b1@agence.example", from, subject, text, at: "2026-10-28T10:00:00.000Z" })

test("réponse d'un prospect en séquence → reply", () => {
  assert.deepEqual(classifyInbound(msg("contact@orvane-piscines.example", "Re: Une idée pour votre site", "Bonjour, oui ça m'intéresse, appelez-moi jeudi."), known),
    { kind: "reply", prospectId: "orvane-piscines-valmont-sur-lys", email: "contact@orvane-piscines.example" })
  assert.equal(classifyInbound(msg("contact@orvane-piscines.example", "Re: Une idée", "Pas intéressé pour le moment, merci."), known).kind, "reply", "un « non merci » reste une réponse (la séquence s'arrête)")
})

test("« STOP » / demande d'opposition → unsub", () => {
  for (const [s, t] of [["STOP", ""], ["Re: Une idée pour votre site", "stop"], ["Re: x", "Merci de ne plus me contacter."], ["Désinscription", ""], ["Re: x", "Retirez-moi de votre liste svp"]]) {
    assert.equal(classifyInbound(msg("contact@orvane-piscines.example", s, t), known).kind, "unsub", `${s} / ${t}`)
  }
  assert.equal(classifyInbound(msg("contact@orvane-piscines.example", "Re: x", "On veut stopper l'hémorragie de clients, parlons-en"), known).kind, "reply")
})

test("avis de non-remise → bounce rattaché au prospect cité ; sans adresse connue → ignoré", () => {
  const dsn = msg("mailer-daemon@googlemail.com", "Delivery Status Notification (Failure)", "Address not found. Your message wasn't delivered to bonjour@atelier-brisane.example because the address couldn't be found")
  assert.deepEqual(classifyInbound(dsn, known), { kind: "bounce", prospectId: "atelier-brisane-menuiserie-sornac-le-haut", email: "bonjour@atelier-brisane.example" })
  assert.equal(classifyInbound(msg("postmaster@mx.example", "Undeliverable: x", "inconnu@ailleurs.example"), known).kind, "ignore")
})

test("réponse automatique (absence) et expéditeur hors séquence → ignorés", () => {
  assert.equal(classifyInbound(msg("contact@orvane-piscines.example", "Réponse automatique : absent jusqu'au 3 novembre"), known).kind, "ignore")
  assert.equal(classifyInbound(msg("contact@orvane-piscines.example", "Out of Office: back Monday"), known).kind, "ignore")
  assert.equal(classifyInbound(msg("quelquun@ailleurs.example", "Re: Une idée"), known).kind, "ignore")
})

test("choix du lecteur : explicite, sinon gmail seulement si la clé de service est là", () => {
  assert.equal(selectReader({ LWS_REPLY_READER: "file" }).name, "file")
  assert.equal(selectReader({ LWS_REPLY_READER: "none" }).name, "none")
  assert.equal(selectReader({ LWS_REPLY_READER: "gmail" }).name, "gmail")
  assert.equal(selectReader({}).name, "none", "pas de sa-key.json dans le workspace de test")
})

test("faux lecteur (fichier) : filtre par boîte et par date", async () => {
  const ws = makeWorkspace()
  try {
    const f = ws.write("inbox.jsonl", [
      JSON.stringify({ inbox: "b1@agence.example", from: "A@X.example", subject: "s", text: "t", at: "2026-10-27T10:00:00.000Z" }),
      JSON.stringify({ inbox: "b1@agence.example", from: "b@x.example", subject: "s", text: "t", at: "2026-10-20T10:00:00.000Z" }),
      JSON.stringify({ inbox: "b2@agence.example", from: "c@x.example", subject: "s", text: "t", at: "2026-10-27T10:00:00.000Z" }),
      "pas du json",
    ].join("\n"))
    const got = await fileReader(f).fetch("b1@agence.example", "2026-10-25T00:00:00.000Z")
    assert.deepEqual(got.map((m) => m.from), ["a@x.example"])
  } finally { ws.cleanup() }
})

test("répondeurs d'absence qui gardent l'objet « Re: … » : ignorés (en-têtes ou texte) ; un humain absent mais intéressé reste une réponse", async () => {
  // test blitz du 24/10 : seul l'OBJET était regardé ; le répondeur Gmail garde « Re: <objet> » et le dit dans le texte
  // ou par l'en-tête Auto-Submitted → faux Hot Lead (et faux « reply » appris)
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
  assert.equal(classifyInbound(m("Merci pour votre message.", { auto: true }), known).kind, "ignore", "en-tête Auto-Submitted")
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
