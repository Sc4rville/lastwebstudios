/**
 * Scraping — shared utilities (the Found type + helpers). No dependency.
 *
 * `Found` is the contract shared by ALL sources: each provider returns `Found[]`,
 * the orchestrator (scrape.ts) merges, enriches, deduplicates them → CSV `name,city,website,phone,industry`.
 */
export type Found = {
  name: string
  city: string
  website: string // "" until found (enrichment fills it in)
  phone: string
  email?: string
  industry: string
  source: string // osm | sirene | gmaps  (traceability, not written to the pipeline CSV)
  key?: string // a stable dedup key BEFORE there is a site (e.g. siren) — otherwise we dedup by domain
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// cleans text fields (spaces/multi-line) — a guard before the CSV
export const clean = (s: string) => (s ?? "").replace(/[\n\r]+/g, " ").replace(/\s+/g, " ").trim()

// ─── RFC4180-lite CSV: REAL escaping (no more naive join(",") that misaligned the columns as soon as
// a field held a comma — a harvested email, a company name like "X, Y et fils"…) ───
export const csvField = (s: string) => (/[",\n\r]/.test(s ?? "") ? `"${(s ?? "").replace(/"/g, '""')}"` : (s ?? ""))
export const csvJoin = (cells: string[]) => cells.map(csvField).join(",")
/** splits a CSV line, honouring quoted fields ("" = an escaped quote). */
export function csvSplit(line: string): string[] {
  const out: string[] = []
  let cur = "", q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c }
    else if (c === '"') q = true
    else if (c === ",") { out.push(cur); cur = "" }
    else cur += c
  }
  out.push(cur)
  return out
}

export const slug = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

export function domainOf(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase()
  } catch {
    return ""
  }
}

// chains/franchises → excluded (FIT gate: we only target independents)
export const CHAINS =
  /cuisinella|schmidt|mobalpa|aviva|socoo'? ?c|ixina|cuisine[ -]?plus|arthur[ -]?bonnet|comera|per[ée]n[ée]|hygena|[ée]co[ -]?cuisine|darty|ikea|conforama|\bbut\b|leroy[ -]?merlin|lapeyre|castorama|brico[ -]?(d[ée]p[ôo]t|rama)|maisons? du monde|\bfly\b|alinea|mobilier de france|\batlas\b|cuisines? r[ée]f[ée]rences?|raison[ -]?home|vie[ -]?cuisines|veneta|cuisines? (aviva|schmidt)/i

// ─── Chain filtering IN LAYERS (a static filter alone is too brittle) ───
// Layer 1: the global regex above + a list of brands PER TRADE (industries.ts `chains`,
//          regex fragments). Layer 2: `dropChainNetworks` (a data-driven heuristic, below).

const _chainRe = new Map<string, RegExp>() // memo: a trade's fragments → a single regex
/** Is the prospect a chain/franchise? global regex + trade list (regex fragments, case-insensitive). */
export function isChain(name: string, website: string, extra?: string[]): boolean {
  const dom = domainOf(website)
  if (CHAINS.test(name) || (dom && CHAINS.test(dom))) return true
  if (extra?.length) {
    const key = extra.join("|")
    let re = _chainRe.get(key)
    if (!re) { re = new RegExp(key, "i"); _chainRe.set(key, re) }
    return re.test(name) || (!!dom && re.test(dom))
  }
  return false
}

/** ROOT domain (approximate eTLD+1: the last 2 labels) — to group a network's subdomains. */
export function rootDomainOf(url: string): string {
  const h = domainOf(url)
  const p = h.split(".")
  return p.length <= 2 ? h : p.slice(-2).join(".")
}

// a trade's generic words: removed to isolate the REAL brand ("Cash Piscine" → "cash")
const GENERIC_WORDS = /\b(piscines?|spas?|pools?|cuisines?|paysag(e|iste)s?|jardins?|sarl|sas|sasu|eurl|\bsa\b|et fils|cie|france|store|shop|magasin|concept|groupe)\b/gi
const brandKey = (name: string) => slug(name.replace(GENERIC_WORDS, " ")).replace(/-/g, "") || slug(name).replace(/-/g, "")

/**
 * Layer 2 — a DATA-DRIVEN anti-network heuristic (no list to maintain).
 * The same brand (normalised name) OR the same root domain coming back ≥ `min` times in the batch =
 * a franchise/portal → the whole group is dropped. Catches UNLISTED chains (Cash Piscine ×5,
 * Ibiza ×4…). Transparent: logs what was dropped (no silent truncation).
 */
export function dropChainNetworks(found: Found[], log: (s: string) => void, min = 3): Found[] {
  const byBrand = new Map<string, number>(), byRoot = new Map<string, number>()
  for (const f of found) {
    const b = brandKey(f.name); if (b) byBrand.set(b, (byBrand.get(b) ?? 0) + 1)
    const r = rootDomainOf(f.website); if (r) byRoot.set(r, (byRoot.get(r) ?? 0) + 1)
  }
  const dropped: string[] = []
  const kept = found.filter((f) => {
    const net = (byBrand.get(brandKey(f.name)) ?? 0) >= min || (byRoot.get(rootDomainOf(f.website)) ?? 0) >= min
    if (net) dropped.push(f.name)
    return !net
  })
  if (dropped.length) log(`  anti-network: −${dropped.length} (brand/domain repeated ≥${min}×: ${[...new Set(dropped)].slice(0, 6).join(", ")}…)`)
  return kept
}

// directories/aggregators/marketplaces/social networks → NEVER a prospect's own site (filters enrichment)
export const AGGREGATORS =
  /pagesjaunes|pappers|google\.|facebook\.|instagram\.|linkedin\.|youtube\.|twitter\.|x\.com|tiktok|annuaire|societe\.com|verif\.com|infogreffe|data\.gouv|kompass|yelp|tripadvisor|leboncoin|houzz|pinterest|wikipedia|mappy|justacote|118000|cylex|tel\.local|trustpilot|indeed|figaro|booking|page-?jaune|manomano|amazon|cdiscount|ebay|wanadoo|free\.fr\/|over-blog|wixsite|business\.site|entreprises?\.|verif-|score3|kompass|europages|hoodspot|misterwhat|local\.fr|trouverunpro|starofservice/i

/**
 * A response's HTML, DECODED in the right character set. `res.text()` always decodes as UTF-8; yet old
 * tradespeople's sites (the product's target) are often ISO-8859-1 / windows-1252: "réalisations" became
 * "r�alisations", the scoring signals (`r[ée]alisations`, `r[ée]server en ligne`…) were no longer seen and
 * enrichment found neither the name nor the town in the page (blitz test of 24/10). Order: BOM, the
 * Content-Type header, <meta charset> / http-equiv in the first 4 KB, else UTF-8. A declared (or assumed) but
 * invalid UTF-8 is re-read as windows-1252 (a misconfigured server, a frequent case). `maxBytes` bounds the read.
 */
// windows-1252: Node decodes this label as ISO-8859-1 (0x80 → U+0080 instead of "€"). The 27 characters
// specific to windows-1252 (€, ’, œ, typographic «…», dashes) are therefore put back by hand. Seen on Node 24.
const W1252: Record<number, string> = { 0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ" }
/** the labels the WHATWG standard files under windows-1252 */
const IS_1252 = /^(windows-1252|cp1252|x-cp1252|iso-8859-1|iso8859-1|iso_8859-1|latin1|l1|ascii|us-ascii|iso-ir-100|ibm819|cp819|csisolatin1)$/
function decode1252(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1").replace(/[\x80-\x9f]/g, (c) => W1252[c.charCodeAt(0)] ?? c)
}

export function decodeHtml(bytes: Uint8Array, contentType = ""): string {
  const label = (() => {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8"
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le"
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be"
    const fromHeader = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType)?.[1]
    if (fromHeader) return fromHeader
    const head = decode1252(bytes.subarray(0, 4096))
    return /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1] ?? "utf-8"
  })().toLowerCase()
  if (IS_1252.test(label)) return decode1252(bytes)
  let dec: TextDecoder
  try { dec = new TextDecoder(label, { fatal: label === "utf-8" || label === "utf8" }) } catch { dec = new TextDecoder("utf-8", { fatal: true }) } // unknown label
  try { return dec.decode(bytes) } catch { return decode1252(bytes) } // invalid "UTF-8": the misconfigured-server case
}

/** Reads at most `maxBytes` as a STREAM, then cuts: an endless (or 2 GB) page no longer fills memory until the
 *  20 s timeout only to end as a false "site unreachable" (blitz test of 24/10). */
export async function readHtml(res: Response, maxBytes = 5_000_000): Promise<string> {
  const type = res.headers.get("content-type") || ""
  if (!res.body) return decodeHtml(new Uint8Array(await res.arrayBuffer()).subarray(0, maxBytes), type)
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value); size += value.length
    }
  } finally {
    if (size >= maxBytes) await reader.cancel().catch(() => { /* connection already closed */ })
    else reader.releaseLock()
  }
  const all = new Uint8Array(Math.min(size, maxBytes))
  let off = 0
  for (const p of parts) { if (off >= all.length) break; const n = Math.min(p.length, all.length - off); all.set(p.subarray(0, n), off); off += n }
  return decodeHtml(all, type)
}
