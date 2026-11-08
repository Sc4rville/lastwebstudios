/**
 * D6 · THE LEARNING LOOP, end to end in the sandbox (the US studio, no key) : feedback on a site → « I'll remember: … »
 * with an undo id → the preference is listed by the API with its evidence → the next simulated build applies it, VISIBLY,
 * and records it ; the edit of the commented site applies it too ; off and undo stop it. The story's own comment
 * (cast.us.json › story.feedback) already taught two preferences, which the story's queued build applied.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startSandbox, type SandboxRun } from "../../scripts/sandbox.ts"

let run: SandboxRun, parent = ""
before(async () => {
  parent = mkdtempSync(join(tmpdir(), "lws-learning-e2e-"))
  run = await startSandbox({ check: true, dir: join(parent, "sb"), db: "pglite", json: false, quiet: true })
  assert.ok(run.ok, JSON.stringify(run.checks.filter((c) => !c.ok)))
})
after(async () => { await run?.stop(); if (parent) rmSync(parent, { recursive: true, force: true }) })

const get = async (p: string) => { const r = await fetch(run.url + p); return { status: r.status, body: await r.json() as any } }
const post = async (p: string, body: unknown) => { const r = await fetch(run.url + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() as any } }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function idle(): Promise<void> {
  for (let i = 0; i < 200; i++) { const j = await get("/api/jobs"); if (!(j.body.jobs || []).some((x: any) => x.status === "queued" || x.status === "running")) return; await sleep(250) }
  throw new Error("jobs still running after 50 s")
}
const siteOf = async (id: string) => ((await get("/api/sites")).body as any[]).find((s) => s.id === id)
const html = (id: string, date: string) => readFileSync(join(run.dir, "output", "sites", id, date, "index.html"), "utf8")

test("the story's comment taught two preferences, with their evidence ; the story's build applied them, visibly", { timeout: 120_000 }, async () => {
  await idle()
  const l = await get("/api/learning")
  assert.equal(l.status, 200)
  const ids = l.body.preferences.map((p: any) => p.id)
  assert.deepEqual(ids.sort(), ["p-no-stock-phrases", "p-serif-headlines"])
  const serif = l.body.preferences.find((p: any) => p.id === "p-serif-headlines")
  assert.equal(serif.on, true)
  assert.equal(serif.strength, "Said once")
  assert.match(serif.evidence, /^Your comment on Tallmarsh Roofing: “Use a serif for the headlines, it feels more like a family business\.”$/)
  assert.ok(!("weight" in serif) && !/model|axis|weight/i.test(JSON.stringify(l.body.preferences.map((p: any) => [p.text, p.strength, p.evidence, p.used.say]))), "plain words, nothing about weights or models")
  // the story sent four sites to outreach : decisions kept (with each site's traits), too few to learn a trait from
  assert.match(l.body.summary, /^Learned from 1 comment and 4 decisions \(sent or skipped\) on 4 sites\. 2 preferences go into every build and every edit\.$/)
  // picks and words : honest about how far they are (the story has a handful of outcomes, below 5 per trade)
  assert.deepEqual(l.body.picks.items, [])
  assert.match(l.body.picks.note, /^Too early to say which prospects answer best: \d+ business(es)? contacted so far\. I compare a trade once it has 5\.$/)
  assert.match(l.body.words.email.note, /^Too early to say which first email works: 3 written so far/)
  assert.match(l.body.words.email.next.why, /^Trying each opening in turn/)
  // the build the story queued (Bramblecrest) : built with both, serif headlines, the headline says what they do
  const b = await siteOf("bramblecrest-pool-spa-austin")
  assert.equal(b.preferences, 2)
  const sv = await get(`/api/learning/site?id=bramblecrest-pool-spa-austin&date=${encodeURIComponent(b.date)}`)
  assert.equal(sv.body.sentence, "Built with 2 of your preferences")
  assert.deepEqual(sv.body.applied.map((p: any) => p.id).sort(), ["p-no-stock-phrases", "p-serif-headlines"])
  assert.match(html(b.id, b.date), /\.hero h1,h2,\.brand\{font-family:Georgia/)
  assert.doesNotMatch(html(b.id, b.date), /class="visual photo"/, "a demo business has no photo of theirs : never a drawing called one")
  // the record is the agency's, never public next to the site
  assert.equal((await fetch(`${run.url}/preview/${b.id}/${b.date}/.lws-taste.json`)).status, 404)
  // the commented site itself was edited by the demo with them (its comment cleared, like the real edit agent does)
  const t = await siteOf("tallmarsh-roofing-austin")
  assert.match(html(t.id, t.date), /\.hero h1,h2,\.brand\{font-family:Georgia/)
  assert.equal(t.preferences, 2)
  // a site built before any feedback says so
  const w = await siteOf("pecanwood-pools-austin")
  assert.equal((await get(`/api/learning/site?id=${w.id}&date=${encodeURIComponent(w.date)}`)).body.sentence, "Built before it had your preferences")
  // the call list gives each lead a call opening, with its first line in the lead's language
  const crm = await get("/api/crm")
  const lead = crm.body.hot.call0.find((x: any) => x.id === "tallmarsh-roofing-austin")
  assert.ok(lead.callAngle && ["built-it", "customers", "value"].includes(lead.callAngle.key), JSON.stringify(lead.callAngle))
  assert.match(lead.callAngle.opener, /Tallmarsh Roofing/)
})

test("feedback → « I'll remember » + undo id → listed with its evidence → the next build applies it ; off and undo stop it", { timeout: 180_000 }, async () => {
  await idle()
  const site = await siteOf("larkmoor-plumbing-drain-austin")
  await post(`/api/control?id=${site.id}&date=${encodeURIComponent(site.date)}`, { comment: "The phone number should be at the top of the page, in the header." })
  const fb = await post("/api/refill", { id: site.id, date: site.date })
  assert.equal(fb.status, 200, JSON.stringify(fb.body))
  assert.equal(fb.body.remember.pending, false, "the sandbox distils at once (rules, no model)")
  assert.equal(fb.body.remember.text, "I'll remember: Phone number at the top of the page, one tap to call.")
  assert.match(fb.body.remember.undo, /^f-/)
  const l = await get("/api/learning")
  const p = l.body.preferences.find((x: any) => x.id === "p-phone-top")
  assert.ok(p && p.on)
  assert.equal(p.evidence, "Your comment on Larkmoor Plumbing & Drain: “The phone number should be at the top of the page, in the header.”")
  await idle()
  // the edit of that site applied it : the phone in the header, one tap
  assert.match(html(site.id, site.date), /<a class="cta phone" href="tel:/)
  assert.deepEqual((await get(`/api/learning/site?id=${site.id}&date=${encodeURIComponent(site.date)}`)).body.applied.map((x: any) => x.id).sort(), ["p-no-stock-phrases", "p-phone-top", "p-serif-headlines"])

  // the NEXT build applies it (and the two from the story), and says so
  const nb = await post("/api/batch", { mode: "composer", ids: ["copperwick-kitchens-austin"], limit: 1 })
  assert.equal(nb.status, 200, JSON.stringify(nb.body))
  await idle()
  const c = await siteOf("copperwick-kitchens-austin")
  assert.ok(c, "Copperwick is built")
  assert.equal(c.preferences, 3)
  const cv = await get(`/api/learning/site?id=${c.id}&date=${encodeURIComponent(c.date)}`)
  assert.equal(cv.body.sentence, "Built with 3 of your preferences")
  assert.ok(cv.body.applied.some((x: any) => x.id === "p-phone-top" && x.on))
  assert.match(html(c.id, c.date), /<a class="cta phone" href="tel:/)
  assert.match(html(c.id, c.date), /\.hero h1,h2,\.brand\{font-family:Georgia/)
  assert.match(readFileSync(join(run.dir, "output", "sites", c.id, c.date, "control.md"), "utf8"), /^- preferences : .*p-phone-top/m)
  const used = (await get("/api/learning")).body.preferences.find((x: any) => x.id === "p-phone-top").used
  assert.equal(used.say, "Used on 2 sites")

  // off : a rebuild no longer applies it (and the rebuild is a « not this one » for the version it replaces)
  const off = await post("/api/learning/preference", { id: "p-no-stock-phrases", on: false })
  assert.equal(off.status, 200)
  assert.equal((await get("/api/learning")).body.preferences.find((x: any) => x.id === "p-no-stock-phrases").off, "Off: you switched it off")
  // undo : the phone preference is forgotten
  const u = await post("/api/learning/undo", { undo: fb.body.remember.undo })
  assert.equal(u.status, 200)
  assert.deepEqual(u.body.removed, ["p-phone-top"])
  assert.equal((await post("/api/learning/undo", { undo: fb.body.remember.undo })).status, 404, "an undo works once")
  const rb = await post("/api/batch", { mode: "composer", ids: [c.id], limit: 1, force: true, note: "rebuild from the cockpit" })
  assert.equal(rb.status, 200, JSON.stringify(rb.body))
  await idle()
  const c2 = await siteOf(c.id)
  const cv2 = await get(`/api/learning/site?id=${c2.id}&date=${encodeURIComponent(c2.date)}`)
  assert.deepEqual(cv2.body.applied.map((x: any) => x.id), ["p-serif-headlines"])
  assert.doesNotMatch(html(c2.id, c2.date), /class="cta phone"/)

  // your own words, then delete
  const ed = await post("/api/learning/preference", { id: "p-serif-headlines", text: "Serif headlines, always" })
  assert.equal(ed.body.preference.text, "Serif headlines, always")
  assert.equal((await post("/api/learning/preference", { id: "p-serif-headlines", text: "  " })).status, 400)
  const del = await fetch(`${run.url}/api/learning/preference?id=p-serif-headlines`, { method: "DELETE" })
  assert.equal(del.status, 200)
  assert.ok(!(await get("/api/learning")).body.preferences.some((x: any) => x.id === "p-serif-headlines"))
  // feedback without an edit job (a reason to skip, say) also answers « I'll remember »
  const fr = await post("/api/learning/feedback", { id: "wrenhaven-carpentry-austin", kind: "reject", text: "Too much text, cut it down" })
  assert.equal(fr.body.remember.text, "I'll remember: Short copy: one idea per section, no long paragraphs.")
  assert.equal((await post("/api/learning/feedback", { id: "../etc", text: "x" })).status, 400)
  assert.equal((await post("/api/learning/preference", { id: "p-nope", on: true })).status, 404)
})
