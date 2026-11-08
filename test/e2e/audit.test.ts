/**
 * What the audits broke, fixed and locked, in the sandbox (simulated engine): the preview belongs to the selected
 * prospect ; a US search yields US-shaped data (names, ZIP, area codes) and the same place in every view ; gibberish
 * in the prompt sends nothing (no request, no red console line) ; the same search twice says « Already looking for
 * that » ; the edit sheet rejects an unknown trade ; Hands-off asks before building what already waits and says
 * exactly what it does ; Stop disables Find/Build with a reason, on every re-render, and cancelling the prompt does
 * not pause ; double-click on « Create invoice » creates one invoice ; a kanban card opens with the keyboard ; a
 * second `npm run sandbox` is refused with the running URL before building anything ; mobile approve works ;
 * Settings: « Which AI do you use » shows the status of the choice and writes LWS_LLM to .env.
 * Area B: the call panel and the sheets are dialogs (focus in, Tab stays in, Escape closes, focus goes back) ; site
 * cards, segments, tabs and the brief's chips answer the keyboard ; the header pill is compact and the sheet says
 * « Test mode — no emails go out » and « Estimated plan usage » ; the Outreach header changes the approve choice in
 * place ; Ask writes English with the count it lists ; Won and un-winning ask first ; blank step names, an empty
 * agency paragraph and a missing date are said inline ; busy buttons show an SVG spinner ; billing in a US agency:
 * Sales tax 0 %, EIN, a won deal fills the client, every rule enforced.
 * Area C, measured in the browser (the studio direction, round 3): one typeface at 400/500/600 and the tokens ; a lime
 * primary with an inset highlight, a real disabled state, neutral count badges ; the steps as one 42 px segmented
 * control ; a readable error toast at the bottom, clear of every action ; a row of four large captures in view at
 * 1440 × 900 ; one header row and the steps as a tab bar on a phone, 16 px gutters ; the filmstrip's dot and date ;
 * Before and Compare as framed pages, two aligned halves ; one list and a stage picker on a phone (no hidden board) ;
 * the meeting chips ; sans text 13 px or more ; billing on app.css.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium, type Browser, type Page } from "playwright"
import { startSandbox, type SandboxRun } from "../../scripts/sandbox.ts"
import { tsx } from "../helpers/proc.ts"

let run: SandboxRun, browser: Browser, parent = ""
before(async () => {
  parent = mkdtempSync(join(tmpdir(), "lws-audit-"))
  process.env.LWS_AGENCY_CONFIG = "agency.config.example.us.json"
  run = await startSandbox({ check: true, dir: join(parent, "sb"), db: "pglite", json: false, quiet: true })
  assert.ok(run.ok, JSON.stringify(run.checks.filter((c) => !c.ok)))
  browser = await chromium.launch()
})
after(async () => { delete process.env.LWS_AGENCY_CONFIG; await browser?.close(); await run?.stop(); if (parent) rmSync(parent, { recursive: true, force: true }) })

async function open(width: number, height: number, path: string): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  await ctx.addInitScript(() => { try { localStorage.setItem("lws.settingsSeen", "1"); localStorage.setItem("lws.howto", "1"); localStorage.setItem("lws.demoBar.sandbox", "1") } catch { /* */ } })
  await page.emulateMedia({ reducedMotion: "reduce" })
  const errors: string[] = []
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
  page.on("pageerror", (e) => errors.push(String(e)))
  // the cockpit never opens the browser's own confirm() / prompt() (audit round 2) : one would fail the test
  page.on("dialog", (d) => { errors.push(`native dialog: ${d.message()}`); void d.dismiss() })
  await page.goto(run.url + path, { waitUntil: "load", timeout: 45_000 })
  return { page, errors, close: () => ctx.close() }
}
const post = (p: string, b: unknown) => fetch(run.url + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json())

