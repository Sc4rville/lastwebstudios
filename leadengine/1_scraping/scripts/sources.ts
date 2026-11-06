/**
 * Scraping — les SOURCES (providers). Chacune renvoie des `Found[]`, l'orchestrateur fait le reste.
 *
 *   osm      — OpenStreetMap/Overpass (FR+BE+CH). Gratuit, légal (ODbL). Donne le SITE directement.
 *   sirene   — API Recherche d'entreprises (FR, gouv, sans clé). Couverture MASSIVE (tout le registre
 *              par NAF × département), mais PAS de site → l'enrichissement le retrouvera.
 *   gmapsCsv — adapter : ingère un CSV produit par gosom/google-maps-scraper (opt-in GMAPS_CSV=path).
 *              Donne site + tél. Hors-process (binaire Go), zéro dépendance ajoutée au repo.
 */
import { readFile } from "node:fs/promises"
import { isChain, clean, sleep, csvSplit, type Found } from "./util.ts"
import { INDUSTRIES, OSM_ZONES, osmZone } from "./industries.ts"
import { agency } from "../../../packages/shared/agency.mjs"

// Overpass et recherche-entreprises demandent un User-Agent qui identifie l'appelant : agency.config.json › http.userAgent
const UA = agency().http.userAgent

// ─────────────────────────── OSM / Overpass ───────────────────────────
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]

async function overpass(query: string): Promise<any[]> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const mirror of OVERPASS) {
      try {
        const res = await fetch(mirror, {
          method: "POST",
          body: new URLSearchParams({ data: query }),
          headers: { "user-agent": UA }, // UA identifié sinon rate-limit immédiat
          signal: AbortSignal.timeout(230_000),
        })
        if (res.status === 429 || res.status === 504) { lastErr = new Error(`overpass ${res.status}`); await sleep(25_000); continue }
        if (!res.ok) throw new Error(`overpass HTTP ${res.status}`)
        return (await res.json()).elements ?? []
      } catch (e) { lastErr = e }
    }
  }
  throw lastErr
}

export async function osmSource(industry: string, zoneKey: string, log: (s: string) => void): Promise<Found[]> {
  const ind = INDUSTRIES[industry]
  const one = osmZone(zoneKey)
  const zones = zoneKey === "all" ? [OSM_ZONES.fr, OSM_ZONES.be, OSM_ZONES.ch] : one ? [one] : null
  if (!zones) throw new Error(`zone OSM inconnue : ${zoneKey} (fr|be|ch|all, un pays ISO « us », ou une subdivision « us-ca »)`)

  const out: Found[] = []
  for (const [i, z] of zones.entries()) {
    if (i > 0) await sleep(8_000) // politesse entre zones
    const blocks = ind.osm.flatMap((sel) => [`nwr${sel}["website"](area.z);`, `nwr${sel}["contact:website"](area.z);`]).join("\n  ")
    const els = await overpass(`[out:json][timeout:220];\n(\n  ${z.areas.join("\n  ")}\n)->.z;\n(\n  ${blocks}\n);\nout tags center;`)
    let kept = 0
    for (const el of els) {
      const t = el.tags ?? {}
      const name = clean(t.name ?? "")
      const website = (t.website ?? t["contact:website"] ?? "").trim().split(";")[0]
      if (!name || !website) continue
      if (t.brand || t["brand:wikidata"] || isChain(name, website, ind.chains)) continue
      out.push({ name, city: clean(t["addr:city"] ?? ""), website, phone: clean(t.phone ?? t["contact:phone"] ?? ""), industry, source: "osm" })
      kept++
    }
    log(`  osm    ${z.label.padEnd(26)} ${String(els.length).padStart(4)} avec site · ${kept} indépendants`)
  }
  return out
}

// ─────────────────────────── SIRENE (FR) ───────────────────────────
const SIRENE = "https://recherche-entreprises.api.gouv.fr/search"

