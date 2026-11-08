/**
 * Round 3 (truth) : the daily cap said in builds, the email sequence's sending hours, the emails parsed back for the
 * call panel, the invoice fields checked when saved, a demo invoice printed whole, the processes the cockpit starts
 * stopped with it. No database, no network.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildsCap, buildsStatus, recordBuild, buildUsd } from "../../packages/shared/cage.mjs"
import { atWall, inWindow, nextInWindow, wallLabel, windowLabel, type SendWindow } from "../../outreach/scripts/lib/window.ts"
import { sellerFieldProblem, invoiceProblem } from "../../backoffice/reviewpipe/invoices.ts"
import { demoLeftovers, demoCopyByCountry, readExamples } from "../../packages/shared/agency-demo.mjs"
import { spawnTracked, stopChildren, liveChildren } from "../../backoffice/reviewpipe/children.ts"

test("D2: the daily cap in builds : LWS_BUILDS_PER_DAY, else the $ limit ÷ one build's estimate, else none ; today's builds counted", () => {
  assert.deepEqual(buildsCap({ LWS_BUILDS_PER_DAY: "6" }), { cap: 6, from: "builds" })
  assert.deepEqual(buildsCap({ LWS_BUDGET_USD_DAY: "20" }), { cap: 6, from: "budget" }, "$20 at $3 a build : 6, rounded down")
  assert.deepEqual(buildsCap({ LWS_BUDGET_USD_DAY: "20", LWS_SITE_USD: "4" }), { cap: 5, from: "budget" })
  assert.deepEqual(buildsCap({}), { cap: null, from: null })
  assert.equal(buildUsd({}), 3)
  const dir = mkdtempSync(join(tmpdir(), "lws-builds-"))
  try {
    const file = join(dir, "builds.jsonl")
    recordBuild({ id: "a", source: "test", at: "2026-11-07T10:00:00.000Z" }, { file })
    recordBuild({ id: "b", source: "test", at: "2026-11-07T23:59:00.000Z" }, { file })
    recordBuild({ id: "c", source: "test", at: "2026-11-06T12:00:00.000Z" }, { file }) // the day before
    const s = buildsStatus("2026-11-07T23:59:30.000Z", { LWS_BUILDS_PER_DAY: "2" }, { file })
    assert.deepEqual([s.done, s.cap, s.left, s.reached, s.estimateUsd, s.resetsAt], [2, 2, 0, true, 6, "2026-11-08T00:00:00.000Z"])
    assert.equal(buildsStatus("2026-11-07T12:00:00.000Z", {}, { file }).reached, false, "no cap : never reached")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("D5: a next email is scheduled inside the sending hours, on the agency's clock (never 1:20 in the night)", () => {
  const w: SendWindow = { start: 9, end: 17, days: [1, 2, 3, 4, 5], tz: "America/Chicago", locale: "en-US" }
  const sat = Date.parse("2026-11-07T07:20:00.000Z") // Saturday 1:20 AM in Austin
  const next = nextInWindow(sat, w)
  assert.equal(new Date(next).toISOString(), new Date(atWall(2026, 11, 9, 9, 0, "America/Chicago")).toISOString(), "Monday 9:00 AM their time")
  assert.match(wallLabel(next, w), /^Mon, Nov 9, 9:00\s?AM$/)
  const tue = Date.parse("2026-11-10T16:30:00.000Z") // Tuesday 10:30 AM in Austin : inside, unchanged
  assert.ok(inWindow(tue, w)); assert.equal(nextInWindow(tue, w), tue)
  const late = Date.parse("2026-11-11T00:30:00.000Z") // Tuesday 6:30 PM in Austin → Wednesday 9:00
  assert.equal(new Date(nextInWindow(late, w)).toISOString(), "2026-11-11T15:00:00.000Z")
  // across a DST change (Europe/Paris, last Sunday of October) the opening stays 9:00 local
  const paris: SendWindow = { ...w, tz: "Europe/Paris", locale: "fr-FR" }
  assert.equal(new Date(nextInWindow(Date.parse("2026-10-24T20:00:00.000Z"), paris)).toISOString(), "2026-10-26T08:00:00.000Z")
  assert.equal(windowLabel(w), "Mon–Fri, 9 AM–5 PM")
})

test("Billing › Your business : a value that can't be right is refused for its field ; an issue date in the future too", () => {
  assert.deepEqual(sellerFieldProblem({ siret: "abc" }, "FR"), { field: "siret", error: "A SIRET is 14 digits." })
  assert.equal(sellerFieldProblem({ siret: "123 456 789 00012" }, "FR"), null)
  assert.equal(sellerFieldProblem({ iban: "<b>x" }, "FR")?.field, "iban")
  assert.equal(sellerFieldProblem({ iban: "FR76 3000 6000 0112 3456 7890 189" }, "FR"), null)
  assert.equal(sellerFieldProblem({ paymentLink: "javascript:alert(1)" }, "US")?.error, "The payment link must start with http(s)://.")
  assert.equal(sellerFieldProblem({ taxId: "12-3456789", phone: "+1 512-555-0142", email: "a@b.co" }, "US"), null)
  assert.equal(sellerFieldProblem({ taxId: "EIN" }, "US")?.field, "taxId")
  assert.equal(sellerFieldProblem({ phone: "call me maybe" }, "US")?.field, "phone")
  assert.equal(sellerFieldProblem({ name: "Acme <b>" }, "US")?.field, "name")
  const tomorrow2 = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10)
  assert.equal(invoiceProblem({ client: { name: "X" }, items: [{ label: "Site", qty: 1, unitPrice: 100 }], issueDate: tomorrow2, dueDate: tomorrow2 }), "The issue date can't be in the future.")
})

test("Settings : what is still the demo's (untouched) is told apart from an .example placeholder you typed ; each demo's copy by country", () => {
  const ex = readExamples(process.cwd())
  const us = ex.find((e: any) => e.country === "US")
  const left = demoLeftovers({ ...us, name: "Pixel Ranch", contactEmail: "hi@pixelranch.example", website: "https://pixelranch.example" }, ex)
  assert.equal(left.find((x) => x.key === "contactEmail")?.why, "placeholder")
  assert.equal(left.find((x) => x.key === "website")?.why, "placeholder")
  assert.equal(left.find((x) => x.key === "offer")?.why, "demo")
  assert.equal(left.some((x) => x.key === "name"), false)
  const copy = demoCopyByCountry(ex)
  assert.ok(copy.US.brand && copy.FR.brand && copy.US.brand !== copy.FR.brand)
  assert.equal(copy.US.timezone, "America/Chicago", "the US demo studio is in Austin, like its cast")
})

test("stopping the cockpit stops what it started : a child that ignores SIGTERM and its own child are gone (no orphan)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lws-children-"))
  try {
    const flag = join(dir, "alive")
    // a « scraper » that ignores SIGTERM, with a grandchild of its own, writing a file every 100 ms while alive
    const code = `process.on("SIGTERM", () => {}); const { spawn } = require("node:child_process"); spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{}); setInterval(()=>require('node:fs').writeFileSync('${flag}', String(Date.now())), 100)"], { stdio: "ignore" }); setInterval(() => {}, 1000)`
    const c = spawnTracked(process.execPath, ["-e", code], { stdio: "ignore" })
    for (let i = 0; i < 50 && !existsSync(flag); i++) await new Promise((r) => setTimeout(r, 100))
    assert.ok(existsSync(flag), "the grandchild runs")
    assert.equal(liveChildren(), 1)
    await stopChildren(500)
    await new Promise((r) => setTimeout(r, 300))
    assert.equal(liveChildren(), 0)
    assert.ok(c.exitCode !== null || c.signalCode !== null, "the child is gone")
    rmSync(flag, { force: true })
    await new Promise((r) => setTimeout(r, 400))
    assert.equal(existsSync(flag), false, "the grandchild is gone too (its whole process group)")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