test("US search: American names, ZIP and area codes of the place, trade matching the name ; the brief says what it didn't catch", { timeout: 120_000 }, async () => {
  const { page, errors, close } = await open(1440, 900, "/#prospects")
  try {
    await page.waitForSelector("#plist .pc", { timeout: 20_000 })
    // the US cast lives in Austin too : only what this search brings is measured
    const cast = new Set(((await (await fetch(run.url + "/api/prospects")).json()).items as any[]).map((x) => x.id))
    const finds: string[] = []
    page.on("request", (r) => { if (r.url().includes("/api/prospects/find")) finds.push(r.postData() || "") })
    await page.fill("#findText", "asdkjh qwe")
    await page.waitForFunction(() => /didn't catch a trade/.test(document.querySelector("#briefChips")!.textContent || ""), null, { timeout: 5_000 })
    // no NEW job (a job of the demo's story may finish and leave the list meanwhile)
    const jobIds = async () => ((await (await fetch(run.url + "/api/jobs")).json()).jobs as any[]).map((j) => j.id)
    const jobsBefore = new Set(await jobIds())
    await page.click("#findBtn")
    await page.waitForTimeout(800)
    assert.deepEqual((await jobIds()).filter((id) => !jobsBefore.has(id)), [], "gibberish launches no job")
    // typed and sent at once (before the 400 ms preview) : still nothing sent, the hint inline
    await page.fill("#findText", "zzzz qqqq"); await page.press("#findText", "Enter")
    await page.waitForFunction(() => /didn't catch a trade/.test(document.querySelector("#briefChips")!.textContent || ""), null, { timeout: 5_000 })
    assert.deepEqual(finds, [], "nothing is sent when the agency did not understand")
    await page.fill("#findText", "6 roofers and pool builders around Austin")
    await page.waitForFunction(() => /Austin/.test(document.querySelector("#briefChips")!.textContent || ""), null, { timeout: 5_000 })
    await page.click("#findBtn")
    await page.waitForFunction(() => !document.querySelector("#findBtn.loading"), null, { timeout: 10_000 })
    // the same search again while it runs → « Already looking for that », one job
    await page.click("#findBtn")
    await page.waitForFunction(() => /Already looking for that/.test(document.querySelector("#toasts")!.textContent || ""), null, { timeout: 10_000 })
    assert.equal((await (await fetch(run.url + "/api/jobs")).json()).jobs.filter((j: any) => j.mode === "find" && /Austin/.test(j.params?.place || "") && (j.params?.trades || []).includes("couvreur-zingueur")).length, 1, "one search, not two")
    await page.waitForFunction(() => /found/.test(document.querySelector("#jobs")!.textContent || "") && !document.querySelector("#jobs .bar"), null, { timeout: 60_000 })
    // the list refreshes right after the job ends : wait for the cards themselves, not only the strip
    await page.waitForFunction((known) => [...document.querySelectorAll<HTMLElement>("#plist .pc")].filter((e) => !known.includes(e.dataset.id || "") && /Austin/.test(e.querySelector(".sub")?.textContent || "")).length >= 3, [...cast], { timeout: 20_000 })
    // what the search said it brought, under the field (audit round 2)
    assert.match(await page.$eval("#findDone", (e) => e.textContent || ""), /^Found \d+ (roofers and pool builders|pool builders and roofers) near Austin/)
    const cards = await page.$$eval("#plist .pc", (els) => els.map((e) => ({ id: (e as HTMLElement).dataset.id || "", name: e.querySelector(".name")!.textContent || "", sub: e.querySelector(".sub")!.textContent || "", foot: e.querySelector(".foot .contact")!.textContent || "" })))
    const austin = cards.filter((c) => /Austin/.test(c.sub) && !cast.has(c.id))
    assert.ok(austin.length >= 3, `${austin.length} Austin cards`)
    for (const c of austin) {
      assert.match(c.sub, /Austin, TX 787\d\d/, c.sub)
      assert.match(c.foot, /\((512|737)\) 555-01\d\d/, c.foot)
      assert.doesNotMatch(c.name, /Piscines|Cuisines|Menuiserie|Atelier/, `French-sounding: ${c.name}`)
      assert.ok(/Roofer|Pool/.test(c.sub), `trade ${c.sub}`)
      assert.match(c.name, /Roof|Pool|Spa/, `the trade is in the name: ${c.name}`)
    }
    assert.equal(new Set(austin.map((c) => c.name.split(" ")[0])).size, austin.length, `near-duplicate names: ${austin.map((c) => c.name).join(" | ")}`)
    // every new card has its own « before » (a capture or its drawing), never « no capture »
    assert.equal(await page.$$eval("#plist .pc .nopic", (e) => e.length), 0)
    // the same place in every view : the leads behind the Sites rail carry the state and the ZIP too
    const leads = (await (await fetch(run.url + "/api/leads")).json()).prospects.filter((l: any) => l.city === "Austin")
    assert.ok(leads.length >= 3 && leads.every((l: any) => l.region === "TX" && /^787\d\d$/.test(l.zip)), JSON.stringify(leads.slice(0, 2)))
    assert.deepEqual(errors, [])
  } finally { await close() }
})

test("the preview belongs to the selected prospect (its name on the new site, its old site on the left of Compare)", { timeout: 120_000 }, async () => {
  const { page, errors, close } = await open(1440, 900, "/#sites")
  try {
    await page.waitForFunction(() => document.querySelectorAll("#rail .card").length >= 2, null, { timeout: 20_000 })
    // the built ones (a site still building has no preview yet, by design)
    const cards = await page.$$eval("#rail .card", (els) => els.filter((e) => !/Building/.test(e.querySelector(".sr")!.textContent || "")).map((e) => ({ id: (e as HTMLElement).dataset.id, name: e.querySelector(".name")!.textContent || "" })))
    for (const c of cards.slice(0, 2)) {
      await page.click(`#rail .card[data-id="${c.id}"]`)
      await page.waitForFunction((n) => document.querySelector("#iTitle")!.textContent === n, c.name, { timeout: 5_000 })
      const src = await page.$eval("#preview", (f) => (f as HTMLIFrameElement).src)
      assert.ok(src.includes(`/preview/${c.id}/`), `${c.name}: ${src}`)
      const title = await page.evaluate(async (u) => { const r = await fetch(u); const t = await r.text(); return (/<title>([^<]*)/.exec(t) || [])[1] || "" }, src)
      assert.ok(title.includes(c.name.split(" ")[0]), `${c.name} → site title "${title}"`)
      await page.click('#viewmode a[data-v="compare"]')
      await page.waitForSelector("#compare:not([hidden]) .half.l img")
      assert.ok((await page.$eval("#compare .half.l img", (i) => (i as HTMLImageElement).src)).includes(`/avant/${c.id}`))
      await page.click('#viewmode a[data-v="after"]')
    }
    assert.deepEqual(errors, [])
  } finally { await close() }
})

test("Hands-off asks before building what already waits ; off cancels pending builds", { timeout: 60_000 }, async () => {
  const { page, errors, close } = await open(1440, 900, "/#prospects")
  try {
    await page.waitForSelector("#plist .pc", { timeout: 20_000 })
    // no NEW build (a build of the demo's story may finish and leave the list meanwhile)
    const builds = async () => ((await (await fetch(run.url + "/api/jobs")).json()).jobs as any[]).filter((j) => j.mode === "composer").map((j) => j.id)
    const jobsBefore = new Set(await builds())
    await page.click("#menuBtn"); await page.click("#menuHandsoff")
    await page.waitForSelector("#sheet:not([hidden]) #hoToggle", { state: "attached" })
    await page.click("#sheet label.switch")
    await page.waitForFunction(() => /Build \d+ now|Hands-off is on/.test(document.querySelector("#sheet")!.textContent || ""), null, { timeout: 10_000 })
    const txt = await page.$eval("#sheet", (e) => e.textContent || "")
    if (/Build \d+ now/.test(txt)) {
      assert.match(txt, /\d+ good prospects? already wait\./)
      assert.deepEqual((await builds()).filter((id) => !jobsBefore.has(id)), [], "nothing built before the answer")
      await page.click("#hoSkip")
    }
    assert.equal((await (await fetch(run.url + "/api/automatic")).json()).automatic, true)
    // the promise, exactly : built without asking, never sent without you
    await page.click("#menuBtn"); await page.click("#menuHandsoff")
    await page.waitForSelector("#sheet:not([hidden]) #hoHint")
    assert.equal(await page.$eval("#hoHint", (e) => e.textContent), "New good prospects get built without asking you. You still approve each site.")
    await page.click("#sheet label.switch")
    await page.waitForFunction(() => /Hands-off is off/.test(document.querySelector("#toasts")!.textContent || ""), null, { timeout: 10_000 })
    assert.equal((await (await fetch(run.url + "/api/automatic")).json()).automatic, false)
    assert.deepEqual(errors, [])
  } finally { await close() }
})

test("Stop: Find and Build are disabled with the reason ; cancelling the prompt does not pause ; Resume re-enables", { timeout: 60_000 }, async () => {
  const { page, errors, close } = await open(1440, 900, "/#prospects")
  try {
    await page.waitForSelector("#plist .pc", { timeout: 20_000 })
    await page.click("#cagePill"); await page.waitForSelector("#sheet:not([hidden]) #cStop"); await page.click("#cStop")
    // the reason is asked in the cockpit's own sheet ; Cancel there stops nothing
    await page.waitForSelector("#sheet:not([hidden]) #askIn"); await page.click("#askNo")
    await page.waitForTimeout(500)
    assert.equal((await (await fetch(run.url + "/api/cage")).json()).stop.on, false, "cancelled prompt → not paused")
    await page.keyboard.press("Escape")
    await post("/api/cage/stop", { on: true, reason: "audit" })
    await page.waitForFunction(() => (document.querySelector("#findBtn") as HTMLButtonElement).disabled, null, { timeout: 10_000 })
    assert.equal(await page.$eval("#findBtn", (b) => b.getAttribute("title")), "Paused — resume to run")
    await page.waitForFunction(() => [...document.querySelectorAll("#plist [data-build]")].every((b) => (b as HTMLButtonElement).disabled), null, { timeout: 5_000 })
    assert.equal(await page.$eval("#plist [data-build]", (b) => b.getAttribute("title")), "Paused — resume to run")
    // a re-render (a card changes) keeps them disabled
    const one = await page.$eval("#plist [data-build]", (b) => (b as HTMLElement).dataset.build!)
    await post("/api/prospects/skip", { id: one, on: true }); await post("/api/prospects/skip", { id: one, on: false })
    await page.waitForFunction((i) => !!document.querySelector(`#plist .pc[data-id="${i}"] [data-build]`), one, { timeout: 10_000 })
    await page.waitForTimeout(400)
    assert.ok(await page.$$eval("#plist [data-build]", (bs) => bs.every((b) => (b as HTMLButtonElement).disabled)), "Build stays disabled after a re-render")
    // the server refuses too (a stale tab, a script)
    const refused = await fetch(run.url + "/api/handsoff/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [one] }) })
    assert.equal(refused.status, 409)
    await post("/api/cage/stop", { on: false })
    await page.waitForFunction(() => !(document.querySelector("#findBtn") as HTMLButtonElement).disabled, null, { timeout: 10_000 })
    await page.waitForFunction(() => !(document.querySelector("#plist [data-build]") as HTMLButtonElement).disabled, null, { timeout: 10_000 })
    // the refused request above is the test's own fetch, not the page's : the page stays clean
    assert.deepEqual(errors, [])
  } finally { await close() }
})

test("the edit sheet rejects a trade the agency does not know", { timeout: 60_000 }, async () => {
  const { page, errors, close } = await open(1440, 900, "/#prospects")
  try {
    await page.waitForSelector("#plist .pc", { timeout: 20_000 })
    await page.fill("#findText", "roofers in Austin")
    await page.waitForSelector("#briefChips:not([hidden]) #briefEdit", { timeout: 5_000 })
    await page.click("#briefEdit")
    await page.waitForSelector("#sheet:not([hidden]) #eTrades")
    await page.fill("#eTrades", "Banana")
    await page.click("#eGo")
    await page.waitForFunction(() => /Banana: not a trade the agency knows/.test(document.querySelector("#toasts")!.textContent || ""), null, { timeout: 5_000 })
    assert.equal(await page.$eval("#sheet", (e) => (e as HTMLElement).hidden), false, "the sheet stays open to fix it")
    assert.deepEqual(errors, [])
  } finally { await close() }
})

test("billing: double-click creates ONE invoice ; validation blocks a negative price", { timeout: 60_000 }, async () => {
  const { page, errors, close } = await open(1440, 900, "/billing.html")
  try {
    await page.waitForSelector("#save")
    // round 3: in the demo, the demo studio's fictional business is complete (a demo invoice prints whole) ; your own
    // cockpit never counts a demo studio's value as yours (test/cockpit/invoices.test.ts)
    const before = (await (await fetch(run.url + "/api/invoices")).json()).length
    await page.click('.tabs button[data-v="settings"]'); await page.waitForSelector("#s-name")
    assert.equal(await page.$eval("#s-address", (e) => (e as HTMLInputElement).value), "418 Larkspur Row, Suite 2, Austin, TX 78704", "the demo studio's business, complete")
    await page.fill("#s-name", "Lone Star Web Studio"); await page.fill("#s-address", "1100 Congress Ave, Austin, TX 78701"); await page.click("#save-settings")
    await page.waitForFunction(() => /Saved/.test(document.querySelector("#settings-saved")!.textContent || ""), null, { timeout: 10_000 })
    await page.click('.tabs [data-v="new"]')
    await page.fill("#c-name", "Audit Client"); await page.fill("#items .il-label", "Website"); await page.fill("#items .il-pu", "-5")
    await page.click("#save"); await page.waitForFunction(() => /negative/.test(document.querySelector("#err")!.textContent || ""))
    await page.fill("#items .il-pu", "1200")
    await page.click("#save", { clickCount: 2 })
    await page.waitForFunction(() => /created/.test(document.querySelector("#saved")!.textContent || ""), null, { timeout: 10_000 })
    await page.waitForTimeout(500)
    assert.equal((await (await fetch(run.url + "/api/invoices")).json()).length, before + 1, "one invoice")
    assert.equal(await page.$eval("#c-name", (i) => (i as HTMLInputElement).value), "", "form reset")
    assert.match(await page.$eval("#t-ttc", (e) => e.textContent || ""), /\$/, "US agency → dollars")
    assert.doesNotMatch(await page.$eval("main", (e) => e.textContent || ""), /€|0,00/, "no euro formatting in a US agency")
    assert.equal(await page.$eval("#t-taxlbl", (e) => e.textContent), "Sales tax")
    assert.equal(await page.$eval("#i-vat", (e) => (e as HTMLInputElement).value), "0", "US sales tax defaults to 0 %")
    // every rule, said next to the field at fault
    await page.fill("#c-name", "Audit Client"); await page.fill("#items .il-label", "Website"); await page.fill("#items .il-pu", "100")
    await page.fill("#i-due", "2020-01-01")
    await page.click("#save"); await page.waitForFunction(() => /due date/.test(document.querySelector("#err")!.textContent || ""))
    assert.equal(await page.$eval("#i-due", (e) => e.getAttribute("aria-invalid")), "true")
    await page.fill("#i-due", "2099-01-01"); await page.fill("#i-payurl", "ftp://pay.example")
    await page.click("#save"); await page.waitForFunction(() => /http/.test(document.querySelector("#err")!.textContent || ""))
    await page.fill("#i-payurl", ""); await page.fill("#items .il-label", "")
    await page.click("#save"); await page.waitForFunction(() => /description/.test(document.querySelector("#err")!.textContent || ""))
    await page.fill("#items .il-label", "Website"); await page.fill("#i-vat", "150")
    await page.click("#save"); await page.waitForFunction(() => /between 0 and 100/.test(document.querySelector("#err")!.textContent || ""))
    assert.equal((await (await fetch(run.url + "/api/invoices")).json()).length, before + 1, "nothing created by a refused form")
    // the business behind the invoice: US fields only
    await page.click('.tabs [data-v="settings"]'); await page.waitForSelector("#s-taxId")
    const seller = await page.$eval("#seller-fields", (e) => e.textContent || "")
    assert.match(seller, /EIN/); assert.doesNotMatch(seller, /SIRET|IBAN|VAT number|Registry/)
    await page.fill("#s-name", ""); await page.click("#save-settings")
    await page.waitForFunction(() => /can't be empty/.test(document.querySelector("#seller-warn")!.textContent || ""))
    // a won deal fills the client (the call panel links here with ?client=<id>)
    const won = (await (await fetch(run.url + "/api/won")).json()).won as { id: string; name: string }[]
    if (won.length) {
      await page.goto(run.url + `/billing.html?client=${encodeURIComponent(won[0].id)}`, { waitUntil: "load" })
      await page.waitForFunction((n) => (document.querySelector("#c-name") as HTMLInputElement).value === n, won[0].name, { timeout: 10_000 })
      assert.equal(await page.$eval("#wonWrap", (e) => (e as HTMLElement).hidden), false)
    }
    assert.deepEqual(errors, [])
  } finally { await close() }
})

test("keyboard: Tab to a kanban card, Enter opens the call panel", { timeout: 60_000 }, async () => {
  const { page, errors, close } = await open(1440, 900, "/#outreach")
  try {
    await page.waitForSelector(".kcard", { timeout: 20_000 })
    await page.focus(".kcard")
    await page.keyboard.press("Enter")
    await page.waitForSelector("#lead:not([hidden]) h2", { timeout: 5_000 })
    assert.deepEqual(errors, [])
  } finally { await close() }
})

const inside = (page: Page, sel: string) => page.evaluate((s) => { const d = document.querySelector(s)!; return d.contains(document.activeElement) }, sel)
test("keyboard: the call panel is a dialog — focus in, Tab stays in, Escape closes, focus back on the card ; a sheet gives focus back", { timeout: 90_000 }, async () => {
  const { page, errors, close } = await open(1440, 900, "/#outreach")
  try {
    await page.waitForSelector(".kcard", { timeout: 20_000 })
    const id = await page.$eval("#board .kcard", (e) => (e as HTMLElement).dataset.id!)
    await page.focus(`#board .kcard[data-id="${id}"]`); await page.keyboard.press("Enter")
    await page.waitForSelector("#lead:not([hidden]) h2", { timeout: 5_000 })
    assert.deepEqual(await page.$eval("#lead", (e) => [e.getAttribute("role"), e.getAttribute("aria-modal"), document.getElementById(e.getAttribute("aria-labelledby") || "")?.textContent ? "named" : ""]), ["dialog", "true", "named"])
    assert.ok(await inside(page, "#lead"), "focus moved into the panel")
    for (let i = 0; i < 30; i++) { await page.keyboard.press("Tab"); assert.ok(await inside(page, "#lead"), `Tab #${i + 1} left the panel`) }
    for (let i = 0; i < 6; i++) { await page.keyboard.press("Shift+Tab"); assert.ok(await inside(page, "#lead"), `Shift+Tab #${i + 1} left the panel`) }
    // the tabs are tabs, and a re-render keeps the keyboard on the one you chose
    await page.focus('#ltabs [data-t="history"]'); await page.keyboard.press("Enter")
    await page.waitForFunction(() => document.querySelector('#ltabs [data-t="history"]')!.getAttribute("aria-selected") === "true")
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-t")), "history")
    await page.keyboard.press("Escape")
    await page.waitForSelector("#lead", { state: "hidden" })
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset?.id), id, "focus is back on the card")
    // a sheet : aria-modal, named, Escape closes it and the keyboard is back on what opened it
    await page.focus("#cagePill"); await page.keyboard.press("Enter")
    await page.waitForSelector("#sheet:not([hidden])")
    assert.equal(await page.$eval("#sheet", (e) => e.getAttribute("aria-modal")), "true")
    assert.ok(await inside(page, "#sheet"), "focus moved into the sheet")
    for (let i = 0; i < 12; i++) { await page.keyboard.press("Tab"); assert.ok(await inside(page, "#sheet"), `Tab #${i + 1} left the sheet`) }
    await page.keyboard.press("Escape")
    await page.waitForSelector("#sheet", { state: "hidden" })
    assert.equal(await page.evaluate(() => document.activeElement?.id), "cagePill")
    // the menu says whether it is open, Escape closes it
    await page.focus("#menuBtn"); await page.keyboard.press("Enter")
    assert.equal(await page.$eval("#menuBtn", (e) => e.getAttribute("aria-expanded")), "true")
    await page.keyboard.press("Escape")
    assert.equal(await page.$eval("#menuDrop", (e) => (e as HTMLElement).hidden), true)
    assert.equal(await page.evaluate(() => document.activeElement?.id), "menuBtn")
    assert.deepEqual(errors, [])
  } finally { await close() }
})

test("keyboard: site cards, the Before / After / Compare segments and the brief's chips answer Enter", { timeout: 90_000 }, async () => {
  const { page, errors, close } = await open(1440, 900, "/#sites")
  try {
    await page.waitForFunction(() => document.querySelectorAll("#rail .card").length >= 2, null, { timeout: 20_000 })
    const second = await page.$$eval("#rail .card", (els) => (els[1] as HTMLElement).dataset.id!)
    await page.focus(`#rail .card[data-id="${second}"]`); await page.keyboard.press("Enter")
    await page.waitForFunction((i) => document.querySelector(`#rail .card[data-id="${i}"]`)?.getAttribute("aria-pressed") === "true", second, { timeout: 5_000 })
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset?.id), second, "the keyboard stays on the card after the redraw")
    await page.focus('#viewmode a[data-v="compare"]'); await page.keyboard.press("Enter")
    await page.waitForSelector("#compare:not([hidden])")
    assert.equal(await page.$eval('#viewmode a[data-v="compare"]', (e) => e.getAttribute("aria-pressed")), "true")
    await page.focus('#viewmode a[data-v="after"]'); await page.keyboard.press(" ")
    await page.waitForSelector("#compare", { state: "hidden" })
    await page.goto(run.url + "/#prospects", { waitUntil: "load" })
    await page.fill("#findText", "roofers in Austin")
    await page.waitForSelector("#briefChips:not([hidden]) button.x", { timeout: 5_000 })
    const n = await page.$$eval("#briefChips .chip.brief", (e) => e.length)
    await page.focus("#briefChips .chip.brief button.x"); await page.keyboard.press("Enter")
    await page.waitForFunction((k) => document.querySelectorAll("#briefChips .chip.brief").length === k - 1, n, { timeout: 5_000 })
    await page.focus("#briefEdit"); await page.keyboard.press("Enter")
    await page.waitForSelector("#sheet:not([hidden]) #eTrades")
    await page.keyboard.press("Escape")
    assert.deepEqual(errors, [])
  } finally { await close() }
})

