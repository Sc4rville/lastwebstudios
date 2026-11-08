/**
 * An agency outside the French-speaking world ("it must work in the States"): country and language in agency.config.json,
 * a legal footer per country (CAN-SPAM in the US: a postal address is mandatory, live sending refused without it), US/UK/CA/AU
 * phones recognised, the company register skipped outside France with no network call, trades with English labels and keywords,
 * an English draft, the language passed to the skills and the composer.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { agency, postalAddress, hasCompanyRegistry, NEUTRAL } from "../packages/shared/agency.mjs"
import { buildMessage, legalFooter, liveSendProblem, sendMail } from "../outreach/scripts/lib/smtp.ts"
import { findPhone, findPhones, normalizePhone } from "../leadengine/1_scraping/scripts/phone.ts"
import { readContact } from "../leadengine/2_scoring/scripts/score.ts"
import { INDUSTRIES, industryTerms, industryLabel, osmZone } from "../leadengine/1_scraping/scripts/industries.ts"
import { lookupCompany } from "../leadengine/1_scraping/scripts/company.ts"
import { compose } from "../outreach/scripts/draft.ts"
import { inputBlocks } from "../packages/utils/run-skill.ts"

const US = { ...process.env, LWS_AGENCY_CONFIG: "agency.config.example.us.json" }
const FR = { ...process.env, LWS_AGENCY_CONFIG: "agency.config.example.json" }

test("agency: country, language, locale, currency, time zone; FR defaults; derived from the country; a complete fictional US example", () => {
  assert.equal(NEUTRAL.country, "FR"); assert.equal(NEUTRAL.language, "fr")
  const fr = agency(FR)
  assert.deepEqual([fr.country, fr.language, fr.locale, fr.currency, fr.timezone], ["FR", "fr", "fr-FR", "EUR", "Europe/Paris"])
  const us = agency(US)
  assert.deepEqual([us.country, us.language, us.locale, us.currency, us.timezone], ["US", "en", "en-US", "USD", "America/Chicago"])
  assert.equal(us.name, "Harbor & Pine Web Co.")
  assert.match(us.phone, /^\+1 \d{3}-555-01\d\d$/, "a 555-01xx number (the block reserved for fiction)")
  for (const u of [us.website, us.contactEmail, us.calendarUrl, us.mail.heloDomain]) assert.match(u, /\.example\b/)
  assert.equal(postalAddress(US), "418 Larkspur Row, Suite 2, Austin, TX 78704")
  assert.equal(postalAddress(FR), "", "the FR example's seller address is a <…> placeholder: not an address")
  const dir = mkdtempSync(join(tmpdir(), "lws-agn-"))
  try {
    writeFileSync(join(dir, "agency.config.json"), JSON.stringify({ name: "Kiwi Web", country: "nz" }))
    const nz = agency({}, dir)
    assert.deepEqual([nz.country, nz.language, nz.locale, nz.currency, nz.timezone], ["NZ", "en", "en-NZ", "NZD", "Pacific/Auckland"], "language, locale, currency and time zone derived from the country when missing")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("legal footer: FR (LCEN/GDPR, STOP) · US (CAN-SPAM: identity + postal address + opt-out in English) · CA (CASL)", () => {
  const fr = legalFooter("https://t.example/t/u/x", FR)
  assert.match(fr, /Atelier Vélin/); assert.match(fr, /Pour ne plus être contacté/); assert.match(fr, /« STOP »/)
  const us = legalFooter("https://t.example/t/u/x", US)
  assert.match(us, /Harbor & Pine Web Co\., 418 Larkspur Row, Suite 2, Austin, TX 78704/, "physical address in the footer (CAN-SPAM)")
  assert.match(us, /To stop receiving these messages, one click is enough: https:\/\/t\.example\/t\/u\/x/)
  assert.doesNotMatch(us, /contacté|RGPD|LCEN/)
  const dir = mkdtempSync(join(tmpdir(), "lws-ca-"))
  try {
    writeFileSync(join(dir, "agency.config.json"), JSON.stringify({ name: "Maple Sites", country: "CA", language: "en", postalAddress: "12 Rue Fictive, Montréal, QC H0H 0H0" }))
    const caMsg = buildMessage({ inbox: "b1@maple.example", to: "x@y.example", subject: "s", body: "b", senderName: "M", trackingId: "nope" }, null, new Date(0), { LWS_AGENCY_CONFIG: join(dir, "agency.config.json") })
    assert.match(caMsg.text, /CASL/); assert.match(caMsg.text, /12 Rue Fictive/); assert.match(caMsg.text, /reply "STOP"/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("live sending: US without a postal address → refused (fail-closed, exact message); with an address → allowed; FR → allowed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lws-us-"))
  try {
    const f = join(dir, "agency.config.json")
    writeFileSync(f, JSON.stringify({ name: "No Address LLC", country: "US", language: "en" }))
    const env = { ...process.env, LWS_AGENCY_CONFIG: f, LWS_LIVE_SEND: "1", LWS_MAIL_TRANSPORT: "simulated" }
    assert.match(String(liveSendProblem(env)), /country=US and no postal address \(CAN-SPAM/)
    let calls = 0
    const transport = { name: "fake", async send() { calls++ } }
    await assert.rejects(sendMail({ inbox: "a@x.example", to: "b@y.example", subject: "s", body: "b", senderName: "n", trackingId: "t" }, { env, transport, cfg: null }), /CAN-SPAM/)
    assert.equal(calls, 0, "no call to the transport")
    writeFileSync(f, JSON.stringify({ name: "With Address LLC", country: "US", language: "en", postalAddress: "1 Main St, Springfield, XX 00000" }))
    const env2 = { ...env, LWS_AGENCY_CONFIG: f + "" }
    // new content, same path: force another cache key by going through a separate file
    const f2 = join(dir, "agency2.config.json"); writeFileSync(f2, JSON.stringify({ name: "With Address LLC", country: "US", language: "en", postalAddress: "1 Main St, Springfield, XX 00000" }))
    assert.equal(liveSendProblem({ ...env2, LWS_AGENCY_CONFIG: f2 }), null)
    const sent = await sendMail({ inbox: "a@x.example", to: "b@y.example", subject: "s", body: "b", senderName: "n", trackingId: "t" }, { env: { ...env2, LWS_AGENCY_CONFIG: f2 }, transport, cfg: null })
    assert.equal(calls, 1); assert.match(sent.text, /1 Main St, Springfield/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
  assert.equal(liveSendProblem(FR), null)
})

test("phones: FR intact, NANP (US/CA), UK, AU, E.164; no false positive on a date or a price", () => {
  assert.equal(findPhone("Appelez le 03 53 01 24 68 dès maintenant"), "03 53 01 24 68")
  assert.equal(findPhone("Call us at (207) 555-0142 today"), "(207) 555-0142")
  assert.equal(findPhone("Tel: 207.555.0142"), "207.555.0142")
  assert.equal(findPhone("+1 207 555 0142"), "+1 207 555 0142")
  assert.equal(findPhone("Call 020 7946 0000 (London)"), "020 7946 0000")
  assert.equal(findPhone("Mobile 07700 900123"), "07700 900123")
  assert.equal(findPhone("Mobile (AU): 0412 345 678"), "0412 345 678")
  assert.equal(findPhone("+44 20 7946 0000"), "+44 20 7946 0000")
  assert.equal(findPhone("+61 2 9876 5432"), "+61 2 9876 5432")
  assert.equal(findPhone("Founded in 2026, prices from 1200 to 45000 dollars, open 9-17"), undefined)
  assert.equal(findPhone("Order #1234567 shipped 2026-11-05"), undefined)
  assert.deepEqual(findPhones("(207) 555-0142 or 207-555-0142 or 03 53 01 24 68").sort(), ["(207) 555-0142", "03 53 01 24 68"], "deduplicated on the digits")
  assert.equal(normalizePhone("+1 (207) 555-0142"), "+12075550142"); assert.equal(normalizePhone("03 53 01 24 68"), "0353012468")
  assert.equal(readContact("<p>Call (207) 555-0142</p>").phone, "(207) 555-0142")
  assert.equal(readContact('<a href="tel:+12075550142">call</a>').phone, "+12075550142", "the tel: link wins")
})

test("company register: outside France, \"unknown\" without any network call; OSM zones for any country or subdivision", async () => {
  const r = await lookupCompany("Harbor Pools LLC", { city: "Portland" })
  assert.equal(hasCompanyRegistry(US), false); assert.equal(hasCompanyRegistry(FR), true)
  assert.ok(r && typeof r === "object")
  // with the US agency, the API is never contacted: LWS_SIRENE_URL points at a closed port and there is no error and no delay
  const prev = { ...process.env }
  process.env.LWS_AGENCY_CONFIG = "agency.config.example.us.json"; process.env.LWS_SIRENE_URL = "http://127.0.0.1:1/search"; delete process.env.LWS_SIRENE
  try {
    const t = Date.now()
    const r2 = await lookupCompany("Harbor Pools LLC", { city: "Portland" })
    assert.ok(Date.now() - t < 2000, "no network call (port 1 would wait or fail)")
    assert.deepEqual(r2, r, "\"unknown\", as with LWS_SIRENE=0")
  } finally { for (const k of ["LWS_AGENCY_CONFIG", "LWS_SIRENE_URL", "LWS_SIRENE"]) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k] } }
  assert.deepEqual(osmZone("us")?.areas, ['area["ISO3166-1"="US"][admin_level=2];'])
  assert.deepEqual(osmZone("us-me")?.areas, ['area["ISO3166-2"="US-ME"];'])
  assert.deepEqual(osmZone("ca-on")?.areas, ['area["ISO3166-2"="CA-ON"];'])
  assert.equal(osmZone("fr")?.label, "France"); assert.equal(osmZone("nope-zone-x"), null)
})

test("trades: at least 20 with an English label and keywords; industryTerms mixes FR + EN; label by language", () => {
  const withEn = Object.entries(INDUSTRIES).filter(([, i]) => i.en && i.en.label && i.en.terms.length >= 3)
  assert.ok(withEn.length >= 20, `${withEn.length} trades with en`)
  for (const k of ["pisciniste", "cuisiniste", "couvreur-zingueur", "paysagiste", "menuisier", "architecte", "installateur-pv-pac"]) assert.ok(INDUSTRIES[k].en, k)
  assert.ok(industryTerms("pisciniste").includes("pool builder") && industryTerms("pisciniste").includes("pisciniste"))
  assert.equal(industryLabel("couvreur-zingueur", "en"), "roofer"); assert.equal(industryLabel("couvreur-zingueur", "fr"), INDUSTRIES["couvreur-zingueur"].label)
  assert.equal(industryLabel("piscine", "en-US"), "pool builder", "normalised alias")
})

test("draft and skills in English when language=en; LANGUAGE block added to every skill's inputs", () => {
  const prev = process.env.LWS_AGENCY_CONFIG
  process.env.LWS_AGENCY_CONFIG = "agency.config.example.us.json"
  try {
    const d = compose({ name: "Harbor Pools", oldUrl: "http://harbor-pools.example/", demoUrl: "https://demo.example/harbor/", seo: "no title tag", competitor: null })
    assert.match(d.subject, /^Harbor Pools: a website that wins you more work$/)
    assert.match(d.body, /^Hello,/); assert.match(d.body, /The 30-second demo: https:\/\/demo\.example\/harbor\//); assert.doesNotMatch(d.body, /Bonjour|devis|démo/)
    assert.match(d.htmlBody, /Watch the demo/)
    const blocks = inputBlocks({ business: "Harbor Pools" })
    assert.match(blocks, /## LANGUAGE\n\nen \(country US\)/)
  } finally { if (prev === undefined) delete process.env.LWS_AGENCY_CONFIG; else process.env.LWS_AGENCY_CONFIG = prev }
  process.env.LWS_AGENCY_CONFIG = "agency.config.example.json"
  try {
    assert.match(compose({ name: "Orvane", oldUrl: "", demoUrl: "", seo: "", competitor: null }).body, /^Bonjour,/)
    assert.match(inputBlocks({ a: "b" }), /## LANGUAGE\n\nfr \(country FR\)/)
  } finally { if (prev === undefined) delete process.env.LWS_AGENCY_CONFIG; else process.env.LWS_AGENCY_CONFIG = prev }
})
