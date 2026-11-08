/**
 * company.ts — qualifies a prospect through the French government API **Recherche d'entreprises** (free, NO key,
 * INSEE/INPI data). Goal: call only REAL good prospects → we check the company is **ACTIVE**
 * (not struck off/closed) and read its **SIZE** (headcount/category/establishments) + its **revenue** if filed.
 *
 * Honesty: the active status and the headcount are ALWAYS there (reliable); **revenue is public only if the
 * company filed its accounts** (rare for small tradespeople → often missing). We return what we have.
 *
 * MATCHING (fixed on 2026-10-24): a TRADE word ("piscines", "cuisines", "menuiserie"…) proves
 * nothing. Before, "Orvane Piscines" (1 word out of 2) was matched with ANOTHER, closed company containing
 * "piscines", and the hard "company STRUCK OFF" gate dropped a real prospect. Now:
 *   - only the name's DISTINCTIVE words count (trade words, legal forms, stop words ignored);
 *   - every distinctive word must appear in the company's name (or a trading name);
 *   - AND the company must be corroborated by the TOWN or the POSTCODE (head office or an establishment),
 *     unless the distinctive name has 2 words or more and no town/postcode was given;
 *   - otherwise: "inconnu" (unknown: we don't decide, no gate falls).
 *
 *   npm run company -- "Orvane Piscines" Valmont-sur-Lys
 *   import { lookupCompany } from "./company.ts"
 *
 * Network: `LWS_SIRENE_URL` replaces the API's URL (tests: a fake local server); `LWS_SIRENE=0` turns
 * the call off (returns "inconnu" without any network).
 */
import { INDUSTRIES, INDUSTRY_ALIASES } from "./industries.ts"
import { agency, hasCompanyRegistry } from "../../../packages/shared/agency.mjs"

let warned = false
function warnNoRegistry() {
  if (warned) return
  warned = true
  console.error(`  registry: no public company registry wired for ${agency().country} (SIRENE is France only): status, size and revenue stay unknown; websites come from OSM or the guessed domain`)
}

const DEFAULT_API = "https://recherche-entreprises.api.gouv.fr/search"

// indicative median of each INSEE headcount band (a size proxy when revenue is missing)
const EFFECTIF: Record<string, number> = {
  "00": 0, "01": 1, "02": 4, "03": 8, "11": 15, "12": 35, "21": 75, "22": 150,
  "31": 225, "32": 400, "41": 750, "42": 1500, "51": 3500, "52": 7500,
}
const ACCENTS = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
const toks = (s: string) => ACCENTS(s).replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter((t) => t.length > 2)
const STOP = new Set(["sarl", "sas", "sasu", "eurl", "sa", "ets", "etablissements", "entreprise", "societe", "groupe", "and", "les", "des", "une",
  "sur", "sous", "aux", "pour", "par", "chez", "the"])
// GENERIC words: they describe the trade or the activity, not the company → never a proof of identity
const BASE_GENERIC = ["piscine", "spa", "cuisine", "menuiserie", "menuisier", "plomberie", "plombier", "chauffage", "electricite", "electricien",
  "maconnerie", "macon", "batiment", "renovation", "construction", "travaux", "habitat", "maison", "deco", "decoration", "design", "concept",
  "services", "service", "france", "pro", "artisan", "atelier", "agence", "studio", "creation", "creations", "amenagement", "agencement",
  "jardin", "jardins", "paysage", "paysagiste", "toiture", "couverture", "fermeture", "fermetures", "stores", "carrelage", "peinture",
  "boulangerie", "patisserie", "restaurant", "traiteur", "garage", "auto", "immobilier", "architecture", "architecte", "interieur", "nord", "sud", "est", "ouest"]
const singular = (t: string) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t)
const GENERIC: Set<string> = (() => {
  const words = new Set<string>()
  const add = (s: string) => { for (const t of toks(s)) words.add(singular(t)) }
  for (const w of BASE_GENERIC) add(w)
  for (const [k, ind] of Object.entries(INDUSTRIES)) { add(k.replace(/-/g, " ")); add(ind.label); for (const t of ind.terms) add(t) }
  for (const k of Object.keys(INDUSTRY_ALIASES)) add(k.replace(/-/g, " "))
  return words
})()
const isGeneric = (t: string) => GENERIC.has(singular(t))

export type CompanyInfo = {
  siren: string | null
  active: boolean
  status: "actif" | "cessé" | "inconnu"
  effectifBand: string | null
  employees: number | null
  categorie: string | null // TPE/PME/ETI/GE (INSEE category)
  ca: number | null
  caYear: string | null
  ageYears: number | null
  etablissementsOuverts: number | null
  naf: string | null
  nom: string | null
  match: number // 0-1 matching confidence (name + town)
}

const UNKNOWN: CompanyInfo = { siren: null, active: false, status: "inconnu", effectifBand: null, employees: null, categorie: null, ca: null, caYear: null, ageYears: null, etablissementsOuverts: null, naf: null, nom: null, match: 0 }

const placeKey = (s: string) => ACCENTS(s).replace(/[^a-z0-9]+/g, "")

/** The words that IDENTIFY the company (no trade word, no legal form, no stop word). */
export function distinctiveTokens(name: string): string[] {
  return [...new Set(toks(name).filter((t) => !STOP.has(t) && !isGeneric(t)))]
}

/**
 * Confidence (0-1) that an API answer is THIS company. 0 = not it / not provable.
 * Rule: every distinctive word present AND town/postcode corroboration (unless ≥ 2 distinctive words and no town/postcode).
 */
