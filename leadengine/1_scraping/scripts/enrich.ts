/**
 * Scraping — ENRICHMENT: find a company's website from its name + town.
 *
 * This is what makes SIRENE (massive coverage, but no site) usable. Two routes, the cheap
 * one first:
 *   1. guessed domain + DNS: slug(name) → candidates (.fr/.com/.be/.ch), resolved in DNS then validated.
 *   2. OPT-IN (agency.config.json › leadengine.searchFallback): DuckDuckGo HTML, then Bing as a backup, the 1st
 *      organic result that is not an aggregator, validated. Off by default: reading result pages by program breaks
 *      the search engines' terms of use (docs/GUIDE.md §10).
 * Always validated: the page answers, is not a parked domain, and a distinctive token of the name
 * appears in the domain or the <title> (otherwise a false positive → dropped).
 *
 * Mechanical, zero LLM, zero key. Bounded concurrency (ENRICH_CONC, default 8).
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

// the name's distinctive tokens (≥3 letters, without generic words/legal forms)
function tokens(name: string): string[] {
  return norm(name).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t))
}

const PARKING = /domain (is )?for sale|parked (free|domain)|buy this domain|achetez ce domaine|ce domaine est (à vendre|en vente)|sedo|godaddy|under construction|en construction|site (en )?cours/i
// a municipality's official site (the trap: a company named after its town → we land on the town hall)
const TOWNSITE = /mairie|conseil municipal|commune de |ville de |service public|état civil|élu·?e?s|délibérations? du conseil|centre communal/i

async function resolves(domain: string): Promise<boolean> {
  try { return (await dns.resolve(domain, "A")).length > 0 } catch { try { return (await dns.resolve(domain, "AAAA")).length > 0 } catch { return false } }
}

/**
 * Validates a candidate site. STRICT against false positives (lesson of the 1st test: durand.com, citernes.com,
 * dorelan… matched by chance). Requires TWO proofs:
 *   1. OWNERSHIP: a distinctive token of the name in the domain or the <title>;
 *   2. RELEVANCE: the page really talks about the TRADE (a trade term present) OR names the TOWN.
 * A mattress / tank / national brand site fails proof #2 → dropped.
 */
async function validate(url: string, nameToks: string[], topic: string[], city: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(12_000) })
    if (!res.ok) return null
    const finalDomain = domainOf(res.url)
    if (!finalDomain || AGGREGATORS.test(finalDomain)) return null
    const raw = (await readHtml(res)).slice(0, 120_000) // ISO-8859-1 included: otherwise the name and town can't be found in the page
    if (PARKING.test(raw) || TOWNSITE.test(raw)) return null
    const sld = finalDomain.split(".")[0] // the domain's distinctive label (before the TLD)
    const title = norm(raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")
    // metadata (often present even on a JS-rendered site) + visible text
    const meta = norm([...raw.matchAll(/<meta[^>]+(?:name|property)=["'](?:description|og:title|og:description|og:site_name)["'][^>]+content=["']([^"']+)["']/gi)].map((m) => m[1]).join(" "))
    const h1 = norm([...raw.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => m[1]).join(" "))
    const text = norm(raw.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " "))
    const blob = `${title} ${meta} ${h1} ${text}`
    const cityTok = norm(city).split(/[^a-z0-9]+/).filter((t) => t.length >= 4)

    // distinctive words OTHER than the town's name (otherwise a company named after its town matches the town hall's site)
    const distinct = nameToks.filter((t) => !cityTok.includes(t))
    if (!distinct.length) return null
    // OWNERSHIP: a distinctive word (≠ town) in the domain or the title
    const belongs = distinct.some((t) => sld.includes(t) || title.includes(t))
    // RELEVANCE: the page (or the domain) talks about the TRADE, or the town appears in the page
    const relevant = topic.some((t) => blob.includes(t) || sld.includes(t)) || cityTok.some((t) => blob.includes(t))

    if (belongs && relevant) return `https://${finalDomain}/`
    return null
  } catch { return null }
}

// route 1: guess the domain from the name (specific stems only) × TLDs
async function guess(name: string, tlds: string[], nameToks: string[], topic: string[], city: string): Promise<string | null> {
  const base = slug(name)
  if (!base) return null
  // SPECIFIC ENOUGH stems (≥5 chars): avoids mpc.fr, casad.fr… (names too short go through DDG)
  const stems = [...new Set([base.replace(/-/g, ""), base, nameToks.join(""), nameToks.join("-")])]
    .filter((s) => s && s.replace(/-/g, "").length >= 5)
  for (const dom of stems.flatMap((s) => tlds.map((tld) => `${s}.${tld}`))) {
    if (!(await resolves(dom))) continue
    const ok = await validate(`https://${dom}/`, nameToks, topic, city)
    if (ok) return ok
  }
  return null
}

// route 2: DuckDuckGo HTML, organic links that are not aggregators, validated
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
      const ok = await validate(u, nameToks, topic, city) // the domain may differ from the name → the title/content decides
      if (ok) return ok
    }
    return null
  } catch { return null }
}

// route 3 (BACKUP): Bing HTML — DDG was a SINGLE point of failure (anti-bot / outage = zero
// enrichment). Same contract: organic links that are not aggregators, validated by their content.
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
  if (!agency().leadengine?.searchFallback) return null // search engines: opt-in (terms of use)
  await sleep(300 + (nameToks.length % 5) * 80) // a slight spread before DDG
  const d = await ddg(f.name, f.city, nameToks, topic)
  if (d) return { website: d, via: "ddg" }
  const b = await bing(f.name, f.city, nameToks, topic) // backup if DDG is silent/blocked
  if (b) return { website: b, via: "bing" }
  return null
}

/** enriches a list of Found without a site in place; returns {found, stats}. Bounded concurrency. */
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
        r.via === "guess" ? viaGuess++ : viaDdg++ // bing counted with ddg (the SERP route)
      } else failed++
      if (done % 25 === 0) log(`  enrich ${done}/${list.length} · ${viaGuess + viaDdg} sites found (${viaGuess} guess / ${viaDdg} serp)`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, list.length) }, worker))
  return { enriched, viaGuess, viaDdg, failed }
}
