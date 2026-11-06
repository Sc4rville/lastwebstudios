/**
 * ensure.ts — GARDE-BARRIÈRE du lead-engine. Avant de lancer le pipe, garantit qu'il y a AU MOINS
 * `need` prospects FRAIS (scrapés, avec site, **pas encore bâtis ni fichés**) pour un métier.
 * S'il en manque → scrape le **DELTA** (need − dispo), en boucle jusqu'au compte OU épuisement de
 * la source (jamais d'infini). Le scraper gère déjà **registre + CSV + dédup** → tout reste répertorié.
 *
 *   npm run ensure -- <industry> <count> [fr|be|ch|all]
 *   import { ensureProspects } from "./ensure.ts"
 */
import { agency } from "../../../packages/shared/agency.mjs"
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { SCRAPED } from "./registry.ts"
import { scrapeProspects } from "./scrape.ts"
import { csvSplit } from "./util.ts"

const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

export type EnsureResult = { industry: string; need: number; available: number; scraped: number; exhausted: boolean }

/** Prospects FRAIS du CSV scrapé pour un métier : site présent ET pas déjà bâti (output/sites) ni fiché (data/prospects). */
export async function freshProspects(industry: string): Promise<{ name: string; city: string; website: string; id: string }[]> {
  const text = await readFile(SCRAPED, "utf8").catch(() => "")
  const lines = text.trim().split("\n")
  if (lines.length < 2) return []
  const cols = csvSplit(lines[0]).map((c) => c.trim())
  const out: { name: string; city: string; website: string; id: string }[] = []
  for (const line of lines.slice(1)) {
    if (!line) continue
    const cells = csvSplit(line)
    const row: Record<string, string> = {}
    cols.forEach((c, i) => (row[c] = (cells[i] ?? "").trim()))
    if (industry && row.industry !== industry) continue
    if (!row.website) continue // sans site = inexploitable ici
    const id = slug(`${row.name}-${row.city}`)
    if (existsSync(join("output", "sites", id)) || existsSync(join("data", "prospects", `${id}.json`))) continue // déjà bâti/fiché
    out.push({ name: row.name, city: row.city, website: row.website, id })
  }
  return out
}

/** Garantit `need` prospects frais pour `industry` ; scrape le delta si court (cap 6 tours anti-infini). */
export async function ensureProspects(industry: string, zone = agency().country.toLowerCase(), need = 5, log: (s: string) => void = console.log): Promise<EnsureResult> {
  let available = (await freshProspects(industry)).length
  let scraped = 0, exhausted = false, rounds = 0
  log(`🔎 ensure ${industry} (${zone}) : besoin ${need}, déjà dispo ${available}`)
  while (available < need && rounds < 6) {
    rounds++
    const missing = need - available
    log(`  → il en manque ${missing} → je scrape…`)
    const before = process.env.LIMIT
    process.env.LIMIT = String(missing)
    let got = 0
    try { got = (await scrapeProspects(industry, zone)).length }
    catch (e) { log(`  ✗ scrape KO : ${(e as Error).message}`); break }
    finally { if (before === undefined) delete process.env.LIMIT; else process.env.LIMIT = before }
    scraped += got
    if (got === 0) { exhausted = true; log(`  ⚠ source épuisée (0 neuf trouvé) — on fait avec ${available}`); break }
    available = (await freshProspects(industry)).length
  }
  log(`✓ ensure ${industry} : ${available} prospects frais prêts${scraped ? ` (+${scraped} scrapés)` : ""}${exhausted ? " · source épuisée" : ""}`)
  return { industry, need, available, scraped, exhausted }
}

// --- CLI : npm run ensure -- <industry> <count> [zone] ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile() } catch { /* env déjà là */ }
  const [industry, countS, zone = agency().country.toLowerCase()] = process.argv.slice(2)
  if (!industry || !countS) { console.error("usage: npm run ensure -- <industry> <count> [fr|be|ch|all]"); process.exit(1) }
  const r = await ensureProspects(industry, zone, Number(countS))
  console.log(JSON.stringify(r))
  process.exit(0)
}
