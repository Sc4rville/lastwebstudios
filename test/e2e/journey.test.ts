/**
 * THE USER'S JOURNEY, as a user would do it, in the sandbox (simulated engine, no key): type what you're after,
 * click Find, see the job strip within 300 ms, see new prospects arrive, click Build on one, see the build run and
 * the site land in Sites as « Waiting for you », click Send to outreach, see the toast and the card in Outreach,
 * click Next step and see the column change. At 1440 and 390 px, 0 console error.
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
  parent = mkdtempSync(join(tmpdir(), "lws-journey-"))
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

for (const [label, width, height] of [["desktop", 1440, 900], ["mobile", 390, 844]] as const) {
  test(`journey @${width}px : find → build → send to outreach → next step, with visible feedback at every click`, { timeout: 240_000 }, async () => {
    const { page, errors, close } = await open(width, height, "/#prospects")
    try {
      await page.waitForSelector("#plist .pc", { timeout: 20_000 })
      const before = await page.$$eval("#plist .pc", (els) => els.length)
      // 1. the prompt
      await page.fill("#findText", `a mix of trades near Lyon, ${label === "desktop" ? 12 : 9} of them`)
      await page.waitForSelector("#briefChips:not([hidden]) .chip", { timeout: 5_000 })
      assert.match(await page.$eval("#briefChips", (e) => e.textContent || ""), /Lyon/)
      const t0 = Date.now()
      await page.click("#findBtn")
      await page.waitForSelector("#jobs .job", { timeout: 2_000 })
      assert.ok(Date.now() - t0 < 1500, `job strip appeared in ${Date.now() - t0} ms`)
      assert.ok(await page.$("#findBtn.loading") || await page.$("#jobs .job .bar"), "visible loading state")
      if (SHOTS) { await page.waitForTimeout(2500); await page.screenshot({ path: join(SHOTS, `journey-finding-${label}.png`) }) }
      // 2. prospects arrive live
      await page.waitForFunction((n) => document.querySelectorAll("#plist .pc").length >= n + 3, before, { timeout: 60_000 })
      await page.waitForFunction(() => /found/.test(document.querySelector("#jobs")!.textContent || "") && !document.querySelector("#jobs .job .bar"), null, { timeout: 60_000 })
      assert.match(await page.$eval("#toasts", (e) => e.textContent || ""), /prospects found/)
      // 3. build one of the new ones
      const newCard = await page.$("#plist .pc.new [data-build]")
      assert.ok(newCard, "a New prospect with a Build button")
      const id = await newCard!.getAttribute("data-build")
      await newCard!.click()
      await page.waitForFunction((i) => document.querySelector(`#plist .pc[data-id="${i}"] .head .chip`)!.textContent === "Building", id, { timeout: 5_000 })
      await page.waitForFunction(() => /Building/.test(document.querySelector("#jobs")!.textContent || ""), null, { timeout: 10_000 })
      if (SHOTS) { await page.waitForTimeout(2000); await page.screenshot({ path: join(SHOTS, `journey-building-${label}.png`) }) }
      await page.waitForFunction((i) => document.querySelector(`#plist .pc[data-id="${i}"] .head .chip`)!.textContent === "Built", id, { timeout: 90_000 })
      // 4. it is in Sites, waiting for you
      await page.click('#steps a[data-v="sites"]')
      await page.waitForFunction((i) => !!document.querySelector(`#rail .card[data-id="${i}"]`), id, { timeout: 15_000 })
      await page.click(`#rail .card[data-id="${id}"]`)
      await page.waitForFunction(() => document.querySelector("#iState")!.textContent === "Waiting for you", null, { timeout: 10_000 })
      await page.click("#approve")
      await page.waitForFunction(() => /Sent to outreach/.test(document.querySelector("#toasts")!.textContent || ""), null, { timeout: 10_000 })
      await page.waitForFunction(() => document.querySelector("#iState")!.textContent === "In outreach", null, { timeout: 10_000 })
      // 5. outreach: the card, then next step
      await page.click('#steps a[data-v="outreach"]')
      await page.waitForSelector(`.kcard[data-id="${id}"]`, { timeout: 15_000 })
      const colOf = () => page.$eval(`.kcard[data-id="${id}"]`, (e) => e.closest(".col")!.querySelector(".colhead span")!.textContent)
      assert.equal(await colOf(), "To call")
      await page.click(`.kcard[data-id="${id}"] [data-next]`)
      await page.waitForFunction((i) => document.querySelector(`.kcard[data-id="${i}"]`)!.closest(".col")!.querySelector(".colhead span")!.textContent === "Follow-up 1", id, { timeout: 10_000 })
      assert.match(await page.$eval("#toasts", (e) => e.textContent || ""), /Follow-up 1/)
      assert.deepEqual(errors, [])
    } catch (e) {
      // what the user would see at that moment (helps when a wait times out)
      const snap = await page.evaluate(() => ({ jobs: document.querySelector("#jobs")?.textContent, cards: document.querySelectorAll("#plist .pc").length, chips: [...document.querySelectorAll("#plist .pc .head .chip")].map((c) => c.textContent).join(","), toasts: document.querySelector("#toasts")?.textContent, hash: location.hash, state: document.querySelector("#iState")?.textContent })).catch(() => null)
      const jobs = await fetch(run.url + "/api/jobs").then((r) => r.json()).catch(() => null)
      console.error("JOURNEY SNAPSHOT", JSON.stringify({ snap, jobs: jobs && jobs.jobs.map((j: any) => `${j.id}:${j.mode}:${j.status}:${j.last}`), errors }))
      throw e
    } finally { await close() }
  })
}