export function scoreMatch(name: string, where: { city?: string; postal?: string }, r: any): number {
  const want = distinctiveTokens(name)
  if (!want.length) return 0 // a name made of generic words only ("Piscines Services"): unverifiable
  const etabs: any[] = Array.isArray(r?.matching_etablissements) ? r.matching_etablissements : []
  const names = [r?.nom_complet, r?.nom_raison_sociale, r?.sigle, ...etabs.flatMap((e) => e?.liste_enseignes || [])].filter(Boolean).join(" ")
  const got = new Set(toks(names).map(singular))
  const hit = want.filter((t) => got.has(singular(t))).length
  if (hit < want.length) return 0
  const places = [r?.siege, ...etabs].filter(Boolean)
  const city = where.city ? placeKey(where.city) : ""
  const postal = (where.postal || "").replace(/\s+/g, "")
  const cityOk = !!city && places.some((p) => { const c = placeKey(p?.libelle_commune || ""); return !!c && (c === city || c.startsWith(city) || city.startsWith(c)) })
  const postalOk = !!postal && places.some((p) => String(p?.code_postal || "").replace(/\s+/g, "") === postal)
  if (cityOk || postalOk) return cityOk && postalOk ? 1 : 0.9
  if (!city && !postal && want.length >= 2) return 0.7 // a very distinctive name, nothing to decide with: cautious but acceptable
  return 0
}

/** The confidence threshold below which we don't decide ("inconnu"). */
export const MATCH_MIN = 0.7

/** Queries the API and returns the best qualified match (or UNKNOWN if nothing is reliable). */
export async function lookupCompany(name: string, opts: { city?: string; postal?: string; siren?: string } = {}): Promise<CompanyInfo> {
  if (process.env.LWS_SIRENE === "0") return UNKNOWN
  // outside France: no public registry wired in (SIRENE = INSEE) → "inconnu", no call, no gate falls
  if (!hasCompanyRegistry()) { warnNoRegistry(); return UNKNOWN }
  // search by NAME ALONE (a prospect's town is often a département like "Essonne", which pollutes the
  // full-text matching); the town/postcode only CORROBORATES (scoreMatch).
  const q = opts.siren ? opts.siren : encodeURIComponent((name || "").trim())
  if (!opts.siren && (!name || name.trim().length < 3)) return UNKNOWN
  const API = process.env.LWS_SIRENE_URL || DEFAULT_API
  const url = `${API}?q=${q}&page=1&per_page=5${opts.postal ? `&code_postal=${encodeURIComponent(opts.postal)}` : ""}`
  // the API caps at ~7 req/s → retry with backoff on 429/5xx (otherwise mass "inconnu" in a batch)
  let results: any[] | null = null
  for (let attempt = 0; attempt < 4 && results === null; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "lws-leadengine" }, signal: AbortSignal.timeout(12_000) })
      if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 400 * (attempt + 1) + 200)); continue }
      if (!res.ok) return UNKNOWN
      results = (await res.json()).results || []
    } catch { await new Promise((r) => setTimeout(r, 300 * (attempt + 1))) }
  }
  if (!results || !results.length) return UNKNOWN

  // picks the best match (exact siren, else distinctive name + town/postcode); a threshold against false positives
  const ranked = results.map((r) => ({ r, m: opts.siren ? (String(r.siren) === String(opts.siren) ? 1 : 0) : scoreMatch(name, { city: opts.city, postal: opts.postal }, r) })).sort((a, b) => b.m - a.m)
  const best = ranked[0]
  if (!best || best.m < MATCH_MIN) return UNKNOWN // not sure enough → we don't decide (we never invent a status)
  const r = best.r

  const fin = r.finances || {}
  const years = Object.keys(fin).sort()
  let ca: number | null = null, caYear: string | null = null
  for (const y of years.reverse()) { const v = fin[y]?.ca; if (v != null && v > 0) { ca = v; caYear = y; break } }
  const band = r.tranche_effectif_salarie || null
  const active = r.etat_administratif === "A"
  const created = r.date_creation ? new Date(r.date_creation) : null
  // age in years: Date.now() is fine here, this is a plain Node script (not a Workflow)
  const ageYears = created ? Math.max(0, Math.round((Date.now() - created.getTime()) / 31557600000)) : null

  return {
    siren: r.siren || null,
    active,
    status: active ? "actif" : "cessé",
    effectifBand: band,
    employees: band && band in EFFECTIF ? EFFECTIF[band] : null,
    categorie: r.categorie_entreprise || null,
    ca, caYear,
    ageYears,
    etablissementsOuverts: r.nombre_etablissements_ouverts ?? null,
    naf: r.activite_principale || null,
    nom: r.nom_complet || r.nom_raison_sociale || null,
    match: Math.round(best.m * 100) / 100,
  }
}

// ── CLI: npm run company -- "<name>" [town] ──
import { fileURLToPath } from "node:url"
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [name, city, postal] = process.argv.slice(2)
  if (!name) { console.error('usage: npm run company -- "<name>" [town] [postcode]'); process.exit(1) }
  const info = await lookupCompany(name, { city, postal })
  const flag = info.status === "actif" ? "✓ ACTIVE" : info.status === "cessé" ? "✗ CLOSED (do not call)" : "? unknown"
  console.log(`${flag} — ${info.nom || name} (match ${info.match})`)
  console.log(`  siren ${info.siren || "—"} · NAF ${info.naf || "—"} · founded ${info.ageYears ?? "?"} years ago`)
  console.log(`  size: headcount ~${info.employees ?? "?"} (band ${info.effectifBand || "—"}) · category ${info.categorie || "—"} · ${info.etablissementsOuverts ?? "?"} open establishment(s)`)
  console.log(`  revenue: ${info.ca != null ? info.ca.toLocaleString("fr-FR") + " € (" + info.caYear + ")" : "not filed / confidential"}`)
  process.exit(0)
}