test("status: a pill that says what its figure is (state · today's builds against the daily cap), the sheet says « Test mode — no emails go out », the builds and the plan usage as an estimate", { timeout: 60_000 }, async () => {
  const { page, errors, close } = await open(1440, 900, "/#prospects")
  try {
    await page.waitForSelector("#cagePill .dot")
    const pill = await page.$eval("#cagePill", (e) => ({ text: [...e.children].filter((c) => (c as HTMLElement).offsetWidth > 0).map((c) => c.textContent).join(" ").trim(), title: e.getAttribute("title") || "", dots: document.querySelectorAll("header .dot, header .ic circle[r='8']").length }))
    // audit round 2: the figure is labelled, and the demo spends nothing (no seeded usage)
    // round 3 (D2): the daily cap is said in builds, never in dollars next to a plan's price
    // D2 : « ● Running », the day in builds next to it ; test mode is said in its title and its sheet
    assert.match(pill.text, /^Running \d+ of 6 builds today$/, pill.text)
    assert.match(pill.title, /Test mode — no emails go out\. \d+ of 6 builds today \(the daily cap\)\./)
    assert.doesNotMatch(pill.text + pill.title, /\$/, "no dollar figure on the pill")
    assert.equal(pill.dots, 1, "one status indicator in the header")
    await page.click("#cagePill"); await page.waitForSelector("#sheet:not([hidden]) #cStop")
    const sheet = await page.$eval("#sheet", (e) => e.textContent || "")
    const chrome = await page.$eval("#sheet", (e) => { const c = e.cloneNode(true) as HTMLElement; c.querySelectorAll("details").forEach((d) => d.remove()); return c.textContent || "" })
    assert.match(sheet, /Test mode — no emails go out/); assert.match(sheet, /Builds today\d+ of 6/); assert.match(sheet, /Daily cap6 builds \(the demo's\)/)
    assert.match(sheet, /Plan usage todaynone \(the demo calls no AI\)/); assert.match(sheet, /an estimate, not a charge/)
    // rates are not judged before 100 emails: said, and the rows are dimmed (never a 25 % that looks ignored)
    assert.match(sheet, /Not judged yet: these rates count from 100 emails written/)
    assert.match(sheet, /Unsubscribes\d+ of \d+ written/)
    assert.ok(await page.$$eval("#sheet .row.dim", (e) => e.length) >= 3)
    assert.match(sheet, /Turn on sending/); assert.equal(await page.$eval("#cStop", (e) => e.textContent), "Stop")
    assert.doesNotMatch(chrome, /dry-?run|breaker|sequencer/i, "the switches' names only inside « Turn on sending »")
    await page.keyboard.press("Escape")
    // mobile : the state is a word, not a lone dot
    const m = await open(390, 844, "/#prospects")
    try {
      await m.page.waitForSelector("#cagePill .short")
      assert.ok(await m.page.$eval("#cagePill .short", (e) => (e as HTMLElement).offsetWidth > 0 && /^(Running|Stopped)$/.test(e.textContent || "")), "the word shows on a phone, never a lone dot")
      assert.equal(await m.page.$eval("#cagePill .dot", (e) => (e as HTMLElement).offsetWidth), 0, "never a lone dot")
      assert.ok(await m.page.evaluate(() => document.documentElement.scrollWidth <= 390), "no horizontal scroll")
      // a phone: brand · pill · menu on one row, the three steps as the tab bar at the bottom, in thumb's reach
      const nav = { steps: await rectOf(m.page, "#steps"), outreach: await rectOf(m.page, '#steps a[data-v="outreach"]'), pill: await rectOf(m.page, "#cagePill"), menu: await rectOf(m.page, "#menuBtn") }
      const apart = (a: any, b: any) => a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t
      assert.ok(apart(nav.steps, nav.pill) && apart(nav.steps, nav.menu), `the steps never run under the pill (${JSON.stringify(nav)})`)
      assert.ok(nav.outreach.r <= 390 && nav.steps.b === 844 && nav.steps.w === 390, `the tab bar fits the screen, at the bottom (${JSON.stringify(nav)})`)
      assert.ok(await m.page.$eval("#menuBtn", (e) => e.getBoundingClientRect().right <= 390), "the menu stays on screen")
      assert.deepEqual(m.errors, [])
    } finally { await m.close() }
    assert.deepEqual(errors, [])
  } finally { await close() }
})

test("Outreach: the approve choice changes in place (call list, emails in test mode, your own tool under Advanced) ; Ask writes English with the count it lists", { timeout: 90_000 }, async () => {
  const { page, errors, close } = await open(1440, 900, "/#outreach")
  try {
    await page.waitForSelector("#agentLine #agentChange", { timeout: 20_000 })
    const was = await (await fetch(run.url + "/api/agent")).json()
    await page.click("#agentChange")
    await page.waitForSelector("#sheet:not([hidden]) #modes")
    assert.equal(await page.$eval("#sheetTitle", (e) => e.textContent), "When you approve a site")
    assert.deepEqual(await page.$$eval("#modes .radio b", (e) => e.map((x) => x.textContent)), ["Add to my call list", "Send emails automatically", "Send to my own tool"])
    assert.match(await page.$eval('#modes .radio:has(input[value="sequencer"])', (e) => e.textContent || ""), /test mode/)
    assert.equal(await page.$eval('#modes details input[value="webhook"]', (e) => !!e), true, "the webhook is under Advanced")
    await page.click("#modes details summary"); await page.click('#modes label:has(input[value="webhook"])'); await page.fill("#aUrl", "ftp://nope.example")
    await page.click("#mSave"); await page.waitForFunction(() => /http/.test(document.querySelector("#mMsg")!.textContent || ""))
    assert.deepEqual(await (await fetch(run.url + "/api/agent")).json(), was, "a refused choice saves nothing")
    await page.click('#modes label:has(input[value="manual"])'); await page.click("#mSave")
    await page.waitForFunction(() => /Add to my call list/.test(document.querySelector("#agentLine")!.textContent || ""), null, { timeout: 5_000 })
    await post("/api/agent", { mode: was.mode, url: was.url || "" })
    // Ask the agent : English, the number it says is the number of things it lists, no jargon
    await page.click("#board .kcard"); await page.waitForSelector("#lead:not([hidden]) #askText")
    // the script comes first ; the insights show two lines, the rest on demand
    assert.ok(await page.$eval("#lead .lbody", (b) => { const s = b.querySelector("#lcontent")!, i = b.querySelector(".insights"); return !i || !!(s.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING) }), "the script before the insights")
    if (await page.$("#insMore")) { assert.equal(await page.$$eval("#lead .insights li", (e) => e.length), 2); await page.click("#insMore") }
    const bullets = await page.$$eval("#lead .insights li", (e) => e.map((x) => x.textContent || ""))
    assert.ok(bullets.length >= 3 && bullets.length <= 6, bullets.join(" | "))
    for (const b of bullets) assert.doesNotMatch(b, /viewport|\bOG\b|pas |responsive/i, b)
    await page.fill("#askText", "a follow-up email"); await page.click("#askGo")
    await page.waitForSelector("#lead .out", { timeout: 10_000 })
    const out = await page.$eval("#lead .out", (e) => e.textContent || "")
    // the question asked stays above its answer, and a demo answer says it is one
    assert.equal(await page.$eval("#lead .answer .q", (e) => e.textContent), "a follow-up email")
    assert.match(await page.$eval("#lead .answer", (e) => e.textContent || ""), /Demo answer: written from what the demo knows, no AI was called/)
    assert.doesNotMatch(out, /viewport|\bOG\b|responsive/i, out)
    // in the language the email goes out in (a French business gets French, even from a US agency) ; the count it
    // says is the count it lists, in either language
    const m = /(One thing|Two things|Three things) changes? for you: ([^.]*)\./.exec(out)
    const f = /(Une chose|Deux choses|Trois choses) qui change(?:nt)? pour vous : ([^.]*)\./.exec(out)
    if (m) assert.equal(m[2].split(/, | and /).length, ["One thing", "Two things", "Three things"].indexOf(m[1]) + 1, out)
    else if (f) assert.equal(f[2].split(/, | et /).length, ["Une chose", "Deux choses", "Trois choses"].indexOf(f[1]) + 1, out)
    // a lead with no email gets a call angle instead, said above the answer
    else if (/^Angle/.test(out)) assert.match(await page.$eval("#lead .answer", (e) => e.textContent || ""), /No email address for .*: here is a call angle instead/)
    else assert.match(out, /It works on a phone|Il s'affiche bien sur téléphone/)
    assert.deepEqual(errors, [])
  } finally { await close() }
})

test("Won and un-winning ask first ; blank step names and a missing meeting date are said inline ; busy buttons spin an SVG", { timeout: 90_000 }, async () => {
  const { page, errors, close } = await open(1440, 900, "/#outreach")
  try {
    await page.waitForSelector("#board .kcard", { timeout: 20_000 })
    const crm = await (await fetch(run.url + "/api/crm")).json()
    const toCall = (crm.hot.call0 || [])[0], won = (crm.closing.signature || [])[0]
    // asked in the cockpit's own sheet (never the browser's confirm) ; Cancel records nothing
    const ask = async () => { await page.waitForSelector("#sheet:not([hidden]) #askOk"); const t = await page.$eval("#askText", (e) => e.textContent || ""); await page.click("#askNo"); await page.waitForSelector("#sheet", { state: "hidden" }); return t }
    if (toCall) {
      await page.click(`#board .kcard[data-id="${toCall.id}"]`); await page.waitForSelector("#lead:not([hidden]) [data-o='won']")
      await page.click("#lead [data-o='won']")
      assert.match(await ask(), /no meeting yet\. Mark it won anyway\?/)
      const after = await (await fetch(run.url + "/api/crm")).json()
      assert.ok((after.hot.call0 || []).some((l: any) => l.id === toCall.id), "dismissed → still to call")
      // Meeting without a date : said next to the date, nothing booked
      await page.click("#lead [data-o='meeting']"); await page.click("#lPickBtn"); await page.fill("#lWhen", ""); await page.click("#lWhenGo")
      await page.waitForFunction(() => /Pick a date/.test(document.querySelector("#lMsg")!.textContent || ""))
      assert.equal(await page.$eval("#lWhen", (e) => e.getAttribute("aria-invalid")), "true")
      await page.keyboard.press("Escape")
    }
    if (won) {
      await page.click("#showWon"); await page.click(`#board .kcard[data-id="${won.id}"]`); await page.waitForSelector("#lead:not([hidden]) [data-o='lost']")
      assert.match(await page.$eval("#lInvoice", (e) => e.getAttribute("href") || ""), new RegExp(`/billing\\.html\\?client=${won.id}`))
      await page.click("#lead [data-o='lost']")
      assert.match(await ask(), /is a won client\. Mark it lost anyway\?/)
      assert.ok(((await (await fetch(run.url + "/api/crm")).json()).closing.signature || []).some((l: any) => l.id === won.id), "dismissed → still won")
      await page.keyboard.press("Escape")
    }
    // Edit steps : a blank name is said under its field, nothing is sent
    const sent: string[] = []; page.on("request", (r) => { if (r.url().includes("/api/crm/stages") && r.method() === "POST") sent.push(r.url()) })
    await page.click("#editStages"); await page.waitForSelector("#sheet:not([hidden]) input[data-k]")
    const k = await page.$eval("#sheet input[data-k]", (e) => (e as HTMLElement).dataset.k!)
    await page.fill(`#sheet input[data-k="${k}"]`, "  "); await page.click("#sSave")
    await page.waitForFunction((x) => /needs a name/.test(document.querySelector(`#err-${x}`)!.textContent || ""), k)
    assert.equal(await page.$eval(`#sheet input[data-k="${k}"]`, (e) => e.getAttribute("aria-invalid")), "true")
    assert.deepEqual(sent, []); assert.equal(await page.$eval("#sheet", (e) => (e as HTMLElement).hidden), false)
    await page.click("#sCancel")
    // the busy state is a drawn SVG spinner, not a bare ring
    const mask = await page.evaluate(() => { const b = document.querySelector("#menuBtn")!; b.classList.add("loading"); const cs = getComputedStyle(b, "::after"); const m = (cs as any).maskImage || (cs as any).webkitMaskImage || ""; b.classList.remove("loading"); return m })
    assert.match(mask, /svg/)
    assert.deepEqual(errors, [])
  } finally { await close() }
})

for (const [label, width, height] of [["desktop", 1440, 900], ["mobile", 390, 844]] as const) {
  test(`approve on ${label}: Send to outreach works, the badge follows`, { timeout: 90_000 }, async () => {
    const { page, errors, close } = await open(width, height, "/#sites")
    try {
      await page.waitForFunction(() => document.querySelectorAll("#rail .card").length >= 1, null, { timeout: 20_000 })
      const target = await page.$$eval("#rail .card", (els) => (els.find((e) => /Waiting for you/.test(e.textContent || "")) as HTMLElement | undefined)?.dataset.id || "")
      if (!target) return // nothing waiting in this run
      await page.click(`#rail .card[data-id="${target}"]`)
      await page.waitForFunction(() => !(document.querySelector("#approve") as HTMLButtonElement).disabled, null, { timeout: 10_000 })
      const n0 = Number(await page.$eval("#nOutreach", (e) => e.textContent || "0")) || 0
      // round 3 : the badge counts calls to make ; under « Send emails automatically » a lead with an address goes to
      // « Emails » first (no call yet), one with a phone and no address to the call list
      const p = (await (await fetch(run.url + "/api/prospects")).json()).items.find((x: any) => x.id === target)
      const mode = (await (await fetch(run.url + "/api/agent")).json()).mode
      const plus = p && p.phone && !(mode === "sequencer" && p.email) ? 1 : 0
      await page.click("#approve")
      await page.waitForFunction(() => /Sent to outreach/.test(document.querySelector("#toasts")!.textContent || ""), null, { timeout: 10_000 })
      await page.waitForFunction(([n, k]) => Number(document.querySelector("#nOutreach")!.textContent || "0") === n + k, [n0, plus], { timeout: 10_000 })
      assert.deepEqual(errors, [])
    } finally { await close() }
  })
}

/* ── Area C: the design system, measured in the browser (tokens, one typeface, components, layout, motion) ── */
const LIME = "rgb(216, 255, 62)"
// every visible element that carries text: sans 13 px or more, JetBrains Mono (numbers, dates) 12 px or more
const smallText = (page: Page, root: string) => page.evaluate((r) => {
  const bad: string[] = []
  for (const e of document.querySelectorAll<HTMLElement>(r.split(",").map((x) => `${x.trim()} *`).join(", "))) {
    if (!e.offsetWidth || ![...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent || "").trim())) continue
    const cs = getComputedStyle(e); if (cs.visibility === "hidden" || e.closest(".sr")) continue
    const px = parseFloat(cs.fontSize), mono = /JetBrains/.test(cs.fontFamily)
    if (px < (mono ? 12 : 13)) bad.push(`${e.tagName.toLowerCase()}.${e.className} ${px}px`)
  }
  return bad.slice(0, 8)
}, root)
const rectOf = (page: Page, sel: string) => page.$eval(sel, (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height } })
const overlap = (a: { l: number; r: number; t: number; b: number }, b: { l: number; r: number; t: number; b: number }) => !(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t)

test("design: one typeface at 400/500/600, the tokens, neutral count badges, a lime primary with a real disabled state, a readable error toast in the header, sans text 13 px or more", { timeout: 90_000 }, async () => {
  const { page, errors, close } = await open(1440, 900, "/#prospects")
  try {
    await page.waitForSelector("#plist .pc", { timeout: 20_000 })
    const d = await page.evaluate(`(async () => {
      await document.fonts.ready
      const st = (s, p) => getComputedStyle(document.querySelector(s)).getPropertyValue(p).trim()
      const root = getComputedStyle(document.documentElement)
      const host = [...document.fonts].filter((f) => f.family.replace(/"/g, "") === "Host Grotesk")
      const covers = (w) => host.some((f) => { const [a, b] = f.weight.split(" ").map(Number); return b ? a <= w && w <= b : a === w })
      return {
        weights: [400, 500, 600].map(covers), space: [...document.fonts].some((f) => /Space Grotesk/.test(f.family)),
        families: [...new Set([...document.querySelectorAll("body *")].filter((e) => e.offsetWidth).map((e) => getComputedStyle(e).fontFamily.split(",")[0].replace(/"/g, "").trim()))],
        tokens: ["--bg", "--bg2", "--bg3", "--line", "--line2", "--accent", "--accent-soft", "--accent-line", "--top"].map((k) => root.getPropertyValue(k).trim()),
        lh: st("body", "line-height"), top: st("header.top", "height"),
        primary: [st("#findBtn", "background-color"), st("#findBtn", "color"), st("#findBtn", "font-weight"), st("#findBtn", "box-shadow")],
        badge: st("#steps a.on i", "background-color"), fit: document.querySelector(".chip.fit") ? st(".chip.fit", "background-color") : "",
        steps: [st("#steps", "height"), st("#steps", "border-radius"), document.querySelectorAll("#steps .arrow").length, document.querySelectorAll("#steps svg.chev").length, st("#steps a.on", "background-color")],
        grid: [st("#plist", "display"), st("#plist", "column-gap"), st("#plist", "row-gap"), st("#plist .pc .thumb", "border-top-left-radius")],
        input: [st("#findForm", "border-top-left-radius"), st(".btn", "border-top-left-radius")],
      }
    })()`) as { weights: boolean[]; space: boolean; families: string[]; tokens: string[]; lh: string; top: string; primary: string[]; badge: string; fit: string; steps: (string | number)[]; grid: string[]; input: string[] }
    assert.deepEqual(d.weights, [true, true, true], "Host Grotesk loads 400, 500 and 600")
    assert.equal(d.space, false, "no Space Grotesk")
    assert.deepEqual(d.families.filter((f) => !/^(Host Grotesk|JetBrains Mono)$/.test(f)), [], `one family (+ mono for numbers): ${d.families}`)
    assert.deepEqual(d.tokens, ["#09090b", "#111114", "#18181c", "rgba(255,255,255,.07)", "rgba(255,255,255,.13)", "#d8ff3e", "rgba(216,255,62,.12)", "rgba(216,255,62,.45)", "60px"])
    assert.ok(Math.abs(parseFloat(d.lh) - 14 * 1.45) < 0.05, `UI line-height 1.45 (${d.lh})`); assert.equal(d.top, "60px", "header 60")
    assert.deepEqual(d.primary.slice(0, 3), [LIME, "rgb(18, 22, 3)", "600"]); assert.match(d.primary[3], /inset/, "inset highlight")
    assert.notEqual(d.badge, LIME, "count badges are neutral"); assert.ok(!d.fit.includes("216, 255, 62"), "Good fit is not lime")
    assert.deepEqual(d.steps.slice(0, 4), ["42px", "999px", 0, 0], "the steps: one 42 px segmented control"); assert.equal(d.steps[4], "rgba(255, 255, 255, 0.11)")
    assert.deepEqual(d.grid, ["grid", "24px", "40px", "14px"], "prospects: a grid of large captures, gaps 24 × 40, radius 14")
    assert.deepEqual(d.input, ["20px", "10px"], "the ask bar 20, buttons 10")
    // the hover colour of the primary
    await page.hover("#findBtn"); await page.waitForTimeout(200)
    assert.equal(await page.$eval("#findBtn", (e) => getComputedStyle(e).backgroundColor), "rgb(229, 255, 112)")
    // disabled is a state, not a faded lime
    // measured in one synchronous step (a live re-render may re-enable the button between two awaits)
    await page.mouse.move(0, 400); await page.waitForTimeout(200)
    const dis = await page.$eval("#findBtn", (b) => { const btn = b as HTMLButtonElement; btn.style.transition = "none"; btn.disabled = true; const c = getComputedStyle(btn); const r = [c.opacity, c.backgroundColor, c.color]; btn.disabled = false; btn.style.transition = ""; return r })
    assert.equal(dis[0], "1"); assert.notEqual(dis[1], LIME); assert.equal(dis[2], "rgb(96, 96, 106)")
    // an error toast is readable and sits at the top, under the header, clear of the header's controls and of the cards' buttons
    await page.evaluate(() => { const t = document.createElement("div"); t.className = "toast bad"; t.textContent = "Could not start the build: the agency is stopped"; document.querySelector("#toasts")!.appendChild(t) })
    const toast = await page.$eval("#toasts .toast.bad", (e) => { const c = getComputedStyle(e); return [c.backgroundColor, c.color, c.borderTopColor] })
    assert.deepEqual(toast, ["rgb(42, 17, 19)", "rgb(255, 180, 180)", "rgba(255, 107, 107, 0.35)"])
    const tr = await rectOf(page, "#toasts .toast.bad")
    assert.ok(tr.t >= 60 && tr.t <= 160, `at the top, under the header (${JSON.stringify(tr)})`)
    for (const s of ["#steps", "#cagePill", "#menuBtn", "#findBtn"]) assert.ok(!overlap(tr, await rectOf(page, s)), `the toast covers ${s}`)
    for (const b of await page.$$("#plist .pc .foot .btn")) { const r = await b.boundingBox(); if (r) assert.ok(!overlap(tr, { t: r.y, l: r.x, b: r.y + r.height, r: r.x + r.width }), "the toast covers a card's button") }
    // the menu: icons, a separator, 8 px padding, a shadow
    await page.click("#menuBtn")
    const menu = await page.$eval("#menuDrop", (e) => { const c = getComputedStyle(e); return { hr: e.querySelectorAll("hr").length, icons: e.querySelectorAll("a svg.ic").length, pad: c.paddingTop, shadow: c.boxShadow, radius: c.borderTopLeftRadius } })
    assert.equal(menu.hr, 1); assert.equal(menu.icons, 4); assert.equal(menu.pad, "8px"); assert.notEqual(menu.shadow, "none"); assert.equal(menu.radius, "14px")
    await page.keyboard.press("Escape")
    assert.deepEqual(await smallText(page, "#v-prospects, header.top"), [], "no small sans text on Prospects")
    assert.deepEqual(errors, [])
  } finally { await close() }
})

test("layout: Prospects shows a row of four large captures at 1440 × 900 ; at 390 one header row, the tab bar, the gutter 16, nothing off screen", { timeout: 150_000 }, async () => {
  // enough prospects to measure the density (the agency's own search, simulated)
  if ((await (await fetch(run.url + "/api/prospects")).json()).items.length < 12) {
    const r = await post("/api/prospects/find", { text: "20 plumbers around Austin" })
    assert.ok(r.ok || r.duplicate, JSON.stringify(r))
    for (let i = 0; i < 120; i++) { const j = (await (await fetch(run.url + "/api/jobs")).json()).jobs; if (!j.some((x: any) => x.mode === "find" && (x.status === "queued" || x.status === "running"))) break; await new Promise((ok) => setTimeout(ok, 500)) }
  }
  const { page, errors, close } = await open(1440, 900, "/#prospects")
  try {
    await page.waitForFunction(() => document.querySelectorAll("#plist .pc").length >= 12, null, { timeout: 30_000 })
    // the studio : the previews are the product, four large captures a row (their site today at 300 px and more)
    const seen = await page.$$eval("#plist .pc", (els) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight }).length)
    assert.ok(seen >= 4, `${seen} prospects fully in view at 1440 × 900`)
    assert.ok((await rectOf(page, "#plist .pc .thumb")).w >= 300, "a large capture")
    // every card: name, status, one action line ; Good fit first among the reasons
    // a card: what it is and why on the right of the capture, who to call and what to do on one line under both
    const c = await page.$eval("#plist .pc.new", (e) => { const f = e.querySelector(".foot")!.getBoundingClientRect(), t = e.querySelector(".thumb")!.getBoundingClientRect(); return { build: !!e.querySelector(".foot [data-build]"), under: f.top >= t.bottom, full: f.left <= t.left + 1 } })
    assert.deepEqual(c, { build: true, under: true, full: true })
    assert.deepEqual(errors, [])
  } finally { await close() }
  const m = await open(390, 844, "/#prospects")
  try {
    await m.page.waitForSelector("#plist .pc", { timeout: 20_000 })
    assert.equal((await rectOf(m.page, "header.top")).h, 56, "one row: brand · pill · menu")
    const st = await rectOf(m.page, "#steps")
    assert.deepEqual([st.l, st.w, st.b], [0, 390, 844], "the steps are the tab bar, at the bottom")
    assert.equal((await rectOf(m.page, "#plist .pc")).l, 16, "16 px page gutter")
    const ask = await rectOf(m.page, "#findForm"); assert.equal(ask.h, 56, "the ask bar keeps its height on a phone")
    assert.ok(await m.page.evaluate(() => document.documentElement.scrollWidth <= 390))
    const off = await m.page.$$eval("#v-prospects *, header.top *", (els) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.width && !e.closest(".bar") && (r.right > innerWidth + 1 || r.left < -1) }).length)
    assert.equal(off, 0, "nothing off screen")
    assert.deepEqual(await smallText(m.page, "#v-prospects, header.top"), [])
    assert.deepEqual(m.errors, [])
  } finally { await m.close() }
})

