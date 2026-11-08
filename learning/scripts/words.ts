/**
 * Learning — THE WORDS (D6) : which opening of the first email, and which opening of the call, gets answers. Each
 * first email records its opening (data/savior/<id>.json › angle), each lead on the call list gets one call opening
 * (data/learning/words.json) ; the sales outcomes (a reply, a meeting, signed) say which works. The next drafts lean on
 * the winner, BOUNDED : at most LEAN of the next ones (the others keep going out, so the comparison stays honest), and
 * only once every opening has MIN_N tries. Each choice is explained in one sentence.
 */
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { Outcome } from "./types.ts"

export type Channel = "email" | "call"
export type Angle = { key: string; label: string; brief: string }
export const MIN_N = 5
/** the winner's share of the next drafts once it leads : never all of them */
export const LEAN = 0.6
export const WORDS_FILE = join("data", "learning", "words.json")

export const ANGLES: Record<Channel, Angle[]> = {
  email: [
    { key: "built-it", label: "“It's already built”", brief: "Open with the finished new site, ready to look at today (not a mockup): what was already done for them." },
    { key: "customers", label: "“More calls from phones”", brief: "Open with what the new site changes for their customers (it works on a phone, one tap to call, Google can read it): a gain for them, never a criticism of their current site." },
    { key: "craft", label: "“Your work deserves it”", brief: "Open with what is genuinely good about their work (seen on their own site), then the new site that shows it at that level." },
  ],
  call: [
    { key: "built-it", label: "“I built you a new site”", brief: "Say straight away that a new site is already built for them and offer to show it." },
    { key: "customers", label: "“Customers on a phone”", brief: "Open with how people look for their trade now (on a phone) and what the new site changes there." },
    { key: "value", label: "“What is a new customer worth?”", brief: "Open with one question: what one new customer is worth to them, then the site that brings more." },
  ],
}
const angleOf = (ch: Channel, key: string) => ANGLES[ch].find((a) => a.key === key)
export const isAngle = (ch: Channel, key: unknown): key is string => typeof key === "string" && !!angleOf(ch, key)

export type AngleStat = { key: string; label: string; n: number; wins: number }
export type Pick = { angle: string; label: string; why: string; leaning: boolean }

/**
 * Tries and wins per opening. `assigned` = prospect → opening ; a win is a reply (or more) for an email, a meeting (or
 * signed) for a call. `tried` (optional) keeps only the prospects really tried (a call made).
 */
export function angleStats(ch: Channel, assigned: Record<string, string>, rows: Outcome[], tried?: Set<string>): AngleStat[] {
  const kinds = new Map<string, Set<string>>()
  for (const o of rows) { if (!o || typeof o.id !== "string") continue; const k = kinds.get(o.id) || new Set<string>(); k.add(o.outcome); kinds.set(o.id, k) }
  const win = (id: string) => { const k = kinds.get(id); if (!k) return false; return ch === "email" ? k.has("reply") || k.has("meeting") || k.has("won") : k.has("meeting") || k.has("won") }
  return ANGLES[ch].map((a) => {
    const ids = Object.entries(assigned).filter(([id, k]) => k === a.key && (!tried || tried.has(id))).map(([id]) => id)
    return { key: a.key, label: a.label, n: ids.length, wins: ids.filter(win).length }
  })
}

/** a stable draw in [0, 1) for a prospect : the same prospect always gets the same opening */
export function draw(ch: Channel, id: string): number {
  return createHash("sha256").update(`${ch}\n${id}`).digest().readUInt32BE(0) / 2 ** 32
}
const WHAT: Record<Channel, [string, string]> = { email: ["reply", "replies"], call: ["meeting", "meetings"] }
const count = (ch: Channel, n: number) => `${n} ${n === 1 ? WHAT[ch][0] : WHAT[ch][1]}`
const TRIES: Record<Channel, string> = { email: "first emails", call: "calls" }

/** the leader, when it really leads : every opening tried MIN_N times, ahead by 10 points, at least 2 wins */
export function leader(stats: AngleStat[]): { best: AngleStat; next: AngleStat } | null {
  if (stats.length < 2 || stats.some((s) => s.n < MIN_N)) return null
  const sorted = [...stats].sort((a, b) => b.wins / b.n - a.wins / a.n || b.n - a.n)
  const [best, next] = sorted
  return best.wins >= 2 && best.wins / best.n - next.wins / next.n >= 0.1 ? { best, next } : null
}

/** The opening the next draft uses, and why, in one sentence. */
export function pickAngle(ch: Channel, id: string, stats: AngleStat[]): Pick {
  const u = draw(ch, id)
  const arms = ANGLES[ch]
  const byKey = new Map(stats.map((s) => [s.key, s]))
  const n = (k: string) => byKey.get(k)?.n ?? 0
  const lead = leader(arms.map((a) => byKey.get(a.key) || { key: a.key, label: a.label, n: 0, wins: 0 }))
  if (lead) {
    const others = arms.filter((a) => a.key !== lead.best.key)
    const a = u < LEAN ? angleOf(ch, lead.best.key)! : others[Math.min(others.length - 1, Math.floor(((u - LEAN) / (1 - LEAN)) * others.length))]
    const why = `Leaning on ${lead.best.label}: ${count(ch, lead.best.wins)} from ${lead.best.n} ${TRIES[ch]}, against ${lead.next.wins} from ${lead.next.n} for the next best. The others still go out ${Math.round((1 - LEAN) * 10)} times in 10, so the comparison stays honest.`
    return { angle: a.key, label: a.label, why, leaning: a.key === lead.best.key }
  }
  if (arms.some((a) => n(a.key) < MIN_N)) {
    // each opening in turn until every one has MIN_N tries (the least tried first ; a tie broken by the draw)
    const least = Math.min(...arms.map((a) => n(a.key)))
    const tied = arms.filter((a) => n(a.key) === least)
    const a = tied[Math.floor(u * tied.length)]
    return { angle: a.key, label: a.label, why: `Trying each opening in turn (${arms.map((x) => `${n(x.key)} ${x.label}`).join(", ")}): I lean on one once each has ${MIN_N}.`, leaning: false }
  }
  const a = arms[Math.floor(u * arms.length)]
  return { angle: a.key, label: a.label, why: `No clear winner yet (${stats.map((s) => `${s.label} ${s.wins} of ${s.n}`).join(", ")}): each opening goes out as often.`, leaning: false }
}

