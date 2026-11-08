/**
 * D6 on the cockpit's side : the sandbox's builds honour the owner's preferences VISIBLY (the phone goes to the top, the
 * headline says what they do, their photo carries the hero when they have a real one : never a drawing called a photo…) and record which ones they applied, with why the others
 * were skipped ; the real distillation runs the learn-taste skill through packages/llm (`claude -p` on the
 * subscription : the fake `claude` of the tests answers here), falls back to the rules when no model answers, and its
 * « I'll remember » arrives over SSE with an undo id that works even while it thinks.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { planTaste, renderWithTaste, renderNewSite, findOwnPhoto } from "../../backoffice/reviewpipe/sim-site.ts"
import { invent, toSheet } from "../../backoffice/reviewpipe/sim-data.ts"
import { distillMode } from "../../backoffice/reviewpipe/learning.ts"
import { makeWorkspace } from "../helpers/workspace.ts"
import { tsx } from "../helpers/proc.ts"

const sheetOf = (trade = "couvreur-zingueur") => toSheet(invent({ trades: [trade], place: "Austin, TX", country: "US", count: 1, seed: 11, taken: new Set() })[0], "US")
const P = (key: string, text = key) => ({ id: `p-${key}`, key, text })

test("a demo build honours the preferences it can show, visibly, and says why it skipped the others", () => {
  const sheet = sheetOf()
  const dir = mkdtempSync(join(tmpdir(), "lws-sim-taste-"))
  try {
    const plain = renderNewSite(sheet, "en")
    const prefs = [P("hero-own-photo"), P("no-stock-phrases"), P("phone-top"), P("reviews-up"), { id: "p-team-faces", text: "Show the team's faces" }, P("hero-type")]
    // a fictional demo business has no photo of theirs : the photo preference is kept for real builds, and said so
    const { html, record } = renderWithTaste(sheet, "en", join(dir, "site"), prefs, "demo", dir)
    assert.notEqual(html, plain)
    assert.doesNotMatch(html, /class="visual photo"/, "never a drawing passed off as their photo")
    assert.ok(!existsSync(join(dir, "data", "assets", sheet.id, "photo-1.svg")), "no drawing invented for them")
    assert.match(html, /<a class="cta phone" href="tel:/, "the phone at the top, one tap")
    assert.doesNotMatch(html, /Free estimate, no obligation/, "no stock line under the headline")
    // the headline says what they do and where (their first service when it is short, else their trade), never the stock line
    const svc0 = String(sheet.content.services[0]), what = svc0.length <= 22 ? svc0 : "roofer"
    assert.ok(html.includes(`<h1>${what[0].toUpperCase()}${what.slice(1)} in ${sheet.identity.city}.</h1>`), html.slice(html.indexOf("<h1>"), html.indexOf("</h1>") + 5))
    assert.doesNotMatch(html, /A roof you can trust for decades/)
    assert.deepEqual(record.applied.map((p) => p.id), ["p-no-stock-phrases", "p-phone-top", "p-hero-type"])
    assert.deepEqual((record.skipped || []).map((p) => [p.id, p.why]), [
      ["p-hero-own-photo", "Noted for real builds: the demo has no photo of theirs"],
      ["p-reviews-up", "No reviews on their site"],
      ["p-team-faces", "The demo can't show this one: a real build applies it"],
    ])
    assert.deepEqual(record.traits, { tone: "light", hero: "type" })
    assert.equal(record.given.length, 6)
    // with a real picture of theirs (a .jpg, never an .svg drawing), the photo carries the hero and travels with the site
    mkdirSync(join(dir, "data", "assets", sheet.id), { recursive: true })
    writeFileSync(join(dir, "data", "assets", sheet.id, "photo-0.svg"), "<svg/>")
    assert.equal(findOwnPhoto(sheet, dir), "", "a drawing is not a photo")
    writeFileSync(join(dir, "data", "assets", sheet.id, "photo-1.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
    const withPhoto = renderWithTaste(sheet, "en", join(dir, "site2"), prefs, "demo", dir)
    assert.match(withPhoto.html, /class="visual photo"/, "their photo carries the hero")
    assert.match(withPhoto.html, /url\("assets\/photo-1\.jpg"\)/)
    assert.ok(existsSync(join(dir, "site2", "assets", "photo-1.jpg")), "the photo travels with the site")
    assert.deepEqual(withPhoto.record.applied.map((p) => p.id), ["p-hero-own-photo", "p-no-stock-phrases", "p-phone-top"])
    assert.deepEqual(withPhoto.record.traits, { tone: "light", hero: "photo" })
    // nothing given : the site as before, its traits still recorded
    const none = planTaste(sheet, [])
    assert.deepEqual([none.applied, none.traits], [[], { tone: "light", hero: "type" }])
    assert.equal(renderNewSite(sheet, "en", { effects: none.effects }), plain)
    // no phone : said, not faked
    assert.equal(planTaste({ ...sheet, identity: { ...sheet.identity, phone: "" } }, [P("phone-top")]).skipped[0].why, "No phone number on their site")
    const dark = renderWithTaste(sheet, "en", join(dir, "site"), [P("dark-pages"), P("light-pages")], "demo", dir)
    assert.match(dark.html, /body\{background:#0f1114/)
    assert.deepEqual(dark.record.traits, { tone: "dark", hero: "type" })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("their own photo: theirs first (sheet assets, then their old site's pictures, never a logo or a captioned one)", () => {
  const sheet = sheetOf("pisciniste"), dir = mkdtempSync(join(tmpdir(), "lws-sim-photo-"))
  try {
    const img = join(dir, "data", "old-sites", sheet.id, "img"); mkdirSync(img, { recursive: true })
    for (const f of ["logo.png", "pool-caption.jpg", "tile.png"]) writeFileSync(join(img, f), "x")
    assert.equal(findOwnPhoto(sheet, dir), "")
    writeFileSync(join(img, "pool-2.jpg"), "x")
    assert.equal(findOwnPhoto(sheet, dir), join(img, "pool-2.jpg"))
    mkdirSync(join(dir, "data", "assets", sheet.id), { recursive: true }); writeFileSync(join(dir, "data", "assets", sheet.id, "photo-1.webp"), "x")
    assert.equal(findOwnPhoto(sheet, dir), join(dir, "data", "assets", sheet.id, "photo-1.webp"), "the sheet's own assets first")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("distillation mode: the rules in the sandbox (or when asked), the skill everywhere else", () => {
  assert.equal(distillMode({ LWS_SANDBOX: "1" }), "rules")
  assert.equal(distillMode({ LWS_TASTE_DISTILL: "rules" }), "rules")
  assert.equal(distillMode({}), "skill")
})

const PROBE = (mode = "") => `import { initLearning, onFeedback, learningView } from "./backoffice/reviewpipe/learning.ts"
import { loadTaste, undoFeedback, saveTaste } from "./learning/scripts/taste.ts"
const events = []
initLearning({ broadcast: (e) => events.push(e), sendJson: () => {}, parseBody: async () => null, siteDir: () => null })
const wait = async (f) => { for (let i = 0; i < 300 && !f(); i++) await new Promise((r) => setTimeout(r, 50)) }
const a = await onFeedback({ kind: "comment", id: "orvane-piscines-valmont-sur-lys", date: "2026-10-20-composer", text: "${mode === "typo" ? "Fix the typo in their hours" : "I want to see the people behind the business"}" })
await wait(() => events.some((e) => e.undo === a?.undo))
const b = await onFeedback({ kind: "comment", id: "orvane-piscines-valmont-sur-lys", text: "Their own photos in the hero please" })
// undone while the skill still thinks : nothing is learned from it
const t = loadTaste(); undoFeedback(t, b.undo); saveTaste(t)
await new Promise((r) => setTimeout(r, 3000))
const v = await learningView()
console.log("RESULT " + JSON.stringify({ a, events, prefs: loadTaste().preferences, view: v.preferences, summary: v.summary }))
`

test("the real path: the learn-taste skill through packages/llm (the fake claude answers), « I'll remember » over SSE, undo while it thinks", { timeout: 120_000 }, async () => {
  const ws = makeWorkspace({ seed: ["agency"] })
  try {
    ws.write("_probe.mts", PROBE())
    const log = ws.path("claude.log")
    const r = await tsx(ws.dir, "_probe.mts", [], { env: { FAKE_CLAUDE_LOG: log }, timeoutMs: 100_000 })
    const line = r.stdout.split("\n").find((l) => l.startsWith("RESULT "))
    assert.ok(line, r.out)
    const out = JSON.parse(line!.slice(7))
    assert.equal(out.a.pending, true, "answered at once: the skill thinks in the background")
    assert.match(out.a.undo, /^f-/)
    const ev = out.events.find((e: any) => e.undo === out.a.undo)
    assert.equal(ev.type, "learning")
    assert.equal(ev.remember.text, "I'll remember: Show the team's faces in the about section.")
    assert.deepEqual(out.prefs.map((p: any) => [p.id, p.by, p.sources[0].quote]), [["p-show-the-team-s-faces-in-the-about", "skill", "I want to see the people behind the business"]])
    assert.equal(out.view[0].evidence, "Your comment on Orvane Piscines: “I want to see the people behind the business”")
    assert.match(out.summary, /^Learned from 1 comment on 1 site\. 1 preference goes into every build and every edit\./)
    const calls = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((c) => /# Learn taste/.test(c.stdin))
    assert.ok(calls.length >= 1)
    assert.ok(calls[0].argv.includes("--json-schema"), "structured output (schema.json of the skill)")
    assert.equal(calls[0].argv[calls[0].argv.indexOf("--model") + 1], "haiku", "role fast, on the plan")
    assert.equal(calls[0].env.ANTHROPIC_API_KEY, false, "plan-first: no API key")
    assert.match(calls[0].stdin, /## PREFERENCES/)
  } finally { ws.cleanup() }
})

test("the real path, no model answering: the rules still catch the common words ; a one-off fix teaches nothing", { timeout: 120_000 }, async () => {
  const ws = makeWorkspace({ seed: ["agency"] })
  try {
    ws.write("_probe.mts", PROBE("typo"))
    const r = await tsx(ws.dir, "_probe.mts", [], { env: { FAKE_CLAUDE_MODE: "fail" }, timeoutMs: 100_000 })
    const out = JSON.parse(r.stdout.split("\n").find((l) => l.startsWith("RESULT "))!.slice(7))
    const ev = out.events.find((e: any) => e.undo === out.a.undo)
    assert.equal(ev.remember.text, null, "« Fix the typo in their hours »: nothing general")
    assert.deepEqual(out.prefs, [], "and the undone one left nothing either")
  } finally { ws.cleanup() }
})
