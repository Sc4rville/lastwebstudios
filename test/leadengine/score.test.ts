/**
 * G4: the scoring gate. A page without any contact is not "KEPT"; the hook (accroche, French copy) holds neither
 * an em dash nor an invented trade; a closed namesake no longer drops a real prospect. The "old site"
 * is the fictional Orvane Piscines fixture served on 127.0.0.1; SIRENE is a fake server.
 * The reasons and the hook stay French on purpose (codes for the cockpit, copy for a French prospect).
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { serveDir, jsonRoutes, type Http } from "../helpers/server.ts"
import { makeWorkspace, FIXTURES, type Workspace } from "../helpers/workspace.ts"
import { tsx } from "../helpers/proc.ts"
import { accroche, isUnreachable } from "../../leadengine/2_scoring/scripts/model.ts"
import { readContact, scoreProspect } from "../../leadengine/2_scoring/scripts/score.ts"

const DASHES = /[‒-―]/
let orvane: Http, empty: Http, sirene: Http, ws: Workspace
let reply: any = null
before(async () => {
  orvane = await serveDir(join(FIXTURES, "sites", "orvane-piscines"))
  empty = await serveDir(join(FIXTURES, "sites", "empty-site"))
  sirene = await jsonRoutes({ "GET /search": () => ({ json: reply }) })
  ws = makeWorkspace()
})
after(async () => { await orvane.close(); await empty.close(); await sirene.close(); ws.cleanup(); process.env.LWS_SIRENE = "0" })

test("hook: never an em dash, even when the reason holds one", () => {
  for (const reasons of [["pas responsive — viewport absent"], [], ["site injoignable / cassé"], ["visuel : typo datée – couleurs ternes"]]) {
    for (const ind of ["", "pisciniste", "architecte", "metier-inconnu"]) assert.doesNotMatch(accroche(reasons, ind), DASHES, `${reasons} / ${ind}`)
  }
})

test("hook: with no known trade, no trade is invented (no more default \"cuisiniste\")", () => {
  const a = accroche(["pas de HTTPS"], "")
  assert.match(a, /^Votre site : pas de https\./)
  assert.doesNotMatch(a, /cuisiniste|votre activité/)
  assert.match(accroche(["pas de HTTPS"], "pisciniste"), /^Votre site de pisciniste :/)
  assert.match(accroche(["pas de HTTPS"], "architecte"), /^Votre site d'architecte :/)
})

test("readContact: tel: link, FR number, mailto, form; an @2x image is not an email", () => {
  assert.deepEqual(readContact('<a href="tel:+33353012468">appeler</a>'), { phone: "+33353012468", email: undefined, form: false })
  assert.equal(readContact("<p>Tél. 03 53 01 24 68</p>").phone, "03 53 01 24 68")
  assert.equal(readContact('<a href="mailto:contact@orvane-piscines.example">écrire</a>').email, "contact@orvane-piscines.example")
  assert.equal(readContact('<img src="logo@2x.png"><p>rien</p>').email, undefined)
  assert.equal(readContact('<form><input name="x"></form>').form, true)
  assert.deepEqual(readContact("<p>Site en construction</p>"), { phone: undefined, email: undefined, form: false })
})

test("isUnreachable: neither sheet nor site → unreachable; a single way is enough", () => {
  assert.equal(isUnreachable({ industry: "" }, {}), true)
  assert.equal(isUnreachable({ industry: "" }, undefined), true)
  assert.equal(isUnreachable({ industry: "", phone: "01 99 00 42 17" }, {}), false)
  assert.equal(isUnreachable({ industry: "" }, { form: true }), false)
})

test("`npm run score` on an empty page WITHOUT a contact: DROPPED (not kept), reason \"injoignable\"", async () => {
  const r = await tsx(ws.dir, "leadengine/2_scoring/scripts/score.ts", ["vide-test", empty.url + "/"], { env: { VISUAL: "0" } })
  assert.equal(r.code, 0, r.out)
  assert.match(r.stdout, /→ DROPPED/)
  assert.match(r.stdout, /injoignable/)
  assert.doesNotMatch(r.stdout, /KEPT/)
  const saved = ws.json("data/raw/vide-test.score.json")
  assert.equal(saved.tier, "cold")
})

test("`npm run score` on the fictional old Orvane site: KEPT, need detected, clean hook", async () => {
  const r = await tsx(ws.dir, "leadengine/2_scoring/scripts/score.ts", ["orvane-test", orvane.url + "/", "pisciniste"], { env: { VISUAL: "0" } })
  assert.equal(r.code, 0, r.out)
  assert.match(r.stdout, /→ KEPT/)
  const s = ws.json("data/raw/orvane-test.score.json")
  assert.ok(s.value > 0 && s.tier !== "cold", JSON.stringify(s))
  for (const why of ["pas responsive", "pas de HTTPS", "vieux jQuery", "dernière trace de maj : 2016"]) assert.ok(s.reasons.some((x: string) => x.includes(why)), why)
  assert.doesNotMatch(s.accroche, DASHES)
  assert.match(s.accroche, /pisciniste/)
})

test("scoreProspect: a CLOSED namesake \"… PISCINES\" no longer drops the prospect (no more 0/100)", async () => {
  process.env.LWS_SIRENE = "1"; process.env.LWS_SIRENE_URL = `${sirene.url}/search`
  reply = JSON.parse(readFileSync(join(FIXTURES, "sirene", "homonym-ceased.json"), "utf8"))
  const s = await scoreProspect("orvane-piscines-valmont-sur-lys", orvane.url + "/", { industry: "pisciniste", name: "Orvane Piscines", city: "Valmont-sur-Lys", phone: "03 53 01 24 68" })
  assert.ok(s.value > 0, JSON.stringify(s))
  assert.ok(!s.reasons.some((r) => /RADIÉE/.test(r)))
})

test("scoreProspect: the REAL company, closed, is still dropped by the hard gate", async () => {
  process.env.LWS_SIRENE = "1"; process.env.LWS_SIRENE_URL = `${sirene.url}/search`
  reply = JSON.parse(readFileSync(join(FIXTURES, "sirene", "true-match.json"), "utf8"))
  reply.results[0].etat_administratif = "C"
  const s = await scoreProspect("orvane-piscines-valmont-sur-lys", orvane.url + "/", { industry: "pisciniste", name: "Orvane Piscines", city: "Valmont-sur-Lys" })
  assert.equal(s.value, 0)
  assert.ok(s.reasons.some((r) => /RADIÉE/.test(r)))
})

test("hook: \"pas de HTTPS\" is NOT a dead site (regression found on 2026-10-24)", () => {
  assert.doesNotMatch(accroche(["pas de HTTPS (sécurité + SEO pénalisé)"], "pisciniste"), /inaccessible/)
  assert.match(accroche(["site en erreur (HTTP 404)"], "pisciniste"), /inaccessible/)
  assert.match(accroche(["site injoignable / cassé"], ""), /^Votre site est inaccessible/)
})