test("Sites: the filmstrip says name, a 6 px state dot and a date ; Before and Compare are framed pages, two aligned halves", { timeout: 90_000 }, async () => {
  const { page, errors, close } = await open(1440, 900, "/#sites")
  try {
    await page.waitForFunction(() => document.querySelectorAll("#rail .card").length >= 2, null, { timeout: 20_000 })
    const card = await page.$eval("#rail .card", (e) => ({ first: e.querySelector(".row1 > *")!.className, dot: [getComputedStyle(e.querySelector(".sdot")!).width, getComputedStyle(e.querySelector(".sdot")!).height], when: e.querySelector(".when")!.textContent || "", said: e.querySelector(".sr")!.textContent || "", chips: e.querySelectorAll(".chip").length }))
    assert.equal(card.first, "name", "the name comes first"); assert.deepEqual(card.dot, ["6px", "6px"]); assert.equal(card.chips, 0, "no status chip in the rail")
    assert.match(card.when, /^(Today|Yesterday|\d days ago|\d{1,2} \w{3}|\w{3} \d{1,2})$/, card.when)
    assert.match(card.said, /Waiting for you|In outreach|Skipped|Building|Old|Won|Lost/)
    // the studio (round 3) : lime means « needs you » : waiting for you = a lime dot, won = mint, nothing else lime
    const dots = await page.$$eval("#rail .card", (els) => els.map((e) => [e.querySelector(".sr")!.textContent, getComputedStyle(e.querySelector(".sdot")!).backgroundColor]))
    for (const [said, bg] of dots) {
      if (said === "Waiting for you" || said === "Building") assert.equal(bg, LIME, `${said}: ${bg}`)
      else assert.notEqual(bg, LIME, `${said}: no lime`)
      if (said === "Won") assert.equal(bg, "rgb(126, 224, 129)", `${said}: ${bg}`)
    }
    const built = await page.$$eval("#rail .card", (els) => (els.find((e) => !/Building/.test(e.querySelector(".sr")!.textContent || "")) as HTMLElement).dataset.id!)
    await page.click(`#rail .card[data-id="${built}"]`)
    await page.click('#viewmode a[data-v="before"]'); await page.waitForSelector("#before:not([hidden]) img")
    assert.equal(await page.$eval("#before", (e) => getComputedStyle(e).backgroundColor), "rgb(12, 12, 15)")
    assert.equal(await page.$eval("#before img", (e) => getComputedStyle(e).borderTopLeftRadius), "12px")
    await page.click('#viewmode a[data-v="compare"]'); await page.waitForSelector("#compare:not([hidden]) .half.r iframe")
    await page.waitForTimeout(300)
    const [l, rr, f, fr] = [await rectOf(page, "#compare .half.l .sc"), await rectOf(page, "#compare .half.r .sc"), await rectOf(page, "#compare .half.r iframe"), await rectOf(page, "#frame")]
    const cmp = { bg: await page.$eval("#compare", (e) => getComputedStyle(e).backgroundColor), l: [l.t, l.w, l.h], r: [rr.t, rr.w, rr.h], fw: f.w, radius: await page.$eval("#compare .half.l .sc", (e) => getComputedStyle(e).borderTopLeftRadius), mid: (l.r + rr.l) / 2, frame: (fr.l + fr.r) / 2 }
    assert.equal(cmp.bg, "rgba(0, 0, 0, 0)", "the two frames stand on the stage"); assert.equal(cmp.radius, "12px")
    assert.deepEqual(cmp.l, cmp.r, "the two halves: same top, same size")
    assert.ok(Math.abs(cmp.fw - cmp.r[1]) < 2, `the new site is scaled to its half (${cmp.fw} vs ${cmp.r[1]})`)
    assert.ok(Math.abs(cmp.mid - cmp.frame) < 2, "centred")
    // a phone width: two 390 px columns, centred
    await page.click('#vpsel a[data-w="390"]'); await page.waitForTimeout(300)
    const nar = await page.evaluate(() => [document.querySelector("#compare .half.l .sc")!.getBoundingClientRect().width, document.querySelector("#compare .half.r iframe")!.getBoundingClientRect().width])
    assert.deepEqual(nar.map(Math.round), [390, 390])
    await page.click('#vpsel a[data-w="full"]'); await page.click('#viewmode a[data-v="after"]')
    assert.deepEqual(await smallText(page, "#v-sites"), [])
    assert.deepEqual(errors, [])
  } finally { await close() }
})

