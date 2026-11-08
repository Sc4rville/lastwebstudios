/**
 * G14 in a real browser: the sandbox (FICTIONAL agency, PGlite, no key) gives a populated cockpit, clean at 1440 and
 * 390 px: the home ring, Sites (rail + before/after compare), Pipeline (kanban + call panel with insights, email tab),
 * 0 console error. Screenshots (fictional only): LWS_SHOTS_DIR=NIGHT/shots npm run test:e2e
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium, type Browser, type Page } from "playwright"
import { startSandbox, type SandboxRun } from "../../scripts/sandbox.ts"

const SHOTS = process.env.LWS_SHOTS_DIR || ""
let run: SandboxRun, browser: Browser, parent = ""

before(async () => {
  parent = mkdtempSync(join(tmpdir(), "lws-sandbox-e2e-"))
  // the French studio (`--country FR`) : its own cast, its own words ; the default US studio is covered by audit.test.ts
  run = await startSandbox({ check: true, dir: join(parent, "sb"), db: "pglite", json: false, quiet: true, country: "FR" })
  assert.ok(run.ok, JSON.stringify(run.checks.filter((c) => !c.ok)))
  browser = await chromium.launch()
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
})
after(async () => { delete process.env.LWS_AGENCY_CONFIG; await browser?.close(); await run?.stop(); if (parent) rmSync(parent, { recursive: true, force: true }) })

async function open(width: number, height: number, path: string): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  await ctx.addInitScript(() => { try { localStorage.setItem("lws.settingsSeen", "1"); localStorage.setItem("lws.howto", "1") } catch { /* */ } })
  const errors: string[] = []
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
  page.on("pageerror", (e) => errors.push(String(e)))
  await page.goto(run.url + path, { waitUntil: "load", timeout: 45_000 })
  return { page, errors, close: () => ctx.close() }
}
const wide = (page: Page, sel: string) => page.evaluate((s) => [...document.querySelectorAll<HTMLElement>(`${s} *`)]
  .filter((e) => { const r = e.getBoundingClientRect(); return r.width && getComputedStyle(e).visibility !== "hidden" && !e.closest(".bar, .progress") && (r.right > innerWidth + 1 || r.left < -1) }).map((e) => `${e.tagName.toLowerCase()}.${e.getAttribute("class") || ""}`).slice(0, 5), sel)

for (const [label, width, height] of [["desktop", 1440, 900], ["mobile", 390, 844]] as const) {
  test(`sandbox @${width}px : Prospects (why picked, statuses), the Sites rail with the compare view, 0 console error`, { timeout: 120_000 }, async () => {
    const { page, errors, close } = await open(width, height, "/")
    try {
      await page.waitForFunction(() => document.querySelectorAll("#plist .pc").length >= 5, null, { timeout: 20_000 })
      const txt = await page.$eval("#v-prospects", (e) => (e as HTMLElement).innerText)
      for (const n of ["Orvane", "Brisane", "Lumeo", "Quillanne"]) assert.match(txt, new RegExp(n, "i"))
      // each business at its furthest step, the same words as Sites (a client is « Won », never « Built »)
      // the sandbox is ready once the story's build is done : it waits for you (« To review »), the lead in the emails is
      // « In outreach »
      assert.match(txt, /Strong fit/); assert.match(txt, /Waiting for you/); assert.match(txt, /\bWon\b/); assert.match(txt, /In outreach/); assert.doesNotMatch(txt, /\bBuilt\b/)
      assert.match(txt, /No mobile version|No HTTPS|Site from 20\d\d/)
      assert.deepEqual(await wide(page, "#v-prospects"), [], "prospects off screen")
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `sandbox-prospects-${label}.png`) })
      await page.goto(run.url + "/#sites", { waitUntil: "load" })
      await page.waitForFunction(() => document.querySelectorAll("#rail .card").length >= 3, null, { timeout: 20_000 })
      const rail = await page.$eval("#rail", (e) => e.textContent || "")
      for (const n of ["Orvane", "Brisane", "Lumeo"]) assert.match(rail, new RegExp(n, "i"))
      assert.deepEqual(await wide(page, "#v-sites .rail, #v-sites .stagebar, #v-sites .inspect"), [], "sites view off screen")
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `sandbox-sites-${label}.png`) })
      // a phone has Before and After (no two cramped halves) ; a desktop has Compare
      if (width > 640) { await page.click('#viewmode a[data-v="compare"]'); await page.waitForSelector("#compare:not([hidden]) .half.l img", { timeout: 10_000 }) }
      else { await page.click('#viewmode a[data-v="before"]'); await page.waitForSelector("#before:not([hidden]) img", { timeout: 10_000 }) }
      await page.waitForTimeout(600)
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `sandbox-compare-${label}.png`) })
      assert.deepEqual(errors, [])
    } finally { await close() }
  })

  test(`sandbox @${width}px : Outreach (Won, lost, to call) and the call panel of Cuisines Lumeo (phone, insights, script, email tab)`, { timeout: 120_000 }, async () => {
    const { page, errors, close } = await open(width, height, "/#outreach")
    try {
      await page.waitForSelector(".kcard:visible", { timeout: 20_000 }) // the board on desktop, the stage-grouped list on mobile
      const board = await page.$eval("#v-outreach", (e) => e.textContent || "")
      for (const n of ["Orvane Piscines", "Cuisines Lumeo"]) assert.ok(board!.includes(n), n)
      // Brisane said no : off the board, behind « 1 lost » (never shown as Nurturing)
      assert.doesNotMatch(board, /Atelier Brisane/); assert.match(board, /Lost\s*1/)
      assert.match(await page.$eval("#agentLine", (e) => e.textContent || ""), /When you approve a site/)
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `sandbox-outreach-${label}.png`) })
      await page.click(".kcard[data-id='cuisines-lumeo-vereuil']:visible")
      await page.waitForSelector("#lead:not([hidden])", { timeout: 10_000 })
      await page.waitForTimeout(300)
      const panel = await page.$eval("#lead", (e) => e.textContent || "")
      assert.match(panel, /01 99 00 41 52/, "the prospect's phone (Lumeo has no e-mail)")
      assert.match(panel, /Atelier Vélin/, "the call script speaks for the fictional agency")
      assert.match(panel, /Worth knowing/)
      // two insights at first, the rest one click away (the script comes first)
      assert.ok((await page.$$("#lead .insights li")).length >= 2, "insights")
      if (await page.$("#insMore")) { await page.click("#insMore"); assert.ok((await page.$$("#lead .insights li")).length >= 3, "3+ insights once open") }
      assert.deepEqual(await wide(page, "#lead"), [], "call panel off screen")
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `sandbox-call-${label}.png`) })
      await page.click('#ltabs a[data-t="email"]')
      assert.match(await page.$eval("#lcontent", (e) => e.textContent || ""), /No email address/)
      assert.deepEqual(errors, [])
    } finally { await close() }
  })
}
