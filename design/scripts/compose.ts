/**
 * compose.ts — ProspectSheet + template → the prospect's demo site, in output/sites/<id>/<date>/.
 *
 * Split by NATURE (the one rule of the codebase):
 *   - mechanical (here) : route industry → template, render tokens, copy fonts and the prospect's OWN photos.
 *   - reflection (skill): `skills/copywriter` writes the headlines from the sheet + the industry profile.
 *
 * Everything factual (services, offers, figures, steps, projects, nav labels) comes from the sheet, i.e. from
 * the prospect's current site. The model only writes the framing copy — it never invents a menu or a figure.
 *
 * The private build has a second, primary path: a composer skill that assembles a bespoke page from a
 * catalog of harvested sections, fonts, palettes and motion, followed by a blind beauty gate.
 *
 * Export : composeSite(id)     CLI : npm run compose -- <prospectId>
 */
import { readFile, writeFile, mkdir, cp, copyFile, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join, basename } from "node:path"
import { fileURLToPath } from "node:url"
import type { ProspectSheet } from "../../packages/shared/prospect.ts"
import { runSkill } from "../../packages/utils/llm.ts"

export const today = () => new Date().toISOString().slice(0, 10)
export const siteDir = (id: string, date = today()) => join("output", "sites", id, date)

// ─── a tiny template engine: {{path}} · {{mark path}} · {{#each path}} · {{#if path}} ─────────────────────

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)

const get = (ctx: any, path: string): any => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), ctx)

/** `*word*` → <em>word</em>: the copy marks the words that take the brand accent. */
const mark = (v: unknown) => esc(v).replace(/\*([^*]+)\*/g, "<em>$1</em>")

export function render(tpl: string, ctx: Record<string, unknown>): string {
  let out = tpl.replace(/\{\{#if ([\w.]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, path, body) => {
    const v = get(ctx, path)
    return (Array.isArray(v) ? v.length : v) ? body : ""
  })
  out = out.replace(/\{\{#each ([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, path, body: string) =>
    ((get(ctx, path) as unknown[]) ?? [])
      .map((item, i) =>
        body.replace(/\{\{(mark )?(this(?:\.[\w]+)?|@index|@num|[\w.]+)\}\}/g, (_m, isMark, key: string) => {
          const v =
            key === "this" ? item
            : key.startsWith("this.") ? get(item, key.slice(5))
            : key === "@index" ? i
            : key === "@num" ? String(i + 1).padStart(2, "0")
            : get(ctx, key)
          return isMark ? mark(v) : esc(v)
        }),
      )
      .join(""),
  )
  return out.replace(/\{\{(mark )?([\w.]+)\}\}/g, (_, isMark, key) => (isMark ? mark(get(ctx, key)) : esc(get(ctx, key))))
}

// ─── mechanical helpers ──────────────────────────────────────────────────────────────────────────────────

/** Map the prospect's REAL nav labels to the sections of the template (unmatched labels are dropped). */
export function navLinks(labels: string[] = []): { label: string; href: string }[] {
  const anchors: [RegExp, string][] = [
    [/ouvrage|r[ée]alisation|service|projet|work/i, "#ouvrages"],
    [/atelier|about|qui sommes|histoire/i, "#atelier"],
    [/m[ée]thode|process|d[ée]marche/i, "#methode"],
  ]
  const seen = new Set<string>()
  return labels.flatMap((label) => {
    const href = anchors.find(([re]) => re.test(label))?.[1]
    if (!href || seen.has(href)) return []
    seen.add(href)
    return [{ label, href }]
  })
}

/** "Atelier Braise" → { first: "Atelier", rest: "Braise" } for the wordmark, "AB" for references. */
export function brandParts(name: string) {
  const words = name.trim().split(/\s+/)
  return {
    first: words[0],
    rest: words.slice(1).join(" ") || words[0],
    initials: words.map((w) => w[0]).join("").slice(0, 3).toUpperCase(),
  }
}

async function resolveTemplate(industry: string): Promise<string> {
  const routing = JSON.parse(await readFile(join("design", "routing.json"), "utf8"))
  return routing.routes[industry] ?? routing.fallback
}

// ─── compose ─────────────────────────────────────────────────────────────────────────────────────────────

export async function composeSite(id: string): Promise<string> {
  const sheet: ProspectSheet = JSON.parse(await readFile(join("data", "prospects", `${id}.json`), "utf8"))
  const templateDir = await resolveTemplate(sheet.industry)
  const profile = await readFile(join("design", "industries", `${sheet.industry}.md`), "utf8").catch(() => "")

  // the only reflection of this step: framing copy, from the sheet + the industry profile
  const copy = await runSkill("skills/copywriter", { profile, prospect: sheet }, { taskClass: "design", replayKey: id })

  const outDir = siteDir(id)
  await rm(outDir, { recursive: true, force: true }) // idempotent: a rebuild starts clean
  await mkdir(join(outDir, "assets", "photos"), { recursive: true })
  await cp(join(templateDir, "fonts"), join(outDir, "assets", "fonts"), { recursive: true })

  // the prospect's own photos, most prominent first (parse sorts them by area)
  const photos: string[] = []
  for (const rel of sheet.assets.photos) {
    const src = join("data", rel)
    if (!existsSync(src)) continue
    await copyFile(src, join(outDir, "assets", "photos", basename(src)))
    photos.push(`assets/photos/${basename(src)}`)
  }
  if (!photos.length) throw new Error(`compose: no usable photo for ${id} — not enough material for a demo`)

  const offers = sheet.content.offers ?? []
  const materials = [...new Set(offers.flatMap((o) => (o.material ?? "").toLowerCase().match(/acier|laiton|inox|fer|chêne|verre/g) ?? []))]
    .slice(0, 3)
    .map((m) => m[0].toUpperCase() + m.slice(1))
  const ctx = {
    ...sheet,
    name: sheet.identity.name,
    city: sheet.identity.city,
    brand: brandParts(sheet.identity.name),
    ref: brandParts(sheet.identity.name).initials,
    copy,
    navLinks: navLinks(sheet.content.nav),
    services: sheet.content.services.join(" · "),
    materials: materials.join(" / "),
    offerRange: offers.length ? `01—${String(offers.length).padStart(2, "0")}` : "",
    photos: { hero: photos[0], detail: photos[1] ?? photos[0], texture: photos[2] ?? photos[0] },
    year: new Date().getFullYear(),
  }

  const html = render(await readFile(join(templateDir, "index.html"), "utf8"), ctx)
  await writeFile(join(outDir, "index.html"), html)
  await writeFile(
    join(outDir, "build.json"),
    JSON.stringify({ id, template: templateDir, builtAt: new Date().toISOString(), photos: photos.length, offers: offers.length }, null, 2),
  )
  return outDir
}

// --- CLI ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [id] = process.argv.slice(2)
  if (!id) {
    console.error("usage: npm run compose -- <prospectId>")
    process.exit(1)
  }
  console.log(`✓ composed → ${await composeSite(id)}`)
}
