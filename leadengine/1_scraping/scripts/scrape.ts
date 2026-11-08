/**
 * Scraping (1_scraping) — THE ORCHESTRATOR. The prospect tap, several sources. Zero LLM, free.
 *
 *   sources (osm + sirene + gmaps) → merge → enrichment (missing site) → dedup → CSV
 *
 * Built for qualified VOLUME across French-speaking Europe (FR + Wallonia/Brussels + French-speaking Switzerland),
 * and to run unattended (see architecture/scheduling/): the dedup registry guarantees a re-run
 * adds ONLY new rows, without retrying enrichments that already failed.
 *
 * Usage: npm run scrape -- <industry> [fr|be|ch|all|<ISO country: us, gb, ca, au>|<subdivision: us-ca, ca-on>]
 *   Default: "all" (FR+BE+CH) for a French agency, otherwise the country in agency.config.json.
 * Flags (env):
 *   SOURCES=osm,sirene,gmaps   which sources (default: osm[,sirene if FR])
 *   ENRICH=0                    don't look for missing sites (drops rows without a site)
 *   LIMIT=n                     cap on the number of NEW prospects added
 *   PER_SOURCE=n               cap per source (mostly SIRENE, whose enrichment is slow; default 200)
 *   DEPTS=69,13,75             SIRENE départements to cover (default: all of France)
 *   GMAPS_CSV=path.csv         ingests a gosom/google-maps-scraper CSV (the gmaps source)
 */
import { fileURLToPath } from "node:url"
import { INDUSTRIES, FR_DEPTS } from "./industries.ts"
import { dropChainNetworks, type Found } from "./util.ts"
import { osmSource, sireneSource, gmapsCsvSource } from "./sources.ts"
import { radarOneLine } from "./radar.ts"
import { enrichAll } from "./enrich.ts"
import { agency } from "../../../packages/shared/agency.mjs"
import { harvestContacts } from "./harvest.ts"
import { Registry, appendCsv, SCRAPED } from "./registry.ts"

const today = () => new Date().toISOString().slice(0, 10)
// TLDs to guess for an area: the country's ccTLD + .com (French-speaking areas: the historical set; "us-ca" → us; "gb" → co.uk, uk)
const tldsFor = (zone: string): string[] => {
  const z = zone.toLowerCase()
  if (z === "be") return ["be", "com"]; if (z === "ch") return ["ch", "com"]; if (z === "all") return ["fr", "com", "be", "ch"]; if (z === "fr") return ["fr", "com"]
  const cc = z.split("-")[0]
  if (cc === "gb" || cc === "uk") return ["co.uk", "uk", "com"]
  if (cc === "us") return ["com", "us", "net"]
  if (cc === "au") return ["com.au", "au", "com"]
  return [cc, "com"]
}

