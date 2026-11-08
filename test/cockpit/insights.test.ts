/**
 * The cockpit's words about a prospect come from the engine's codes, in English, whatever the prospect's language :
 * French score reasons give English tags (no viewport / OG / meta jargon), the call panel always has 3 to 6 bullets,
 * and the sandbox's « Ask the agent » says as many things as it lists.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { whyTags, whyCodes, insights, simulatedAsk, heldSay } from "../../backoffice/reviewpipe/insights.ts"

const fr = { identity: { name: "Piscines Orvane" }, score: { reasons: ["pas responsive (pas de viewport)", "SEO pauvre (pas de description / OG)", "dernière trace de maj : 2012", "pas de HTTPS (sécurité + SEO pénalisé)"] }, audit: { https: false } }
const JARGON = /viewport|\bOG\b|meta|responsive|SEO|pas |aucune/i

test("French reasons → English tags from codes, deduplicated, at most 4, no jargon", () => {
  const tags = whyTags(fr)
  assert.deepEqual(tags, ["No mobile version", "No HTTPS", "Site from 2012", "Invisible on Google"])
  for (const t of tags) assert.doesNotMatch(t, JARGON, t)
  assert.equal(new Set(whyCodes(fr).map((w) => w.code)).size, tags.length)
  assert.deepEqual(whyTags({}), [])
})

test("the call panel gets 3 to 6 English bullets, even when the engine knows little", () => {
  for (const sheet of [{}, fr, { ...fr, identity: { name: "X", email: "a@b.example", hours: "Mon–Fri 8–6" }, content: { services: ["Pools", "Spas", "Liners", "Covers"] }, audit: { strengths: { googleRating: 4.7, reviewCount: 31 } } }]) {
    const b = insights(sheet, { angle: "montrer le nouveau site à côté de l'ancien", contact: "Jean Dupont" }, { competitor: { name: "Bleu Piscine", city: "Lyon" } })
    assert.ok(b.length >= 3 && b.length <= 6, `${b.length}: ${b.join(" | ")}`)
    assert.equal(new Set(b.map((x) => x.toLowerCase())).size, b.length, "no duplicate")
    assert.ok(!b.some((x) => /montrer|ancien/.test(x)), "a raw research sentence is never a bullet")
    for (const x of b) assert.doesNotMatch(x, /viewport|\bOG\b|pas responsive/i, x)
  }
  assert.ok(insights({}, { contact: "Il faut demander le gérant, il est là le matin." }, null).every((x) => !/gérant/.test(x)), "a sentence is not a contact name")
  assert.ok(insights({}, { contact: "Jean Dupont" }, null).includes("Ask for Jean Dupont."))
  assert.equal(insights({ ...fr, identity: { ...fr.identity, phone: "01 99 00 41 52" } }, null, null)[0], "Their site today: no mobile version, no HTTPS, site from 2012, invisible on Google.", "acronyms and names keep their case")
  assert.ok(!insights({ content: { services: ["construction de piscines enterrées et semi-enterrées, en béton ou en kit, toutes formes"] } }, null, null).some((x) => /What they sell/.test(x)), "a long service sentence is not a bullet")
  // their own words are quoted (data), the sentence around them is English
  assert.ok(insights({ identity: { hours: "Mar–Sam 9h30–12h" }, content: { services: ["Cuisines équipées"] } }, null, null).includes("Opening hours on their site: “Mar–Sam 9h30–12h”. Call in those hours."))
})

test("the sandbox's Ask: English, the count it says is the count it lists", () => {
  const mail = simulatedAsk(fr, "an email", "Harbor Studio")
  assert.match(mail, /^Subject: a new website for Piscines Orvane/)
  assert.match(mail, /Three things change for you: it works on a phone, it is secure \(HTTPS\) and it looks current \(not like 2012\)\./)
  assert.match(mail, /Harbor Studio$/)
  assert.doesNotMatch(mail, JARGON)
  const one = simulatedAsk({ identity: { name: "A" }, score: { reasons: ["aucune photo"] } }, "email")
  assert.match(one, /One thing changes for you: it shows your work\./)
  assert.match(simulatedAsk({ identity: { name: "A" } }, "email"), /It works on a phone/)
  const angle = simulatedAsk(fr, "a call angle")
  assert.match(angle, /^Angle: open with the one thing their site gets wrong today \(no mobile version\)/)
})

test("the sandbox's Ask writes in the language the email goes out in (a French agency → French)", () => {
  const mail = simulatedAsk(fr, "Écris un mail court", "Camille, Atelier Vélin", "fr")
  assert.match(mail, /^Objet : un nouveau site pour Piscines Orvane/)
  assert.match(mail, /Trois choses qui changent pour vous : il s'affiche bien sur téléphone, il est sécurisé \(HTTPS\) et il a l'air d'aujourd'hui\./)
  assert.match(mail, /Camille, Atelier Vélin$/)
  assert.doesNotMatch(mail, /Subject|Hi,|website/)
  assert.match(simulatedAsk(fr, "un angle d'appel", "", "fr"), /^Angle : ouvrez sur ce que leur site rate aujourd'hui \(pas de version mobile\)/)
})

test("audit round 2: a held email is said in plain English (never the sequencer's French log line nor a file path)", () => {
  const steps = [{ id: "mail-parfait", source: "savior" }, { id: "demo-perso", source: "demo" }, { id: "relance", source: "seo" }]
  const first = heldSay({ step: "mail-parfait", reason: "contenu" }, steps)
  assert.equal(first.say, "First email not written yet: nothing goes out until it is written.")
  assert.match(heldSay({ step: "demo-perso", reason: "contenu" }, steps).say, /personal demo isn't ready yet/)
  assert.match(heldSay({ step: "mail-parfait", reason: "destinataire" }, steps).say, /No valid email address/)
  for (const w of [first, heldSay({ step: "relance", reason: "contenu" }, steps), heldSay({}, [])]) {
    assert.doesNotMatch(w.say, /data\/|\.json|pas encore|généré|savior/i, w.say)
  }
})

test("audit round 2: Ask answers what was asked (a follow-up reads as one, the day asked for is the day proposed)", () => {
  const sheet = { identity: { name: "Blue Sky Plumbing" }, score: { reasons: ["pas responsive (pas de viewport)"] } }
  const f = simulatedAsk(sheet, "a follow-up email for next Tuesday", "Dev, Pixel Forge", "en")
  assert.match(f, /^Subject: following up/)
  assert.match(f, /on Tuesday/)
  assert.match(f, /Dev, Pixel Forge$/, "signed by the agency as it is now")
  assert.doesNotMatch(f, /I built a new website for Blue Sky Plumbing so you can see it already done/, "not the first email again")
  const first = simulatedAsk(sheet, "an email", "Sam", "en")
  assert.match(first, /^Subject: a new website for Blue Sky Plumbing/)
  assert.match(first, /this week/)
  const fr = simulatedAsk(sheet, "relance mardi", "Camille", "fr")
  assert.match(fr, /^Objet : votre nouveau site/); assert.match(fr, /mardi/)
})

test("audit round 2: a business with no phone and no email is said as such first (never « the phone is the only door »)", () => {
  const none = insights({ identity: { name: "Nowhere Roofing" } }, null, null)
  assert.match(none[0], /No phone and no email on their site: find a contact before you call, or skip Nowhere Roofing/)
  assert.ok(!none.some((x) => /only door/.test(x)))
  const phoneOnly = insights({ identity: { name: "Ring Roofing", phone: "(512) 555-0100" } }, null, null)
  assert.ok(phoneOnly.some((x) => /No email for Ring Roofing: the phone is the only door/.test(x)))
})
