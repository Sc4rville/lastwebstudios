/**
 * machine.ts · the Station's "MACHINE" VIEW: the film's stage strip, for real. A snapshot of the whole chain,
 * stage by stage, read from the shared database when it is there and from the disk otherwise (no LLM, no network):
 *
 *   FIND        the scraped pool (data/raw/prospects.scraped.csv)
 *   SCORE       the scoring gate (data/raw/<id>.score.json): hot / warm / cold
 *   READ        the ProspectSheet records (database `prospects` or data/prospects/)
 *   BUILD       the sites (database `generations` or output/sites/) + the builds in progress (queue, markers)
 *   JUDGE       the two human clicks: ♥ and approved (database; without a database: the sites "to review")
 *   SELL        the sequencer (state, sends, tracking events) + the CRM (to call, meetings)
 *   LEARN       the outcomes (data/outcomes.jsonl + database mirror) → rules (learning/rules/rules.json)
 *
 * Each stage: a main counter, sub-counters, the LATEST event (timestamped) and `live` (recent
 * activity). Plus a log (the latest events across all stages) and the cage's state.
 * Never throws: an unreadable stage returns zeros and a note.
 */
import { existsSync, readdirSync, statSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { tryDb } from "../../packages/shared/db.ts"
import { cageStatus, type CageStatus } from "../../packages/shared/cage.ts"
import { readEvents, type OutreachEvent } from "../../outreach/tracking/events.ts"

const RAW = "data/raw"
const POOL_CSV = join(RAW, "prospects.scraped.csv")
const PROSPECTS = "data/prospects"
const SITES = "output/sites"
const SEQ_STATE = "data/sequencer/state.json"
const SENDS = "data/sequencer/sends.jsonl"
const RULES = "learning/rules/rules.json"
const LIVE_MS = 15 * 60_000

export type Tone = "hot" | "warm" | "cold" | "ok" | "bad" | "info" | "dim"
export type StageSub = { label: string; value: number | string; tone?: Tone }
export type Stage = { key: string; label: string; en: string; count: number; unit: string; sub: StageSub[]; last: { at: string; text: string } | null; live: boolean; note?: string; human?: string }
export type FeedItem = { at: string; stage: string; text: string }
export type MachineSnapshot = { at: string; source: "db" | "fs"; stages: Stage[]; feed: FeedItem[]; cage: CageStatus }

const iso = (ms: number | null | undefined) => (ms && Number.isFinite(Number(ms)) ? new Date(Number(ms)).toISOString() : null)
const mtimeIso = (p: string) => { try { return statSync(p).mtime.toISOString() } catch { return null } }
const safe = async <T>(f: () => Promise<T>, d: T): Promise<T> => { try { return await f() } catch { return d } }
// a prospect's readable name ("Atelier Brisane") rather than its slug: a table built once per snapshot
// (database `prospects`, otherwise the sheets on disk). Fallback: the slug without dashes.
let NAMES = new Map<string, string>()
const pretty = (id: string) => NAMES.get(id) || id.replace(/-/g, " ")
async function loadNames(): Promise<Map<string, string>> {
  const m = new Map<string, string>()
  const db = tryDb()
  if (db) {
    await safe(async () => {
      const rows = await db.prepare("SELECT id, name FROM prospects WHERE COALESCE(name,'') <> ''").all() as { id: string; name: string }[]
      for (const r of rows) m.set(r.id, String(r.name))
    }, undefined)
  }
  if (existsSync(PROSPECTS)) {
    for (const f of readdirSync(PROSPECTS)) {
      if (!f.endsWith(".json") || f.endsWith(".example.json") || m.has(f.slice(0, -5))) continue
      try { const n = JSON.parse(await readFile(join(PROSPECTS, f), "utf8"))?.identity?.name; if (typeof n === "string" && n.trim()) m.set(f.slice(0, -5), n.trim()) } catch { /* unreadable sheet */ }
    }
  }
  return m
}

// a CSV line (fields may be quoted)
function csvRow(line: string): string[] {
  const out: string[] = []; let cur = "", q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c }
    else if (c === '"') q = true
    else if (c === ",") { out.push(cur); cur = "" }
    else cur += c
  }
  out.push(cur)
  return out
}

