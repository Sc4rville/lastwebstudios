/**
 * Scraping — util partagé (type Found + helpers). Aucune dépendance.
 *
 * `Found` est le contrat commun à TOUTES les sources : chaque provider renvoie des `Found[]`,
 * l'orchestrateur (scrape.ts) les fusionne, enrichit, déduplique → CSV `name,city,website,phone,industry`.
 */
export type Found = {
  name: string
  city: string
  website: string // "" tant que non trouvé (l'enrichissement le remplit)
  phone: string
  email?: string
  industry: string
  source: string // osm | sirene | gmaps  (traçabilité, non écrit dans le CSV pipeline)
  key?: string // clé de dédup stable AVANT d'avoir un site (ex. siren) — sinon on dédup par domaine
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// nettoyage des champs texte (espaces/multilignes) — garde-fou en amont du CSV
export const clean = (s: string) => (s ?? "").replace(/[\n\r]+/g, " ").replace(/\s+/g, " ").trim()

// ─── CSV RFC4180-lite : échappement RÉEL (fini le join(",") naïf qui désalignait les colonnes dès
// qu'un champ contenait une virgule — email harvesté, raison sociale « X, Y et fils »…) ───
export const csvField = (s: string) => (/[",\n\r]/.test(s ?? "") ? `"${(s ?? "").replace(/"/g, '""')}"` : (s ?? ""))
export const csvJoin = (cells: string[]) => cells.map(csvField).join(",")
/** découpe une ligne CSV en respectant les champs quotés ("" = quote échappée). */
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

// chaînes/franchises → exclues (gate FIT : on ne cible que les indépendants)
export const CHAINS =
  /cuisinella|schmidt|mobalpa|aviva|socoo'? ?c|ixina|cuisine[ -]?plus|arthur[ -]?bonnet|comera|per[ée]n[ée]|hygena|[ée]co[ -]?cuisine|darty|ikea|conforama|\bbut\b|leroy[ -]?merlin|lapeyre|castorama|brico[ -]?(d[ée]p[ôo]t|rama)|maisons? du monde|\bfly\b|alinea|mobilier de france|\batlas\b|cuisines? r[ée]f[ée]rences?|raison[ -]?home|vie[ -]?cuisines|veneta|cuisines? (aviva|schmidt)/i

// ─── Anti-chaînes EN COUCHES (un filtre statique seul est trop fragile) ───
// Couche 1 : le regex global ci-dessus + une liste de marques PAR MÉTIER (industries.ts `chains`,
//            fragments regex). Couche 2 : `dropChainNetworks` (heuristique data-driven, ci-dessous).

const _chainRe = new Map<string, RegExp>() // mémo : les fragments d'un métier → un seul regex
/** Le prospect est-il une chaîne/franchise ? regex global + liste métier (fragments regex, insensible casse). */
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

/** Domaine RACINE (eTLD+1 approché : 2 derniers labels) — pour regrouper les sous-domaines d'un réseau. */
export function rootDomainOf(url: string): string {
  const h = domainOf(url)
  const p = h.split(".")
  return p.length <= 2 ? h : p.slice(-2).join(".")
}

// mots génériques d'un métier : on les retire pour isoler la VRAIE marque ("Cash Piscine" → "cash")
const GENERIC_WORDS = /\b(piscines?|spas?|pools?|cuisines?|paysag(e|iste)s?|jardins?|sarl|sas|sasu|eurl|\bsa\b|et fils|cie|france|store|shop|magasin|concept|groupe)\b/gi
const brandKey = (name: string) => slug(name.replace(GENERIC_WORDS, " ")).replace(/-/g, "") || slug(name).replace(/-/g, "")

/**
 * Couche 2 — heuristique anti-réseau DATA-DRIVEN (se passe d'une liste à maintenir).
 * Une même marque (nom normalisé) OU un même domaine racine qui revient ≥ `min` fois dans le lot =
 * franchise/portail → on jette tout le groupe. Attrape les chaînes NON listées (Cash Piscine ×5,
 * Ibiza ×4…). Transparent : logue ce qui est tombé (pas de troncature silencieuse).
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
  if (dropped.length) log(`  anti-réseau : −${dropped.length} (marque/domaine récurrent ≥${min}× : ${[...new Set(dropped)].slice(0, 6).join(", ")}…)`)
  return kept
}

// annuaires/agrégateurs/marketplaces/réseaux → JAMAIS le site propre d'un prospect (filtre l'enrichissement)
export const AGGREGATORS =
  /pagesjaunes|pappers|google\.|facebook\.|instagram\.|linkedin\.|youtube\.|twitter\.|x\.com|tiktok|annuaire|societe\.com|verif\.com|infogreffe|data\.gouv|kompass|yelp|tripadvisor|leboncoin|houzz|pinterest|wikipedia|mappy|justacote|118000|cylex|tel\.local|trustpilot|indeed|figaro|booking|page-?jaune|manomano|amazon|cdiscount|ebay|wanadoo|free\.fr\/|over-blog|wixsite|business\.site|entreprises?\.|verif-|score3|kompass|europages|hoodspot|misterwhat|local\.fr|trouverunpro|starofservice/i

/**
 * Le HTML d'une réponse, DÉCODÉ dans le bon jeu de caractères. `res.text()` décode toujours en UTF-8 ; or les vieux
 * sites d'artisans (la cible du produit) sont souvent en ISO-8859-1 / windows-1252 : « réalisations » devenait
 * « r�alisations », les signaux du scoring (`r[ée]alisations`, `r[ée]server en ligne`…) ne se voyaient plus et
 * l'enrichissement ne retrouvait ni le nom ni la ville dans la page (test blitz du 24/10). Ordre : BOM, en-tête
 * Content-Type, <meta charset> / http-equiv dans les 4 premiers Ko, sinon UTF-8. Un UTF-8 annoncé (ou supposé) mais
 * invalide est relu en windows-1252 (serveur mal réglé, cas fréquent). `maxBytes` borne la lecture.
 */
// windows-1252 : Node décode cette étiquette comme ISO-8859-1 (0x80 → U+0080 au lieu de « € »). Les 27 caractères
// propres à windows-1252 (€, ’, œ, «…» typographiques, tirets) sont donc remis à la main. Vu sur Node 24.
const W1252: Record<number, string> = { 0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ" }
/** les étiquettes que le standard WHATWG range sous windows-1252 */
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
  try { dec = new TextDecoder(label, { fatal: label === "utf-8" || label === "utf8" }) } catch { dec = new TextDecoder("utf-8", { fatal: true }) } // étiquette inconnue
  try { return dec.decode(bytes) } catch { return decode1252(bytes) } // « UTF-8 » invalide : le cas des serveurs mal réglés
}

/** Lit au plus `maxBytes` en FLUX puis coupe : une page sans fin (ou de 2 Go) ne remplit plus la mémoire jusqu'au délai
 *  de 20 s pour finir en faux « site injoignable » (test blitz du 24/10). */
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
    if (size >= maxBytes) await reader.cancel().catch(() => { /* connexion déjà fermée */ })
    else reader.releaseLock()
  }
  const all = new Uint8Array(Math.min(size, maxBytes))
  let off = 0
  for (const p of parts) { if (off >= all.length) break; const n = Math.min(p.length, all.length - off); all.set(p.subarray(0, n), off); off += n }
  return decodeHtml(all, type)
}
