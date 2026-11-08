/**
 * brief.ts · "Tell the agency what you're after" → { trades, place, country, count, mix }.
 * The live preview (/api/brief) is ALWAYS the deterministic parser: free, instant, no model while the owner types.
 * A real search (/api/prospects/find, database checked first) asks the `find-brief` skill (role fast, any LWS_LLM
 * way) ; the sandbox (LWS_SANDBOX=1) or any failure falls back to the parser.
 * Parser: the engine's trade list (FR, EN and a few DE terms, whole words only), numbers, "near/around/in <place>",
 * mix words. The country is the AGENCY'S unless the text names one (« in France », « Austin, TX », « Texas ») or the place is
 * a well-known city (« Boston » is in the US, « Nice » in France, whatever the agency's country).
 */
import { INDUSTRIES, normalizeIndustry } from "../../leadengine/1_scraping/scripts/industries.ts"
import { agency } from "../../packages/shared/agency.mjs"

export type Brief = { trades: string[]; place: string; country: string; count: number; mix: boolean; via: "skill" | "parser"; unmatched?: string[]; error?: string; note?: string }
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
const EXTRA: Record<string, string[]> = { "couvreur-zingueur": ["roofer", "roofers", "roofing", "couvreur", "toiture"], pisciniste: ["pool", "pools", "piscine", "piscines"], cuisiniste: ["kitchen", "kitchens", "cuisine", "cuisines"], menuisier: ["carpenter", "carpenters", "joinery", "woodwork", "menuisier", "menuiserie"], paysagiste: ["landscaper", "landscapers", "landscaping", "paysagiste", "jardinier"], charpente: ["timber", "framing"], "salle-de-bain": ["bathroom", "bathrooms"], "installateur-pv-pac": ["solar", "heat pump"], architecte: ["architect", "architects"], ferronnier: ["metalwork", "blacksmith", "ironwork"], verandaliste: ["pergola", "sunroom", "veranda"], "constructeur-ccmi": ["home builder", "homebuilder"], "maitre-oeuvre": ["contractor", "contractors"], securite: ["alarm", "security"], veterinaire: ["vet", "veterinary"] }
// words that read as a trade (EN, FR, DE) : said back to the owner when the engine knows none of them, never silently dropped
const TRADE_WORDS = /\b(plumbers?|plumbing|electricians?|electrical|painters?|painting|tilers?|tiling|hvac|cleaners?|cleaning|movers?|dentists?|lawyers?|attorneys?|accountants?|restaurants?|cafes?|bakers?|bakery|bakeries|florists?|mechanics?|garages?|gyms?|coaches|photographers?|hairdressers?|barbers?|salons?|realtors?|tutors?|daycares?|chiropractors?|tattoo|boulangers?|boulangeries?|coiffeurs?|avocats?|comptables?|garagistes?|restaurateurs?|b(?:ä|ae)cker(?:eien?)?|friseure?|anw(?:ä|ae)lte|werkst(?:ä|ae)tten?)\b/giu
const MIX_WORDS = /\b(mix|mixed|variety|various|surprise|anything|whatever|all trades|different trades|melange|mélange|varie|surprends)\b/i
// a US state written after the place (« Austin, TX », « Boise Idaho ») : the only place-based country hint
const US_STATE_CODES = new Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "))
const US_STATE_NAMES = /\b(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York State|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|West Virginia|Wisconsin|Wyoming)\b/
const COUNTRY_WORDS: [RegExp, string][] = [[/\b(USA|U\.S\.A?\.?|United States|America)\b|\bUS\b/, "US"], [/\b(France)\b/i, "FR"], [/\b(Germany|Deutschland|Allemagne)\b/i, "DE"], [/\b(UK|U\.K\.|England|United Kingdom|Britain|Angleterre)\b/, "GB"], [/\b(Canada)\b/i, "CA"], [/\b(Belgium|Belgique)\b/i, "BE"], [/\b(Switzerland|Suisse|Schweiz)\b/i, "CH"], [/\b(Australia|Australie)\b/i, "AU"], [/\b(Spain|Espagne|España)\b/i, "ES"], [/\b(Italy|Italie|Italia)\b/i, "IT"]]
// well-known cities carry their own country (and, in the US, their state) : « plumbers in Boston » is Boston, MA even
// for a French agency, « couvreurs à Nice » is Nice, France even for a US one. An unknown town keeps the agency's country.
const CITY: Record<string, string> = {
  // US metros → state
  austin: "US-TX", "round rock": "US-TX", "cedar park": "US-TX", pflugerville: "US-TX", georgetown: "US-TX", leander: "US-TX", "dripping springs": "US-TX",
  lakeway: "US-TX", "bee cave": "US-TX", kyle: "US-TX", buda: "US-TX", "san marcos": "US-TX", hutto: "US-TX", dallas: "US-TX", houston: "US-TX", "san antonio": "US-TX", "fort worth": "US-TX", "el paso": "US-TX", denver: "US-CO", "colorado springs": "US-CO",
  portland: "US-OR", seattle: "US-WA", spokane: "US-WA", miami: "US-FL", orlando: "US-FL", tampa: "US-FL", jacksonville: "US-FL", boston: "US-MA", chicago: "US-IL",
  phoenix: "US-AZ", tucson: "US-AZ", atlanta: "US-GA", nashville: "US-TN", memphis: "US-TN", boise: "US-ID", "san diego": "US-CA", "los angeles": "US-CA",
  "san francisco": "US-CA", "san jose": "US-CA", sacramento: "US-CA", charlotte: "US-NC", raleigh: "US-NC", "new york": "US-NY", brooklyn: "US-NY", buffalo: "US-NY",
  philadelphia: "US-PA", pittsburgh: "US-PA", "las vegas": "US-NV", "salt lake city": "US-UT", minneapolis: "US-MN", detroit: "US-MI", columbus: "US-OH",
  cleveland: "US-OH", cincinnati: "US-OH", indianapolis: "US-IN", "kansas city": "US-MO", "st. louis": "US-MO", "saint louis": "US-MO", baltimore: "US-MD",
  milwaukee: "US-WI", albuquerque: "US-NM", "oklahoma city": "US-OK", tulsa: "US-OK", louisville: "US-KY", richmond: "US-VA", "new orleans": "US-LA",
  honolulu: "US-HI", anchorage: "US-AK", omaha: "US-NE", "des moines": "US-IA", birmingham: "GB", "little rock": "US-AR", charleston: "US-SC",
  // France
  paris: "FR", lyon: "FR", marseille: "FR", lille: "FR", bordeaux: "FR", toulouse: "FR", nantes: "FR", nice: "FR", rennes: "FR", strasbourg: "FR",
  montpellier: "FR", grenoble: "FR", rouen: "FR", dijon: "FR", annecy: "FR", metz: "FR", nancy: "FR", caen: "FR", tours: "FR", angers: "FR", reims: "FR",
  "le havre": "FR", toulon: "FR", "clermont-ferrand": "FR", brest: "FR", limoges: "FR", amiens: "FR", perpignan: "FR", besancon: "FR", orleans: "FR",
  mulhouse: "FR", avignon: "FR", poitiers: "FR", "la rochelle": "FR", pau: "FR", bayonne: "FR", biarritz: "FR", cannes: "FR", antibes: "FR", ajaccio: "FR",
  "saint-etienne": "FR", versailles: "FR", "aix-en-provence": "FR", chambery: "FR", valence: "FR", nimes: "FR", lorient: "FR", vannes: "FR", "le mans": "FR",
  // elsewhere
  london: "GB", manchester: "GB", leeds: "GB", liverpool: "GB", bristol: "GB", glasgow: "GB", edinburgh: "GB", berlin: "DE", munich: "DE", munchen: "DE",
  hamburg: "DE", cologne: "DE", koln: "DE", frankfurt: "DE", brussels: "BE", bruxelles: "BE", antwerp: "BE", liege: "BE", ghent: "BE", geneva: "CH", geneve: "CH",
  zurich: "CH", lausanne: "CH", toronto: "CA", montreal: "CA", vancouver: "CA", calgary: "CA", ottawa: "CA", sydney: "AU", melbourne: "AU", brisbane: "AU",
  perth: "AU", madrid: "ES", barcelona: "ES", rome: "IT", milan: "IT", amsterdam: "NL", rotterdam: "NL", dublin: "IE", auckland: "NZ",
}
/** a well-known city → { country, state } ; null for a town the agency does not know (it keeps the agency's country) */
export function cityCountry(place: string): { country: string; state: string } | null {
  const k = norm(String(place || "").replace(/,.*$/, "").trim()).replace(/\s+/g, " ")
  const v = CITY[k]; if (!v) return null
  const [country, state = ""] = v.split("-"); return { country, state }
}
// a place typed in lower case with no « in / near » (« roofers austin ») : recognised from the list above
const KNOWN_PLACES = new RegExp(`(?<![\\p{L}])(${Object.keys(CITY).sort((a, b) => b.length - a.length).map((c) => c.replace(/[.]/g, "\\.")).join("|")})(?![\\p{L}])`, "giu")
// everyday words that are also towns : a place only when written with a capital (« Nice », « Tours »), never « a nice mix »
const COMMON_WORDS = new Set(["nice", "tours", "valence", "nancy", "pau", "reading", "perth", "brest", "rome", "columbus", "phoenix", "richmond", "charleston"])
const PLACE_STOP = /^(the|a|an|my|our|town|city|area|me|it|them|France|USA|US|America|United States|Germany|Deutschland|UK|England|Canada|Belgium|Belgique|Switzerland|Suisse|Australia|Spain|Italy)$/i