test("Outreach on a phone: one list (no hidden board), a stage picker ; the call panel's meeting chips (Tomorrow 10:00 AM, …, Pick…) book in one click", { timeout: 120_000 }, async () => {
  const m = await open(390, 844, "/#outreach")
  try {
    await m.page.waitForSelector("#mlist .kcard", { timeout: 20_000 })
    assert.equal(await m.page.$$eval("#board .kcard", (e) => e.length), 0, "the board is not in the page on a phone")
    assert.equal(await m.page.$$eval(".kcard", (els) => els.filter((e) => (e as HTMLElement).offsetParent === null).length), 0, "no hidden cards")
    const picks = await m.page.$$eval("#mstages [data-ms]", (els) => els.map((e) => (e as HTMLElement).dataset.ms!))
    if (picks.length > 2) {
      await m.page.click(`#mstages [data-ms="${picks[1]}"]`)
      assert.equal(await m.page.$$eval("#mlist h3", (e) => e.length), 1, "one step shown")
      assert.equal(await m.page.$eval(`#mstages [data-ms="${picks[1]}"]`, (e) => e.getAttribute("aria-pressed")), "true")
      await m.page.click('#mstages [data-ms=""]')
      assert.equal(await m.page.$$eval("#mlist h3", (e) => e.length), picks.length - 1, "All again")
    }
    assert.deepEqual(await smallText(m.page, "#v-outreach"), [])
    assert.deepEqual(m.errors, [])
  } finally { await m.close() }
  const { page, errors, close } = await open(1440, 900, "/#outreach")
  try {
    await page.waitForSelector("#board .kcard", { timeout: 20_000 })
    assert.equal(await page.$eval("#mlist", (e) => e.children.length), 0, "a wide screen: the board only")
    const crm = await (await fetch(run.url + "/api/crm")).json()
    const lead = (crm.hot.call0 || [])[0] || (crm.hot.relance1 || [])[0]
    if (!lead) return
    await page.click(`#board .kcard[data-id="${lead.id}"]`); await page.waitForSelector("#lead:not([hidden]) [data-o='meeting']")
    assert.equal(await page.$eval("#lead .sect .lbl", (e) => [getComputedStyle(e).fontSize, getComputedStyle(e).fontWeight].join(" ")), "15px 600", "section titles, not tiny grey labels")
    assert.ok(await page.$$eval("#lead .btn.primary", (e) => e.length) <= 1, "one lime action in the panel at most: the call")
    await page.click("#lead [data-o='meeting']")
    const chips = await page.$$eval("#lQuick .btn", (e) => e.map((x) => x.textContent || ""))
    assert.equal(chips.length, 3); assert.equal(chips[2], "Pick a day")
    for (const c of chips.slice(0, 2)) assert.match(c, /^(Tomorrow|In 2 days|Monday|Tuesday|Wednesday|Thursday|Friday) \d{1,2}:00\s(AM|PM)( [A-Z][A-Za-z0-9+:-]{1,8})?$/, c) // the time zone said after the time
    assert.equal(await page.$eval("#lPick", (e) => (e as HTMLElement).hidden), true, "the date field waits for « Pick… »")
    await page.click("#lPickBtn"); assert.equal(await page.$eval("#lPick", (e) => (e as HTMLElement).hidden), false)
    const t = Number(await page.$eval("#lQuick [data-t]", (e) => (e as HTMLElement).dataset.t))
    // audit round 2: 10:00 on the AGENCY's clock (its time zone), whatever the browser's (here UTC on a server)
    const tz = (await (await fetch(run.url + "/api/agency")).json()).timezone
    const onAgency = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: tz, ...o }).format(new Date(t))
    assert.equal(onAgency({ hour: "numeric", hour12: false }), "10", `10:00 in ${tz}`)
    assert.ok(!["Sat", "Sun"].includes(onAgency({ weekday: "short" })), "a working day")
    assert.match(chips[0], new RegExp(` (${onAgency({ timeZoneName: "short" }).split(" ").pop()})$`), "the chip names the agency's zone")
    await page.click("#lQuick [data-t]")
    await page.waitForFunction(() => /Meeting booked/.test(document.querySelector("#toasts")!.textContent || ""), null, { timeout: 10_000 })
    const after = await (await fetch(run.url + "/api/crm")).json()
    const moved = [...Object.values(after.hot), ...Object.values(after.closing)].flat().find((l: any) => l.id === lead.id) as any
    assert.equal(moved && moved.rdvAt && new Date(moved.rdvAt).getTime(), t, "booked at the chip's time")
    assert.deepEqual(await smallText(page, "#lead"), [])
    assert.deepEqual(errors, [])
  } finally { await close() }
})

