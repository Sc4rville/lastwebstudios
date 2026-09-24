/**
 * Parse (3_parsing) — mechanical, no LLM. Reads the prospect's current site with a real browser.
 *
 * Opens the site (Playwright), takes the full-page "before" screenshot, downloads photos + logo,
 * keeps the raw text, the REAL navigation labels and the headings → data/assets/<id>/ + data/raw/<id>.json.
 *
 * Export : parsePage(id, url)     CLI : npm run parse -- <id> <url>
 */
import { chromium, type Page } from "playwright"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const MIN_PX = 200 // ignore images smaller than this (icons, bullets…)

export type Raw = {
  id: string
  url: string
  title: string
  screenshot: string
  logo?: string
  photos: string[]
  text: string
  /** Real navigation labels, captured before the nav is stripped — the demo never invents a menu. */
  nav: string[]
  /** Visible h1–h3 headings, in document order. */
  sections: string[]
}

/** Scroll the whole page so lazy-loaded images actually load. */
async function autoScroll(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let total = 0
      const timer = setInterval(() => {
        window.scrollBy(0, 500)
        total += 500
        if (total >= document.body.scrollHeight) {
          clearInterval(timer)
          resolve()
        }
      }, 100)
    })
    window.scrollTo(0, 0)
  })
}

export async function parsePage(id: string, url: string): Promise<Raw> {
  const dir = join("data", "assets", id)
  const rel = (file: string) => `assets/${id}/${file}`
  await mkdir(dir, { recursive: true })
  await mkdir(join("data", "raw"), { recursive: true })

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 })
  await autoScroll(page)
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(dir, "before.png"), fullPage: true })
  const title = await page.title()

  const nav = await page.evaluate(() => {
    const labels = new Set<string>()
    document.querySelectorAll("nav a, header a, [role=navigation] a, #menu a, .menu a").forEach((a) => {
      const label = (a as HTMLElement).innerText.trim()
      if (label && label.length <= 60 && !/^https?:/.test(label)) labels.add(label)
    })
    return [...labels]
  })
  const sections = await page.evaluate(() =>
    [...document.querySelectorAll("h1, h2, h3")].map((h) => (h as HTMLElement).innerText.trim()).filter((t) => t && t.length <= 120),
  )
  const found = await page.evaluate(() => {
    const seen = new Set<string>()
    return [...document.querySelectorAll("img")]
      .map((img) => ({ src: img.currentSrc || img.src, w: img.naturalWidth, h: img.naturalHeight, alt: img.alt || "" }))
      .filter((i) => i.src && !i.src.startsWith("data:") && !seen.has(i.src) && seen.add(i.src))
  })
  const text = await page.evaluate(() => {
    document.querySelectorAll("script,style,noscript,nav,svg").forEach((el) => el.remove())
    return document.body.innerText.replace(/\n{3,}/g, "\n\n").trim()
  })
  await browser.close()

  async function download(src: string, name: string): Promise<string | null> {
    try {
      const res = await fetch(src)
      if (!res.ok) return null
      const ext = (new URL(src).pathname.split(".").pop() || "jpg").toLowerCase()
      const file = `${name}.${/^(jpe?g|png|webp|gif|svg)$/.test(ext) ? ext : "jpg"}`
      await writeFile(join(dir, file), Buffer.from(await res.arrayBuffer()))
      return file
    } catch {
      return null
    }
  }

  const isLogo = (i: { src: string; alt: string }) => /logo/i.test(i.src) || /logo/i.test(i.alt)
  const logoImg = found.find(isLogo)
  const logoFile = logoImg ? await download(logoImg.src, "logo") : null
  // most prominent first: the design engine takes photos[0] as its hero candidate
  const big = found.filter((i) => !isLogo(i) && i.w >= MIN_PX && i.h >= MIN_PX).sort((a, b) => b.w * b.h - a.w * a.h)
  const photos: string[] = []
  for (const [n, img] of big.entries()) {
    const f = await download(img.src, `photo-${n + 1}`)
    if (f) photos.push(rel(f))
  }

  const raw: Raw = { id, url, title, screenshot: rel("before.png"), logo: logoFile ? rel(logoFile) : undefined, photos, text, nav, sections }
  await writeFile(join("data", "raw", `${id}.json`), JSON.stringify(raw, null, 2))
  return raw
}

// --- CLI ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [id, url] = process.argv.slice(2)
  if (!id || !url) {
    console.error("usage: npm run parse -- <id> <url>")
    process.exit(1)
  }
  const raw = await parsePage(id, url)
  console.log(`✓ ${raw.photos.length} photos${raw.logo ? " + logo" : ""}, ${raw.nav.length} nav labels → data/raw/${id}.json`)
}