const DE: Record<string, string[]> = { "couvreur-zingueur": ["dachdecker"], menuisier: ["schreiner", "tischler"], pisciniste: ["poolbau", "poolbauer", "schwimmbad"], cuisiniste: ["kuchenstudio", "kuchenbau"], paysagiste: ["gartenbau", "landschaftsbau"], architecte: ["architekt"], "salle-de-bain": ["badstudio"], charpente: ["zimmerei", "zimmermann"] }
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
/** whole-word matching only : « Boise » never becomes joinery, « pools » matches the pool builder */
export function tradeMatches(text: string): string[] {
  const t = norm(text)
  const out: string[] = []
  for (const [key, ind] of Object.entries(INDUSTRIES)) {
    const terms = [key, ind.label, ...(ind.terms || []), ...((ind as any).en?.terms || []), (ind as any).en?.label, ...(EXTRA[key] || []), ...(DE[key] || [])].filter(Boolean).map((x) => norm(String(x))).filter((w) => w.length >= 4)
    if (terms.some((w) => new RegExp(`(^|[^a-z0-9])${esc(w)}(s|es|ers|eurs)?([^a-z0-9]|$)`).test(t))) out.push(key)
  }
  // the engine's own aliases (industries.ts) : "kitchen remodel", "piscines", legacy keys… one to three words at a time
  const words = t.split(/[^a-z0-9]+/).filter(Boolean)
  for (let i = 0; i < words.length; i++) for (let n = 3; n >= 1; n--) {
    const k = normalizeIndustry(words.slice(i, i + n).join(" "))
    if (k && INDUSTRIES[k] && !out.includes(k) && words.slice(i, i + n).join("").length >= 4) out.push(k)
  }
  // « pool builders » is a pool builder, not also a construction company : generic trades yield to specific ones
  const GENERIC = ["construction", "maitre-oeuvre", "constructeur-ccmi", "equipement", "agencement"]
  const uniq = [...new Set(out)]
  return uniq.some((k) => !GENERIC.includes(k)) ? uniq.filter((k) => !GENERIC.includes(k) || new RegExp(`(^|[^a-z0-9])${esc(norm(INDUSTRIES[k].label))}`).test(t)) : uniq
}
const exampleFor = (ctry: string) => (ctry === "US" || ctry === "GB" || ctry === "CA" || ctry === "AU" ? "roofers in Austin" : "roofers in Lyon")
export function parseBrief(text: string, country = agency().country): Brief {
  const raw = String(text || "").trim()
  // the count : « 12 », « 1,000 » ; a 5-digit number is a ZIP unless a trade follows it (« 10000 roofers »)
  const flat = raw.replace(/(\d),(\d{3})\b/g, "$1$2")
  const big = /(?<![\d.,])(\d{5,})\s+([\p{L}-]+)/u.exec(flat)
  const num = /(?<![\d.,])(\d{1,4})(?![\d.,]?\d)/.exec(flat)
  const asked = big && tradeMatches(big[2]).length ? Number(big[1]) : num ? Number(num[1]) : 10
  const count = Math.max(1, Math.min(200, asked))
  // a count changed is said, never silent : past 200 the search runs for 200 ; « -5 » is 5 ; « 0 » is 1
  const negative = !!num && new RegExp(`-\\s*${num[1]}(?![\\d])`).test(flat)
  const notes: string[] = []
  if (asked > 200) notes.push("Searching for 200, the maximum per search")
  else if (negative) notes.push(`A count can't be negative: searching for ${count}`)
  else if (num && asked < 1) notes.push("Searching for 1, at least one per search")
  const trades = tradeMatches(raw)
  // a trade-sounding word the engine knows nothing about (« lawyers », « Bäcker ») is said back, never dropped
  const unmatched = [...new Set([...raw.matchAll(TRADE_WORDS)].map((m) => m[0].toLowerCase()))].filter((w) => !tradeMatches(w).length)
  const mixSaid = MIX_WORDS.test(raw)
  // the place : after « near / around / in / à … », skipping anything that is a trade or a country
  let place = ""
  for (const m of raw.matchAll(/(?<![\p{L}])(?:[Nn]ear|[Aa]round|[Ii]n|[Aa]t|[Oo]utside|[Cc]lose to|[Aa]utour de|[Pp]r[eè]s de|à|a|sur|en|bei|um|nahe)\s+(\p{Lu}[\p{L}\p{N}'’-]*(?:[ -]\p{Lu}[\p{L}\p{N}'’-]*)*)(?:,\s*([A-Z]{2})\b)?/gu)) {
    let cand = m[1].replace(/\s+(And|Et|With|Avec)$/, ""), st = m[2] || ""
    const tail = / ([A-Z]{2})$/.exec(cand); if (!st && tail && US_STATE_CODES.has(tail[1])) { st = tail[1]; cand = cand.slice(0, -3) }
    if (PLACE_STOP.test(cand) || tradeMatches(cand).length || MIX_WORDS.test(cand)) continue
    place = st && US_STATE_CODES.has(st) ? `${cand}, ${st}` : cand
    break
  }
  if (!place) {
    const flatRaw = norm(raw)
    for (const c of flatRaw.matchAll(KNOWN_PLACES)) {
      const typed = raw.slice(c.index!, c.index! + c[1].length)
      if (COMMON_WORDS.has(c[1].toLowerCase()) && !/^\p{Lu}/u.test(typed)) continue
      place = typed.replace(/(^|[\s-])\p{L}/gu, (x) => x.toUpperCase()); break
    }
  }
  // the country is the AGENCY'S, unless the text names another one, a US state, or the place is a well-known city
  let ctry = country
  const named = COUNTRY_WORDS.find(([re]) => re.test(raw))
  const city = place ? cityCountry(place) : null
  if (named) ctry = named[1]
  else if (/,\s*[A-Z]{2}$/.test(place) || US_STATE_NAMES.test(raw)) ctry = "US"
  else if (city) { ctry = city.country; if (city.state) place = `${place.replace(/,.*$/, "")}, ${city.state}` }
  const words = raw.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length
  const mix = mixSaid || (!trades.length && !unmatched.length)
  let error: string | undefined
  if (!trades.length && !mixSaid && words >= 1) {
    if (unmatched.length) error = `${unmatched.join(", ")}: not a trade the agency knows yet — try “${exampleFor(ctry)}”`
    else if (!place) error = `I didn't catch a trade — try “${exampleFor(ctry)}” or “a mix of trades”`
  }
  // no place said : around the agency's own town when its address says it (said back), never a silent nationwide scan
  if (!error && !place && !named && (trades.length || mix) && ctry === String(agency().country || "").toUpperCase()) {
    const home = agencyTown()
    if (home) { place = home; notes.push(`No place said: around your agency (${home})`) }
    else notes.push("No place said: the whole country is searched; add a town to narrow it")
  }
  return { trades, place, country: ctry, count, mix: error ? false : mix, via: "parser", ...(unmatched.length ? { unmatched } : {}), ...(error ? { error } : {}), ...(notes.length ? { note: notes.join(" · ") } : {}) }
}
/** the agency's own town, from its postal address (« 418 Larkspur Row, Austin, TX 78704 » → « Austin, TX » ;
 *  « 12 rue des Lavandières, 01990 Valmont-sur-Lys » → « Valmont-sur-Lys ») ; "" when it does not say */