export async function scrapeProspects(industry: string, zone: string): Promise<Found[]> {
  if (!INDUSTRIES[industry]) throw new Error(`Unknown trade: ${industry} (known: ${Object.entries(INDUSTRIES).map(([k, v]) => v.en?.label ? `${v.en.label} (${k})` : k).join(", ")})`)
  const log = (s: string) => console.log(s)
  const limit = Number(process.env.LIMIT) || Infinity
  const perSource = Number(process.env.PER_SOURCE) || 200
  const enrichOn = process.env.ENRICH !== "0"

  // which sources: default = osm (+ sirene if the area touches France: the only public registry wired in)
  const frInScope = zone === "fr" || zone === "all"
  if (!frInScope) log(`  registry: no public company registry wired in for "${zone}" (SIRENE = France): sites through OSM / a guessed domain only`)
  const sources = (process.env.SOURCES?.split(",").map((s) => s.trim()).filter(Boolean)) ??
    ["osm", ...(frInScope ? ["sirene"] : [])]

  const reg = await Registry.load()
  const date = today()

  // ── 1. collect (each source → Found[]) ──
  const withSite: Found[] = [] // osm + gmaps (direct site)
  const noSite: Found[] = []   // sirene (to enrich)

  if (sources.includes("osm")) {
    try { (await osmSource(industry, zone, log)).forEach((f) => withSite.push(f)) }
    catch (e) { log(`  osm failed (going on with the other sources): ${(e as Error).message}`) }
  }
  if (sources.includes("gmaps") && process.env.GMAPS_CSV)
    (await gmapsCsvSource(process.env.GMAPS_CSV, industry, log)).forEach((f) => withSite.push(f))
  if (sources.includes("sirene") && frInScope) {
    const depts = process.env.DEPTS?.split(",").map((d) => d.trim()) ?? FR_DEPTS
    ;(await sireneSource(industry, { depts, cap: perSource }, log)).forEach((f) => noSite.push(f))
  }

  // ── 1b. anti-network (layer 2): drops recurring UNLISTED franchises/portals (data-driven) ──
  const cleaned = dropChainNetworks(withSite, log)

  // ── 2. dedup the rows with a direct site (registry) ──
  const fresh: Found[] = []
  for (const f of cleaned) {
    if (fresh.length >= limit) break
    if (reg.add(f, date)) fresh.push(f)
  }

  // ── 3. enrich the rows without a site (sirene), skipping those already tried ──
  if (enrichOn && noSite.length && fresh.length < limit) {
    const toTry = noSite.filter((f) => !f.key || !reg.hasKey(f.key)).slice(0, Math.max(0, (limit === Infinity ? perSource : limit) * 3))
    log(`  → enriching ${toTry.length} prospects without a site (guessed domain + DNS, DDG fallback)…`)
    const { enriched, viaGuess, viaDdg, failed } = await enrichAll(toTry, tldsFor(zone), log)
    log(`  enrich done: ${enriched.length} sites found (${viaGuess} guess / ${viaDdg} ddg) · ${failed} without a site`)
    for (const f of toTry) reg.markTried(f.key!, date) // tried = don't retry on the next run
    for (const f of enriched) {
      if (fresh.length >= limit) break
      if (reg.add(f, date)) fresh.push(f)
    }
  }

  // ── 4. free contacts: phone + email from the site (feeds closability scoring + distribution) ──
  // wrapped: over hundreds of sites a network failure is certain → it must NOT prevent persisting.
  if (process.env.HARVEST !== "0" && fresh.length) {
    log(`  → collecting contacts (phone + email) on ${fresh.length} sites…`)
    try {
      const { phones, emails } = await harvestContacts(fresh, log)
      log(`  contacts: +${phones} phones · +${emails} emails`)
    } catch (e) { log(`  harvest interrupted (the prospects are saved anyway): ${(e as Error).message}`) }
  }

  // ── 5. persist (CSV + registry) ──
  await appendCsv(fresh)
  await reg.save()
  return fresh
}

// --- CLI ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // the harvest hits hundreds of third-party sites: an isolated socket reset / network error is INEVITABLE.
  // We downgrade it to a warning instead of letting node crash the whole run (and lose the whole batch).
  process.on("unhandledRejection", (r: any) => console.warn(`  ⚠ network rejection ignored: ${String(r?.message || r).slice(0, 90)}`))
  process.on("uncaughtException", (e) => console.warn(`  ⚠ network exception ignored: ${e.message.slice(0, 90)}`))
  const [industry, zone = agency().country === "FR" ? "all" : agency().country.toLowerCase()] = process.argv.slice(2)
  if (!industry) {
    console.error(`usage: npm run scrape -- <industry> [fr|be|ch|all|us|gb|ca|au|us-ca…]   (trades: ${Object.keys(INDUSTRIES).join(", ")})`)
    process.exit(1)
  }
  console.log(`🔎 scrape ${industry} (${zone}) — several sources (OSM + SIRENE + gosom), web enrichment`)
  const radar = radarOneLine(industry)
  if (radar) console.log(`   ${radar}\n`); else console.log(`   (trade not on the radar — try \`npm run radar\`)\n`)
  const fresh = await scrapeProspects(industry, zone)
  const bySource = fresh.reduce<Record<string, number>>((a, f) => ((a[f.source] = (a[f.source] ?? 0) + 1), a), {})
  console.log(`\n✅ ${fresh.length} NEW prospects → ${SCRAPED}`)
  console.log(`   by source: ${Object.entries(bySource).map(([s, n]) => `${s} ${n}`).join(" · ") || "—"}`)
  console.log(`   pipeline: SEED=${SCRAPED} npm run pipeline`)
}