async function sireneFetch(params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString()
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${SIRENE}?${qs}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) })
      if (res.status === 429) { await sleep(2_000 * (attempt + 1)); continue } // 7 req/s : on respire
      if (!res.ok) throw new Error(`sirene HTTP ${res.status}`)
      return await res.json()
    } catch (e) { if (attempt === 3) throw e; await sleep(1_500) }
  }
}

/** FR seulement. Itère NAF × départements, pagine, garde les PME indépendantes (sans site → enrich). */
export async function sireneSource(
  industry: string,
  opts: { depts: string[]; cap: number },
  log: (s: string) => void,
): Promise<Found[]> {
  const ind = INDUSTRIES[industry]
  const out: Found[] = []
  const seenSiren = new Set<string>()

  for (const dept of opts.depts) {
    if (out.length >= opts.cap) break
    let kept = 0
    for (const naf of ind.naf) {
      if (out.length >= opts.cap) break
      let page = 1
      while (out.length < opts.cap) {
        const d = await sireneFetch({
          activite_principale: naf, departement: dept, etat_administratif: "A",
          page: String(page), per_page: "25",
        })
        const results: any[] = d?.results ?? []
        if (!results.length) break
        for (const e of results) {
          const cat = e.categorie_entreprise // GE/ETI = grand groupe → hors cible
          if (cat === "GE" || cat === "ETI") continue
          if ((e.nombre_etablissements_ouverts ?? 1) > 8) continue // mini-chaîne
          const name = clean(e.nom_complet ?? e.nom_raison_sociale ?? "")
          if (!name || isChain(name, "", INDUSTRIES[industry]?.chains)) continue
          const siren = String(e.siren ?? "")
          if (seenSiren.has(siren)) continue
          seenSiren.add(siren)
          // ville = l'établissement DU DÉPARTEMENT cherché (pas le siège, qui peut être ailleurs)
          const etab = (e.matching_etablissements ?? [])[0] ?? e.siege ?? {}
          out.push({
            name, city: clean(etab.libelle_commune ?? (e.siege ?? {}).libelle_commune ?? ""), website: "", phone: "",
            industry, source: "sirene", key: `sirene:${siren}`,
          })
          kept++
          if (out.length >= opts.cap) break
        }
        if (page >= (d.total_pages ?? 1)) break
        page++
        await sleep(150) // ~7 req/s max
      }
    }
    if (kept) log(`  sirene dept ${dept.padEnd(20)} ${kept} PME (à enrichir)`)
  }
  return out
}

// ─────────────────────────── gosom CSV (opt-in) ───────────────────────────
/** Ingère un CSV gosom/google-maps-scraper. Colonnes tolérantes (title/name, website, phone, address). */
export async function gmapsCsvSource(path: string, industry: string, log: (s: string) => void): Promise<Found[]> {
  const text = await readFile(path, "utf8")
  const lines = text.split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return []
  const cols = csvSplit(lines[0]).map((c) => c.trim().toLowerCase()) // vrai parse : les CSV gosom sont quotés
  const idx = (names: string[]) => names.map((n) => cols.indexOf(n)).find((i) => i >= 0) ?? -1
  const iName = idx(["title", "name", "nom"]), iSite = idx(["website", "site", "url"])
  const iPhone = idx(["phone", "telephone", "tel"]), iCity = idx(["city", "ville"]), iAddr = idx(["address", "adresse"])
  const cell = (row: string[], i: number) => (i >= 0 ? clean(row[i]?.replace(/^"|"$/g, "") ?? "") : "")

  const out: Found[] = []
  for (const line of lines.slice(1)) {
    const row = csvSplit(line)
    const name = cell(row, iName), website = cell(row, iSite)
    if (!name || !website || isChain(name, website, INDUSTRIES[industry]?.chains)) continue
    const city = cell(row, iCity) || cell(row, iAddr).match(/\b\d{4,5}\s+([A-ZÀ-Ÿ][\w' -]+)/)?.[1] || ""
    out.push({ name, city: clean(city), website, phone: cell(row, iPhone), industry, source: "gmaps" })
  }
  log(`  gmaps  CSV ${path} → ${out.length} indépendants avec site`)
  return out
}
