/**
 * The three steps in a real browser, on a 100 % fictional workspace where the film was played end to end
 * (test/helpers/film.ts): Prospects (why picked in plain words, Build / Skip, Automatic toggle, Find sheet),
 * the three-step nav with counts, the cage pill and sheet (Pause / Resume on every view), the call panel
 * (« Lost » records the outcome and takes the card off the board, DB required), Next step on a card.
 * 0 console error, nothing off screen at 1440 and 390 px. No tech word on the Prospects page.
 * With a database if `npm run test:e2e` could start a throwaway Postgres (docker), else disk mode.
 * Screenshots (fictional): LWS_SHOTS_DIR=NIGHT/shots npm run test:e2e
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium, type Browser, type Page } from "playwright"
import { makeWorkspace, type Workspace } from "../helpers/workspace.ts"
import { startCockpit } from "../helpers/cockpit.ts"
import { freePort, type Proc } from "../helpers/server.ts"
import { npmRun } from "../helpers/proc.ts"
import { freshDatabase } from "../helpers/pg.ts"
import { filmWorkspaceSetup, playFilm, FILM_SECRET } from "../helpers/film.ts"

const WITH_DB = !!process.env.DATABASE_URL
const SHOTS = process.env.LWS_SHOTS_DIR || ""
let ws: Workspace, cockpit: Proc, browser: Browser, db: Awaited<ReturnType<typeof freshDatabase>> | null = null

before(async () => {
  ws = makeWorkspace({ seed: ["agency", "machine"] })
  ws.materialize("video", (p) => p === "fonts" || p.startsWith("fonts/"))
  ws.materialize("design/fonts", (p) => !p.includes("/") ? !/\.(woff2?|ttf|otf)$/.test(p) && (p.endsWith(".json") || p === "host-grotesk") : p.startsWith("host-grotesk/"))
  filmWorkspaceSetup(ws)
  const port = await freePort(), base = `http://127.0.0.1:${port}`
  const env: NodeJS.ProcessEnv = { LWS_TRACK_SECRET: FILM_SECRET, LWS_BUDGET_USD_DAY: "20" }
  if (WITH_DB) {
    db = await freshDatabase()
    const r = await npmRun(ws.dir, "db:init", [], { env: { DATABASE_URL: db.url, DB_SSL: "disable" } })
    assert.equal(r.code, 0, r.out)
    Object.assign(env, { DATABASE_URL: db.url, DB_SSL: "disable" })
  } else delete process.env.DATABASE_URL
  const day = new Date().toISOString()
  ws.write("data/logs/spend.jsonl", [
    { at: day, day: day.slice(0, 10), kind: "agent", source: "worker:composer", usd: 2.88, billing: "plan", estimated: true },
    { at: day, day: day.slice(0, 10), kind: "image", source: "openai-image", usd: 0.25, billing: "api", estimated: true },
  ].map((e) => JSON.stringify(e)).join("\n") + "\n")
  cockpit = await startCockpit(ws.dir, env, { port })
  for (let i = 0; i < 300 && WITH_DB && !/Indexed →/.test(cockpit.output()); i++) await new Promise((r) => setTimeout(r, 100))
  await playFilm({ ws, base, dbUrl: db?.url })
  browser = await chromium.launch()
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
})
after(async () => { await browser?.close(); await cockpit?.stop(); ws?.cleanup(); await db?.drop() })

async function open(width: number, height: number, path: string): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  await ctx.addInitScript(() => { try { localStorage.setItem("lws.settingsSeen", "1"); localStorage.setItem("lws.howto", "1") } catch { /* */ } })
  await page.emulateMedia({ reducedMotion: "reduce" }) // no entrance animations under the pointer
  const errors: string[] = []
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
  page.on("pageerror", (e) => errors.push(String(e)))
  await page.goto(cockpit.url + path, { waitUntil: "load", timeout: 45_000 })
  return { page, errors, close: () => ctx.close() }
}
async function offscreen(page: Page, sel: string): Promise<string[]> {
  return page.evaluate((s) => {
    const bad: string[] = []
    for (const el of document.querySelectorAll<HTMLElement>(`${s} *`)) {
      const r = el.getBoundingClientRect()
      if (!r.width || getComputedStyle(el).visibility === "hidden") continue
      if (el.closest(".bar, .progress")) continue // an animated progress bar slides inside an overflow:hidden track
      if (r.right > innerWidth + 1 || r.left < -1) bad.push(`${el.tagName.toLowerCase()}.${String(el.getAttribute("class") || "")} [${Math.round(r.left)}, ${Math.round(r.right)}]`)
    }
    return bad.slice(0, 8)
  }, sel)
}
const TECH = /\b(learn|score|scoring|gate|parse|judge|dry-run|breaker|sequencer|composer|axis|tier)\b/i

