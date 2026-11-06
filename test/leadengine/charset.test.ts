/**
 * Test blitz (24/10) · les VIEUX sites (la cible du produit) sont souvent en ISO-8859-1 / windows-1252. Le lead engine
 * décodait tout en UTF-8 (`res.text()`) : « réalisations » devenait « r�alisations », les signaux accentués du scoring
 * disparaissaient et l'enrichissement ne retrouvait plus le nom ni la ville dans la page. Ici : le vieux site FICTIF
 * Orvane Piscines servi en Latin-1 (déclaré par l'en-tête, par <meta> seulement, ou pas du tout) doit être lu
 * exactement comme sa version UTF-8.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { createServer, type Server } from "node:http"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { FIXTURES } from "../helpers/workspace.ts"
import { decodeHtml } from "../../leadengine/1_scraping/scripts/util.ts"
import { techProbe } from "../../leadengine/2_scoring/scripts/score.ts"

const enc = new TextEncoder()
/** windows-1252 pour le texte de la fixture : on n'y garde que des caractères Latin-1 (les autres en ASCII). */
const toLatin1 = (s: string) => Buffer.from(s, "latin1")
const latin1Safe = (s: string) => s.replace(/[’‘]/g, "'").replace(/[“”«»]/g, '"').replace(/[–—]/g, "-").replace(/[^\x00-\xff]/g, "")

test("decodeHtml : BOM, en-tête, <meta charset>, http-equiv, UTF-8 annoncé mais faux, rien d'annoncé, étiquette inconnue", () => {
  const s = "Réalisations · Vallée de la Lys · façade, pièce d'eau"
  assert.equal(decodeHtml(enc.encode(s), "text/html; charset=utf-8"), s)
  assert.equal(decodeHtml(toLatin1(s), "text/html; charset=ISO-8859-1"), s)
  assert.equal(decodeHtml(toLatin1(`<meta charset="windows-1252"><p>${s}`), "text/html"), `<meta charset="windows-1252"><p>${s}`)
  const equiv = `<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1"><p>${s}`
  assert.equal(decodeHtml(toLatin1(equiv), ""), equiv)
  assert.equal(decodeHtml(toLatin1(s), "text/html; charset=UTF-8"), s, "serveur qui annonce UTF-8 à tort")
  assert.equal(decodeHtml(toLatin1(s), "text/html"), s, "rien d'annoncé, octets Latin-1")
  assert.equal(decodeHtml(enc.encode(s), "text/html"), s, "rien d'annoncé, UTF-8 valide")
  assert.equal(decodeHtml(Uint8Array.from([0xef, 0xbb, 0xbf, ...enc.encode(s)]), "text/html; charset=iso-8859-1"), s, "le BOM prime sur l'en-tête (et il est retiré)")
  assert.equal(decodeHtml(enc.encode(s), "text/html; charset=x-inconnu-42"), s)
  assert.equal(decodeHtml(Buffer.from([0x80]), "text/html; charset=windows-1252"), "€")
  // Node décode « windows-1252 » comme ISO-8859-1 (0x80-0x9F → caractères de contrôle) : « cœur », l'apostrophe et l'euro
  assert.equal(decodeHtml(Buffer.from([0x63, 0x9c, 0x75, 0x72, 0x20, 0x92, 0x20, 0x31, 0x32, 0x80, 0x20, 0x85]), "text/html; charset=ISO-8859-1"), "cœur ’ 12€ …")
  assert.equal(decodeHtml(Buffer.from([0xa4]), "text/html; charset=iso-8859-15"), "€", "latin-9 : l'euro en 0xA4")
})

