/**
 * Round 1 of the stranger audits (2026-11-06), the behaviour fixed and locked without a browser :
 * a phone is written by its own shape (never « 51 25 55 01 26 » for a US number) ; what still belongs to the demo
 * studio is listed (Settings and doctor say the same) ; a « mix » fits the market ; the demo cast never gives two
 * businesses one number and tells a strong fit from a fit ; a demo build is typographic (no clip-art, no invented
 * figures, a plumber is not sold « comfort ») and old sites differ from one another.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { demoLeftovers, readExamples } from "../../packages/shared/agency-demo.mjs"
import { pickMix } from "../../backoffice/reviewpipe/brief.ts"
import { invent, toSheet } from "../../backoffice/reviewpipe/sim-data.ts"
import { renderNewSite, renderOldSite } from "../../backoffice/reviewpipe/sim-site.ts"

test("a phone is written by its own shape first, whatever the agency's country (no boot race can regroup it)", async () => {
  const L: any = await import(new URL("../../backoffice/reviewpipe/public/locale.js", import.meta.url).href) // the browser module itself
  L.setLocale({ country: "FR", locale: "fr-FR", currency: "EUR" })
  assert.equal(L.phone("(512) 555-0126"), "(512) 555-0126", "a US number under a French locale")
  assert.equal(L.phone("+1 207-555-0142"), "(207) 555-0142")
  assert.equal(L.phone("0199001234"), "01 99 00 12 34")
  L.setLocale({ country: "US", locale: "en-US", currency: "USD" })
  assert.equal(L.phone("01 99 00 12 34"), "01 99 00 12 34", "a French number under a US locale")
  assert.equal(L.phone("5125550126"), "(512) 555-0126")
})

test("Settings and doctor list what still belongs to the demo studio, in plain words, until nothing is left", () => {
  const ex = readExamples(process.cwd())
  assert.ok(ex.length >= 2)
  const us = JSON.parse(readFileSync("agency.config.example.us.json", "utf8"))
  const labels = demoLeftovers(us, ex).map((x) => x.label)
  for (const l of ["Agency name", "Your first name (the sender)", "Phone", "Email", "Website"]) assert.ok(labels.includes(l), `${l} in ${labels.join(", ")}`)
  // renamed only (the audit's « Northline Web ») : the sender, the phone, the .example addresses and the offer still show
  const renamed = { ...us, name: "Northline Web" }
  const left = demoLeftovers(renamed, ex).map((x) => x.key)
  assert.ok(!left.includes("name") && left.includes("firstName") && left.includes("phone") && left.includes("contactEmail") && left.includes("offer"), left.join(","))
  const mine = { ...renamed, phone: "+1 512-555-0100", contactEmail: "hi@example.com", website: "https://example.com", calendarUrl: "", postalAddress: "1100 Congress Ave, Austin, TX 78701", mail: { senderName: "Jo · Northline Web", heloDomain: "example.com" }, brand: { expediteur: "Jo", team: "We build sites for Austin trades.", offer: "A new site in two weeks", garantie: "Pay only if you like it" }, invoice: { seller: { name: "Northline Web LLC", address: "1100 Congress Ave, Austin, TX 78701", taxId: "12-3456789" } } }
  assert.deepEqual(demoLeftovers(mine, ex), [])
})

test("a « mix » fits the market : a US agency gets roofers, plumbers, HVAC… never the French showroom set", async () => {
  const us = await pickMix(4, "US")
  assert.equal(us.length, 4)
  for (const k of us) assert.ok(["couvreur-zingueur", "plombier", "chauffagiste", "electricien", "paysagiste", "peintre", "entrepreneur-general", "cloturiste", "solier", "pisciniste"].includes(k), k)
  assert.ok(!us.includes("verandaliste") && !us.includes("architecte-interieur"))
})

test("the demo cast : never two businesses on one number, « Strong fit » tells cards apart", () => {
  const list = invent({ trades: ["plombier"], place: "Austin", country: "US", count: 12, seed: 4242, taken: new Set() })
  assert.equal(new Set(list.map((p) => p.phone)).size, list.length, list.map((p) => p.phone).join(" "))
  const tiers = new Set(invent({ trades: ["plombier", "couvreur-zingueur"], place: "Lyon", country: "FR", count: 12, seed: 99, taken: new Set() }).map((p) => toSheet(p, "FR").score.tier))
  assert.deepEqual([...tiers].sort(), ["hot", "warm"], "a mix of strong fits and fits")
})

test("a demo build is typographic : no clip-art standing in for photos, no invented figures, the trade's own headline", () => {
  const [p] = invent({ trades: ["plombier"], place: "Austin", country: "US", count: 1, seed: 7, taken: new Set() })
  const html = renderNewSite(toSheet(p, "US"), "en")
  assert.doesNotMatch(html, /<svg/, "no geometric picture in place of a photo")
  assert.doesNotMatch(html, /Since \d{4}|Comfort, installed right/)
  assert.match(html, /Leaks fixed, water hot, same day\./)
  assert.match(html, /is a plumber based in Austin/)
  assert.match(html, /\.cta\{[^}]*white-space:nowrap/, "the quote button never wraps")
  const fr = renderNewSite(toSheet(invent({ trades: ["pisciniste"], place: "Lyon", country: "FR", count: 1, seed: 3, taken: new Set() })[0], "FR"), "fr")
  assert.match(fr, /Demander un devis/); assert.doesNotMatch(fr, /<svg|Depuis \d{4}/)
  // old sites : the same era, each its own colours
  const olds = invent({ trades: ["plombier"], place: "Austin", country: "US", count: 8, seed: 11, taken: new Set() }).map((x) => renderOldSite(toSheet(x, "US"), "en"))
  const looks = new Set(olds.map((h) => /<style>:root\{([^}]*)\}/.exec(h)![1] + /<body class="o o-(\w+)"/.exec(h)![1]))
  assert.ok(looks.size >= 3, `${looks.size} looks for 8 old sites`)
  assert.ok(new Set(olds.map((h) => /<body class="o o-(\w+)"/.exec(h)![1])).size >= 2, "more than one skeleton")
  // the page of the era, whole : a gallery of the trade's drawings, a visitor counter or a form, a dated footer ; the
  // capture takes the page (#cap), never a wide screen of wallpaper
  for (const h of olds) { assert.match(h, /<div id="cap">/); assert.match(h, /class="o-foot"/); assert.match(h, /class="o-gal"/); assert.match(h, /Austin/) }
})

test("audit round 2: a demo stand-in capitalises its services and fills its hero with their own words (no picture, no figure)", () => {
  const sheet = { id: "x", industry: "pisciniste", identity: { name: "Bassins Noriac", city: "Valmont", zip: "69000", phone: "01 99 00 12 34" }, content: { services: ["piscines béton sur mesure", "couloirs de nage", "bassins miroirs"] }, _sim: { family: "pool" } }
  const html = renderNewSite(sheet, "fr")
  assert.match(html, /<b>Piscines béton sur mesure<\/b>/, "a service card is a title")
  assert.doesNotMatch(html, /<b>piscines béton/)
  assert.match(html, /class="visual"[^>]*><div class="words"><span>Piscines béton sur mesure<\/span><span>Couloirs de nage<\/span>/, "the hero's right half is their words")
  assert.match(html, /Piscines béton sur mesure, couloirs de nage, bassins miroirs : on s'occupe/, "in a sentence they read as written")
  assert.doesNotMatch(html, /<svg|<img/)
})
