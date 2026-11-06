/**
 * G14 (marque centralisée) : tout ce qui parle au nom de l'agence lit agency.config.json (packages/shared/agency.mjs).
 * Le dépôt privé garde ses valeurs (son agency.config.json) ; l'exemple livré est une agence FICTIVE ; et plus aucun
 * morceau de l'identité de l'agence n'est écrit en dur dans le code du produit.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { agency, agencyFile, brandFacts, NEUTRAL } from "../../packages/shared/agency.mjs"
import { buildMessage } from "../../outreach/scripts/lib/smtp.ts"
import { codeFiles } from "../../scripts/lib/files.mjs"
import { tsx } from "../helpers/proc.ts"

const EXAMPLE = { LWS_AGENCY_CONFIG: "agency.config.example.json" }
const FICTION_PHONE = /^0(19900|26191|35301|46571|53649|63998|97740)/ // plages ARCEP réservées à la fiction

test("résolution : agency.config.json du dépôt, LWS_AGENCY_CONFIG, puis valeurs neutres ; un fichier partiel suffit", () => {
  assert.match(String(agencyFile({})), /agency\.config\.json$/)
  assert.equal(agency(EXAMPLE).name, "Atelier Vélin")
  const empty = mkdtempSync(join(tmpdir(), "lws-agency-"))
  try {
    assert.equal(agencyFile({}, empty), null)
    assert.equal(agency({}, empty).name, NEUTRAL.name)
    writeFileSync(join(empty, "agency.config.json"), JSON.stringify({ name: "Studio Test", mail: { heloDomain: "studio-test.example" } }))
    const a = agency({}, empty)
    assert.equal(a.name, "Studio Test")
    assert.equal(a.mail.senderName, "Studio Test", "dérivé du nom")
    assert.equal(a.mail.legalIdentity, "Studio Test")
    assert.equal(a.mail.heloDomain, "studio-test.example")
    assert.equal(a.storage.bucket, NEUTRAL.storage.bucket, "clé absente = valeur neutre")
  } finally { rmSync(empty, { recursive: true, force: true }) }
})

test("l'agence d'exemple est fictive : domaines .example, téléphone de fiction ARCEP", () => {
  const raw = readFileSync("agency.config.example.json", "utf8")
  for (const e of raw.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? []) assert.match(e, /\.example$/, e)
  for (const u of raw.match(/https?:\/\/[^"\s)]+/g) ?? []) assert.match(new URL(u).hostname, /\.example$/, u)
  const a = agency(EXAMPLE)
  assert.match(a.phone.replace(/\D/g, ""), FICTION_PHONE)
  assert.match(a.mail.heloDomain, /\.example$/)
  assert.equal(brandFacts(EXAMPLE).studio, "Atelier Vélin")
  assert.equal(brandFacts(EXAMPLE).calcomUrl, a.calendarUrl)
})

test("pied légal des mails = identité de l'agence (jamais une autre agence en dur)", () => {
  const msg = buildMessage({ inbox: "camille@atelier-velin.example", to: "contact@orvane-piscines.example", subject: "Une idée", body: "Bonjour", senderName: "Camille", trackingId: "x" }, null)
  assert.match(msg.text, new RegExp(`${agency().mail.legalIdentity}\\. Vous recevez ce message`))
})

test("factures, User-Agent, HELO, mail sauveur lisent l'agence (process neuf, agence d'exemple)", async () => {
  const probe = join(mkdtempSync(join(tmpdir(), "lws-agency-probe-")), "probe.mts")
  writeFileSync(probe, [
    `import { DEFAULT_SELLER } from ${JSON.stringify(join(process.cwd(), "backoffice/reviewpipe/invoices.ts"))}`,
    `import { brandFacts, agency } from ${JSON.stringify(join(process.cwd(), "packages/shared/agency.mjs"))}`,
    `console.log(JSON.stringify({ seller: DEFAULT_SELLER, brand: brandFacts(), ua: agency().http }))`,
  ].join("\n"))
  try {
    const r = await tsx(process.cwd(), probe, [], { env: EXAMPLE })
    assert.equal(r.code, 0, r.out)
    const o = JSON.parse(r.stdout.trim().split("\n").pop()!)
    assert.equal(o.seller.name, "Atelier Vélin")
    assert.equal(o.seller.email, "bonjour@atelier-velin.example")
    assert.match(o.seller.siret, /^</, "placeholders gardés")
    assert.equal(o.brand.senderName, "Camille · Atelier Vélin")
    assert.match(o.ua.userAgent, /atelier-velin/)
  } finally { rmSync(join(probe, ".."), { recursive: true, force: true }) }
  for (const [f, needle] of [["leadengine/1_scraping/scripts/sources.ts", "agency().http.userAgent"], ["leadengine/1_scraping/scripts/emails.ts", "agency().http.crawlerUserAgent"], ["leadengine/2_scoring/scripts/score.ts", "agency().http.crawlerUserAgent"], ["outreach/scripts/wehavemillionverifierathome.ts", "agency().mail.heloDomain"], ["packages/shared/storage.ts", "agency().storage.bucket"], ["outreach/scripts/savior.ts", "brandFacts()"]] as const) {
    assert.ok(readFileSync(f, "utf8").includes(needle), `${f} lit ${needle}`)
  }
})

test("opérateurs du CRM (attribution des appels) : ceux de l'agence, aucun prénom en dur dans le cockpit", () => {
  assert.deepEqual(agency(EXAMPLE).operators, ["camille", "alex"])
  const serve = readFileSync("backoffice/reviewpipe/serve.ts", "utf8")
  const crm = serve.slice(serve.indexOf('path === "/api/crm/assign"'), serve.indexOf('path === "/api/crm/stage"'))
  assert.ok(crm.includes("agency().operators"))
  for (const op of agency().operators) assert.ok(!crm.includes(`"${op}"`), `opérateur « ${op} » écrit en dur`)
})

test("aucun morceau de l'identité de l'agence n'est écrit en dur dans le code du produit", () => {
  const a = agency()
  const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "") } catch { return "" } }
  const tokens = [host(a.website), a.mail.heloDomain, a.contactEmail, a.calendarUrl.replace(/^https?:\/\//, ""), a.phone].filter((t) => t && t.length >= 6 && !/^localhost$/.test(t))
  assert.ok(tokens.length >= 3, JSON.stringify(tokens))
  const CODE = /\.(ts|mts|mjs|js|cjs|json|html|css|sh|service|timer|sql)$/
  const SKIP = /^(agency\.config(\.example)?\.json|outreach\/sequencer\/config\.json|package-lock\.json|test\/|data\/sample\/|examples\/|scripts\/oss\/overlay\/)/
  const hits: string[] = []
  for (const rel of codeFiles(process.cwd())) {
    if (!CODE.test(rel) || SKIP.test(rel)) continue
    const s = readFileSync(rel, "utf8")
    for (const t of tokens) if (s.includes(t)) hits.push(`${rel} : ${t.slice(0, 3)}…`)
  }
  assert.deepEqual(hits, [])
})
