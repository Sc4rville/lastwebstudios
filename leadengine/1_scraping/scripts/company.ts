/**
 * company.ts — qualifie un prospect via l'API gouv **Recherche d'entreprises** (gratuite, SANS clé,
 * source INSEE/INPI). But : n'appeler que de VRAIS bons prospects → on vérifie qu'il est **ACTIF**
 * (pas radié/fermé) et on lit sa **TAILLE** (effectif/catégorie/établissements) + son **CA** si déposé.
 *
 * Honnêteté : l'état actif et l'effectif sont TOUJOURS là (fiables) ; le **CA n'est public que si la
 * boîte a déposé ses comptes** (rare chez les petits artisans → souvent absent). On rend ce qu'on a.
 *
 * MATCHING (corrigé le 2026-10-24) : un mot de MÉTIER (« piscines », « cuisines », « menuiserie »…) ne prouve
 * rien. Avant, « Orvane Piscines » (1 mot sur 2) était rapproché d'une AUTRE société cessée contenant
 * « piscines », et le gate dur « société RADIÉE » jetait un vrai prospect. Désormais :
 *   - seuls les mots DISTINCTIFS du nom comptent (mots de métier, formes juridiques, mots vides ignorés) ;
 *   - tous les mots distinctifs doivent se retrouver dans le nom (ou une enseigne) de la société ;
 *   - ET la société doit être corroborée par la VILLE ou le CODE POSTAL (siège ou un établissement),
 *     sauf nom distinctif de 2 mots ou plus et aucune ville/CP fournie ;
 *   - sinon : « inconnu » (on ne se prononce pas, aucun gate ne tombe).
 *
 *   npm run company -- "Orvane Piscines" Valmont-sur-Lys
 *   import { lookupCompany } from "./company.ts"
 *
 * Réseau : `LWS_SIRENE_URL` remplace l'URL de l'API (tests : faux serveur local) ; `LWS_SIRENE=0` coupe
 * l'appel (renvoie « inconnu » sans réseau).
 */
import { INDUSTRIES, INDUSTRY_ALIASES } from "./industries.ts"
import { agency, hasCompanyRegistry } from "../../../packages/shared/agency.mjs"

let warned = false
function warnNoRegistry() {
  if (warned) return
  warned = true
  console.error(`  registre : no public company registry wired for ${agency().country} (SIRENE is France only): status, size and revenue stay unknown; websites come from OSM or the guessed domain`)
}

const DEFAULT_API = "https://recherche-entreprises.api.gouv.fr/search"

// médiane indicative de chaque tranche d'effectif INSEE (proxy de taille quand le CA manque)
const EFFECTIF: Record<string, number> = {
  "00": 0, "01": 1, "02": 4, "03": 8, "11": 15, "12": 35, "21": 75, "22": 150,
  "31": 225, "32": 400, "41": 750, "42": 1500, "51": 3500, "52": 7500,
}
const ACCENTS = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
const toks = (s: string) => ACCENTS(s).replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter((t) => t.length > 2)
const STOP = new Set(["sarl", "sas", "sasu", "eurl", "sa", "ets", "etablissements", "entreprise", "societe", "groupe", "and", "les", "des", "une",
  "sur", "sous", "aux", "pour", "par", "chez", "the"])
// mots GÉNÉRIQUES : ils décrivent le métier ou l'activité, pas l'entreprise → jamais une preuve d'identité
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
  categorie: string | null // TPE/PME/ETI/GE (catégorie INSEE)
  ca: number | null
  caYear: string | null
  ageYears: number | null
  etablissementsOuverts: number | null
  naf: string | null
  nom: string | null
  match: number // 0-1 confiance du matching (nom+ville)
}

const UNKNOWN: CompanyInfo = { siren: null, active: false, status: "inconnu", effectifBand: null, employees: null, categorie: null, ca: null, caYear: null, ageYears: null, etablissementsOuverts: null, naf: null, nom: null, match: 0 }

const placeKey = (s: string) => ACCENTS(s).replace(/[^a-z0-9]+/g, "")

/** Les mots qui IDENTIFIENT l'entreprise (ni métier, ni forme juridique, ni mot vide). */
export function distinctiveTokens(name: string): string[] {
  return [...new Set(toks(name).filter((t) => !STOP.has(t) && !isGeneric(t)))]
}