export type WordsLine = { sentence: string; n: number; evidence: string; angle: string }
export type WordsView = { items: WordsLine[]; note: string | null; total: number; next: Pick | null }
/** What the agency says about its words, per channel : results per opening (only with MIN_N tries), the leaning. */
export function wordsView(ch: Channel, stats: AngleStat[]): WordsView {
  const total = stats.reduce((a, s) => a + s.n, 0)
  const items: WordsLine[] = []
  const lead0 = ch === "email" ? "First emails that open with" : "Calls that open with"
  for (const s of stats) if (s.n >= MIN_N) items.push({ sentence: `${lead0} ${s.label} got ${count(ch, s.wins)} from ${s.n}.`, n: s.n, evidence: `${s.wins} of ${s.n}`, angle: s.key })
  const lead = leader(stats)
  if (lead) items.push({ sentence: `The next ${TRIES[ch]} lean on ${lead.best.label} (${Math.round(LEAN * 10)} in 10); the others keep going out so the comparison stays honest.`, n: lead.best.n + lead.next.n, evidence: `${lead.best.wins} of ${lead.best.n} against ${lead.next.wins} of ${lead.next.n}`, angle: lead.best.key })
  const short = stats.filter((s) => s.n < MIN_N)
  const what = ch === "email" ? "first email" : "call opening"
  const note = !total ? `Nothing to compare yet: no ${what} ${ch === "email" ? "written" : "tried"}.`
    : short.length ? `Too early to say which ${what} works: ${total} ${ch === "email" ? "written" : "tried"} so far (${stats.filter((s) => s.n).map((s) => `${s.n} ${s.label}`).join(", ")}). I lean on one once each has ${MIN_N}.`
    : !lead ? "No clear winner yet: each opening goes out as often." : null
  return { items, note, total, next: null }
}

// ── the openings in words (the sandbox's drafts, the call script's first lines) ────────────────────────────────────────
/** the call's opening sentence for an opening, in the lead's language (the call script splices it in) */
export function callOpener(key: string, lead: { name: string; trade?: string; trades?: string }, lang = "en"): string {
  const fr = String(lang).toLowerCase().startsWith("fr")
  const name = lead.name
  if (fr) {
    if (key === "customers") return `Aujourd'hui, la plupart des gens cherchent un ${lead.trade || "artisan"} sur leur téléphone. J'ai construit un nouveau site pour ${name} qui marche là : on vous appelle en un geste, et Google le lit.`
    if (key === "value") return `Une question avant tout : combien vous rapporte un nouveau client, pour ${name} ? Je vous demande ça parce que j'ai construit un nouveau site pour vous en amener plus.`
    return `J'ai regardé votre site et je me suis permis d'en construire un nouveau pour ${name}, pour que vous le voyiez déjà fait.`
  }
  if (key === "customers") return `Most people look for a ${lead.trade || "business like yours"} on their phone now. I built a new site for ${name} that works there: one tap to call you, and Google can read it.`
  if (key === "value") return `Quick question first: what is one new customer worth to ${name}? I ask because I built you a new site to bring in more of them.`
  return `I looked at your site and took the liberty of building a new one for ${name}, so you can see it already done.`
}

// ── the store : the call openings given, and the email openings read from the written first emails ─────────────────────
type WordsFile = { calls: Record<string, { angle: string; at: string; why?: string }> }
export function loadWords(root = "."): WordsFile {
  try { const j = JSON.parse(readFileSync(join(root, WORDS_FILE), "utf8")); return { calls: j?.calls && typeof j.calls === "object" ? j.calls : {} } } catch { return { calls: {} } }
}
export function saveWords(w: WordsFile, root = "."): void {
  const f = join(root, WORDS_FILE)
  mkdirSync(dirname(f), { recursive: true })
  const tmp = `${f}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(w, null, 2) + "\n"); renameSync(tmp, f)
}
/** prospect → the opening of its first email, from the written emails (data/savior/<id>.json › angle) */
export function emailAngles(root = "."): Record<string, string> {
  const dir = join(root, "data", "savior"), out: Record<string, string> = {}
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue
    try { const j = JSON.parse(readFileSync(join(dir, f), "utf8")); if (isAngle("email", j?.angle)) out[String(j.prospectId || f.slice(0, -5))] = j.angle } catch { /* a broken file counts for nothing */ }
  }
  return out
}
export function callAngles(root = "."): Record<string, string> {
  return Object.fromEntries(Object.entries(loadWords(root).calls).filter(([, v]) => isAngle("call", v?.angle)).map(([k, v]) => [k, v.angle]))
}
