/**
 * templates.ts — extracteurs mécaniques du lab (panneau 2). Pas de LLM.
 *
 * Lit la bibliothèque de templates (design/templates/) et la fonderie (video/fonts/) pour alimenter
 * la galerie, les font pairings et les extraits. Tout vient de fichiers déjà présents : aucun nouveau
 * modèle de données.
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
  fonts: string[] // familles @font-face détectées dans l'index.html
  extract: string // un titre/hero représentatif
}

/** N'expose qu'une URL http(s) (défense en profondeur : la source est du scraping tiers). */
function safeUrl(u: unknown): string {
  try {
    const x = new URL(String(u ?? ""))
    return x.protocol === "http:" || x.protocol === "https:" ? x.href : ""
  } catch {
    return ""
  }
}

/** Lit index.json + chaque meta.json, grep les @font-face et un extrait par template. */
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

/** Familles citées dans les règles @font-face d'un HTML (dédupliquées, ordre d'apparition). */
function fontFamilies(html: string): string[] {
  const out = new Set<string>()
  const re = /@font-face\s*\{[^}]*?font-family\s*:\s*["']?([^"';}]+)["']?/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) out.add(m[1].trim())
  return [...out].slice(0, 8)
}

/** Premier titre visible (h1/h2) comme extrait représentatif du template. */
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
  file: string // nom de fichier servi via /font/<file>
  family: string // ex: "Space Grotesk"
  weight: number // ex: 500
}

/** Énumère video/fonts/*.woff2 → specimens (famille + graisse déduites du nom de fichier). */
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
