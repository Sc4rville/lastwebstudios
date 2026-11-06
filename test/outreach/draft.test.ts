/**
 * P0-1 : `outreach/scripts/draft.ts` levait à l'import (classe de caractères inversée), cassant
 * `npm run outreach`, le bouton « préparer » de Salesport et les skills /out et /outreach-mail.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { tsx } from "../helpers/proc.ts"
import { makeWorkspace } from "../helpers/workspace.ts"

const DASHES = /[‒-―]/

test("draft.ts se charge (plus de SyntaxError à l'import)", async () => {
  const m = await import("../../outreach/scripts/draft.ts")
  assert.equal(typeof m.stripDash, "function")
  assert.equal(typeof m.compose, "function")
})

test("stripDash remplace les 4 tirets typographiques (U+2012 à U+2015) et rien d'autre", async () => {
  const { stripDash } = await import("../../outreach/scripts/draft.ts")
  assert.equal(stripDash("a‒b–c—d―e"), "a-b-c-d-e")
  assert.equal(stripDash("prix · 12 € · tél. 03 53 01 24 68"), "prix · 12 € · tél. 03 53 01 24 68")
  assert.equal(stripDash("Orvane — Piscines"), "Orvane - Piscines")
})

test("la source de draft.ts n'écrit plus les tirets en dur dans la regex (garde-fou anti-régression)", () => {
  const src = readFileSync("outreach/scripts/draft.ts", "utf8")
  const line = src.split("\n").find((l) => l.includes("export const stripDash"))!
  assert.ok(line, "stripDash introuvable")
  assert.doesNotMatch(line, DASHES)
  assert.match(line, /\\u2012-\\u2015/)
})

test("compose() rend un brouillon sans aucun tiret cadratin, même si l'entrée en contient", async () => {
  const { compose } = await import("../../outreach/scripts/draft.ts")
  const d = compose({ name: "Orvane — Piscines", oldUrl: "http://orvane-piscines.example/", demoUrl: "", seo: "pas de H1 – rien", competitor: { name: "Testex", url: "http://testex.example/", city: "Port-Aubril" } })
  for (const part of [d.subject, d.body, d.htmlBody]) assert.doesNotMatch(part, DASHES)
  assert.match(d.body, /Orvane - Piscines/)
})

test("`npm run outreach` sans argument affiche l'usage (exit 1), sans pile d'exception", async () => {
  const ws = makeWorkspace()
  try {
    const r = await tsx(ws.dir, "outreach/scripts/draft.ts")
    assert.equal(r.code, 1)
    assert.match(r.stderr, /usage: npm run outreach/)
    assert.doesNotMatch(r.out, /SyntaxError|Invalid regular expression/)
  } finally { ws.cleanup() }
})

test("compose() : le HTML du brouillon échappe le nom, le concurrent et les URL scrapées ; liens http(s) seulement", async () => {
  // test blitz du 24/10 : « Dupont & Fils <SARL> » ou une URL à guillemets cassaient le balisage du brouillon Gmail
  const { compose } = await import("../../outreach/scripts/draft.ts")
  const d = compose({ name: "Dupont & Fils <SARL>", oldUrl: 'http://vieux.example/"><img src=x onerror=alert(1)>', demoUrl: "javascript:alert(1)", seo: "pas de <title>", competitor: { name: "Testex <b>", url: "http://testex.example/?a=1&b=2", city: "Port-Aubril" }, claims: ["sert de cas de test (phrase fictive)"] }) // claims explicites : l'agence d'exemple n'en autorise aucune
  assert.match(d.htmlBody, /Dupont &amp; Fils &lt;SARL&gt;/)
  assert.doesNotMatch(d.htmlBody, /<img|javascript:|<b>|<title>/, "aucune balise injectée")
  const tags = d.htmlBody.match(/<[a-z][^>]*>/gi) ?? []
  assert.ok(tags.every((t) => /^<(div style="[^"]*"|br|a href="[^"\s]*")>$/.test(t)), `balises inattendues : ${tags.filter((t) => !/^<(div|br|a href="[^"\s]*")/.test(t)).join(" ")}`)
  assert.match(d.htmlBody, /<a href="http:\/\/testex\.example\/\?a=1&amp;b=2">Testex &lt;b&gt;<\/a>/)
  assert.doesNotMatch(d.htmlBody, /Voir la demo/, "un lien de démo non http(s) n'est pas un bouton")
  assert.match(d.body, /Dupont & Fils <SARL>/, "le texte brut reste lisible tel quel")
})

test("/out ne prépare JAMAIS un brouillon pour un prospect désinscrit (registre commun des oppositions)", { timeout: 90_000 }, async () => {
  // test blitz du 24/10 : seul le séquenceur regardait (mal) les oppositions ; draft.ts préparait un nouveau mail froid
  const ws = makeWorkspace({ seed: ["agency"] })
  try {
    ws.write("data/sequencer/events.jsonl", JSON.stringify({ id: "ev-u", type: "unsub", source: "track", prospectId: "orvane-piscines-valmont-sur-lys", trackingId: "", at: "2026-10-20T10:00:00.000Z" }) + "\n")
    const r = await tsx(ws.dir, "outreach/scripts/draft.ts", ["orvane-piscines-valmont-sur-lys,atelier-brisane-menuiserie-sornac-le-haut", "--no-verify", "--no-write-fiche"], { env: { OUTREACH_DEMO: "0" }, timeoutMs: 80_000 })
    assert.equal(r.code, 0, r.out)
    const o = ws.json("data/outreach/orvane-piscines-valmont-sur-lys.json")
    assert.equal(o.ready, false)
    assert.match(o.skipReason, /^⛔ désinscrit le 2026-10-20 \(opposition\) : ne jamais le recontacter/)
    const b = ws.json("data/outreach/atelier-brisane-menuiserie-sornac-le-haut.json")
    assert.doesNotMatch(String(b.skipReason), /⛔/, "un prospect sans opposition n'est pas bloqué")
  } finally { ws.cleanup() }
})