/**
 * Confiance (0-1) qu'une réponse de l'API soit CETTE entreprise. 0 = pas elle / pas prouvable.
 * Règle : tous les mots distinctifs présents ET corroboration ville/CP (sauf ≥ 2 mots distinctifs sans ville/CP).
 */
export function scoreMatch(name: string, where: { city?: string; postal?: string }, r: any): number {
  const want = distinctiveTokens(name)
  if (!want.length) return 0 // nom fait de mots génériques seulement (« Piscines Services ») : invérifiable
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
  if (!city && !postal && want.length >= 2) return 0.7 // nom très distinctif, rien pour départager : prudent mais acceptable
  return 0
}

/** Seuil de confiance en dessous duquel on ne se prononce pas (« inconnu »). */
export const MATCH_MIN = 0.7

/** Interroge l'API et renvoie la meilleure correspondance qualifiée (ou UNKNOWN si rien de fiable). */
export async function lookupCompany(name: string, opts: { city?: string; postal?: string; siren?: string } = {}): Promise<CompanyInfo> {
  if (process.env.LWS_SIRENE === "0") return UNKNOWN
  // hors France : aucun registre public branché (SIRENE = INSEE) → « inconnu », aucun appel, aucun gate ne tombe
  if (!hasCompanyRegistry()) { warnNoRegistry(); return UNKNOWN }
  // recherche par NOM SEUL (la ville d'un prospect est souvent un département « Essonne » qui pollue le
  // matching plein-texte) ; la ville/CP ne sert qu'à CORROBORER (scoreMatch).
  const q = opts.siren ? opts.siren : encodeURIComponent((name || "").trim())
  if (!opts.siren && (!name || name.trim().length < 3)) return UNKNOWN
  const API = process.env.LWS_SIRENE_URL || DEFAULT_API
  const url = `${API}?q=${q}&page=1&per_page=5${opts.postal ? `&code_postal=${encodeURIComponent(opts.postal)}` : ""}`
  // l'API plafonne à ~7 req/s → retry avec backoff sur 429/5xx (sinon mass-"inconnu" en batch)
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

  // choisit la meilleure correspondance (par siren exact, sinon nom distinctif + ville/CP) ; seuil anti-faux-positif
  const ranked = results.map((r) => ({ r, m: opts.siren ? (String(r.siren) === String(opts.siren) ? 1 : 0) : scoreMatch(name, { city: opts.city, postal: opts.postal }, r) })).sort((a, b) => b.m - a.m)
  const best = ranked[0]
  if (!best || best.m < MATCH_MIN) return UNKNOWN // pas assez sûr → on ne se prononce pas (on n'invente pas un état)
  const r = best.r

  const fin = r.finances || {}
  const years = Object.keys(fin).sort()
  let ca: number | null = null, caYear: string | null = null
  for (const y of years.reverse()) { const v = fin[y]?.ca; if (v != null && v > 0) { ca = v; caYear = y; break } }
  const band = r.tranche_effectif_salarie || null
  const active = r.etat_administratif === "A"
  const created = r.date_creation ? new Date(r.date_creation) : null
  // âge en années sans Date.now() interdit ? ici on est en script Node normal (pas Workflow) → OK
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

// ── CLI : npm run company -- "<nom>" [ville] ──
import { fileURLToPath } from "node:url"
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [name, city, postal] = process.argv.slice(2)
  if (!name) { console.error('usage: npm run company -- "<nom>" [ville] [code postal]'); process.exit(1) }
  const info = await lookupCompany(name, { city, postal })
  const flag = info.status === "actif" ? "✓ ACTIF" : info.status === "cessé" ? "✗ CESSÉ (ne pas appeler)" : "? inconnu"
  console.log(`${flag} — ${info.nom || name} (match ${info.match})`)
  console.log(`  siren ${info.siren || "—"} · NAF ${info.naf || "—"} · créée il y a ${info.ageYears ?? "?"} ans`)
  console.log(`  taille : effectif ~${info.employees ?? "?"} (tranche ${info.effectifBand || "—"}) · catégorie ${info.categorie || "—"} · ${info.etablissementsOuverts ?? "?"} établissement(s) ouvert(s)`)
  console.log(`  CA : ${info.ca != null ? info.ca.toLocaleString("fr-FR") + " € (" + info.caYear + ")" : "non déposé / confidentiel"}`)
  process.exit(0)
}
