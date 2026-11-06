/**
 * G4 / P1-1 : plus de faux positif INSEE. Tests 100 % hors ligne : l'API Recherche d'entreprises est
 * remplacée par un faux serveur local qui rejoue des réponses fictives (test/fixtures/sirene/).
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

test("mots distinctifs : le métier, la forme juridique et les mots vides ne comptent pas", () => {
  assert.deepEqual(distinctiveTokens("Orvane Piscines"), ["orvane"])
  assert.deepEqual(distinctiveTokens("SARL Cuisines Lumeo"), ["lumeo"])
  assert.deepEqual(distinctiveTokens("Atelier Brisane Menuiserie"), ["brisane"])
  assert.deepEqual(distinctiveTokens("Piscines Services"), [], "nom 100 % générique : invérifiable")
})

test("« Orvane Piscines » contre une AUTRE société cessée « … PISCINES » : pas de match (inconnu, aucun gate)", async () => {
  reply = "homonym-ceased"
  const c = await lookupCompany("Orvane Piscines", { city: "Valmont-sur-Lys" })
  assert.equal(c.status, "inconnu")
  assert.equal(c.siren, null)
  assert.equal(c.match, 0)
})

test("le vrai homonyme (nom distinctif + même commune) : match, actif, taille et CA lus", async () => {
  reply = "true-match"
  const c = await lookupCompany("Orvane Piscines", { city: "Valmont-sur-Lys" })
  assert.equal(c.status, "actif")
  assert.equal(c.siren, "000000034")
  assert.equal(c.ca, 640000)
  assert.ok(c.match >= 0.9)
})

test("corroboration par le code postal seul : match", async () => {
  reply = "true-match"
  const c = await lookupCompany("Orvane Piscines", { postal: "59999" })
  assert.equal(c.status, "actif")
})

test("même nom distinctif mais autre commune (cessée) : on ne tranche pas", async () => {
  reply = "same-name-other-city"
  const c = await lookupCompany("Orvane Piscines", { city: "Valmont-sur-Lys" })
  assert.equal(c.status, "inconnu")
})

test("scoreMatch : il faut TOUS les mots distinctifs ; une enseigne d'établissement compte", () => {
  const r = { nom_complet: "SOCIETE X", siege: { libelle_commune: "VALMONT-SUR-LYS", code_postal: "59999" }, matching_etablissements: [{ liste_enseignes: ["ORVANE PISCINES"], libelle_commune: "VALMONT-SUR-LYS" }] }
  assert.ok(scoreMatch("Orvane Piscines", { city: "Valmont-sur-Lys" }, r) >= 0.9)
  assert.equal(scoreMatch("Orvane Brisane", { city: "Valmont-sur-Lys" }, r), 0)
})

test("LWS_SIRENE=0 : aucune requête réseau, « inconnu »", async () => {
  const n = api.hits.length
  process.env.LWS_SIRENE = "0"
  try { assert.equal((await lookupCompany("Orvane Piscines", { city: "Valmont-sur-Lys" })).status, "inconnu") }
  finally { process.env.LWS_SIRENE = "1" }
  assert.equal(api.hits.length, n)
})

test("`npm run company` (CLI) contre le faux serveur : ACTIF sur le vrai homonyme", async () => {
  reply = "true-match"
  const r = await tsx(process.cwd(), "leadengine/1_scraping/scripts/company.ts", ["Orvane Piscines", "Valmont-sur-Lys"], { env: { LWS_SIRENE: "1", LWS_SIRENE_URL: `${api.url}/search` } })
  assert.equal(r.code, 0, r.out)
  assert.match(r.stdout, /✓ ACTIF . ORVANE PISCINES/)
})