for (const [label, width, height] of [["desktop", 1440, 900], ["mobile", 390, 844]] as const) {
  test(`prospects @${width}px : cards with plain reasons and Good fit, Build / Skip, Automatic, Find sheet, the three-step nav, no tech word, 0 overflow`, { timeout: 90_000 }, async () => {
    const { page, errors, close } = await open(width, height, "/")
    try {
      await page.waitForFunction(() => document.querySelectorAll("#plist .pc").length >= 2, null, { timeout: 20_000 })
      const cards = await page.$$eval("#plist .pc", (els) => els.map((e) => ({ name: e.querySelector(".name")!.textContent, why: [...e.querySelectorAll(".tags .chip")].map((x) => x.textContent), fit: !!e.querySelector(".chip.fit"), status: e.querySelector(".head .chip")!.textContent })))
      assert.ok(cards.some((c) => c.why.length >= 1), "at least one card says why it was picked")
      assert.ok(cards.some((c) => c.fit), "a Good fit chip")
      for (const c of cards) assert.doesNotMatch(c.why.join(" "), /\d{2,3}\s*\/\s*100|axes|besoin|levier/i, "no scoring numbers")
      assert.doesNotMatch(await page.$eval("#v-prospects", (e) => (e as HTMLElement).innerText), TECH)
      // the three steps with counts
      const steps = await page.$$eval("#steps a", (els) => els.map((e) => ({ v: (e as HTMLElement).dataset.v, on: e.classList.contains("on"), n: e.querySelector("i")!.textContent })))
      assert.deepEqual(steps.map((s) => s.v), ["prospects", "sites", "outreach"])
      assert.ok(steps[0].on)
      assert.deepEqual(await offscreen(page, "header.top"), [])
      assert.deepEqual(await offscreen(page, "#v-prospects"), [])
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `prospects-${label}.png`) })
      // the prompt field: what the agency understood shows as chips while you type
      await page.fill("#findText", "kitchen and pool builders near Lyon, 8 of them")
      await page.waitForSelector("#briefChips:not([hidden]) .chip", { timeout: 5_000 })
      assert.match(await page.$eval("#briefChips", (e) => e.textContent || ""), /Lyon/)
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `find-${label}.png`) })
      await page.fill("#findText", "")
      // Hands-off (in the ⋯ menu) round-trips ; turning it on asks before building what already waits
      await page.click("#menuBtn"); await page.click("#menuHandsoff")
      await page.waitForSelector("#sheet:not([hidden]) #hoToggle", { state: "attached" })
      await page.click("#sheet label.switch")
      await page.waitForFunction(() => !!document.querySelector("#sheet:not([hidden]) #hoSkip") || /Hands-off is on/.test(document.querySelector("#toasts")!.textContent || ""), null, { timeout: 10_000 })
      if (await page.$("#sheet:not([hidden]) #hoSkip")) await page.click("#hoSkip")
      const a = await (await fetch(cockpit.url + "/api/automatic")).json()
      assert.equal(a.automatic, true)
      await page.click("#menuBtn"); await page.click("#menuHandsoff")
      await page.waitForSelector("#sheet:not([hidden]) #hoToggle", { state: "attached" })
      await page.click("#sheet label.switch")
      await page.waitForFunction(() => !(document.querySelector("#hoToggle") as HTMLInputElement).checked)
      await page.keyboard.press("Escape")
      // Skip then Undo
      const skippable = await page.$("#plist [data-skip]")
      if (skippable) {
        const id = await skippable.getAttribute("data-skip")
        await page.locator(`#plist [data-skip="${id}"]`).click()
        await page.waitForSelector(`#plist .pc.skipped[data-id="${id}"]`, { timeout: 10_000 })
        await page.locator(`#plist [data-unskip="${id}"]`).click()
        await page.waitForSelector(`#plist .pc:not(.skipped)[data-id="${id}"]`, { timeout: 10_000 })
      }
      // nav → Sites, → Outreach
      await page.click('#steps a[data-v="sites"]')
      await page.waitForFunction(() => !document.querySelector<HTMLElement>("#v-sites")!.hidden)
      await page.click('#steps a[data-v="outreach"]')
      await page.waitForFunction(() => !document.querySelector<HTMLElement>("#v-outreach")!.hidden)
      assert.deepEqual(errors, [])
    } finally { await close() }
  })
}

