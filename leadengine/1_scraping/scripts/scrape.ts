/**
 * Scraping (1_scraping) — L'ORCHESTRATEUR. Le robinet à prospects, multi-sources. Zéro LLM, gratuit.
 *
 *   sources (osm + sirene + gmaps) → fusion → enrichissement (site manquant) → dédup → CSV
 *
 * Conçu pour le VOLUME qualifié sur la francophonie (FR + Wallonie/Bruxelles + Suisse romande),
 * et pour tourner en auto (cf. architecture/scheduling/) : le registre dédup garantit qu'un re-run
 * n'ajoute QUE du neuf, sans re-tenter les enrichissements déjà échoués.
 *
 * Usage : npm run scrape -- <industry> [fr|be|ch|all|<pays ISO : us, gb, ca, au>|<subdivision : us-ca, ca-on>]
 *   Défaut : « all » (FR+BE+CH) pour une agence française, sinon le pays de agency.config.json.
 * Flags (env) :
 *   SOURCES=osm,sirene,gmaps   quelles sources (défaut : osm[,sirene si FR])
 *   ENRICH=0                    ne pas chercher les sites manquants (jette les lignes sans site)
 *   LIMIT=n                     cap du nombre de prospects NEUFS ajoutés
 *   PER_SOURCE=n               cap par source (surtout SIRENE, dont l'enrichissement est lent ; défaut 200)
 *   DEPTS=69,13,75             départements SIRENE à couvrir (défaut : toute la France)
 *   GMAPS_CSV=path.csv         ingère un CSV gosom/google-maps-scraper (source gmaps)
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
// TLD à deviner pour une zone : le ccTLD du pays + .com (zones francophones : l'historique ; « us-ca » → us ; « gb » → co.uk, uk)
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
  if (!INDUSTRIES[industry]) throw new Error(`métier inconnu : ${industry} (connus : ${Object.keys(INDUSTRIES).join(", ")})`)
  const log = (s: string) => console.log(s)
  const limit = Number(process.env.LIMIT) || Infinity
  const perSource = Number(process.env.PER_SOURCE) || 200
  const enrichOn = process.env.ENRICH !== "0"

  // quelles sources : défaut = osm (+ sirene si la zone touche la France : seul registre public branché)
  const frInScope = zone === "fr" || zone === "all"
  if (!frInScope) log(`  registre : aucun registre public d'entreprises branché pour « ${zone} » (SIRENE = France) : sites via OSM / domaine deviné seulement`)
  const sources = (process.env.SOURCES?.split(",").map((s) => s.trim()).filter(Boolean)) ??
    ["osm", ...(frInScope ? ["sirene"] : [])]

  const reg = await Registry.load()
  const date = today()

  // ── 1. collecte (chaque source → Found[]) ──
  const withSite: Found[] = [] // osm + gmaps (site direct)
  const noSite: Found[] = []   // sirene (à enrichir)

  if (sources.includes("osm")) {
    try { (await osmSource(industry, zone, log)).forEach((f) => withSite.push(f)) }
    catch (e) { log(`  osm KO (on continue avec les autres sources) : ${(e as Error).message}`) }
  }
  if (sources.includes("gmaps") && process.env.GMAPS_CSV)
    (await gmapsCsvSource(process.env.GMAPS_CSV, industry, log)).forEach((f) => withSite.push(f))
  if (sources.includes("sirene") && frInScope) {
    const depts = process.env.DEPTS?.split(",").map((d) => d.trim()) ?? FR_DEPTS
    ;(await sireneSource(industry, { depts, cap: perSource }, log)).forEach((f) => noSite.push(f))
  }

  // ── 1b. anti-réseau (couche 2) : jette les franchises/portails récurrents NON listés (data-driven) ──
  const cleaned = dropChainNetworks(withSite, log)

  // ── 2. dédup des lignes à site direct (registre) ──
  const fresh: Found[] = []
  for (const f of cleaned) {
    if (fresh.length >= limit) break
    if (reg.add(f, date)) fresh.push(f)
  }

  // ── 3. enrichissement des lignes sans site (sirene), en sautant celles déjà tentées ──
  if (enrichOn && noSite.length && fresh.length < limit) {
    const toTry = noSite.filter((f) => !f.key || !reg.hasKey(f.key)).slice(0, Math.max(0, (limit === Infinity ? perSource : limit) * 3))
    log(`  → enrichissement de ${toTry.length} prospects sans site (devine-domaine + DNS, fallback DDG)…`)
    const { enriched, viaGuess, viaDdg, failed } = await enrichAll(toTry, tldsFor(zone), log)
    log(`  enrich terminé : ${enriched.length} sites trouvés (${viaGuess} guess / ${viaDdg} ddg) · ${failed} sans site`)
    for (const f of toTry) reg.markTried(f.key!, date) // tenté = ne pas re-tenter au prochain run
    for (const f of enriched) {
      if (fresh.length >= limit) break
      if (reg.add(f, date)) fresh.push(f)
    }
  }

  // ── 4. contacts gratuits : tél + email depuis le site (nourrit scoring closabilité + distribution) ──
  // enveloppé : sur des centaines de sites, un plante réseau est certain → il ne doit PAS empêcher la persistance.
  if (process.env.HARVEST !== "0" && fresh.length) {
    log(`  → récupération des contacts (tél + email) sur ${fresh.length} sites…`)
    try {
      const { phones, emails } = await harvestContacts(fresh, log)
      log(`  contacts : +${phones} téléphones · +${emails} emails`)
    } catch (e) { log(`  harvest interrompu (on sauve quand même les prospects) : ${(e as Error).message}`) }
  }

  // ── 5. persistance (CSV + registre) ──
  await appendCsv(fresh)
  await reg.save()
  return fresh
}

// --- CLI ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // le harvest tape des centaines de sites tiers : un socket reset / erreur réseau isolée est INÉVITABLE.
  // On la dégrade en avertissement au lieu de laisser node crasher tout le run (et perdre le lot entier).
  process.on("unhandledRejection", (r: any) => console.warn(`  ⚠ rejet réseau ignoré : ${String(r?.message || r).slice(0, 90)}`))
  process.on("uncaughtException", (e) => console.warn(`  ⚠ exception réseau ignorée : ${e.message.slice(0, 90)}`))
  const [industry, zone = agency().country === "FR" ? "all" : agency().country.toLowerCase()] = process.argv.slice(2)
  if (!industry) {
    console.error(`usage: npm run scrape -- <industry> [fr|be|ch|all|us|gb|ca|au|us-ca…]   (métiers : ${Object.keys(INDUSTRIES).join(", ")})`)
    process.exit(1)
  }
  console.log(`🔎 scrape ${industry} (${zone}) — sources multiples (OSM + SIRENE + gosom), enrichissement web`)
  const radar = radarOneLine(industry)
  if (radar) console.log(`   ${radar}\n`); else console.log(`   (métier hors radar — penses-tu à \`npm run radar\` ?)\n`)
  const fresh = await scrapeProspects(industry, zone)
  const bySource = fresh.reduce<Record<string, number>>((a, f) => ((a[f.source] = (a[f.source] ?? 0) + 1), a), {})
  console.log(`\n✅ ${fresh.length} NOUVEAUX prospects → ${SCRAPED}`)
  console.log(`   par source : ${Object.entries(bySource).map(([s, n]) => `${s} ${n}`).join(" · ") || "—"}`)
  console.log(`   pipeline : SEED=${SCRAPED} npm run pipeline`)
}