async function findStage(feed: FeedItem[]): Promise<Stage> {
  const st: Stage = { key: "find", label: "find", en: "find", count: 0, unit: "in the pool", sub: [], last: null, live: false }
  if (!existsSync(POOL_CSV)) { st.note = "nothing scraped yet: npm run scrape -- <trade> <country>"; return st }
  const lines = (await readFile(POOL_CSV, "utf8")).split(/\r?\n/).filter((l) => l.trim())
  const head = csvRow(lines[0] || "").map((h) => h.trim().toLowerCase())
  const col = (n: string) => head.indexOf(n)
  const rows = lines.slice(1).map(csvRow)
  const inds = new Set(rows.map((r) => (r[col("industry")] || "").trim()).filter(Boolean))
  st.count = rows.length
  st.sub = [
    { label: "trades", value: inds.size },
    { label: "with email", value: rows.filter((r) => /@/.test(r[col("email")] || "")).length },
    { label: "with phone", value: rows.filter((r) => (r[col("phone")] || "").replace(/\D/g, "").length >= 9).length },
  ]
  const at = mtimeIso(POOL_CSV)
  const lastRow = rows[rows.length - 1]
  if (at && lastRow) {
    st.last = { at, text: `${lastRow[col("name")] || "?"}${lastRow[col("city")] ? ` · ${lastRow[col("city")]}` : ""} added to the pool` }
    feed.push({ at, stage: "find", text: st.last.text })
  }
  return st
}

async function scoreStage(feed: FeedItem[], dbTiers: Record<string, number> | null): Promise<Stage> {
  const st: Stage = { key: "score", label: "score", en: "score", count: 0, unit: "scored", sub: [], last: null, live: false }
  const tiers: Record<string, number> = { hot: 0, warm: 0, cold: 0 }
  let newest: { at: string; id: string; value: number; tier: string } | null = null
  if (existsSync(RAW)) {
    for (const f of readdirSync(RAW)) {
      if (!f.endsWith(".score.json")) continue
      try {
        const s = JSON.parse(await readFile(join(RAW, f), "utf8"))
        const tier = String(s?.tier || "")
        if (tier in tiers) tiers[tier]++
        st.count++
        const at = mtimeIso(join(RAW, f))
        if (at && (!newest || at > newest.at)) newest = { at, id: f.replace(/\.score\.json$/, ""), value: Number(s?.value) || 0, tier }
      } catch { /* unreadable score: ignored */ }
    }
  }
  if (!st.count && dbTiers) { for (const k of Object.keys(tiers)) tiers[k] = dbTiers[k] || 0; st.count = Object.values(dbTiers).reduce((a, b) => a + b, 0); st.note = "from the sheets (raw scores are not on this machine)" }
  st.sub = [{ label: "hot", value: tiers.hot, tone: "hot" }, { label: "warm", value: tiers.warm, tone: "warm" }, { label: "cold", value: tiers.cold, tone: "cold" }]
  if (newest) {
    st.last = { at: newest.at, text: `${pretty(newest.id)} · ${newest.value}/100 ${newest.tier}` }
    feed.push({ at: newest.at, stage: "score", text: `the gate: ${st.last.text}` })
  }
  return st
}

