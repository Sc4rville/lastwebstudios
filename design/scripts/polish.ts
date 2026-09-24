/**
 * polish.ts — BRAND layer on top of the composed site. Mechanical, ZERO LLM, deterministic.
 *
 *   1. finds the prospect's brand colour by sampling the "before" screenshot of their REAL site
 *      (falls back to the logo, then to a neutral accent);
 *   2. tunes it so it stays readable on the template's dark ground;
 *   3. injects a single `<style id="lws-polish">` that re-points the template's `--brand` token.
 *
 * Effect: the demo already wears the prospect's colours — it feels like theirs, not like a template.
 * Idempotent (replaces the layer if present).
 *
 * Export : polishSite(id)     CLI : npm run polish -- <prospectId>
 */
import { chromium } from "playwright"
import { readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join, extname } from "node:path"
import { fileURLToPath } from "node:url"
import type { ProspectSheet } from "../../packages/shared/prospect.ts"
import { siteDir } from "./compose.ts"

const FALLBACK = "#ff5a1f"

const hexToRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const rgbToHex = (rgb: number[]) => "#" + rgb.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("")

/** Relative luminance (WCAG). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Lift a colour toward white until it reaches a minimum luminance (readable accent on a dark ground). */
export function tuneForDark(hex: string, minLum = 0.2): string {
  let rgb = hexToRgb(hex)
  for (let i = 0; i < 20 && luminance(rgbToHex(rgb)) < minLum; i++) rgb = rgb.map((v) => v + (255 - v) * 0.12)
  return rgbToHex(rgb)
}

/** Dominant SATURATED colour of an image, via a canvas in the browser (no image dependency). */
async function sampleColor(page: import("playwright").Page, file: string): Promise<string | null> {
  const ext = extname(file).toLowerCase()
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".svg" ? "image/svg+xml" : "image/jpeg"
  const dataUrl = `data:${mime};base64,` + (await readFile(file)).toString("base64")
  return page.evaluate(async (src) => {
    const img = new Image()
    img.src = src
    try {
      await img.decode()
    } catch {
      return null
    }
    const W = 96
    const H = Math.max(1, Math.round((W * img.height) / img.width))
    const c = document.createElement("canvas")
    c.width = W
    c.height = H
    const ctx = c.getContext("2d")!
    ctx.drawImage(img, 0, 0, W, H)
    const data = ctx.getImageData(0, 0, W, H).data
    const buckets: Record<number, { n: number; r: number; g: number; b: number }> = {}
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const l = (max + min) / 510
      const s = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255))
      if (s < 0.45 || l < 0.18 || l > 0.82) continue // greys, too dark, too light: not a brand colour
      const hue = Math.round((Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b) * 180) / Math.PI / 24)
      const k = (buckets[hue] ??= { n: 0, r: 0, g: 0, b: 0 })
      k.n++
      k.r += r
      k.g += g
      k.b += b
    }
    const best = Object.values(buckets).sort((a, b) => b.n - a.n)[0]
    if (!best || best.n < 10) return null
    return "#" + [best.r, best.g, best.b].map((x) => Math.round(x / best.n).toString(16).padStart(2, "0")).join("")
  }, dataUrl)
}

export async function polishSite(id: string): Promise<string> {
  const outDir = siteDir(id)
  const index = join(outDir, "index.html")
  if (!existsSync(index)) throw new Error(`polish: nothing to polish for ${id} (${index} missing)`)
  const sheet: ProspectSheet = JSON.parse(await readFile(join("data", "prospects", `${id}.json`), "utf8"))

  let sampled: string | null = null
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    for (const rel of [sheet.existing.screenshot, sheet.assets.logo]) {
      if (!rel || !existsSync(join("data", rel))) continue
      sampled = await sampleColor(page, join("data", rel))
      if (sampled) break
    }
  } finally {
    await browser.close()
  }

  const brand = tuneForDark(sampled ?? FALLBACK)
  const [r, g, b] = hexToRgb(brand)
  const layer = `<style id="lws-polish">:root{--brand:${brand};--brand-rgb:${r},${g},${b}}</style>`
  let html = await readFile(index, "utf8")
  html = html.includes('id="lws-polish"')
    ? html.replace(/<style id="lws-polish">[\s\S]*?<\/style>/, layer)
    : html.replace("</head>", `${layer}\n</head>`)
  await writeFile(index, html)
  return sampled ? `${brand} (sampled ${sampled} from their current site)` : `${brand} (neutral fallback)`
}

// --- CLI ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [id] = process.argv.slice(2)
  if (!id) {
    console.error("usage: npm run polish -- <prospectId>")
    process.exit(1)
  }
  console.log(`✓ polish: brand ${await polishSite(id)}`)
}
