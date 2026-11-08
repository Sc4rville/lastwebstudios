/**
 * Parse (3_parsing) — mechanical, no LLM. Fetches + parses a prospect's site.
 *
 * Opens the site (Playwright), takes the "before" screenshot (avant.png), downloads photos + logo,
 * collects the raw text → data/assets/<id>/ + data/raw/<id>.json.
 *
 * Export: parsePage(id, url)     CLI usage: npm run parse -- <id> <url>
 */
import { chromium, type Page } from "playwright"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { upload } from "../../../packages/shared/storage.ts"

const MIN_PX = 200 // ignores smaller images (icons, bullets…)

// scrolls the whole page to trigger lazy-loaded images
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

export type Raw = {
  id: string
  url: string
  title: string
  screenshot: string
  logo?: string
  photos: string[]
  text: string
}

export async function parsePage(id: string, url: string): Promise<Raw> {
  const dataAssets = join("data", "assets", id)
  const rel = (file: string) => `assets/${id}/${file}`
  await mkdir(dataAssets, { recursive: true })
  await mkdir(join("data", "raw"), { recursive: true })

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 })
  await autoScroll(page)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(dataAssets, "avant.png"), fullPage: true })
  // STORAGE: pushes the "before" shot to the bucket right away (the durable source, read by the cockpit/VM) → the BEFORE
  // ALWAYS works even if the local disk is wiped. avant.png is gitignored, the bucket keeps it.
  await upload(join(dataAssets, "avant.png"), `prospects/${id}/avant.png`).catch(() => {})

  const title = await page.title()
  const text = await page.evaluate(() => {
    document.querySelectorAll("script,style,noscript,nav,footer,svg").forEach((el) => el.remove())
    return document.body.innerText.replace(/\n{3,}/g, "\n\n").trim()
  })
  const found = await page.evaluate(() => {
    const seen = new Set<string>()
    const out: { src: string; w: number; h: number; alt: string }[] = []
    // 1) <img> (srcset resolved through currentSrc after the lazy-load scroll)
    for (const img of Array.from(document.querySelectorAll("img"))) {
      const src = img.currentSrc || img.src
      if (src && !src.startsWith("data:") && !seen.has(src)) { seen.add(src); out.push({ src, w: img.naturalWidth, h: img.naturalHeight, alt: img.alt || "" }) }
    }
    // 2) srcset (picture/source + img[srcset]) — the largest listed source
    for (const s of Array.from(document.querySelectorAll("picture source[srcset], img[srcset]"))) {
      const cand = (s.getAttribute("srcset") || "").split(",").map((x) => x.trim().split(/\s+/)[0]).filter(Boolean)
      if (!cand.length) continue
      let src = ""; try { src = new URL(cand[cand.length - 1], location.href).href } catch { src = "" }
      if (src && !src.startsWith("data:") && !seen.has(src)) { seen.add(src); out.push({ src, w: 0, h: 0, alt: "" }) }
    }
    // 3) CSS background-image (heroes, galleries, sections) — THE big miss: on estate/restaurant sites,
    //    most photos are background-images, not <img>. That is what brought back 0 photos.
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const bg = getComputedStyle(el).backgroundImage
      if (!bg || !bg.includes("url(")) continue
      const r = el.getBoundingClientRect()
      const matches = bg.match(/url\((['"]?)(.*?)\1\)/g) || []
      for (const u of matches) {
        let url = u.replace(/^url\((['"]?)/, "").replace(/(['"]?)\)$/, "")
        try { url = new URL(url, location.href).href } catch { url = "" }
        if (url && !url.startsWith("data:") && !seen.has(url)) { seen.add(url); out.push({ src: url, w: Math.round(r.width), h: Math.round(r.height), alt: el.getAttribute("aria-label") || "" }) }
      }
    }
    return out
  })
  await browser.close()

  async function download(src: string, name: string): Promise<string | null> {
    try {
      const res = await fetch(src)
      if (!res.ok) return null
      const ext = (new URL(src).pathname.split(".").pop() || "jpg").split("?")[0].slice(0, 4)
      const file = `${name}.${/^(jpg|jpeg|png|webp|gif|svg)$/i.test(ext) ? ext : "jpg"}`
      await writeFile(join(dataAssets, file), Buffer.from(await res.arrayBuffer()))
      return file
    } catch {
      return null
    }
  }

  const isLogo = (i: { src: string; alt: string }) => /logo/i.test(i.src) || /logo/i.test(i.alt)
  const logoSrc = found.find(isLogo)
  let logo: string | undefined
  if (logoSrc) {
    const f = await download(logoSrc.src, "logo")
    if (f) logo = rel(f)
  }

  const big = found.filter((i) => !isLogo(i) && i.w >= MIN_PX && i.h >= MIN_PX)
  const photos: string[] = []
  for (const [n, img] of big.entries()) {
    const f = await download(img.src, `photo-${n + 1}`)
    if (f) photos.push(rel(f))
  }

  const raw: Raw = { id, url, title, screenshot: rel("avant.png"), logo, photos, text }
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
  console.log(`→ parse ${url}`)
  const raw = await parsePage(id, url)
  console.log(`✓ ${raw.photos.length} photos${raw.logo ? " + logo" : ""} → data/raw/${id}.json`)
}
