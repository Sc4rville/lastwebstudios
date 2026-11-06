/**
 * Scraping — ENRICHISSEMENT : retrouver le site web d'une boîte depuis nom + ville.
 *
 * C'est ce qui rend SIRENE (couverture massive, mais sans site) exploitable. Deux voies, la pas
 * chère d'abord :
 *   1. devine-domaine + DNS : slug(nom) → candidats (.fr/.com/.be/.ch), résolus en DNS puis validés.
 *   2. OPT-IN (agency.config.json › leadengine.searchFallback) : DuckDuckGo HTML puis Bing en secours, 1er résultat
 *      organique hors agrégateur, validé. Coupé par défaut : lire des pages de résultats par programme sort des
 *      conditions d'utilisation des moteurs (docs/GUIDE.md §10).
 * Validation systématique : la page répond, n'est pas un parking, et un token distinctif du nom
 * apparaît dans le domaine ou le <title> (sinon faux positif → on jette).
 *
 * Mécanique, zéro LLM, zéro clé. Concurrence bornée (ENRICH_CONC, défaut 8).
 */
import dns from "node:dns/promises"
import { AGGREGATORS, domainOf, readHtml, slug, sleep, type Found } from "./util.ts"
import { industryTerms } from "./industries.ts"
import { agency } from "../../../packages/shared/agency.mjs"

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
const STOP = new Set([
  "sarl", "sas", "sa", "eurl", "sasu", "snc", "scop", "sci", "ets", "etablissements", "etablissement",
  "et", "de", "du", "des", "la", "le", "les", "aux", "chez", "groupe", "atelier", "ateliers", "maison",
  "cuisine", "cuisines", "menuiserie", "menuiseries", "agencement", "architecte", "architecture",
  "ferronnerie", "paysagiste", "jardin", "france", "fils", "freres", "pere",
])

// tokens distinctifs du nom (≥3 lettres, hors mots génériques/forme juridique)
function tokens(name: string): string[] {
  return norm(name).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t))
}

const PARKING = /domain (is )?for sale|parked (free|domain)|buy this domain|achetez ce domaine|ce domaine est (à vendre|en vente)|sedo|godaddy|under construction|en construction|site (en )?cours/i
// site institutionnel d'une commune (piège : une boîte nommée d'après sa ville → on tombe sur la mairie)
const TOWNSITE = /mairie|conseil municipal|commune de |ville de |service public|état civil|élu·?e?s|délibérations? du conseil|centre communal/i

async function resolves(domain: string): Promise<boolean> {
  try { return (await dns.resolve(domain, "A")).length > 0 } catch { try { return (await dns.resolve(domain, "AAAA")).length > 0 } catch { return false } }
}

/**
 * Valide un candidat-site. Anti-faux-positif STRICT (leçon du 1er test : durand.com, citernes.com,
 * dorelan… matchaient par hasard). Exige DEUX preuves :
 *   1. APPARTENANCE : un token distinctif du nom dans le domaine ou le <title> ;
 *   2. PERTINENCE   : la page parle bien du MÉTIER (terme métier présent) OU cite la VILLE.
 * Un site de matelas/cuves/marque nationale échoue la preuve #2 → écarté.
 */
