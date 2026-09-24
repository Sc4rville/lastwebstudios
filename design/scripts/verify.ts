/**
 * verify.ts — the quality GATE of the design engine. Mechanical: render it and LOOK, never assume.
 *
 * Opens the built site in a real browser and checks what a human reviewer would catch first:
 * leftover template tokens, broken images, fonts that did not load, a page too thin to be a site,
 * horizontal overflow on a phone. Saves the screenshots the pitch is made of (after.png, hero.png).
 * A failed gate means the demo never reaches distribution.
 *
 * The private build adds a blind beauty gate: a context-free LLM judge compares before/after and sends
 * the page back to the composer when the new one is not clearly more beautiful (capped retries).
 *
 * Export : verifySite(id)     CLI : npm run verify -- <prospectId>
 */
import { chromium, type Page } from "playwright"
import { readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { siteDir } from "./compose.ts"

export type Check = { name: string; ok: boolean; detail: string }
export type Verdict = { pass: boolean; checks: Check[] }

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 60))
    }
    document.querySelectorAll(".rv").forEach((el) => el.classList.add("in"))
    window.scrollTo(0, 0)
  })
  await page.waitForTimeout(1600) // let the intro and reveals finish
}

export async function verifySite(id: string): Promise<Verdict> {
  const dir = siteDir(id)
  const url = "file://" + resolve(join(dir, "index.html"))
  const html = await readFile(join(dir, "index.html"), "utf8")
  const checks: Check[] = []
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail })

  const leftovers = html.match(/\{\{[^}]*\}\}/g) ?? []
  add("no leftover tokens", leftovers.length === 0, leftovers.slice(0, 3).join(" ") || "clean")

  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(url, { waitUntil: "load" })
    await settle(page)
    const probe = await page.evaluate(() => ({
      broken: [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute("src")),
      text: document.body.innerText.length,
      fonts: ["Anton", "Geist", "Chivo Mono"].filter((f) => !document.fonts.check(`16px "${f}"`)),
      sections: document.querySelectorAll("section").length,
    }))
    add("images load", probe.broken.length === 0, probe.broken.join(", ") || `${await page.locator("img").count()} ok`)
    add("fonts load", probe.fonts.length === 0, probe.fonts.length ? `missing: ${probe.fonts.join(", ")}` : "3 families")
    add("real content", probe.text > 800 && probe.sections >= 4, `${probe.text} chars, ${probe.sections} sections`)
    await page.screenshot({ path: join(dir, "hero.png") })
    await page.screenshot({ path: join(dir, "after.png"), fullPage: true })

    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await phone.goto(url, { waitUntil: "load" })
    await settle(phone)
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    add("no mobile overflow", overflow <= 1, overflow > 1 ? `${overflow}px too wide at 390px` : "fits 390px")
    await phone.screenshot({ path: join(dir, "mobile.png") })
  } finally {
    await browser.close()
  }

  const verdict = { pass: checks.every((c) => c.ok), checks }
  await writeFile(join(dir, "verify.json"), JSON.stringify(verdict, null, 2))
  return verdict
}

// --- CLI ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [id] = process.argv.slice(2)
  if (!id) {
    console.error("usage: npm run verify -- <prospectId>")
    process.exit(1)
  }
  const v = await verifySite(id)
  for (const c of v.checks) console.log(`${c.ok ? "✓" : "✗"} ${c.name} — ${c.detail}`)
  console.log(v.pass ? "→ PASS" : "→ FAIL")
  process.exit(v.pass ? 0 : 1)
}
