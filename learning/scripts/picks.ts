/**
 * Learning — THE PICKS, said in words (D6) : which prospects answer, from the sales outcomes the CRM and the sequencer
 * record (data/outcomes.jsonl + its database mirror), and what that changes in the picks (learning/rules/rules.json,
 * read by the scoring : the trade's value goes up or down, bounded and shrunk, see learn.ts).
 *
 * Plain sentences with their sample sizes, never a claim on fewer than MIN_N businesses per side : below that, one line
 * says how many there are and how many it takes. Nothing about weights, axes or models.
 */
import type { Outcome } from "./types.ts"

export const MIN_N = 5

export type TradeStat = { trade: string; n: number; replied: number; meetings: number; won: number; lost: number }
export type PickLine = { sentence: string; n: number; evidence: string; trade?: string; effect?: "picked first" | "picked later" | null }
export type PicksView = { items: PickLine[]; note: string | null; total: number }
type Rules = { industries?: Record<string, { value: number }>; signals?: Record<string, number> }

const SIGNAL_WORDS: Record<string, string> = { gallery: "a photo gallery", quoteCta: "a quote button", social: "social media links", premium: "a polished look", multiSite: "several locations", ecommerce: "an online shop", booking: "online booking", blog: "a blog" }

/** one trial per business : what it ever did (sent, replied, met, signed, said no) */
function perProspect(rows: Outcome[]): Map<string, { industry: string; kinds: Set<string>; signals: Record<string, unknown> }> {
  const m = new Map<string, { industry: string; kinds: Set<string>; signals: Record<string, unknown> }>()
  for (const o of rows) {
    if (!o || typeof o.id !== "string") continue
    const cur = m.get(o.id) || { industry: "", kinds: new Set<string>(), signals: {} }
    cur.kinds.add(o.outcome)
    if (o.industry && o.industry !== "?") cur.industry = o.industry
    if (o.signals && Object.keys(o.signals).length) cur.signals = o.signals as Record<string, unknown>
    m.set(o.id, cur)
  }
  return m
}
const replied = (k: Set<string>) => k.has("reply") || k.has("meeting") || k.has("won")

export function tradeStats(rows: Outcome[]): TradeStat[] {
  const by = new Map<string, TradeStat>()
  for (const p of perProspect(rows).values()) {
    const t = p.industry || "?"
    const s = by.get(t) || { trade: t, n: 0, replied: 0, meetings: 0, won: 0, lost: 0 }
    s.n++
    if (replied(p.kinds)) s.replied++
    if (p.kinds.has("meeting") || p.kinds.has("won")) s.meetings++
    if (p.kinds.has("won")) s.won++
    if (p.kinds.has("lost")) s.lost++
    by.set(t, s)
  }
  return [...by.values()].sort((a, b) => b.n - a.n || a.trade.localeCompare(b.trade))
}

const of = (a: number, n: number) => `${a} of ${n}`
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const plural = (label: string) => (/(s|sh|ch|x)$/.test(label) ? `${label}es` : /[^aeiou]y$/.test(label) ? `${label.slice(0, -1)}ies` : `${label}s`)

/**
 * The picks in plain words. `label(trade)` gives a trade's English name (« roofer ») ; `rules` = what the scoring reads
 * (a trade picked first or later is said only when the rules really move it).
 */
export function pickSentences(rows: Outcome[], rules: Rules, label: (trade: string) => string): PicksView {
  const stats = tradeStats(rows).filter((s) => s.trade !== "?")
  const total = stats.reduce((a, s) => a + s.n, 0)
  const name = (t: string) => plural(label(t).toLowerCase())
  const items: PickLine[] = []
  const ready = stats.filter((s) => s.n >= MIN_N).sort((a, b) => b.replied / b.n - a.replied / a.n || b.n - a.n)
  // the best and the worst trade, compared, when both have enough businesses
  if (ready.length >= 2) {
    const hi = ready[0], lo = ready[ready.length - 1]
    const rh = hi.replied / hi.n, rl = lo.replied / lo.n
    const ev = `${of(hi.replied, hi.n)} ${name(hi.trade)} answered, ${of(lo.replied, lo.n)} ${name(lo.trade)}`
    const sentence = rh === rl || (rl > 0 && rh / rl < 1.5)
      ? `${cap(name(hi.trade))} and ${name(lo.trade)} answer about as often (${ev}).`
      : rl === 0 ? `${cap(name(hi.trade))} answer, ${name(lo.trade)} not yet (${ev}).`
      : `${cap(name(hi.trade))} answer ${fmtRatio(rh / rl)} more often than ${name(lo.trade)} (${ev}).`
    items.push({ sentence, n: hi.n + lo.n, evidence: ev })
  }
  // what the picks do with it : only what the rules file really changes
  for (const s of ready) {
    const v = rules.industries?.[s.trade]?.value ?? 0
    if (!v) continue
    const ev = `${of(s.replied, s.n)} answered${s.meetings ? `, ${s.meetings} meeting${s.meetings === 1 ? "" : "s"}` : ""}${s.won ? `, ${s.won} signed` : ""}`
    items.push(v > 0
      ? { sentence: `${cap(name(s.trade))} are picked first now: ${ev}.`, n: s.n, evidence: ev, trade: s.trade, effect: "picked first" }
      : { sentence: `${cap(name(s.trade))} are picked later now: ${ev}.`, n: s.n, evidence: ev, trade: s.trade, effect: "picked later" })
  }
  // what their old site had (a booking button, a gallery…) and who answered more, both sides with enough businesses
  const ps = [...perProspect(rows).values()]
  for (const [k, words] of Object.entries(SIGNAL_WORDS)) {
    const w = ps.filter((p) => p.signals?.[k]), wo = ps.filter((p) => !p.signals?.[k])
    if (w.length < MIN_N || wo.length < MIN_N) continue
    const a = w.filter((p) => replied(p.kinds)).length, b = wo.filter((p) => replied(p.kinds)).length
    const ra = a / w.length, rb = b / wo.length
    if (Math.abs(ra - rb) < 0.15) continue
    const ev = `${of(a, w.length)} with it answered, ${of(b, wo.length)} without`
    items.push({ sentence: `Businesses whose site has ${words} answer ${ra > rb ? "more" : "less"} often (${ev}).`, n: w.length + wo.length, evidence: ev })
  }
  const short = stats.filter((s) => s.n < MIN_N)
  const note = !total
    ? "Nothing to learn from yet: no business has been contacted. The picks start leaning once a trade has 5 answers or silences."
    : !ready.length
      ? `Too early to say which prospects answer best: ${total} business${total === 1 ? "" : "es"} contacted so far. I compare a trade once it has ${MIN_N}.`
      : short.length ? `Not enough yet for ${short.slice(0, 3).map((s) => `${name(s.trade)} (${s.n})`).join(", ")}${short.length > 3 ? ` and ${short.length - 3} more` : ""}: ${MIN_N} each before I say anything.` : null
  return { items, note, total }
}
function fmtRatio(r: number): string {
  if (r >= 1.9) return `${Math.round(r)}×`
  return `${r.toFixed(1).replace(/\.0$/, "")}×`
}
