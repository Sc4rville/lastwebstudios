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
  run = await startSandbox({ check: true, dir: join(parent, "sb"), db: "pglite", json: false, quiet: true })
  assert.ok(run.ok, JSON.stringify(run.checks.filter((c) => !c.ok)))
  browser = await chromium.launch()
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
})
after(async () => { await browser?.close(); await run?.stop(); if (parent) rmSync(parent, { recursive: true, force: true }) })

async function open(width: number, height: number, path: string): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
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
      assert.match(txt, /Good fit/); assert.match(txt, /Building/); assert.match(txt, /Built/)
      assert.match(txt, /No mobile version|No HTTPS|Site from 20\d\d/)
      assert.deepEqual(await wide(page, "#v-prospects"), [], "prospects off screen")
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `sandbox-prospects-${label}.png`) })
      await page.goto(run.url + "/#sites", { waitUntil: "load" })
      await page.waitForFunction(() => document.querySelectorAll("#rail .card").length >= 3, null, { timeout: 20_000 })
      const rail = await page.$eval("#rail", (e) => e.textContent || "")
      for (const n of ["Orvane", "Brisane", "Lumeo"]) assert.match(rail, new RegExp(n, "i"))
      assert.deepEqual(await wide(page, "#v-sites .rail, #v-sites .stagebar, #v-sites .inspect"), [], "sites view off screen")
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `sandbox-sites-${label}.png`) })
      await page.click('#viewmode a[data-v="compare"]')
      await page.waitForSelector("#compare:not([hidden]) .chandle", { timeout: 10_000 })
      await page.waitForTimeout(600)
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `sandbox-compare-${label}.png`) })
      assert.deepEqual(errors, [])
    } finally { await close() }
  })

  test(`sandbox @${width}px : Outreach (Won, nurturing, to call) and the call panel of Cuisines Lumeo (phone, insights, script, email tab)`, { timeout: 120_000 }, async () => {
    const { page, errors, close } = await open(width, height, "/#outreach")
    try {
      await page.waitForSelector(".kcard", { timeout: 20_000 })
      const board = await page.textContent("#board")
      for (const n of ["Orvane Piscines", "Atelier Brisane", "Cuisines Lumeo"]) assert.ok(board!.includes(n), n)
      assert.match(await page.$eval("#agentLine", (e) => e.textContent || ""), /Email automation/)
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `sandbox-outreach-${label}.png`) })
      await page.click(".kcard[data-id='cuisines-lumeo-vereuil']")
      await page.waitForSelector("#lead:not([hidden])", { timeout: 10_000 })
      await page.waitForTimeout(300)
      const panel = await page.$eval("#lead", (e) => e.textContent || "")
      assert.match(panel, /01 99 00 41 52/, "the prospect's phone (Lumeo has no e-mail)")
      assert.match(panel, /Atelier Vélin/, "the call script speaks for the fictional agency")
      assert.match(panel, /Insights/)
      assert.ok((await page.$$("#lead .insights li")).length >= 3, "3+ insights")
      assert.deepEqual(await wide(page, "#lead"), [], "call panel off screen")
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `sandbox-call-${label}.png`) })
      await page.click('#ltabs a[data-t="email"]')
      assert.match(await page.$eval("#lcontent", (e) => e.textContent || ""), /No email address/)
      assert.deepEqual(errors, [])
    } finally { await close() }
  })
}
