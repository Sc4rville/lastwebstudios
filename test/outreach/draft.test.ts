/**
 * P0-1: `outreach/scripts/draft.ts` threw on import (a reversed character class), breaking
 * `npm run outreach`, Salesport's "prepare" button and the /out and /outreach-mail skills.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { tsx } from "../helpers/proc.ts"
import { makeWorkspace } from "../helpers/workspace.ts"

const DASHES = /[‒-―]/

test("draft.ts loads (no more SyntaxError on import)", async () => {
  const m = await import("../../outreach/scripts/draft.ts")
  assert.equal(typeof m.stripDash, "function")
  assert.equal(typeof m.compose, "function")
})

test("stripDash replaces the 4 typographic dashes (U+2012 to U+2015) and nothing else", async () => {
  const { stripDash } = await import("../../outreach/scripts/draft.ts")
  assert.equal(stripDash("a‒b–c—d―e"), "a-b-c-d-e")
  assert.equal(stripDash("prix · 12 € · tél. 03 53 01 24 68"), "prix · 12 € · tél. 03 53 01 24 68")
  assert.equal(stripDash("Orvane — Piscines"), "Orvane - Piscines")
})

test("draft.ts's source no longer writes the dashes literally in the regex (regression guard)", () => {
  const src = readFileSync("outreach/scripts/draft.ts", "utf8")
  const line = src.split("\n").find((l) => l.includes("export const stripDash"))!
  assert.ok(line, "stripDash not found")
  assert.doesNotMatch(line, DASHES)
  assert.match(line, /\\u2012-\\u2015/)
})

test("compose() returns a draft without any em dash, even when the input has some", async () => {
  const { compose } = await import("../../outreach/scripts/draft.ts")
  const d = compose({ name: "Orvane — Piscines", oldUrl: "http://orvane-piscines.example/", demoUrl: "", seo: "pas de H1 – rien", competitor: { name: "Testex", url: "http://testex.example/", city: "Port-Aubril" } })
  for (const part of [d.subject, d.body, d.htmlBody]) assert.doesNotMatch(part, DASHES)
  assert.match(d.body, /Orvane - Piscines/)
})

test("`npm run outreach` with no argument prints the usage (exit 1), no stack trace", async () => {
  const ws = makeWorkspace()
  try {
    const r = await tsx(ws.dir, "outreach/scripts/draft.ts")
    assert.equal(r.code, 1)
    assert.match(r.stderr, /usage: npm run outreach/)
    assert.doesNotMatch(r.out, /SyntaxError|Invalid regular expression/)
  } finally { ws.cleanup() }
})

test("compose(): the draft's HTML escapes the name, the competitor and the scraped URLs; http(s) links only", async () => {
  // blitz test of 10/24: « Dupont & Fils <SARL> » or a URL with quotes broke the Gmail draft's markup
  const { compose } = await import("../../outreach/scripts/draft.ts")
  const d = compose({ name: "Dupont & Fils <SARL>", oldUrl: 'http://vieux.example/"><img src=x onerror=alert(1)>', demoUrl: "javascript:alert(1)", seo: "pas de <title>", competitor: { name: "Testex <b>", url: "http://testex.example/?a=1&b=2", city: "Port-Aubril" }, claims: ["sert de cas de test (phrase fictive)"] }) // explicit claims: the example agency allows none
  assert.match(d.htmlBody, /Dupont &amp; Fils &lt;SARL&gt;/)
  assert.doesNotMatch(d.htmlBody, /<img|javascript:|<b>|<title>/, "no injected tag")
  const tags = d.htmlBody.match(/<[a-z][^>]*>/gi) ?? []
  assert.ok(tags.every((t) => /^<(div style="[^"]*"|br|a href="[^"\s]*")>$/.test(t)), `unexpected tags: ${tags.filter((t) => !/^<(div|br|a href="[^"\s]*")/.test(t)).join(" ")}`)
  assert.match(d.htmlBody, /<a href="http:\/\/testex\.example\/\?a=1&amp;b=2">Testex &lt;b&gt;<\/a>/)
  assert.doesNotMatch(d.htmlBody, /Voir la demo/, "a non-http(s) demo link is not a button")
  assert.match(d.body, /Dupont & Fils <SARL>/, "the plain text stays readable as is")
})

test("/out NEVER prepares a draft for an unsubscribed prospect (the shared opt-out register)", { timeout: 90_000 }, async () => {
  // blitz test of 10/24: only the sequencer looked (badly) at opt-outs; draft.ts prepared a new cold email
  const ws = makeWorkspace({ seed: ["agency"] })
  try {
    ws.write("data/sequencer/events.jsonl", JSON.stringify({ id: "ev-u", type: "unsub", source: "track", prospectId: "orvane-piscines-valmont-sur-lys", trackingId: "", at: "2026-10-20T10:00:00.000Z" }) + "\n")
    const r = await tsx(ws.dir, "outreach/scripts/draft.ts", ["orvane-piscines-valmont-sur-lys,atelier-brisane-menuiserie-sornac-le-haut", "--no-verify", "--no-write-fiche"], { env: { OUTREACH_DEMO: "0" }, timeoutMs: 80_000 })
    assert.equal(r.code, 0, r.out)
    const o = ws.json("data/outreach/orvane-piscines-valmont-sur-lys.json")
    assert.equal(o.ready, false)
    assert.match(o.skipReason, /^⛔ unsubscribed on 2026-10-20 \(opt-out\): never contact them again/)
    const b = ws.json("data/outreach/atelier-brisane-menuiserie-sornac-le-haut.json")
    assert.doesNotMatch(String(b.skipReason), /⛔/, "a prospect without an opt-out is not blocked")
  } finally { ws.cleanup() }
})