async function extractStage(feed: FeedItem[]): Promise<{ st: Stage; tiers: Record<string, number> | null }> {
  const st: Stage = { key: "extract", label: "read", en: "extract", count: 0, unit: "sheets", sub: [], last: null, live: false }
  const db = tryDb()
  if (db) {
    const ok = await safe(async () => {
      const r = await db.prepare(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE COALESCE(email,'') LIKE '%@%')::int AS mail,
        COUNT(*) FILTER (WHERE COALESCE(phone,'') <> '')::int AS tel FROM prospects WHERE present = 1`).get() as any
      const t = await db.prepare("SELECT opp_tier AS tier, COUNT(*)::int AS n FROM prospects WHERE present = 1 GROUP BY opp_tier").all() as any[]
      const l = await db.prepare("SELECT id, name, city, sheet_mtime FROM prospects WHERE present = 1 ORDER BY sheet_mtime DESC NULLS LAST LIMIT 1").get() as any
      st.count = r?.n ?? 0
      st.sub = [{ label: "with email", value: r?.mail ?? 0 }, { label: "with phone", value: r?.tel ?? 0 }]
      const at = iso(l?.sheet_mtime)
      if (l && at) st.last = { at, text: `sheet ${l.name || pretty(l.id)}${l.city ? ` · ${l.city}` : ""}` }
      return Object.fromEntries(t.map((x) => [x.tier || "?", x.n]))
    }, null)
    if (ok) { if (st.last) feed.push({ at: st.last.at, stage: "extract", text: st.last.text }); return { st, tiers: ok } }
  }
  if (existsSync(PROSPECTS)) {
    let mail = 0, tel = 0, newest: { at: string; text: string } | null = null
    for (const f of readdirSync(PROSPECTS)) {
      if (!f.endsWith(".json") || f.endsWith(".example.json")) continue
      try {
        const s = JSON.parse(await readFile(join(PROSPECTS, f), "utf8"))
        st.count++
        if (/@/.test(s?.identity?.email || "")) mail++
        if (s?.identity?.phone) tel++
        const at = mtimeIso(join(PROSPECTS, f))
        if (at && (!newest || at > newest.at)) newest = { at, text: `sheet ${s?.identity?.name || pretty(f.slice(0, -5))}${s?.identity?.city ? ` · ${s.identity.city}` : ""}` }
      } catch { /* unreadable sheet */ }
    }
    st.sub = [{ label: "with email", value: mail }, { label: "with phone", value: tel }]
    st.last = newest
    if (newest) feed.push({ at: newest.at, stage: "extract", text: newest.text })
  }
  return { st, tiers: null }
}

function fsSites(): { n: number; building: number; newest: { at: string; id: string; dir: string } | null; dirs: { id: string; dir: string }[] } {
  const out = { n: 0, building: 0, newest: null as { at: string; id: string; dir: string } | null, dirs: [] as { id: string; dir: string }[] }
  if (!existsSync(SITES)) return out
  for (const id of readdirSync(SITES)) {
    let dates: string[] = []; try { dates = readdirSync(join(SITES, id)) } catch { continue }
    for (const d of dates) {
      const dir = join(SITES, id, d)
      if (existsSync(join(dir, ".lws-building"))) out.building++
      if (!existsSync(join(dir, "index.html"))) continue
      out.n++; out.dirs.push({ id, dir: d })
      const at = mtimeIso(join(dir, "index.html"))
      if (at && (!out.newest || at > out.newest.at)) out.newest = { at, id, dir: d }
    }
  }
  return out
}

async function buildStage(feed: FeedItem[]): Promise<Stage> {
  const st: Stage = { key: "build", label: "build", en: "build", count: 0, unit: "sites", sub: [], last: null, live: false }
  const fs = fsSites()
  let running = fs.building, queued = 0
  const db = tryDb()
  let fromDb = false
  if (db) {
    fromDb = await safe(async () => {
      const g = await db.prepare("SELECT COUNT(*)::int AS n FROM generations WHERE present = 1 AND has_index = 1").get() as any
      const l = await db.prepare("SELECT prospect_id, dir_slug, COALESCE(created_at, indexed_at) AS at FROM generations WHERE present = 1 AND has_index = 1 ORDER BY gen_date DESC NULLS LAST, created_at DESC NULLS LAST LIMIT 1").get() as any
      const b = await db.prepare("SELECT COUNT(*) FILTER (WHERE status = 'running')::int AS running, COUNT(*) FILTER (WHERE status = 'queued')::int AS queued FROM batch_requests WHERE mode IN ('composer','template-fill')").get() as any
      st.count = g?.n ?? 0
      running = Math.max(running, b?.running ?? 0); queued = b?.queued ?? 0
      const at = iso(l?.at)
      if (l && at) st.last = { at, text: `site ${pretty(l.prospect_id)} · ${l.dir_slug}` }
      return true
    }, false)
  }
  if (!fromDb) {
    st.count = fs.n
    if (fs.newest) st.last = { at: fs.newest.at, text: `site ${pretty(fs.newest.id)} · ${fs.newest.dir}` }
  }
  st.sub = [{ label: "building", value: running, tone: running ? "hot" : undefined }, { label: "queued", value: queued }]
  st.live = running > 0
  if (st.last) feed.push({ at: st.last.at, stage: "build", text: `${st.last.text} built` })
  return st
}

async function judgeStage(feed: FeedItem[], sitesCount: number): Promise<Stage> {
  const st: Stage = { key: "judge", label: "judge", en: "judge", count: 0, unit: "approved", sub: [], last: null, live: false, human: "you · ♥ ✓" }
  const db = tryDb()
  const ok = db && await safe(async () => {
    const r = await db.prepare(`SELECT COUNT(DISTINCT prospect_id) FILTER (WHERE status IN ('approved','drafted','sent'))::int AS approved,
        COUNT(DISTINCT prospect_id) FILTER (WHERE COALESCE(love,0) > 0)::int AS loved,
        COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
        COUNT(*) FILTER (WHERE COALESCE(status,'draft') = 'draft')::int AS todo
      FROM generations WHERE present = 1 AND has_index = 1`).get() as any
    const l = await db.prepare("SELECT prospect_id, status, status_changed_at FROM generations WHERE status_changed_at IS NOT NULL ORDER BY status_changed_at DESC LIMIT 1").get() as any
    st.count = r?.approved ?? 0
    st.sub = [{ label: "to review", value: r?.todo ?? 0, tone: "info" }, { label: "♥", value: r?.loved ?? 0, tone: "warm" }, { label: "skipped", value: r?.rejected ?? 0, tone: "dim" }]
    const at = iso(l?.status_changed_at)
    const word: Record<string, string> = { approved: "approved", rejected: "skipped", drafted: "draft ready", sent: "sent" }
    if (l && at) st.last = { at, text: `${word[l.status] || l.status}: ${pretty(l.prospect_id)}` }
    return true
  }, false)
  if (!ok) {
    st.count = sitesCount; st.unit = "to review"
    st.sub = [{ label: "♥ and ✓", value: "database required", tone: "dim" }]
    st.note = "♥ and approved live in the database (npm run db:init)"
  }
  if (st.last) feed.push({ at: st.last.at, stage: "judge", text: st.last.text })
  return st
}

async function sequences(): Promise<any[]> {
  const db = tryDb()
  if (db) {
    const rows = await safe(() => db.prepare("SELECT data FROM sequencer_state").all(), [] as any[])
    if (rows.length) return rows.map((r: any) => (typeof r.data === "string" ? JSON.parse(r.data) : r.data))
  }
  try { if (existsSync(SEQ_STATE)) return JSON.parse(await readFile(SEQ_STATE, "utf8")) } catch { /* */ }
  return []
}

async function sellStage(feed: FeedItem[], events: OutreachEvent[]): Promise<Stage> {
  const st: Stage = { key: "sell", label: "sell", en: "sell", count: 0, unit: "enrolled", sub: [], last: null, live: false, human: "you · ☎" }
  const seqs = await sequences()
  const live = seqs.filter((s) => s.status === "active" || s.status === "waiting-content")
  st.count = seqs.length
  const sends = seqs.reduce((n, s) => n + (s.sends?.length || 0), 0)
  const clicks = events.filter((e) => e.type === "click" && !e.suspect).length || seqs.reduce((n, s) => n + (s.clicks?.length || 0), 0)
  const replied = seqs.filter((s) => s.status === "replied").length
  let toCall = 0, rdv = 0
  const db = tryDb()
  if (db) {
    await safe(async () => {
      const rows = await db.prepare("SELECT pipeline, stage, COUNT(*)::int AS n FROM crm_leads GROUP BY pipeline, stage").all() as any[]
      for (const r of rows) { if (r.pipeline === "hot" && r.stage !== "nurturing" && r.stage !== "lost") toCall += r.n; if (r.pipeline === "closing") rdv += r.n }
    }, undefined)
  }
  st.sub = [
    { label: "running", value: live.length }, { label: "emails", value: sends }, { label: "clicks", value: clicks, tone: clicks ? "hot" : undefined },
    { label: "replies", value: replied, tone: replied ? "ok" : undefined },
    ...(db ? [{ label: "to call", value: toCall }, { label: "closing", value: rdv }] : []),
  ]
  // latest sales fact: a prospect event (click, reply…) or a send
  const label: Record<string, string> = { click: "click", reply: "replied", unsub: "unsubscribed", bounce: "bounce", complaint: "complaint" }
  const sendsLog: any[] = existsSync(SENDS) ? (await readFile(SENDS, "utf8")).split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) : []
  const pidOf = (e: OutreachEvent) => e.prospectId || sendsLog.find((s) => s.trackingId === e.trackingId)?.prospectId || seqs.find((s) => (s.sends || []).some((x: any) => x.trackingId === e.trackingId))?.prospectId || ""
  for (const e of events.filter((x) => x.type !== "outcome").slice(-6)) feed.push({ at: e.at, stage: "sell", text: `${label[e.type] || e.type}${e.suspect ? " (scanner)" : ""} · ${pretty(pidOf(e))}` })
  const allSends = seqs.flatMap((s) => (s.sends || []).map((x: any) => ({ ...x, prospectId: s.prospectId })))
  for (const s of allSends.sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(-4)) feed.push({ at: s.at, stage: "sell", text: `email "${s.step}" → ${pretty(s.prospectId)}` })
  const lastEv = events.filter((x) => x.type !== "outcome").slice(-1)[0]
  const lastSend = allSends.sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(-1)[0]
  if (lastEv && (!lastSend || lastEv.at >= lastSend.at)) st.last = { at: lastEv.at, text: `${label[lastEv.type] || lastEv.type} · ${pretty(pidOf(lastEv))}` }
  else if (lastSend) st.last = { at: lastSend.at, text: `email "${lastSend.step}" → ${pretty(lastSend.prospectId)}` }
  return st
}

async function learnStage(feed: FeedItem[]): Promise<Stage> {
  const st: Stage = { key: "learn", label: "learn", en: "learn", count: 0, unit: "outcomes", sub: [], last: null, live: false }
  const { loadOutcomes } = await import("../../learning/scripts/learn.ts")
  const { outcomes } = await safe(() => loadOutcomes(), { outcomes: [] as any[], fromFile: 0, fromDb: 0 })
  st.count = outcomes.length
  let rules: any = null
  try { if (existsSync(RULES)) rules = JSON.parse(await readFile(RULES, "utf8")) } catch { /* */ }
  st.sub = [
    { label: "won", value: outcomes.filter((o) => o.outcome === "won").length, tone: "ok" },
    { label: "lost", value: outcomes.filter((o) => o.outcome === "lost").length, tone: "bad" },
    { label: "trades adjusted", value: rules ? Object.keys(rules.industries || {}).length : 0 },
  ]
  const word: Record<string, string> = { won: "won", lost: "lost", meeting: "meeting", reply: "reply", sent: "sent" }
  const sorted = outcomes.slice().sort((a, b) => String(a.ts).localeCompare(String(b.ts)))
  for (const o of sorted.slice(-4)) feed.push({ at: o.ts, stage: "learn", text: `${word[o.outcome] || o.outcome} · ${pretty(o.id)} (${o.industry})` })
  const lo = sorted[sorted.length - 1]
  if (lo) st.last = { at: lo.ts, text: `${word[lo.outcome] || lo.outcome} · ${pretty(lo.id)}` }
  if (rules?.updatedAt) {
    feed.push({ at: rules.updatedAt, stage: "learn", text: `rules recomputed (${rules.totalOutcomes} outcome(s))` })
    if (!st.last || rules.updatedAt > st.last.at) st.last = { at: rules.updatedAt, text: `rules recomputed · ${Object.keys(rules.industries || {}).length} trade(s) adjusted` }
  } else if (outcomes.length) st.note = "rules not recomputed yet: npm run learn (nightly timer)"
  return st
}

/** The snapshot of the whole machine. */
export async function machineSnapshot(now = new Date().toISOString()): Promise<MachineSnapshot> {
  const feed: FeedItem[] = []
  NAMES = await safe(() => loadNames(), new Map<string, string>())
  const events = await safe(() => readEvents(), [] as OutreachEvent[])
  const find = await safe(() => findStage(feed), null)
  const ex = await safe<{ st: Stage | null; tiers: Record<string, number> | null }>(() => extractStage(feed), { st: null, tiers: null })
  const score = await safe(() => scoreStage(feed, ex.tiers), null)
  const build = await safe(() => buildStage(feed), null)
  const judge = await safe(() => judgeStage(feed, build?.count ?? 0), null)
  const sell = await safe(() => sellStage(feed, events), null)
  const learn = await safe(() => learnStage(feed), null)
  const blank = (key: string, label: string, en: string): Stage => ({ key, label, en, count: 0, unit: "", sub: [], last: null, live: false, note: "unreadable" })
  const stages = [
    find ?? blank("find", "find", "find"), score ?? blank("score", "score", "score"), ex.st ?? blank("extract", "read", "extract"),
    build ?? blank("build", "build", "build"), judge ?? blank("judge", "judge", "judge"), sell ?? blank("sell", "sell", "sell"), learn ?? blank("learn", "learn", "learn"),
  ]
  const t = new Date(now).getTime()
  for (const s of stages) if (s.last && t - new Date(s.last.at).getTime() < LIVE_MS) s.live = true
  const cage = await cageStatus(process.env, now)
  return { at: now, source: tryDb() ? "db" : "fs", stages, feed: feed.filter((f) => f.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 14), cage }
}
