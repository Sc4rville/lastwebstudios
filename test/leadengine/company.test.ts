/**
 * G4 / P1-1: no more INSEE false positives. 100 % offline tests: the Recherche d'entreprises API is
 * replaced by a fake local server that replays fictional answers (test/fixtures/sirene/).
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { jsonRoutes, type Http } from "../helpers/server.ts"
import { FIXTURES } from "../helpers/workspace.ts"
import { tsx } from "../helpers/proc.ts"
import { lookupCompany, distinctiveTokens, scoreMatch } from "../../leadengine/1_scraping/scripts/company.ts"

const fx = (name: string) => JSON.parse(readFileSync(join(FIXTURES, "sirene", `${name}.json`), "utf8"))
let api: Http
let reply = "homonym-ceased"
before(async () => {
  api = await jsonRoutes({ "GET /search": () => ({ json: fx(reply) }) })
  process.env.LWS_SIRENE = "1"
  process.env.LWS_SIRENE_URL = `${api.url}/search`
})
after(async () => { await api.close(); process.env.LWS_SIRENE = "0" })

test("distinctive words: the trade, the legal form and stop words don't count", () => {
  assert.deepEqual(distinctiveTokens("Orvane Piscines"), ["orvane"])
  assert.deepEqual(distinctiveTokens("SARL Cuisines Lumeo"), ["lumeo"])
  assert.deepEqual(distinctiveTokens("Atelier Brisane Menuiserie"), ["brisane"])
  assert.deepEqual(distinctiveTokens("Piscines Services"), [], "a 100 % generic name: unverifiable")
})

test("\"Orvane Piscines\" against ANOTHER closed company \"… PISCINES\": no match (unknown, no gate)", async () => {
  reply = "homonym-ceased"
  const c = await lookupCompany("Orvane Piscines", { city: "Valmont-sur-Lys" })
  assert.equal(c.status, "inconnu")
  assert.equal(c.siren, null)
  assert.equal(c.match, 0)
})

test("the real namesake (distinctive name + same town): match, active, size and revenue read", async () => {
  reply = "true-match"
  const c = await lookupCompany("Orvane Piscines", { city: "Valmont-sur-Lys" })
  assert.equal(c.status, "actif")
  assert.equal(c.siren, "000000034")
  assert.equal(c.ca, 640000)
  assert.ok(c.match >= 0.9)
})

test("corroboration by the postcode alone: match", async () => {
  reply = "true-match"
  const c = await lookupCompany("Orvane Piscines", { postal: "59999" })
  assert.equal(c.status, "actif")
})

test("same distinctive name but another town (closed): no decision", async () => {
  reply = "same-name-other-city"
  const c = await lookupCompany("Orvane Piscines", { city: "Valmont-sur-Lys" })
  assert.equal(c.status, "inconnu")
})

test("scoreMatch: ALL the distinctive words are needed; an establishment's trading name counts", () => {
  const r = { nom_complet: "SOCIETE X", siege: { libelle_commune: "VALMONT-SUR-LYS", code_postal: "59999" }, matching_etablissements: [{ liste_enseignes: ["ORVANE PISCINES"], libelle_commune: "VALMONT-SUR-LYS" }] }
  assert.ok(scoreMatch("Orvane Piscines", { city: "Valmont-sur-Lys" }, r) >= 0.9)
  assert.equal(scoreMatch("Orvane Brisane", { city: "Valmont-sur-Lys" }, r), 0)
})

test("LWS_SIRENE=0: no network request, \"inconnu\" (unknown)", async () => {
  const n = api.hits.length
  process.env.LWS_SIRENE = "0"
  try { assert.equal((await lookupCompany("Orvane Piscines", { city: "Valmont-sur-Lys" })).status, "inconnu") }
  finally { process.env.LWS_SIRENE = "1" }
  assert.equal(api.hits.length, n)
})

test("`npm run company` (CLI) against the fake server: ACTIVE on the real namesake", async () => {
  reply = "true-match"
  const r = await tsx(process.cwd(), "leadengine/1_scraping/scripts/company.ts", ["Orvane Piscines", "Valmont-sur-Lys"], { env: { LWS_SIRENE: "1", LWS_SIRENE_URL: `${api.url}/search` } })
  assert.equal(r.code, 0, r.out)
  assert.match(r.stdout, /✓ ACTIVE . ORVANE PISCINES/)
})