test("billing reads the cockpit's tokens and type (no fork)", { timeout: 60_000 }, async () => {
  const html = await (await fetch(run.url + "/billing.html")).text()
  const style = (/<style>([\s\S]*?)<\/style>/.exec(html) || [])[1] || ""
  assert.match(html, /<link rel="stylesheet" href="\/app\.css">/)
  assert.doesNotMatch(style, /--[a-z0-9-]+\s*:|@font-face|Space Grotesk|#[0-9a-f]{3,6}\b/i, "no token, font or colour of its own")
  const { page, errors, close } = await open(1440, 900, "/billing.html")
  try {
    await page.waitForSelector("#save")
    const b = await page.evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.body).fontFamily.split(",")[0].replace(/"/g, ""), getComputedStyle(document.querySelector(".tabs")!).borderTopLeftRadius, getComputedStyle(document.querySelector("#save")!).backgroundColor])
    assert.deepEqual(b, ["rgb(9, 9, 11)", "Host Grotesk", "999px", LIME])
    assert.deepEqual(await smallText(page, "main, header"), [])
    assert.deepEqual(errors, [])
  } finally { await close() }
})

test("a second `npm run sandbox` is refused with the running URL", { timeout: 120_000 }, async () => {
  // the running marker is written by the CLI run only (not by --check) : simulate it
  const { writeFileSync, mkdirSync } = await import("node:fs")
  mkdirSync(join(process.cwd(), ".sandbox"), { recursive: true })
  const before = readdirSync(join(process.cwd(), ".sandbox")).filter((f) => f !== ".running")
  writeFileSync(join(process.cwd(), ".sandbox", ".running"), JSON.stringify({ pid: process.pid, url: run.url, dir: run.dir }))
  try {
    const r = await tsx(process.cwd(), "scripts/sandbox.ts", ["--quiet"], { timeoutMs: 30_000 })
    assert.notEqual(r.code, 0)
    assert.match(r.out, new RegExp(`already running at ${run.url.replace(/[.]/g, "\\.")}`))
    assert.deepEqual(readdirSync(join(process.cwd(), ".sandbox")).filter((f) => f !== ".running"), before, "refused before building a folder")
    assert.ok(existsSync(join(run.dir, ".lws-sandbox")), "the live sandbox is untouched")
  } finally { rmSync(join(process.cwd(), ".sandbox", ".running"), { force: true }) }
})

/* ── Round 1 of the stranger audits (2026-11-06) : what they broke, fixed and locked ── */
const jobsNow = async () => (await (await fetch(run.url + "/api/jobs")).json()).jobs as any[]
const idle = async (mode: string, ms = 90_000) => { for (let i = 0; i < ms / 500; i++) { if (!(await jobsNow()).some((j) => j.mode === mode && (j.status === "queued" || j.status === "running"))) return; await new Promise((r) => setTimeout(r, 500)) } throw new Error(`${mode} still running`) }

test("Find searches the text in the field, never the chips of an earlier text ; a foreign city is its own country, said", { timeout: 120_000 }, async () => {
  const { page, errors, close } = await open(1440, 900, "/#prospects")
  try {
    await page.waitForSelector("#plist .pc", { timeout: 20_000 })
    await idle("find")
    const finds: any[] = []
    page.on("request", (r) => { if (r.url().includes("/api/prospects/find")) finds.push(JSON.parse(r.postData() || "{}")) })
    // the chips of a first text are shown…
    await page.fill("#findText", "6 carpenters in Dijon")
    await page.waitForFunction(() => /Dijon/.test(document.querySelector("#briefChips")!.textContent || ""), null, { timeout: 5_000 })
    // …a US agency asking for Dijon is told where that is, and the search runs there (France)
    assert.match(await page.$eval("#briefChips", (e) => e.textContent || ""), /Dijon is in France, not United States/)
    // then another text, sent at once (before its 400 ms preview) : the old chips dim, the NEW text is what is searched
    await page.fill("#findText", "7 painters in Metz"); await page.press("#findText", "Enter")
    for (let i = 0; i < 40 && !finds.length; i++) await page.waitForTimeout(250)
    assert.equal(finds.length, 1, JSON.stringify(finds))
    const sent = finds[0]
    assert.ok(sent.text === "7 painters in Metz" || (sent.brief === "7 painters in Metz" && (sent.trades || []).includes("peintre") && /Metz/.test(sent.place || "")), JSON.stringify(sent))
    await page.waitForFunction(() => !document.querySelector("#findBtn.loading"), null, { timeout: 10_000 })
    assert.doesNotMatch(await page.$eval("#toasts", (e) => e.textContent || ""), /Already looking for that/, "another text is another search")
    const job = (await jobsNow()).find((j) => j.mode === "find" && /Metz/.test(j.params?.place || ""))
    assert.ok(job && job.params.trades.includes("peintre") && job.params.country === "FR", JSON.stringify(job))
    assert.match(await page.$eval("#briefChips", (e) => e.textContent || ""), /Metz/)
    assert.doesNotMatch(await page.$eval("#briefChips", (e) => e.textContent || ""), /Carpenter|Dijon/, "no chip of the earlier text under the new one")
    await idle("find")
    assert.deepEqual(errors, [])
  } finally { await close() }
})

test("Lost asks first and leaves the board (never « Nurturing ») ; it comes back from « N lost » ; the call panel closes when you change view", { timeout: 120_000 }, async () => {
  const { page, errors, close } = await open(1440, 900, "/#outreach")
  try {
    await page.waitForSelector("#board .kcard", { timeout: 20_000 })
    const crm = await (await fetch(run.url + "/api/crm")).json()
    assert.ok(Array.isArray(crm.lost), "a Lost list of its own")
    assert.ok(!(crm.hot.nurturing || []).some((l: any) => crm.lost.some((x: any) => x.id === l.id)), "a lost lead is not in Nurturing")
    const lead = [...["call0", "relance1", "relance2", "relance3", "nurturing"].flatMap((k) => crm.hot[k] || []), ...["demo", "propal", "nego"].flatMap((k) => crm.closing[k] || [])][0]
    assert.ok(lead, "a lead on the board")
    await page.click(`#board .kcard[data-id="${lead.id}"]`); await page.waitForSelector("#lead:not([hidden]) [data-o='lost']")
    await page.click("#lead [data-o='lost']"); await page.waitForSelector("#sheet:not([hidden]) #askOk")
    assert.match(await page.$eval("#sheetTitle", (e) => e.textContent || ""), /Mark .* as lost\?/, "Lost asks first, even on a fresh lead")
    await page.click("#askNo"); await page.waitForTimeout(300)
    assert.ok(!(await (await fetch(run.url + "/api/crm")).json()).lost.some((x: any) => x.id === lead.id), "dismissed → nothing recorded")
    await page.click("#lead [data-o='lost']"); await page.waitForSelector("#sheet:not([hidden]) #askOk"); await page.click("#askOk")
    await page.waitForFunction(() => /Marked lost/.test(document.querySelector("#toasts")!.textContent || ""), null, { timeout: 10_000 })
    const after = await (await fetch(run.url + "/api/crm")).json()
    assert.ok(after.lost.some((x: any) => x.id === lead.id), "in Lost")
    assert.ok(!Object.values(after.hot).flat().some((x: any) => x.id === lead.id), "off the call steps, Nurturing included")
    // a view change closes the call panel (it is a dialog over the board, never over Sites)
    await page.click('#steps a[data-v="sites"]'); await page.waitForFunction(() => (document.querySelector("#lead") as HTMLElement).hidden, null, { timeout: 5_000 })
    await page.click('#steps a[data-v="outreach"]'); await page.waitForSelector("#showLost", { timeout: 10_000 })
    await page.click("#showLost"); await page.waitForSelector(`#board .kcard[data-id="${lead.id}"] [data-unlose]`)
    assert.equal(await page.$eval("#board .colhead span", (e) => e.textContent), "Lost")
    await page.click(`#board [data-unlose="${lead.id}"]`)
    await page.waitForFunction(() => /back on your call list/.test(document.querySelector("#toasts")!.textContent || ""), null, { timeout: 10_000 })
    assert.ok(((await (await fetch(run.url + "/api/crm")).json()).hot.call0 || []).some((x: any) => x.id === lead.id))
    assert.deepEqual(errors, [])
  } finally { await close() }
})

test("Stop halts a running build between two sites ; Ask refuses an unknown lead and an email to someone who unsubscribed, before any model call", { timeout: 150_000 }, async () => {
  await idle("composer")
  const p = (await (await fetch(run.url + "/api/prospects")).json()).items.filter((x: any) => x.status === "new").slice(0, 3)
  if (p.length < 3) return
  const r = await post("/api/batch", { mode: "composer", ids: p.map((x: any) => x.id), limit: 3, note: "audit: stop mid-batch" })
  assert.ok(r.ok, JSON.stringify(r))
  // the first site lands, then Stop
  let built = 0
  for (let i = 0; i < 120 && !built; i++) { built = (await (await fetch(run.url + "/api/sites")).json()).filter((s: any) => p.some((x: any) => x.id === s.id)).length; if (!built) await new Promise((ok) => setTimeout(ok, 500)) }
  assert.ok(built >= 1, "the first site landed")
  await post("/api/cage/stop", { on: true, reason: "audit" })
  try {
    for (let i = 0; i < 60; i++) { const j = (await jobsNow()).find((x) => x.id === r.id); if (!j || j.status === "done" || j.status === "error") break; await new Promise((ok) => setTimeout(ok, 500)) }
    const ended = (await (await fetch(run.url + "/api/batches")).json()).batches.find((b: any) => b.id === r.id)
    assert.equal(ended.status, "done")
    const after = (await (await fetch(run.url + "/api/sites")).json()).filter((s: any) => p.some((x: any) => x.id === s.id)).length
    assert.ok(after < 3, `Stop ended the batch: ${after} of 3 built`)
    assert.equal((await fetch(run.url + "/api/crm/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: p[0].id, ask: "a call angle" }) })).status, 409, "no model call while stopped")
  } finally { await post("/api/cage/stop", { on: false }) }
  const ask = (b: unknown) => fetch(run.url + "/api/crm/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) })
  assert.equal((await ask({ id: "no-such-lead", ask: "hi" })).status, 404)
  const out = (await (await fetch(run.url + "/api/crm")).json())
  const opted = [...Object.values(out.hot).flat(), ...Object.values(out.closing).flat(), ...out.lost].find((l: any) => l.optOut) as any
  if (opted) {
    const no = await ask({ id: opted.id, ask: "write a follow-up email" })
    assert.equal(no.status, 409); assert.match((await no.json()).error, /unsubscribed|spam/)
    assert.equal((await ask({ id: opted.id, ask: "a call angle" })).status, 200, "a call angle is still fine")
  }
})

test("the cockpit opens on the product (no form wall) with one line saying it is a demo ; Sites on a phone fits the screen and shows a phone ; Desktop is a desktop", { timeout: 120_000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage(); const errors: string[] = []
  page.on("pageerror", (e) => errors.push(String(e)))
  try {
    await page.goto(run.url + "/#sites", { waitUntil: "load" })
    await page.waitForSelector("#demoBar:not([hidden])", { timeout: 10_000 })
    assert.match(await page.$eval("#demoBar", (e) => e.textContent || ""), /Demo agency: every business here is fictional/)
    await page.waitForTimeout(800)
    assert.equal(await page.$eval("#sheet", (e) => (e as HTMLElement).hidden), true, "no modal over the product")
    await page.click("#demoBarX"); assert.equal(await page.$eval("#demoBar", (e) => (e as HTMLElement).hidden), true)
    await page.reload({ waitUntil: "load" }); await page.waitForTimeout(800)
    assert.equal(await page.$eval("#demoBar", (e) => (e as HTMLElement).hidden), true, "dismissed stays dismissed")
    // Desktop : the site laid out at 1440 and scaled into the frame (never its tablet layout at 850 px)
    await page.waitForFunction(() => document.querySelectorAll("#rail .card").length >= 1, null, { timeout: 20_000 })
    const built = await page.$$eval("#rail .card", (els) => (els.find((e) => !/Building/.test(e.querySelector(".sr")!.textContent || "")) as HTMLElement).dataset.id!)
    await page.click(`#rail .card[data-id="${built}"]`); await page.waitForTimeout(400)
    const pv = await page.$eval("#preview", (f) => [getComputedStyle(f).width, getComputedStyle(f).transform])
    assert.equal(pv[0], "1440px"); assert.match(pv[1], /^matrix\(0\.\d+/, `scaled down: ${pv[1]}`)
  } finally { await ctx.close() }
  assert.deepEqual(errors, [])
  const m = await open(390, 844, "/#sites")
  try {
    await m.page.waitForFunction(() => document.querySelectorAll("#rail .card").length >= 1, null, { timeout: 20_000 })
    await m.page.waitForTimeout(400)
    assert.ok(await m.page.evaluate(() => document.documentElement.scrollWidth <= 390 && document.body.scrollWidth <= 390), `page ${await m.page.evaluate(() => document.documentElement.scrollWidth)} px wide at 390`)
    assert.equal(await m.page.$eval('#vpsel a[data-w="390"]', (e) => e.getAttribute("aria-pressed")), "true", "a phone shows the site as a phone")
    const open_ = await rectOf(m.page, "#openTab"); assert.ok(open_.r <= 390, `Open is on screen (${open_.r})`)
    const view = await rectOf(m.page, "#view"); assert.ok(view.h >= 400, `the preview is the page (${view.h} px tall)`)
    const ap = await rectOf(m.page, "#approve"); assert.ok(ap.b <= 844 && ap.t >= 700, "Send to outreach stays in reach")
    assert.deepEqual(m.errors, [])
  } finally { await m.close() }
})

/* ── Round 2 of the stranger audits (2026-11-07) : what they broke, fixed and locked ── */
const crmNow = async () => (await (await fetch(run.url + "/api/crm")).json()) as any
const leadsOf = (c: any) => [...Object.values(c.hot || {}).flat(), ...Object.values(c.closing || {}).flat()] as any[]
const send = (p: string, b: unknown, method = "POST") => fetch(run.url + p, { method, headers: { "content-type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) })

test("round 2: a US demo studio is an American cast (won client, call list, sites, script in English), never the French one", { timeout: 90_000 }, async () => {
  const FRENCH = /Orvane|Lumeo|Brisane|Quillanne|Fréhaut|Aubrelle|Vélisande|Doralis/
  const won = (await (await fetch(run.url + "/api/won")).json()).won as any[]
  assert.ok(won.length >= 1 && won.every((w) => /Austin, TX 787\d\d/.test(w.address) && !FRENCH.test(w.name)), JSON.stringify(won))
  const c = await crmNow()
  assert.ok(leadsOf(c).length && leadsOf(c).every((l) => !FRENCH.test(l.name) && !/^0\d /.test(l.phone || "")), leadsOf(c).map((l) => `${l.name} ${l.phone}`).join(" | "))
  const sites = (await (await fetch(run.url + "/api/sites")).json()) as any[]
  assert.ok(sites.length >= 2 && sites.every((s) => !FRENCH.test(s.name || s.id)), sites.map((s) => s.id).join(", "))
  const { page, errors, close } = await open(1440, 900, "/#outreach")
  try {
    const call = (c.hot.call0 || [])[0]
    if (call) {
      await page.click(`#board .kcard[data-id="${call.id}"]`); await page.waitForSelector("#lead:not([hidden]) .script")
      const script = await page.$eval("#lcontent", (e) => e.textContent || "")
      assert.match(script, /^Hi, this is \w+ from /, script)
      assert.doesNotMatch(script, /Bonjour|Si oui|calez/, "spoken and coaching lines in English for an Austin business")
      assert.doesNotMatch(script, /plumber businesses|roofer businesses/, "a trade's plural")
    }
    assert.deepEqual(errors, [])
  } finally { await close() }
})

test("round 2: no email → Ask gives a call angle and says so ; a follow-up never pretends an email went out ; a demo answer says it is one", { timeout: 90_000 }, async () => {
  const c = await crmNow()
  const noMail = leadsOf(c).find((l) => !l.email && l.phone && l.pipeline === "hot")
  if (!noMail) return
  const r = await (await send("/api/crm/ask", { id: noMail.id, ask: "A follow-up email mentioning the new mobile site" })).json()
  assert.equal(r.ok, true); assert.equal(r.simulated, true)
  assert.match(r.note, new RegExp(`No email address for ${noMail.name}: here is a call angle instead`))
  assert.match(r.text, /^Angle/); assert.doesNotMatch(r.text, /^(Subject|Objet)/, "never an email nobody can receive")
  // its follow-up call : no « make sure you saw it » when nothing was sent
  const back = noMail.stage
  await send("/api/crm/stage", { id: noMail.id, pipeline: "hot", stage: "relance1" })
  const { page, errors, close } = await open(1440, 900, "/#outreach")
  try {
    await page.waitForSelector(`#board .kcard[data-id="${noMail.id}"]`, { timeout: 20_000 })
    await page.click(`#board .kcard[data-id="${noMail.id}"]`); await page.waitForSelector("#lead:not([hidden]) .script")
    const script = await page.$eval("#lcontent", (e) => e.textContent || "")
    assert.match(script, /I tried to reach you a few days ago/); assert.doesNotMatch(script, /make sure you saw it|my email/)
    // the panel : a scrim behind it, one emphasised footer action, the note saved by its own icon
    assert.equal(await page.$eval("#leadScrim", (e) => (e as HTMLElement).hidden), false)
    assert.equal(await page.$$eval("#lead .lfoot .btn.solid", (e) => e.length), 1)
    assert.ok(await page.$("#lead .notewrap [data-o='note']"))
    await page.fill("#askText", "a follow-up email"); await page.click("#askGo"); await page.waitForSelector("#lead .answer .out", { timeout: 10_000 })
    assert.match(await page.$eval("#lead .answer", (e) => e.textContent || ""), /here is a call angle instead/)
    await page.click("#leadScrim", { position: { x: 120, y: 300 } }); await page.waitForSelector("#lead", { state: "hidden" })
    assert.deepEqual(errors, [])
  } finally { await close(); await send("/api/crm/stage", { id: noMail.id, pipeline: "hot", stage: back || "call0" }) }
})

test("round 2: one job per site (never paid twice) and never a build for a prospect that does not exist", { timeout: 120_000 }, async () => {
  await idle("composer")
  const ghost = await send("/api/batch", { mode: "composer", ids: ["does-not-exist"], limit: 1 })
  assert.equal(ghost.status, 404); assert.match((await ghost.json()).error, /Not a prospect of this agency: does-not-exist/)
  assert.ok(!((await (await fetch(run.url + "/api/sites")).json()) as any[]).some((s) => s.id === "does-not-exist"), "no site for no one")
  const site = ((await (await fetch(run.url + "/api/sites")).json()) as any[]).find((s) => s.hasIndex !== false && !["lost", "signature"].includes(s.crmStage))
  assert.ok(site)
  const first = await (await send("/api/batch", { mode: "composer", ids: [site.id], limit: 1, force: true, note: "audit r2: rebuild" })).json()
  assert.equal(first.ok, true, JSON.stringify(first))
  const again = await send("/api/batch", { mode: "composer", ids: [site.id], limit: 1, force: true })
  assert.equal(again.status, 409); assert.match((await again.json()).error, /is already being built/)
  const apply = await send("/api/refill", { id: site.id, date: site.date })
  assert.equal(apply.status, 409, "feedback while it is being rebuilt waits")
  const { page, errors, close } = await open(1440, 900, "/#sites")
  try {
    await page.waitForSelector(`#rail .card[data-id="${site.id}"]`, { timeout: 20_000 })
    await page.click(`#rail .card[data-id="${site.id}"]`)
    const st = await page.$eval("#rebuild", (b) => [(b as HTMLButtonElement).disabled, b.getAttribute("title") || ""])
    const busyNow = (await jobsNow()).some((j) => j.id === first.id && (j.status === "queued" || j.status === "running"))
    if (busyNow) { assert.equal(st[0], true); assert.match(String(st[1]), /Being built|Still building/) }
    assert.deepEqual(errors, [])
  } finally { await close() }
  await idle("composer")
})

test("round 2: invoices: never a number spent on nothing, one credit note per invoice, only the last draft deleted ; Billing has the cockpit's header and cards on a phone", { timeout: 120_000 }, async () => {
  // your own details (the demo studio's never count)
  await send("/api/invoice-settings", { name: "Lone Star Web Studio", address: "1100 Congress Ave, Austin, TX 78701", email: "hello@lonestar.example" })
  const inv = (items: any[]) => ({ client: { name: "Ridgeway Roofing" }, items, vatRate: 0 })
  for (const [items, why] of [[[{ label: "Website", qty: 1, unitPrice: 0 }], /total is zero/], [[{ label: "Website", qty: 1, unitPrice: "Infinity" }], /must be numbers/], [[{ label: "Website", qty: 1e300, unitPrice: 1e300 }], /looks like a typo/]] as const) {
    const r = await send("/api/invoices", inv(items as any)); assert.equal(r.status, 400); assert.match((await r.json()).error, why)
  }
  const a = await (await send("/api/invoices", inv([{ label: "Website", qty: 1, unitPrice: 1500 }]))).json()
  assert.ok(a.number, JSON.stringify(a))
  await send(`/api/invoices/${a.id}`, { status: "sent" })
  const c1 = await send(`/api/invoices/${a.id}/avoir`, {}); assert.equal(c1.status, 200)
  const cn = await c1.json()
  const c2 = await send(`/api/invoices/${a.id}/avoir`, {}); assert.equal(c2.status, 409, "a second credit note is refused")
  assert.match((await c2.json()).error, new RegExp(`already cancelled by credit note ${cn.number}`))
  const listed = ((await (await fetch(run.url + "/api/invoices")).json()) as any[]).find((i) => i.number === a.number)
  assert.equal(listed.cancelledBy, cn.number)
  const d1 = await (await send("/api/invoices", inv([{ label: "Deposit", qty: 1, unitPrice: 300 }]))).json()
  const d2 = await (await send("/api/invoices", inv([{ label: "Balance", qty: 1, unitPrice: 700 }]))).json()
  const early = await send(`/api/invoices/${d1.id}`, undefined, "DELETE"); assert.equal(early.status, 409)
  assert.match((await early.json()).error, /Only the last invoice/)
  assert.equal((await send(`/api/invoices/${d2.id}`, undefined, "DELETE")).status, 200)
  assert.equal((await send(`/api/invoices/${d1.id}`, undefined, "DELETE")).status, 200, "now the last one")
  const sent = await send(`/api/invoices/${a.id}`, undefined, "DELETE"); assert.equal(sent.status, 409, "a sent invoice is never deleted")
  // the printed invoice carries YOUR details ; in the demo it says it is a demo invoice (its studio is fictional)
  const html = await (await fetch(run.url + `/invoice/${a.id}`)).text()
  assert.match(html, /Lone Star Web Studio/); assert.match(html, /1100 Congress Ave/)
  assert.match(html, /Demo invoice: a fictional business and a fictional client/); assert.match(html, /← Back to Billing/); assert.match(html, /name="viewport"/)
  const m = await open(390, 844, "/billing.html")
  try {
    // the cockpit's header (its demo line too, hidden here like the cockpit's own once dismissed)
    for (const s of ["#cagePill .short", "#menuBtn", "#steps"]) await m.page.waitForSelector(s, { timeout: 10_000 })
    await m.page.waitForSelector("#demoBar", { state: "attached" })
    assert.match(await m.page.$eval("#cagePill .label2", (e) => e.textContent || ""), /^\d+ of \d+ builds today$/)
    assert.match(await m.page.$eval("#cagePill", (e) => e.getAttribute("href") || ""), /#status$/)
    await m.page.click('.tabs [data-v="list"]'); await m.page.waitForSelector("#inv-rows tr.rowline")
    assert.ok(await m.page.evaluate(() => document.documentElement.scrollWidth <= 390), `billing at 390: ${await m.page.evaluate(() => document.documentElement.scrollWidth)} px`)
    const row = await m.page.$eval(`#inv-rows tr.rowline:has(td b)`, () => true)
    assert.ok(row)
    const cancelled = await m.page.$$eval("#inv-rows tr.rowline", (rows, n) => { const r = rows.find((x) => x.querySelector("b")?.textContent === n); return r ? [r.textContent || "", !!r.querySelector("[data-av]")] : null }, a.number)
    assert.ok(cancelled && /Cancelled by/.test(String(cancelled[0])) && cancelled[1] === false, JSON.stringify(cancelled))
    assert.deepEqual(m.errors, [])
  } finally { await m.close() }
})

test("round 2: Sites: a won site says so and links to Outreach (no dead grey button, no Skip), Compare's halves match, a phone has Before / After", { timeout: 120_000 }, async () => {
  const sites = (await (await fetch(run.url + "/api/sites")).json()) as any[]
  const won = sites.find((s) => s.crmStage === "signature")
  const { page, errors, close } = await open(1440, 900, "/#sites")
  try {
    await page.waitForFunction(() => document.querySelectorAll("#rail .card").length >= 2, null, { timeout: 20_000 })
    // it opens on a site waiting for you when there is one (never an old one chosen by order)
    const sel = await page.$eval("#rail .card.on .sr", (e) => e.textContent || "")
    if (sites.some((s) => !s.crmStage && !["approved", "rejected", "sent", "drafted", "superseded"].includes(s.status))) assert.match(sel, /Waiting for you|Building/, sel)
    if (won) {
      await page.click(`#rail .card[data-id="${won.id}"]`); await page.waitForFunction((n) => document.querySelector("#iTitle")!.textContent === n, won.name, { timeout: 5_000 })
      assert.equal(await page.$eval("#approve", (e) => (e as HTMLElement).hidden), true, "no disabled « Won » slab")
      assert.equal(await page.$eval("#reject", (e) => (e as HTMLElement).hidden), true, "no Skip on a client")
      assert.equal(await page.$eval("#iOutreach", (e) => [(e as HTMLElement).hidden, e.textContent].join("|")), "false|Open the client in Outreach")
      await page.click('#viewmode a[data-v="compare"]'); await page.waitForSelector("#compare:not([hidden]) .half.l img")
      await page.waitForFunction(() => (document.querySelector("#compare .half.l img") as HTMLImageElement).complete)
      const [l, r] = await page.$$eval("#compare .sc", (els) => els.map((e) => { const b = e.getBoundingClientRect(); return [b.top, b.width, b.height, getComputedStyle(e).backgroundColor] }))
      assert.deepEqual(l, r.map((x, i) => (i === 3 ? l[3] : x)), "same top, same width, same height")
      assert.equal(l[3], "rgb(255, 255, 255)", "the old page on the same white canvas, never a black void under it")
      const img = await page.$eval("#compare .half.l img", (e) => e.getBoundingClientRect().width)
      assert.ok(Math.abs(img - (l[1] as number)) < 2, "the old capture fills its half")
      assert.ok(await page.$("#compare .endnote"))
      await page.click('#viewmode a[data-v="after"]')
    }
    assert.deepEqual(errors, [])
  } finally { await close() }
  const m = await open(390, 844, "/#sites")
  try {
    await m.page.waitForFunction(() => document.querySelectorAll("#rail .card").length >= 1, null, { timeout: 20_000 })
    assert.equal(await m.page.$eval('#viewmode [data-v="compare"]', (e) => (e as HTMLElement).offsetWidth), 0, "a phone: Before and After, no two cramped halves")
    // the selected card is in view on the sideways rail
    const on = await rectOf(m.page, "#rail .card.on"); assert.ok(on.l >= 0 && on.r <= 390, JSON.stringify(on))
    // the stage bar is one row
    assert.ok((await rectOf(m.page, ".stagebar")).h <= 60, "one row above the preview")
    if (won) {
      await m.page.click(`#rail .card[data-id="${won.id}"]`); await m.page.waitForTimeout(300)
      assert.equal(await m.page.$eval("#approve", (e) => (e as HTMLElement).offsetParent === null), true, "no fixed bar over a won site's preview")
    }
    assert.deepEqual(m.errors, [])
  } finally { await m.close() }
})

test("round 2: Prospects: the furthest state of each business, counts that add up, and what a search brought said under the field", { timeout: 150_000 }, async () => {
  const items = (await (await fetch(run.url + "/api/prospects")).json()).items as any[]
  for (const s of ["won", "lost", "outreach"]) assert.ok(items.some((x) => x.status === s), `a « ${s} » prospect`)
  const won = items.find((x) => x.status === "won")
  const { page, errors, close } = await open(1440, 900, "/#prospects")
  try {
    await page.waitForSelector(`#plist .pc[data-id="${won.id}"]`, { timeout: 20_000 })
    assert.equal(await page.$eval(`#plist .pc[data-id="${won.id}"] .chip.status`, (e) => e.textContent), "Won", "never « Built » for a client")
    assert.ok(await page.$(`#plist .pc[data-id="${won.id}"] [data-open]`), "its site one click away")
    const count = await page.$eval("#pCount", (e) => e.textContent || "")
    const [, shown, fresh] = /^(\d+) prospects? .*· (\d+) new/.exec(count) || []
    assert.ok(Number(fresh) <= Number(shown), `never more new than shown: ${count}`)
    await idle("find")
    await page.fill("#findText", "20 plumbers around Austin"); await page.waitForFunction(() => /Plumber/.test(document.querySelector("#briefChips")!.textContent || ""), null, { timeout: 5_000 })
    await page.click("#findBtn")
    await page.waitForFunction(() => !(document.querySelector("#findDone") as HTMLElement).hidden, null, { timeout: 90_000 })
    assert.match(await page.$eval("#findDone", (e) => e.textContent || ""), /^Found \d+ of 20 plumbers near Austin.*: the demo finds up to 12 per search\.$/)
    assert.deepEqual(errors, [])
  } finally { await close() }
})

test("round 2: Hands-off says what fits under the daily cap (in builds) and what is abroad ; Settings saves only values from its lists", { timeout: 90_000 }, async () => {
  const pend = await (await fetch(run.url + "/api/handsoff/pending")).json()
  assert.equal(pend.buildsCap, 6); assert.equal(pend.perSiteUsd, 3)
  // the counts are what gets built : today never more than what is left of today's cap, the rest tomorrow
  assert.equal(pend.today + pend.later, pend.count); assert.ok(pend.today <= pend.buildsLeft, JSON.stringify(pend))
  assert.equal(typeof pend.abroad, "number"); assert.equal(typeof pend.noContact, "number"); assert.equal(pend.country, "US")
  assert.equal((await send("/api/budget", { usdDay: 0 })).status, 400)
  assert.equal((await send("/api/budget", { buildsDay: 0 })).status, 400)
  assert.equal((await send("/api/budget", { buildsDay: 2.5 })).status, 400)
  for (const [k, v] of [["country", "ZZ"], ["language", "klingon"], ["currency", "BTC"], ["ai", "skynet"], ["timezone", "Mars/Olympus"]]) {
    const r = await send("/api/settings", { [k]: v }); assert.equal(r.status, 400, `${k}=${v}`); assert.equal((await r.json()).field, k)
  }
  const { page, errors, close } = await open(1440, 900, "/#prospects")
  try {
    await page.waitForSelector("#plist .pc", { timeout: 20_000 })
    await page.click("#menuBtn"); await page.click("#menuHandsoff"); await page.waitForSelector("#sheet:not([hidden]) #hoToggle", { state: "attached" })
    assert.match(await page.$eval("#sheet", (e) => e.textContent || ""), /in your country gets its site built without asking you, up to 6 builds a day \(today: \d+ done\)\. A build uses about \$3\.00 of your plan: an estimate, not a charge/)
    await page.keyboard.press("Escape")
    assert.deepEqual(errors, [])
  } finally { await close() }
})

test("round 3 (truth): the lead in the emails is in outreach, in « Emails », its email reads in full and the next one is in sending hours ; a meeting stops the emails and says why ; Skip in Sites is Skip in Prospects ; old sites open here", { timeout: 120_000 }, async () => {
  const SEQ = "larkmoor-plumbing-drain-austin"
  const prospects = (await (await fetch(run.url + "/api/prospects")).json()).items as any[]
  assert.equal(prospects.find((x) => x.id === SEQ)?.status, "outreach", "a business in the emails is never « New »")
  // old sites of fictional businesses open here (their .example address resolves nowhere)
  const fict = prospects.filter((x) => /\.example\b/.test(x.oldUrl || ""))
  assert.ok(fict.length >= 5 && fict.every((x) => x.oldHref === `/old/${x.id}/`), JSON.stringify(fict.map((x) => x.oldHref)))
  for (const x of fict.slice(0, 3)) { const r = await fetch(run.url + x.oldHref); assert.equal(r.status, 200, x.oldHref); assert.match(await r.text(), /<html/i) }
  const crm = await (await fetch(run.url + "/api/crm")).json()
  const lead = (crm.hot.emails || []).find((l: any) => l.id === SEQ)
  assert.ok(lead, `in « Emails » : ${JSON.stringify(Object.fromEntries(Object.entries(crm.hot).map(([k, v]: any) => [k, v.map((l: any) => l.id)])))}`)
  assert.equal(lead.mail.written, 1); assert.equal(lead.mail.total, 4); assert.equal(lead.mail.stopped, null)
  assert.match(lead.mail.nextLabel, /^(Mon|Tue|Wed|Thu|Fri), [A-Z][a-z]{2} \d{1,2}, ([9]|1[0-2]|[1-4]):\d\d\s?(AM|PM)$/, lead.mail.nextLabel)
  assert.ok(lead.oldHref.startsWith("/old/"))
  // the email itself : subject, body, the legal footer with the postal address (CAN-SPAM), on the agency's clock
  const em = await (await fetch(run.url + `/api/sequences/emails?id=${SEQ}`)).json()
  assert.equal(em.emails.length, 1)
  assert.ok(em.emails[0].subject && em.emails[0].body.length > 40, JSON.stringify(em.emails[0]))
  assert.match(em.emails[0].footer, /Austin, TX 787\d\d/); assert.equal(em.emails[0].label, "First email"); assert.equal(em.emails[0].test, true)
  // the call panel's Email tab reads it
  const { page, errors, close } = await open(1440, 900, "/#outreach")
  try {
    await page.waitForSelector(`#board .kcard[data-id="${SEQ}"]`, { timeout: 20_000 })
    assert.match(await page.$eval(`#board .kcard[data-id="${SEQ}"]`, (e) => e.textContent || ""), /1 of 4 emails written/)
    await page.click(`#board .kcard[data-id="${SEQ}"]`); await page.click('#ltabs a[data-t="email"]')
    await page.waitForSelector("#lcontent details.mail", { timeout: 10_000 })
    const tab = await page.$eval("#lcontent", (e) => e.textContent || "")
    assert.match(tab, /Written1 of 4/); assert.match(tab, /Email 1 · First email/); assert.match(tab, new RegExp(em.emails[0].subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    assert.match(tab, /Next(Mon|Tue|Wed|Thu|Fri)/)
    // a meeting booked : the emails stop, and the card says why
    const r = await send("/api/crm/outcome", { id: SEQ, outcome: "rdv", rdvAt: Date.now() + 3 * 86400_000 })
    assert.equal((await r.json()).mailStopped, true)
    const after = (await (await fetch(run.url + "/api/crm")).json()).closing.demo.find((l: any) => l.id === SEQ)
    assert.equal(after.mail.stopped, "Emails stopped: meeting booked"); assert.equal(after.mail.nextLabel, null)
    assert.equal((await (await fetch(run.url + "/api/sequences")).json()).sequences.find((x: any) => x.prospectId === SEQ).status, "stopped")
    await page.keyboard.press("Escape")
    await page.waitForFunction((id) => /Emails stopped: meeting booked/.test(document.querySelector(`#board .kcard[data-id="${id}"]`)?.textContent || ""), SEQ, { timeout: 10_000 })
    assert.deepEqual(errors, [])
  } finally { await close() }
  // Skip in Sites (the site rejected) is « Skipped » in Prospects : one business, one status
  const sites = await (await fetch(run.url + "/api/sites")).json() as any[]
  const draft = sites.find((x) => x.hasIndex && (x.status === "draft" || !x.status))
  assert.ok(draft, "a site waiting for you")
  assert.equal((await send("/api/status", { id: draft.id, date: draft.date, status: "rejected" })).status, 200)
  assert.equal((await (await fetch(run.url + "/api/prospects")).json()).items.find((x: any) => x.id === draft.id).status, "skipped")
  await send("/api/status", { id: draft.id, date: draft.date, status: "draft" })
})

test("round 3 (truth): Settings saves what you typed (an emptied field stays empty, a bad phone or a too-long name is refused), switching country swaps the demo's text, the toast names real leftovers ; Billing refuses fields that can't be right and the demo invoice is whole", { timeout: 60_000 }, async () => {
  const st = await (await fetch(run.url + "/api/settings")).json()
  const base = { name: st.name, firstName: st.firstName, country: "US", language: st.language, currency: st.currency, postalAddress: "1100 Congress Ave, Austin, TX 78701", timezone: "America/Chicago", brand: st.brand, phone: st.phone, contactEmail: st.contactEmail, website: st.website, offer: st.offer, guarantee: st.guarantee }
  try {
    assert.equal((await (await send("/api/settings", { ...base, phone: "call me maybe ☎☎☎ <b>" })).json()).field, "phone")
    assert.equal((await (await send("/api/settings", { ...base, firstName: "x".repeat(300) })).json()).field, "firstName")
    const ok = await (await send("/api/settings", { ...base, offer: "", guarantee: "", website: "", contactEmail: "hi@pixelranch.example" })).json()
    assert.equal(ok.ok, true)
    const cfg = JSON.parse(readFileSync(join(run.dir, "agency.config.json"), "utf8"))
    assert.equal(cfg.brand.offer, ""); assert.equal(cfg.brand.garantie, ""); assert.equal(cfg.website, "", "never a website you did not type")
    assert.ok(ok.placeholders.some((x: any) => x.key === "contactEmail"), "an .example address is a placeholder")
    assert.ok(!ok.leftovers.some((x: any) => x.key === "contactEmail" || x.key === "website" || x.key === "offer"), JSON.stringify(ok.leftovers))
    // switching country with the demo's text untouched : the other demo's text, never a refusal for French left in English
    const fr = st.demoCopy.FR, us = st.demoCopy.US
    const sw = await (await send("/api/settings", { ...base, country: "FR", language: "fr", currency: "EUR", postalAddress: undefined, timezone: undefined, brand: us.brand, offer: us.offer, guarantee: us.guarantee })).json()
    assert.equal(sw.ok, true, JSON.stringify(sw))
    const cfr = JSON.parse(readFileSync(join(run.dir, "agency.config.json"), "utf8"))
    assert.equal(cfr.brand.team, fr.brand); assert.equal(cfr.brand.offer, fr.offer)
  } finally {
    await send("/api/settings", base)
  }
  // Billing › Your business : a SIRET « abc », an IBAN with a tag, a javascript: link are refused for their field
  for (const [k, v] of [["siret", "abc"], ["iban", "<b>x"], ["paymentLink", "javascript:alert(1)"]]) {
    const r = await send("/api/invoice-settings", { [k]: v }); assert.equal(r.status, 400, k); assert.equal((await r.json()).field, k)
  }
  // the demo's own business is complete there : nothing « left out », a demo invoice prints whole
  const sel = await (await fetch(run.url + "/api/invoice-settings")).json()
  assert.deepEqual(sel._demo, []); assert.equal(sel.sandbox, true)
})

test("Settings saves over the agency that runs (the US one) : it keeps its details, refuses an empty US address, and the call script says your name", { timeout: 90_000 }, async () => {
  const { page, errors, close } = await open(1440, 900, "/#settings")
  try {
    await page.waitForSelector("#sheet:not([hidden]) #sName", { timeout: 20_000 })
    assert.match(await page.$eval("#sheet", (e) => e.textContent || ""), /thrown away when the demo stops/)
    // audit round 2: the hint is built from the name you type, with English quotes ; the zone follows a US address
    await page.fill("#sFirst", "Dev")
    assert.equal(await page.$eval("#sFirstHint", (e) => e.textContent), "It signs your emails and opens your call scripts: “Hi, this is Dev from Harbor & Pine Web Co…”")
    await page.fill("#sAddr", "500 W 2nd St, Austin, TX 78701")
    assert.equal(await page.$eval("#sTz", (e) => (e as HTMLSelectElement).value), "America/Chicago", "Austin is Central")
    assert.equal(await page.$eval("#sheet", (e) => e.classList.contains("wide")), true, "a wide sheet in sections")
    assert.ok(await page.$eval("#sheet > .sheetfoot #aSave", (e) => { const r = e.getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0 }), "Save is in view without scrolling")
    // the server refuses what the form refuses : an empty name, an empty US address, an HTML name is made plain
    const bad = await fetch(run.url + "/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "", brand: "" }) })
    assert.equal(bad.status, 400)
    const noAddr = await fetch(run.url + "/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ country: "US", postalAddress: "" }) })
    assert.equal(noAddr.status, 400); assert.equal((await noAddr.json()).field, "postalAddress")
    await page.fill("#sAddr", ""); await page.click("#aSave")
    await page.waitForFunction(() => /CAN-SPAM/.test(document.querySelector("#sAddrErr")!.textContent || ""), null, { timeout: 5_000 })
    await page.fill("#sAddr", "1100 Congress Ave, Austin, TX 78701")
    await page.fill("#sName", "Lone Star Web Studio."); await page.fill("#sFirst", "Sam")
    await page.click("#aSave")
    await page.waitForFunction(() => /Saved/.test(document.querySelector("#toasts")!.textContent || ""), null, { timeout: 10_000 })
    const cfg = JSON.parse(readFileSync(join(run.dir, "agency.config.json"), "utf8"))
    assert.equal(cfg.country, "US"); assert.equal(cfg.phone, "+1 512-555-0142", "the US example's phone, not the French demo's")
    assert.equal(cfg.mail.senderName, "Sam · Lone Star Web Studio."); assert.doesNotMatch(JSON.stringify(cfg.brand), /un site refait|aucun acompte/, "no French offer")
    assert.equal(await page.$eval("#brand span", (e) => e.textContent), "Lone Star Web Studio.", "the header says your agency")
    // the call script : your name, the agency's name as it is now, no « .. »
    await page.goto(run.url + "/#outreach", { waitUntil: "load" }); await page.waitForSelector("#board .kcard", { timeout: 20_000 })
    await page.click("#board .kcard"); await page.waitForSelector("#lead:not([hidden]) .script")
    const script = await page.$eval("#lead .script", (e) => e.textContent || "")
    // in the business's language (a French business → French), always your name and the agency's current name, no « .. »
    if (!/^(Meeting|Rendez-vous)/.test(script)) { assert.match(script, /(Hi, this is Sam from|ici Sam, de) Lone Star Web Studio\. /, script); assert.doesNotMatch(script, /\.\.|\[your name\]|\[votre prénom\]|Harbor & Pine/) }
    assert.deepEqual(errors, [])
  } finally { await close() }
})

// last : it rewrites the agency's .env and config (same values, another AI)
test("Settings: « Which AI do you use » shows the status of the choice and writes LWS_LLM to .env", { timeout: 60_000 }, async () => {
  const { page, errors, close } = await open(1440, 900, "/#settings")
  try {
    await page.waitForSelector("#sheet:not([hidden]) #aiMode", { timeout: 20_000 })
    assert.match(await page.$eval("#sheet", (e) => e.textContent || ""), /thrown away when the demo stops/)
    assert.equal(await page.$eval("#sCountry", (e) => (e as HTMLSelectElement).value), "US")
    await page.selectOption("#aiMode", "codex")
    // a ChatGPT-only owner learns it here, with the price of what is missing : the lighter steps only
    assert.match(await page.$eval("#aiWhat", (e) => e.textContent || ""), /building sites still needs a Claude plan \(Pro or Max\)/)
    await page.waitForFunction(() => /Building sites also needs Claude/.test(document.querySelector("#aiStatus")!.textContent || ""), null, { timeout: 10_000 })
    // said once : the status line never repeats the choice's own description
    assert.equal(((await page.$eval("#sheet", (e) => e.textContent || "")).match(/lighter steps only/g) || []).length, 1)
    assert.ok(await page.$("#aiStatus [data-copy]"), "the command comes with a Copy button")
    const brand = await page.$eval("#brandText", (e) => (e as HTMLTextAreaElement).value.trim())
    await page.fill("#brandText", ""); await page.click("#aSave")
    await page.waitForFunction(() => /can't be empty/.test(document.querySelector("#brandErr")!.textContent || ""), null, { timeout: 5_000 })
    assert.equal(await page.evaluate(() => document.activeElement?.id), "brandText", "the empty field gets the focus")
    assert.doesNotMatch(await page.$eval("#toasts", (e) => e.textContent || ""), /Saved/, "nothing saved with an empty paragraph")
    await page.fill("#brandText", brand || "A small studio that rebuilds websites for local trades.")
    await page.click("#aSave")
    await page.waitForFunction(() => /Saved/.test(document.querySelector("#toasts")!.textContent || ""), null, { timeout: 10_000 })
    assert.equal((await (await fetch(run.url + "/api/settings")).json()).ai, "codex")
    assert.match(readFileSync(join(run.dir, ".env"), "utf8"), /^LWS_LLM=codex$/m)
    assert.equal(JSON.parse(readFileSync(join(run.dir, "agency.config.json"), "utf8")).country, "US")
    assert.deepEqual(errors, [])
  } finally { await close() }
})