async function validate(url: string, nameToks: string[], topic: string[], city: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(12_000) })
    if (!res.ok) return null
    const finalDomain = domainOf(res.url)
    if (!finalDomain || AGGREGATORS.test(finalDomain)) return null
    const raw = (await readHtml(res)).slice(0, 120_000) // ISO-8859-1 compris : sinon nom et ville introuvables dans la page
    if (PARKING.test(raw) || TOWNSITE.test(raw)) return null
    const sld = finalDomain.split(".")[0] // label distinctif du domaine (avant le TLD)
    const title = norm(raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")
    // métadonnées (souvent présentes même sur un site rendu en JS) + texte visible
    const meta = norm([...raw.matchAll(/<meta[^>]+(?:name|property)=["'](?:description|og:title|og:description|og:site_name)["'][^>]+content=["']([^"']+)["']/gi)].map((m) => m[1]).join(" "))
    const h1 = norm([...raw.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => m[1]).join(" "))
    const text = norm(raw.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " "))
    const blob = `${title} ${meta} ${h1} ${text}`
    const cityTok = norm(city).split(/[^a-z0-9]+/).filter((t) => t.length >= 4)

    // mots distinctifs HORS nom de ville (sinon une boîte nommée d'après sa ville matche le site de la mairie)
    const distinct = nameToks.filter((t) => !cityTok.includes(t))
    if (!distinct.length) return null
    // APPARTENANCE : un mot distinctif (≠ ville) dans le domaine ou le titre
    const belongs = distinct.some((t) => sld.includes(t) || title.includes(t))
    // PERTINENCE : la page (ou le domaine) parle du MÉTIER, ou la ville apparaît dans la page
    const relevant = topic.some((t) => blob.includes(t) || sld.includes(t)) || cityTok.some((t) => blob.includes(t))

    if (belongs && relevant) return `https://${finalDomain}/`
    return null
  } catch { return null }
}

// voie 1 : deviner le domaine depuis le nom (stems spécifiques uniquement) × TLDs
async function guess(name: string, tlds: string[], nameToks: string[], topic: string[], city: string): Promise<string | null> {
  const base = slug(name)
  if (!base) return null
  // stems ASSEZ spécifiques (≥5 car.) : évite mpc.fr, casad.fr… (les noms trop courts passeront par DDG)
  const stems = [...new Set([base.replace(/-/g, ""), base, nameToks.join(""), nameToks.join("-")])]
    .filter((s) => s && s.replace(/-/g, "").length >= 5)
  for (const dom of stems.flatMap((s) => tlds.map((tld) => `${s}.${tld}`))) {
    if (!(await resolves(dom))) continue
    const ok = await validate(`https://${dom}/`, nameToks, topic, city)
    if (ok) return ok
  }
  return null
}

// voie 2 : DuckDuckGo HTML, liens organiques hors agrégateur, validés
async function ddg(name: string, city: string, nameToks: string[], topic: string[]): Promise<string | null> {
  try {
    const q = encodeURIComponent(`${name} ${city} ${topic[0]}`.trim())
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const html = await res.text()
    const links = [...html.matchAll(/class="result__a"[^>]*href="([^"]+)"/g)]
      .map((m) => decodeURIComponent((m[1].match(/uddg=([^&"]+)/)?.[1] ?? "")))
      .filter((u) => u.startsWith("http") && !AGGREGATORS.test(domainOf(u)))
    for (const u of links.slice(0, 5)) {
      const ok = await validate(u, nameToks, topic, city) // le domaine peut différer du nom → le title/contenu tranche
      if (ok) return ok
    }
    return null
  } catch { return null }
}

// voie 3 (SECOURS) : Bing HTML — DDG était un point de défaillance UNIQUE (anti-bot/panne = zéro
// enrichissement). Même contrat : liens organiques hors agrégateurs, validés par le contenu.
async function bing(name: string, city: string, nameToks: string[], topic: string[]): Promise<string | null> {
  try {
    const q = encodeURIComponent(`${name} ${city} ${topic[0]}`.trim())
    const res = await fetch(`https://www.bing.com/search?q=${q}&setlang=fr`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const html = await res.text()
    const links = [...html.matchAll(/<h2><a[^>]+href="(https?:\/\/[^"]+)"/g)]
      .map((m) => m[1])
      .filter((u) => !AGGREGATORS.test(domainOf(u)) && !/bing\.|microsoft\./.test(domainOf(u)))
    for (const u of links.slice(0, 5)) {
      const ok = await validate(u, nameToks, topic, city)
      if (ok) return ok
    }
    return null
  } catch { return null }
}

export type EnrichResult = { website: string; via: "guess" | "ddg" | "bing" } | null

export async function enrichOne(f: Found, tlds: string[]): Promise<EnrichResult> {
  const nameToks = tokens(f.name)
  if (!nameToks.length) return null
  const topic = industryTerms(f.industry).map(norm)
  const g = await guess(f.name, tlds, nameToks, topic, f.city)
  if (g) return { website: g, via: "guess" }
  if (!agency().leadengine?.searchFallback) return null // moteurs de recherche : opt-in (conditions d'utilisation)
  await sleep(300 + (nameToks.length % 5) * 80) // léger étalement avant DDG
  const d = await ddg(f.name, f.city, nameToks, topic)
  if (d) return { website: d, via: "ddg" }
  const b = await bing(f.name, f.city, nameToks, topic) // secours si DDG muet/bloqué
  if (b) return { website: b, via: "bing" }
  return null
}

/** enrichit en place une liste de Found sans site ; renvoie {found, stats}. Concurrence bornée. */
export async function enrichAll(
  list: Found[],
  tlds: string[],
  log: (s: string) => void,
): Promise<{ enriched: Found[]; viaGuess: number; viaDdg: number; failed: number }> {
  const conc = Number(process.env.ENRICH_CONC) || 8
  const enriched: Found[] = []
  let viaGuess = 0, viaDdg = 0, failed = 0, done = 0
  let i = 0
  async function worker() {
    while (i < list.length) {
      const f = list[i++]
      const r = await enrichOne(f, tlds)
      done++
      if (r) {
        f.website = r.website
        enriched.push(f)
        r.via === "guess" ? viaGuess++ : viaDdg++ // bing compté avec ddg (voie SERP)
      } else failed++
      if (done % 25 === 0) log(`  enrich ${done}/${list.length} · ${viaGuess + viaDdg} sites trouvés (${viaGuess} guess / ${viaDdg} serp)`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, list.length) }, worker))
  return { enriched, viaGuess, viaDdg, failed }
}