let srv: Server, base = ""
const pages = new Map<string, { body: Buffer; type: string }>()
before(async () => {
  const site = join(FIXTURES, "sites", "orvane-piscines")
  const html = latin1Safe(readFileSync(join(site, "index.html"), "utf8"))
  assert.match(html, /réalisations/i, "la fixture contient bien des signaux accentués")
  assert.match(html, /charset=utf-8/i)
  const metaLatin = html.replace(/charset=utf-8/i, "charset=iso-8859-1")
  pages.set("/utf8/", { body: Buffer.from(html, "utf8"), type: "text/html; charset=utf-8" })
  pages.set("/header/", { body: toLatin1(metaLatin), type: "text/html; charset=ISO-8859-1" })
  pages.set("/meta/", { body: toLatin1(metaLatin), type: "text/html" })
  pages.set("/rien/", { body: toLatin1(html.replace(/<meta[^>]*charset=utf-8[^>]*>/i, "")), type: "text/html" })
  pages.set("/menteur/", { body: toLatin1(html), type: "text/html; charset=utf-8" })
  // une page datée FICTIVE dont les signaux n'existent QU'ACCENTUÉS (aucun doublon ASCII qui masquerait le bug)
  const accents = `<html><head><meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1"><title>Atelier Fictif de Valmont</title></head><body>
<h1>Atelier Fictif</h1><p>Découvrez nos réalisations, du salon à la cuisine.</p><p>Réservation en ligne de votre rendez-vous.</p>
<p>Nos actualités de l'été.</p><p>Notre architecte d'intérieur vous reçoit à l'atelier.</p><p>Tél : 03 53 01 99 99</p></body></html>`
  pages.set("/accents-utf8/", { body: Buffer.from(accents.replace("iso-8859-1", "utf-8"), "utf8"), type: "text/html; charset=utf-8" })
  pages.set("/accents-latin1/", { body: toLatin1(accents), type: "text/html" })
  srv = createServer((req, res) => {
    const p = pages.get((req.url || "/").split("?")[0])
    if (!p) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { "Content-Type": p.type }); res.end(p.body)
  })
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()))
  const a = srv.address(); base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`
})
after(() => new Promise<void>((r) => { srv?.closeAllConnections?.(); srv?.close(() => r()) }))

test("scoring : le vieux site servi en Latin-1 (en-tête, <meta>, rien, UTF-8 menteur) a les MÊMES signaux, besoin et contact qu'en UTF-8", async () => {
  const ref = await techProbe(`${base}/utf8/`)
  assert.equal(ref.reachable, true)
  assert.equal(ref.signals.gallery, true, "« réalisations » vu dans la version UTF-8")
  for (const v of ["header", "meta", "rien", "menteur"]) {
    const p = await techProbe(`${base}/${v}/`)
    assert.deepEqual(p.signals, ref.signals, `signaux (${v})`)
    assert.deepEqual(p.contact, ref.contact, `contact (${v})`)
    assert.equal(p.feasible, ref.feasible, `faisabilité (${v})`)
    // la seule différence admise : la longueur du HTML en octets ne change rien au besoin (même texte)
    assert.equal(p.besoin, ref.besoin, `besoin (${v})`)
  }
})

test("scoring : une page dont les signaux ne sont QU'ACCENTUÉS (réalisations, réservation, actualités, architecte d'intérieur) les garde en Latin-1", async () => {
  const ref = await techProbe(`${base}/accents-utf8/`)
  assert.deepEqual([ref.signals.gallery, ref.signals.booking, ref.signals.blog, ref.signals.premium], [true, true, true, true], "les 4 signaux en UTF-8")
  const latin = await techProbe(`${base}/accents-latin1/`)
  assert.deepEqual(latin.signals, ref.signals, "avant : les 4 disparaissaient (« r�alisations »)")
})

test("serveurs hostiles : page sans fin (flux continu), boucle de redirections, binaire servi en HTML → réponse bornée, jamais de plantage", { timeout: 60_000 }, async () => {
  const hostile = createServer((req, res) => {
    if (req.url === "/sans-fin/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.write("<html><head><title>Atelier fictif</title></head><body><p>Nos réalisations</p>")
      const chunk = "<p>" + "contenu sans fin ".repeat(4000) + "</p>"
      const pump = () => { while (res.write(chunk)) { /* tant que le tampon accepte */ } }
      res.on("drain", pump); pump()
      req.on("close", () => res.destroy())
      return
    }
    if (req.url?.startsWith("/boucle")) { res.writeHead(302, { Location: "/boucle?" + Math.random() }); res.end(); return }
    if (req.url === "/binaire/") { res.writeHead(200, { "Content-Type": "text/html" }); res.end(Buffer.from(Array.from({ length: 300_000 }, (_, i) => (i * 7919) % 256))); return }
    res.writeHead(404); res.end()
  })
  await new Promise<void>((r) => hostile.listen(0, "127.0.0.1", () => r()))
  const a = hostile.address(); const h = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`
  try {
    const t0 = Date.now(), rss0 = process.memoryUsage().rss
    const endless = await techProbe(`${h}/sans-fin/`)
    assert.ok(Date.now() - t0 < 8_000, `page sans fin lue en ${Date.now() - t0} ms (borne : quelques Mo, pas le délai de 20 s)`)
    assert.equal(endless.reachable, true, "un site énorme est joignable, pas « injoignable »")
    assert.equal(endless.signals.gallery, true)
    assert.ok(process.memoryUsage().rss - rss0 < 200_000_000, "mémoire bornée")
    const loop = await techProbe(`${h}/boucle`)
    assert.equal(loop.reachable, false)
    const bin = await techProbe(`${h}/binaire/`)
    assert.equal(typeof bin.besoin, "number")
  } finally { await new Promise<void>((r) => { hostile.closeAllConnections?.(); hostile.close(() => r()) }) }
})