test("the cage: the header pill opens the sheet; Stop shows in the pill on every view; Resume lifts it", { timeout: 90_000 }, async () => {
  const { page, errors, close } = await open(1440, 900, "/")
  try {
    await page.waitForSelector("#cagePill .dot")
    const running = await page.$eval("#cagePill", (e) => e.textContent || "")
    assert.match(running, /Running/)
    // the figure says what it is (audit round 2: « $3.34 » alone read as money already charged)
    // the daily cap is said in builds : $20 a day at about $3 a build is 6 builds
    assert.match(running, /\d+ of 6 builds today/)
    await page.click("#cagePill")
    await page.waitForSelector("#sheet:not([hidden]) #cStop")
    // today's builds against the cap, then the plan usage they stand for, as an estimate (the measured spend here)
    assert.match(await page.$eval("#sheet", (e) => e.textContent || ""), /Builds today\d+ of 6[\s\S]*Plan usage today≈ \$\d+\.\d\d[\s\S]*an estimate, not a charge/)
    // the reason is asked in the cockpit's own sheet (never the browser's prompt)
    await page.click("#cStop"); await page.waitForSelector("#sheet:not([hidden]) #askIn")
    await page.fill("#askIn", "e2e emergency stop"); await page.click("#askOk")
    await page.waitForFunction(() => /Stopped/.test(document.querySelector("#cagePill")!.textContent || ""), null, { timeout: 10_000 })
    if (SHOTS) await page.screenshot({ path: join(SHOTS, "cage-stop.png") })
    const other = await open(1440, 900, "/#outreach")
    try {
      await other.page.waitForFunction(() => /Stopped/.test(document.querySelector("#cagePill")!.textContent || ""), null, { timeout: 10_000 })
      assert.deepEqual(other.errors, [])
    } finally { await other.close() }
    await page.click("#cagePill")
    await page.waitForSelector("#sheet:not([hidden]) #cStop")
    assert.equal(await page.$eval("#cStop", (e) => e.textContent), "Resume")
    await page.click("#cStop")
    await page.waitForFunction(() => /Running/.test(document.querySelector("#cagePill")!.textContent || ""), null, { timeout: 10_000 })
    assert.deepEqual(errors, [])
  } finally { await close() }
})

test("outreach: Next step moves the card; the call panel's « Lost » records the outcome and takes it off the board", { skip: !WITH_DB && "CRM: database required", timeout: 90_000 }, async () => {
  await fetch(cockpit.url + "/api/crm/stage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "orvane-piscines-valmont-sur-lys", pipeline: "hot", stage: "call0" }) })
  const { page, errors, close } = await open(1440, 900, "/#outreach")
  try {
    const card = ".kcard[data-id='orvane-piscines-valmont-sur-lys']"
    await page.waitForSelector(card, { timeout: 15_000 })
    const colOf = () => page.$eval(card, (e) => e.closest(".col")!.querySelector(".colhead span")!.textContent)
    assert.equal(await colOf(), "To call")
    await page.click(`${card} [data-next]`)
    await page.waitForFunction((c) => document.querySelector(c)!.closest(".col")!.querySelector(".colhead span")!.textContent === "Follow-up 1", card, { timeout: 20_000 })
    await page.click(card)
    await page.waitForSelector("#lead:not([hidden]) [data-o='lost']")
    assert.match(await page.$eval("#lead", (e) => e.textContent || ""), /Worth knowing/)
    if (SHOTS) await page.screenshot({ path: join(SHOTS, "call-lost.png") })
    await page.fill("#lNote", "call back after 5 pm")
    await page.click("#lead [data-o='note']")
    await page.waitForFunction(() => /Saved/.test(document.querySelector("#toasts")!.textContent || ""), null, { timeout: 10_000 }) // the panel re-renders: the toast says it
    await page.click('#ltabs a[data-t="history"]')
    assert.match(await page.$eval("#lcontent", (e) => e.textContent || ""), /call back after 5 pm/)
    await page.fill("#lNote", "no budget this year")
    await page.click("#lead [data-o='lost']") // Lost asks first, in the cockpit's sheet : the test answers yes
    await page.waitForSelector("#sheet:not([hidden]) #askOk"); await page.click("#askOk")
    await page.waitForFunction(() => /Marked lost/.test(document.querySelector("#toasts")!.textContent || ""), null, { timeout: 10_000 })
    // lost leaves the board (never the Nurturing column, an active step) ; the « N lost » filter shows it
    await page.waitForFunction((c) => !document.querySelector(c) && !!document.querySelector("#showLost"), card, { timeout: 10_000 })
    assert.deepEqual(errors, [])
    const out = ws.read("data/outcomes.jsonl").trim().split("\n").map((l) => JSON.parse(l))
    assert.ok(out.filter((o) => o.outcome === "lost").length >= 2, JSON.stringify(out.map((o) => o.outcome)))
  } finally { await close() }
})