export function agencyTown(a: any = agency()): string {
  const addr = [a.postalAddress, a.invoice?.seller?.address].map((v) => String(v || "")).find((v) => v.trim() && !/[<>]/.test(v)) || ""
  const us = /([A-Za-z .'-]+),\s*([A-Z]{2})\s+\d{5}/.exec(addr)
  if (us) return `${us[1].trim()}, ${us[2]}`
  const eu = /\b\d{4,5}\s+([\p{L}][\p{L}' -]+)$/u.exec(addr.trim())
  return eu ? eu[1].trim() : ""
}
/** mix → the radar picks 3–5 trades (the best ones for the agency), deterministically ; a US or English-speaking market gets
 *  the trades that sell there (roofers, plumbers, HVAC, electricians…), never the French showroom set */
const EVERYDAY = ["cuisiniste", "menuisier", "pisciniste", "paysagiste", "couvreur-zingueur", "salle-de-bain", "charpente", "verandaliste", "ferronnier", "architecte-interieur", "installateur-pv-pac", "storiste"]
const EVERYDAY_EN = ["couvreur-zingueur", "plombier", "chauffagiste", "electricien", "paysagiste", "peintre", "entrepreneur-general", "cloturiste", "solier", "pisciniste"]
const ENGLISH_MARKETS = new Set(["US", "CA", "GB", "IE", "AU", "NZ"])
export async function pickMix(n = 4, country = agency().country): Promise<string[]> {
  const pool = ENGLISH_MARKETS.has(String(country || "").toUpperCase()) ? EVERYDAY_EN : EVERYDAY
  // the radar ranks every trade the engine knows; a "mix" for an owner means everyday local trades, best first
  try { const { rankIndustries } = await import("../../leadengine/1_scraping/scripts/radar.ts"); const r = await rankIndustries(); const keys = r.map((x: any) => x.key).filter((k: string) => pool.includes(k)); return (keys.length >= n ? keys : [...keys, ...pool.filter((k) => k in INDUSTRIES && !keys.includes(k))]).slice(0, n) } catch { return pool.filter((k) => k in INDUSTRIES).slice(0, n) }
}
/** a brief sent back by the edit sheet : trades must exist, counts within bounds */
export function validateBrief(b: any, country = agency().country): Brief {
  const trades = (Array.isArray(b.trades) ? b.trades : []).map(String)
  const bad = trades.filter((k: string) => !(k in INDUSTRIES))
  const count = Number(b.count) || 10
  const place = typeof b.place === "string" ? b.place.trim().slice(0, 80) : ""
  const out: Brief = { trades: trades.filter((k: string) => k in INDUSTRIES), place, country: (typeof b.country === "string" && b.country.trim() ? b.country.trim().toUpperCase().slice(0, 2) : country), count: Math.max(1, Math.min(200, count)), mix: !!b.mix, via: "parser" }
  if (bad.length) out.error = `${bad.join(", ")}: not a trade the agency knows`
  else if (count > 200) out.error = "Max 200 per search"
  else if (count < 1 || !Number.isFinite(count)) out.error = "At least 1 per search"
  else if (!out.trades.length && !out.mix && !place) out.error = "Pick a trade, a place, or a mix"
  return out
}
export async function interpretBrief(text: string): Promise<Brief> {
  if (process.env.LWS_SANDBOX !== "1") {
    try {
      const { runSkill } = await import("../../packages/utils/run-skill.ts")
      const list = Object.entries(INDUSTRIES).map(([k, v]) => `${k}: ${v.label}${(v as any).en?.label ? ` / ${(v as any).en.label}` : ""}`).join("\n")
      const r = await runSkill(".claude/skills/find-brief", { request: text, trades: list, country: agency().country }, "fast", 600)
      if (r && Array.isArray(r.trades)) { const v = validateBrief({ ...r, trades: r.trades }); v.via = "skill"; if (!v.trades.length && !v.mix && !v.place) v.error = `I didn't catch a trade — try “${exampleFor(v.country)}”`; return v }
    } catch { /* the parser below */ }
  }
  return parseBrief(text)
}
