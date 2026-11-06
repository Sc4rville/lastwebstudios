/**
 * brief.ts · "Tell the agency what you're after" → { trades, place, country, count, mix }.
 * Real mode: the `find-brief` skill (role fast, any LWS_LLM way). Sandbox (LWS_SANDBOX=1) or any failure: a
 * deterministic parser on the engine's trade list (FR and EN terms), numbers, "near/around/in <place>", mix words.
 */
import { INDUSTRIES } from "../../leadengine/1_scraping/scripts/industries.ts"
import { agency } from "../../packages/shared/agency.mjs"

export type Brief = { trades: string[]; place: string; country: string; count: number; mix: boolean; via: "skill" | "parser"; unmatched?: string[] }
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
const EXTRA: Record<string, string[]> = { "couvreur-zingueur": ["roofer", "roofers", "roofing", "couvreur", "toiture"], pisciniste: ["pool", "pools", "piscine", "piscines"], cuisiniste: ["kitchen", "kitchens", "cuisine", "cuisines"], menuisier: ["carpenter", "carpenters", "joinery", "woodwork", "menuisier", "menuiserie"], paysagiste: ["landscaper", "landscapers", "landscaping", "paysagiste", "jardinier"], charpente: ["timber", "framing"], "salle-de-bain": ["bathroom", "bathrooms"], "installateur-pv-pac": ["solar", "heat pump"], architecte: ["architect", "architects"], ferronnier: ["metalwork", "blacksmith", "ironwork"], verandaliste: ["pergola", "sunroom", "veranda"], "constructeur-ccmi": ["home builder", "homebuilder"], "maitre-oeuvre": ["contractor", "contractors"], securite: ["alarm", "security"], veterinaire: ["vet", "veterinary"] }
// words that read as a trade but match nothing the engine knows (said back to the owner, never silently dropped)
const TRADE_WORDS = /\b(plumbers?|plumbing|electricians?|electrical|painters?|painting|tilers?|tiling|hvac|cleaners?|cleaning|movers?|dentists?|lawyers?|accountants?|restaurants?|bakers?|bakery|florists?|mechanics?|garages?|gyms?|coaches|photographers?)\b/gi
const MIX_WORDS = /\b(mix|mixed|variety|various|surprise|anything|whatever|all trades|different trades|melange|mélange|varie|surprends)\b/i
const US_STATES = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|Texas|California|Florida|New York|Ohio|Maine|Oregon|Colorado)\b/
const US_CITIES = /\b(Austin|Dallas|Houston|Denver|Portland|Seattle|Miami|Boston|Chicago|Phoenix|Atlanta|Nashville)\b/i
const FR_CITIES = /\b(Paris|Lyon|Marseille|Lille|Bordeaux|Toulouse|Nantes|Nice|Rennes|Strasbourg|Montpellier|Grenoble|Rouen|Dijon)\b/i

export function tradeMatches(text: string): string[] {
  const t = ` ${norm(text)} `
  const out: string[] = []
  for (const [key, ind] of Object.entries(INDUSTRIES)) {
    const terms = [key, ind.label, ...(ind.terms || []), ...((ind as any).en?.terms || []), (ind as any).en?.label, ...(EXTRA[key] || [])].filter(Boolean).map((x) => norm(String(x)))
    if (terms.some((w) => w.length >= 4 && t.includes(` ${w}`) || t.includes(` ${w}s `))) out.push(key)
  }
  return [...new Set(out)]
}
export function parseBrief(text: string, country = agency().country): Brief {
  const raw = String(text || "").trim()
  const num = /\b(\d{1,3})\b/.exec(raw)
  const count = Math.max(1, Math.min(200, num ? Number(num[1]) : 10))
  const trades = tradeMatches(raw)
  const unmatched = [...new Set([...raw.matchAll(TRADE_WORDS)].map((m) => m[0].toLowerCase()))].filter((w) => !trades.some((k) => (EXTRA[k] || []).includes(w) || (INDUSTRIES[k] as any).en?.terms?.includes(w)))
  const mix = MIX_WORDS.test(raw) || !trades.length
  let place = ""
  const m = /\b(?:near|around|in|autour de|pres de|près de|a|à|sur)\s+([A-ZÀ-Ý][\w'’-]+(?:[ -][A-ZÀ-Ý][\w'’-]+)*(?:,\s*[A-Z]{2})?)/u.exec(raw)
  if (m) place = m[1].replace(/\s+(and|et|with|avec)$/i, "")
  if (!place) { const c = US_CITIES.exec(raw) || FR_CITIES.exec(raw); if (c) place = c[0] }
  let ctry = country
  if (US_STATES.test(raw) || US_CITIES.test(raw)) ctry = "US"
  else if (FR_CITIES.test(raw) || /\bFrance\b/i.test(raw)) ctry = "FR"
  return { trades, place, country: ctry, count, mix, via: "parser", ...(unmatched.length ? { unmatched } : {}) }
}
/** mix → the radar picks 3–5 trades (the best ones for the agency), deterministically */
const EVERYDAY = ["cuisiniste", "menuisier", "pisciniste", "paysagiste", "couvreur-zingueur", "salle-de-bain", "charpente", "verandaliste", "ferronnier", "architecte-interieur", "installateur-pv-pac", "storiste"]
export async function pickMix(n = 4): Promise<string[]> {
  // the radar ranks every trade the engine knows; a "mix" for an owner means everyday local trades, best first
  try { const { rankIndustries } = await import("../../leadengine/1_scraping/scripts/radar.ts"); const r = await rankIndustries(); const keys = r.map((x: any) => x.key).filter((k: string) => EVERYDAY.includes(k)); return (keys.length >= n ? keys : [...keys, ...EVERYDAY.filter((k) => k in INDUSTRIES && !keys.includes(k))]).slice(0, n) } catch { return EVERYDAY.filter((k) => k in INDUSTRIES).slice(0, n) }
}
export async function interpretBrief(text: string): Promise<Brief> {
  if (process.env.LWS_SANDBOX !== "1") {
    try {
      const { runSkill } = await import("../../packages/utils/run-skill.ts")
      const list = Object.entries(INDUSTRIES).map(([k, v]) => `${k}: ${v.label}${(v as any).en?.label ? ` / ${(v as any).en.label}` : ""}`).join("\n")
      const r = await runSkill(".claude/skills/find-brief", { request: text, trades: list, country: agency().country }, "fast", 600)
      if (r && Array.isArray(r.trades)) return { trades: r.trades.filter((k: string) => k in INDUSTRIES), place: String(r.place || ""), country: String(r.country || agency().country).toUpperCase(), count: Math.max(1, Math.min(200, Number(r.count) || 10)), mix: !!r.mix, via: "skill" }
    } catch { /* the parser below */ }
  }
  return parseBrief(text)
}
