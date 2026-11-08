/**
 * Scraping — the SOURCES (providers). Each returns `Found[]`, the orchestrator does the rest.
 *
 *   osm      — OpenStreetMap/Overpass (FR+BE+CH). Free, legal (ODbL). Gives the SITE directly.
 *   sirene   — API Recherche d'entreprises (FR, government, no key). MASSIVE coverage (the whole registry
 *              by NAF code × département), but NO site → enrichment will find it.
 *   gmapsCsv — adapter: ingests a CSV produced by gosom/google-maps-scraper (opt-in GMAPS_CSV=path).
 *              Gives site + phone. Out of process (Go binary), no dependency added to the repo.
 */
import { readFile } from "node:fs/promises"
import { isChain, clean, sleep, csvSplit, type Found } from "./util.ts"
import { INDUSTRIES, OSM_ZONES, osmZone } from "./industries.ts"
import { agency } from "../../../packages/shared/agency.mjs"

// Overpass and recherche-entreprises ask for a User-Agent that identifies the caller: agency.config.json › http.userAgent
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
          headers: { "user-agent": UA }, // an identified UA, otherwise an immediate rate limit
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
  if (!zones) throw new Error(`unknown OSM area: ${zoneKey} (fr|be|ch|all, an ISO country "us", or a subdivision "us-ca")`)

  const out: Found[] = []
  for (const [i, z] of zones.entries()) {
    if (i > 0) await sleep(8_000) // politeness between areas
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
    log(`  osm    ${z.label.padEnd(26)} ${String(els.length).padStart(4)} with a site · ${kept} independents`)
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
      if (res.status === 429) { await sleep(2_000 * (attempt + 1)); continue } // 7 req/s: take a breath
      if (!res.ok) throw new Error(`sirene HTTP ${res.status}`)
      return await res.json()
    } catch (e) { if (attempt === 3) throw e; await sleep(1_500) }
  }
}

/** FR only. Iterates NAF codes × départements, paginates, keeps independent small businesses (no site → enrich). */
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
          const cat = e.categorie_entreprise // GE/ETI = large group → off target
          if (cat === "GE" || cat === "ETI") continue
          if ((e.nombre_etablissements_ouverts ?? 1) > 8) continue // mini-chain
          const name = clean(e.nom_complet ?? e.nom_raison_sociale ?? "")
          if (!name || isChain(name, "", INDUSTRIES[industry]?.chains)) continue
          const siren = String(e.siren ?? "")
          if (seenSiren.has(siren)) continue
          seenSiren.add(siren)
          // town = the establishment IN THE département searched (not the head office, which may be elsewhere)
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
    if (kept) log(`  sirene dept ${dept.padEnd(20)} ${kept} small businesses (to enrich)`)
  }
  return out
}

// ─────────────────────────── gosom CSV (opt-in) ───────────────────────────
/** Ingests a gosom/google-maps-scraper CSV. Tolerant columns (title/name, website, phone, address). */
export async function gmapsCsvSource(path: string, industry: string, log: (s: string) => void): Promise<Found[]> {
  const text = await readFile(path, "utf8")
  const lines = text.split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return []
  const cols = csvSplit(lines[0]).map((c) => c.trim().toLowerCase()) // a real parse: gosom CSVs are quoted
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
  log(`  gmaps  CSV ${path} → ${out.length} independents with a site`)
  return out
}
