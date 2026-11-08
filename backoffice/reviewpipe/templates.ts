/**
 * templates.ts — the lab's mechanical extractors (panel 2). No LLM.
 *
 * Reads the template library (design/templates/) and the foundry (video/fonts/) to feed
 * the gallery, the font pairings and the excerpts. Everything comes from files already there: no new
 * data model.
 */
import { readFile, readdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"

const TPL_DIR = "design/templates"
const FONTS_DIR = "video/fonts"

export interface TemplateCard {
  slug: string
  category: string
  brand: string
  url: string
  status: string
  stylesheets: number
  fontsSelfHosted: number
  fonts: string[] // @font-face families found in the index.html
  extract: string // a representative heading/hero
}

/** Only exposes an http(s) URL (defence in depth: the source is third-party scraping). */
function safeUrl(u: unknown): string {
  try {
    const x = new URL(String(u ?? ""))
    return x.protocol === "http:" || x.protocol === "https:" ? x.href : ""
  } catch {
    return ""
  }
}

/** Reads index.json + each meta.json, greps the @font-face rules and one excerpt per template. */
export async function readTemplates(): Promise<TemplateCard[]> {
  const indexPath = join(TPL_DIR, "index.json")
  if (!existsSync(indexPath)) return []
  const index = JSON.parse(await readFile(indexPath, "utf8"))
  const cards: TemplateCard[] = []
  for (const t of index.templates ?? []) {
    const htmlPath = t.index as string
    let fonts: string[] = []
    let extract = ""
    if (htmlPath && existsSync(htmlPath)) {
      const html = await readFile(htmlPath, "utf8")
      fonts = fontFamilies(html)
      extract = firstHeading(html)
    }
    cards.push({
      slug: t.slug,
      category: t.category,
      brand: t.brand_guess ?? t.slug,
      url: safeUrl(t.url),
      status: t.status ?? "",
      stylesheets: t.stylesheets ?? 0,
      fontsSelfHosted: t.fonts_self_hosted ?? 0,
      fonts,
      extract,
    })
  }
  return cards
}

/** Families named in an HTML's @font-face rules (deduplicated, in order of appearance). */
function fontFamilies(html: string): string[] {
  const out = new Set<string>()
  const re = /@font-face\s*\{[^}]*?font-family\s*:\s*["']?([^"';}]+)["']?/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) out.add(m[1].trim())
  return [...out].slice(0, 8)
}

/** First visible heading (h1/h2) as the template's representative excerpt. */
function firstHeading(html: string): string {
  const m = html.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i)
  if (!m) return ""
  return m[1]
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
}

export interface FontSpecimen {
  file: string // file name served through /font/<file>
  family: string // ex: "Space Grotesk"
  weight: number // ex: 500
}

/** Lists video/fonts/*.woff2 → specimens (family + weight inferred from the file name). */
export async function readFonts(): Promise<FontSpecimen[]> {
  if (!existsSync(FONTS_DIR)) return []
  const files = (await readdir(FONTS_DIR)).filter((f) => f.endsWith(".woff2") || f.endsWith(".woff"))
  return files
    .map((file) => {
      // ex: space-grotesk-500.woff2 → { family: "Space Grotesk", weight: 500 }
      const base = file.replace(/\.(woff2?|otf|ttf)$/i, "")
      const wm = base.match(/(\d{3})$/)
      const weight = wm ? parseInt(wm[1], 10) : 400
      const family = base
        .replace(/-?\d{3}$/, "")
        .split("-")
        .filter(Boolean)
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(" ")
      return { file, family, weight }
    })
    .sort((a, b) => a.family.localeCompare(b.family) || a.weight - b.weight)
}
