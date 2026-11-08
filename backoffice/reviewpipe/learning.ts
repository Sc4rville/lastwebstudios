/**
 * learning.ts · « What the agency learned » on the cockpit's side (decision D6) : the API the UI reads, and the hooks
 * serve.ts calls when the owner gives feedback on a site, sends it to outreach, skips it or asks for a rebuild.
 *
 *   GET    /api/learning                    preferences (with evidence), picks and words, as plain sentences
 *   GET    /api/learning/site?id&date       which preferences a site was built with (« Built with 3 of your preferences »)
 *   POST   /api/learning/feedback           {id, date?, kind, text} → « I'll remember: … » + an undo id (no edit job)
 *   POST   /api/learning/undo               {undo} → what that feedback taught is taken back
 *   POST   /api/learning/preference         {id, on} switch · {id, text} your words · {id, delete: true} · {text} add one
 *   DELETE /api/learning/preference?id=…    delete
 *
 * Distillation : the learn-taste skill (role fast, through packages/llm : `claude -p` on the subscription by default,
 * any LWS_LLM way) in the background, the answer pushed over SSE ({type: "learning", undo, remember}) ; in the sandbox
 * (LWS_SANDBOX=1) or with LWS_TASTE_DISTILL=rules, the deterministic rules answer at once, with no model.
 * The pure logic lives in learning/scripts/ (taste.ts, picks.ts, words.ts) ; this file only wires it to HTTP and disk.
 */
import type { IncomingMessage, ServerResponse } from "node:http"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import * as T from "../../learning/scripts/taste.ts"
import { pickSentences } from "../../learning/scripts/picks.ts"
import { angleStats, pickAngle, wordsView, emailAngles, callAngles, loadWords, saveWords, callOpener, ANGLES, type Channel, type Pick } from "../../learning/scripts/words.ts"
import type { Outcome } from "../../learning/scripts/types.ts"

const SITES = join("output", "sites")
const PROSPECTS = join("data", "prospects")

type Ctx = {
  broadcast: (o: unknown) => void
  sendJson: (res: ServerResponse, obj: unknown, code?: number) => void
  parseBody: (req: IncomingMessage) => Promise<any>
  siteDir: (id: string, date: string) => string | null
}
let ctx: Ctx | null = null
/** serve.ts hands its helpers once, at start (no import cycle) */
export function initLearning(c: Ctx): void { ctx = c }
const emit = (o: unknown) => { try { ctx?.broadcast(o) } catch { /* the UI reloads on its own */ } }

// one writer at a time : every change of taste.json goes through this chain (read, change, write, mirror)
let chain: Promise<unknown> = Promise.resolve()
function withTaste<R>(fn: (t: T.TasteFile) => R | Promise<R>): Promise<R> {
  const run = chain.then(async () => { const t = T.loadTaste(); const r = await fn(t); T.saveTaste(t); void T.mirrorTaste(t); return r })
  chain = run.catch(() => {})
  return run
}

export const distillMode = (env: NodeJS.ProcessEnv = process.env): "rules" | "skill" => (env.LWS_SANDBOX === "1" || env.LWS_TASTE_DISTILL === "rules" ? "rules" : "skill")

// ── small readers ───────────────────────────────────────────────────────────────────────────────────────────────────
const validId = (id: unknown): id is string => typeof id === "string" && /^[a-z0-9._-]{1,120}$/i.test(id) && !id.includes("..")
function sheet(id: string): any { try { return JSON.parse(readFileSync(join(PROSPECTS, `${id}.json`), "utf8")) } catch { return null } }
const nameOf = (id: string) => sheet(id)?.identity?.name || id.replace(/-/g, " ")
let labels: Record<string, string> | null = null
// the trades' names in French, for what is said to a French business (a call opening never says « kitchen designer » in French)
let labelsFr: Record<string, string> | null = null
async function tradeLabel(k: string): Promise<string> {
  if (!labels) { try { const { INDUSTRIES } = await import("../../leadengine/1_scraping/scripts/industries.ts"); labels = Object.fromEntries(Object.entries(INDUSTRIES).map(([key, v]: [string, any]) => [key, String(v.en?.label || v.label || key)])); labelsFr = Object.fromEntries(Object.entries(INDUSTRIES).map(([key, v]: [string, any]) => [key, String(v.label || key)])) } catch { labels = {}; labelsFr = {} } }
  return labels[k] || k.replace(/-/g, " ")
}
/** a site's latest built version (the one a rebuild replaces) */
function latestSite(id: string): string | null {
  const base = join(SITES, id)
  try { const ds = readdirSync(base).filter((d) => existsSync(join(base, d, "index.html"))).sort(); return ds.length ? ds[ds.length - 1] : null } catch { return null }
}
/**
 * A site's record : its .lws-taste.json, else (a site built on another machine : dot files never travel to the bucket)
 * the `- preferences :` line of its control.md, the texts taken from the store.
 */
function siteRecord(id: string, date: string): { taste: T.SiteTaste | null; traits: T.Traits } {
  const dir = join(SITES, id, date)
  let ctl = ""; try { ctl = readFileSync(join(dir, "control.md"), "utf8") } catch { /* */ }
  let taste = T.readSiteTaste(dir)
  const ids = taste ? [] : T.controlPreferences(ctl)
  if (!taste && ids.length) { const known = new Map(T.loadTaste().preferences.map((p) => [p.id, p.text])); taste = { at: "", by: "control", given: [], applied: ids.map((x) => ({ id: x, text: known.get(x) || x })) } }
  return { taste, traits: { ...T.controlTraits(ctl), ...(taste?.traits || {}) } }
}
/** how many preferences a site was built with (the Sites list says it on the card) */
export function sitePrefCount(dir: string): number {
  const r = T.readSiteTaste(dir)
  if (r) return r.applied?.length ?? 0
  try { return T.controlPreferences(readFileSync(join(dir, "control.md"), "utf8")).length } catch { return 0 }
}

// ── what the endpoint says after a feedback ─────────────────────────────────────────────────────────────────────────
export type Remember = { undo: string; pending: boolean; text: string | null; preferences: { id: string; text: string; isNew: boolean }[]; replaced: { id: string; text: string }[] }
function remember(a: T.Applied): Remember {
  return { undo: a.event.id, pending: false, text: T.rememberText(a), preferences: [...a.created.map((p) => ({ id: p.id, text: p.text, isNew: true })), ...a.strengthened.map((p) => ({ id: p.id, text: p.text, isNew: false }))], replaced: a.replaced.map((p) => ({ id: p.id, text: p.text })) }
}

type Distiller = (f: { kind: string; text: string; site: string; trade: string }, existing: T.Pref[]) => Promise<T.Proposal[]>
/** the learn-taste skill through packages/llm (any LWS_LLM way) ; tests swap it */
let skillDistiller: Distiller = async (f, existing) => {
  const { runSkill } = await import("../../packages/utils/run-skill.ts")
  const raw = await runSkill(".claude/skills/learn-taste", {
    feedback: { kind: f.kind, text: f.text, site: f.site, trade: f.trade },
    preferences: existing.map((p) => ({ id: p.id, text: p.text })),
    language: "English for each preference's text (the owner's own words stay as written in `quote`)",
  }, "fast", 900)
  return T.validateSkillAnswer(raw, existing)
}
export function setDistiller(d: Distiller | null): void { if (d) skillDistiller = d }

/**
 * A feedback in words on a site (a comment, a rebuild request, a reason to skip) : distilled into preferences. With
 * the rules (sandbox) the answer is immediate ; with the skill the event is recorded at once (its undo id works) and
 * the preferences arrive over SSE a few seconds later. null when there are no words.
 */
export async function onFeedback(f: { kind: T.FeedbackKind; id: string; date?: string | null; text?: string | null }): Promise<Remember | null> {
  const text = String(f.text ?? "").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, 2000)
  if (!text || !validId(f.id)) return null
  const ev = { id: T.newEventId(), kind: f.kind, site: f.id, ...(f.date ? { date: f.date } : {}), name: nameOf(f.id), text, at: new Date().toISOString() }
  if (distillMode() === "rules") {
    const a = await withTaste((t) => T.applyFeedback(t, { ...ev, via: "rules" }, T.distillRules(text)))
    emit({ type: "learning" })
    return remember(a)
  }
  await withTaste((t) => { T.applyFeedback(t, { ...ev, via: "skill", pending: true }, []) })
  void (async () => {
    let props: T.Proposal[] = [], via: "skill" | "rules" = "skill"
    try { props = await skillDistiller({ kind: f.kind, text, site: ev.name, trade: await tradeLabel(String(sheet(f.id)?.industry || "")) }, T.loadTaste().preferences) }
    catch { props = T.distillRules(text); via = "rules" } // no model answered : the rules still catch the common words
    const a = await withTaste((t) => {
      const e = t.events.find((x) => x.id === ev.id)
      if (!e || e.undone) return null // undone while it was thinking : nothing is learned
      e.pending = false; e.via = via
      return T.applyFeedback(t, e, props)
    }).catch(() => null)
    if (a) emit({ type: "learning", undo: ev.id, remember: remember(a) })
  })()
  return { undo: ev.id, pending: true, text: null, preferences: [], replaced: [] }
}

/** Sent to outreach or skipped : the decision is kept with the site's traits ; enough of them teach a trait. */
export async function onDecision(f: { id: string; date: string; status: string; reason?: string | null }): Promise<Remember | null> {
  const kind = f.status === "approved" ? "approve" : f.status === "rejected" ? "reject" : null
  if (!kind || !validId(f.id)) return null
  const said = f.reason ? await onFeedback({ kind, id: f.id, date: f.date, text: f.reason }) : null
  await decide(f.id, f.date, kind)
  return said
}
/** A rebuild asked (with or without words) : a « not this one » for the version it replaces. */
export async function onRebuild(ids: string[], text?: string | null): Promise<Remember | null> {
  let said: Remember | null = null
  for (const id of ids.filter(validId).slice(0, 50)) {
    const date = latestSite(id)
    if (!date) continue // a first build is no feedback
    if (text && !said) said = await onFeedback({ kind: "rebuild", id, date, text })
    await decide(id, date, "rebuild")
  }
  return said
}
async function decide(id: string, date: string, kind: T.Decision["kind"]): Promise<void> {
  const rec = siteRecord(id, date)
  const learned = await withTaste((t) => {
    T.recordDecision(t, { site: id, date, kind, traits: rec.traits, applied: (rec.taste?.applied || []).map((p) => p.id), at: new Date().toISOString() })
    return T.refreshTraits(t)
  })
  emit(learned && (learned.created.length || learned.strengthened.length) ? { type: "learning", undo: learned.event.id, remember: remember(learned) } : { type: "learning" })
}

/** after an outcome the CRM recorded : the rules the picks read are rewritten at once */
export async function refreshPicks(): Promise<void> {
  try { const { refreshRules } = await import("../../learning/scripts/learn.ts"); await refreshRules(); emit({ type: "learning" }) } catch { /* the nightly run catches up */ }
}

// ── the words : the opening of the first email, the opening of the call ──────────────────────────────────────────────
async function outcomes(): Promise<Outcome[]> {
  try { const { loadOutcomes } = await import("../../learning/scripts/learn.ts"); return (await loadOutcomes()).outcomes } catch { return [] }
}
async function calledLeads(): Promise<Set<string> | undefined> {
  if (!process.env.DATABASE_URL) return undefined
  try { const { getDb } = await import("../../packages/shared/db.ts"); const rows = await getDb().prepare("SELECT prospect_id AS id FROM crm_leads WHERE COALESCE(call_count,0) > 0").all() as { id: string }[]; return new Set(rows.map((r) => r.id)) } catch { return undefined }
}
/** the opening the next first email of this prospect uses, and why (written into its data/savior/<id>.json) */
export async function firstEmailAngle(id: string): Promise<Pick & { brief: string }> {
  const p = pickAngle("email", id, angleStats("email", emailAngles(), await outcomes()))
  return { ...p, brief: ANGLES.email.find((a) => a.key === p.angle)!.brief }
}
let seen: { at: number; rows: Outcome[]; called: Set<string> | undefined } = { at: 0, rows: [], called: undefined }
/**
 * For the call list : each lead's call opening (given once, kept in data/learning/words.json) with its first sentence
 * in the lead's language. One reading of the outcomes for the whole list.
 */
export async function callAnglesFor(): Promise<(lead: { id: string; name: string; industry?: string; lang?: string }) => { key: string; label: string; opener: string; why: string }> {
  const w = loadWords()
  let stats: ReturnType<typeof angleStats> | null = null
  // the call list is opened often : the outcomes are read at most once a minute for it (a new lead's opening needs them)
  if (Date.now() - seen.at > 60_000) seen = { at: Date.now(), rows: await outcomes(), called: await calledLeads() }
  const { rows, called } = seen
  await tradeLabel("") // the trades' names, loaded for the synchronous calls below
  return (lead) => {
    let a = w.calls[lead.id]
    if (!a || !ANGLES.call.some((x) => x.key === a.angle)) {
      stats ||= angleStats("call", callAngles(), rows, called)
      const p = pickAngle("call", lead.id, stats)
      const st = stats.find((x) => x.key === p.angle); if (st) st.n++ // the next new lead of this list sees this one
      a = { angle: p.angle, at: new Date().toISOString(), why: p.why }
      w.calls[lead.id] = a
      try { saveWords(w) } catch { /* the opening is still given, just not remembered */ }
    }
    const def = ANGLES.call.find((x) => x.key === a.angle)!
    const fr = String(lead.lang || "").toLowerCase().startsWith("fr")
    const trade = String(((fr ? labelsFr : labels) || {})[lead.industry || ""] || "").toLowerCase()
    return { key: def.key, label: def.label, opener: callOpener(def.key, { name: lead.name, trade }, lead.lang || "en"), why: a.why || "" }
  }
}

/** the call opening of a lead sent to outreach, for its research job (the call script is written with it, on any machine) */
export async function callOpeningParams(id: string): Promise<{ openings?: Record<string, string> }> {
  try { const f = await callAnglesFor(); return { openings: { [id]: f({ id, name: nameOf(id) }).key } } } catch { return {} }
}

// ── the page « What the agency learned » ──────────────────────────────────────────────────────────────────────────────
const SAY: Record<string, (n: string) => string> = {
  comment: (n) => `Your comment on ${n}`, rebuild: (n) => `Your rebuild request for ${n}`, reject: (n) => `Skipping ${n}`,
  approve: (n) => `Sending ${n} to outreach`, decisions: () => "What you sent to outreach and what you skipped", you: () => "Added by you",
}
function sourceView(s: T.Source) {
  const say = (SAY[s.kind] || SAY.comment)(s.name || (s.site ? nameOf(s.site) : "a site"))
  return { kind: s.kind, site: s.site || null, date: s.date || null, name: s.name || null, quote: s.quote || null, at: s.at, say }
}
/** every built site's record, once per request : which preferences each was built with */
function allSiteRecords(): { id: string; date: string; applied: string[] }[] {
  const out: { id: string; date: string; applied: string[] }[] = []
  try {
    for (const id of readdirSync(SITES)) {
      let dates: string[] = []; try { if (!statSync(join(SITES, id)).isDirectory()) continue; dates = readdirSync(join(SITES, id)) } catch { continue }
      for (const date of dates) { const r = T.readSiteTaste(join(SITES, id, date)); if (r?.applied?.length) out.push({ id, date, applied: r.applied.map((p) => p.id) }) }
    }
  } catch { /* no site yet */ }
  return out
}
function prefView(p: T.Pref, t: T.TasteFile, sites: ReturnType<typeof allSiteRecords>) {
  const said = p.sources.filter((s) => s.kind !== "decisions")
  const fromDecisions = p.sources.find((s) => s.kind === "decisions")
  const nSites = new Set(said.map((s) => s.site).filter(Boolean)).size
  const strength = said.length
    ? `Said ${T.times(said.length)}${nSites > 1 ? `, about ${nSites} sites` : ""}${fromDecisions ? ", and what you sent and skipped agrees" : ""}`
    : fromDecisions ? "Learned from what you sent to outreach and what you skipped" : p.by === "you" ? "Added by you" : "Said once"
  const latest = [...p.sources].reverse().find((s) => s.quote) || p.sources[p.sources.length - 1]
  const lv = latest ? sourceView(latest) : null
  const evidence = lv ? (lv.kind === "decisions" ? `${lv.quote}.` : lv.quote ? `${lv.say}: “${lv.quote}”` : lv.say) : null
  const used = sites.filter((s) => s.applied.includes(p.id))
  const decided = new Map<string, string>()
  for (const d of t.decisions) if (d.applied.includes(p.id)) { const k = `${d.site}/${d.date}`; const c = decided.get(k); if (!c || d.at > c) decided.set(k, d.kind === "approve" ? `a|${d.at}` : `s|${d.at}`) }
  const approved = [...decided.values()].filter((v) => v.startsWith("a|")).length, skipped = decided.size - approved
  const usedSay = used.length ? `Used on ${used.length} site${used.length === 1 ? "" : "s"}${approved || skipped ? `; you sent ${approved} to outreach${skipped ? ` and skipped ${skipped}` : ""}` : ""}` : "Not used on a site yet"
  const replacedBy = p.replacedBy ? t.preferences.find((x) => x.id === p.replacedBy) : null
  return {
    id: p.id, text: p.text, on: p.on, edited: !!p.edited, by: p.by,
    off: p.on ? null : p.offWhy === "replaced" ? `Off: replaced by “${replacedBy?.text || "a newer preference"}”` : "Off: you switched it off",
    strength, evidence, count: p.count, confidence: p.confidence, // confidence orders the list ; the UI never shows it
    sources: p.sources.slice(-5).reverse().map(sourceView),
    used: { sites: used.length, approved, skipped, say: usedSay },
    createdAt: p.createdAt, updatedAt: p.updatedAt,
  }
}
export async function learningView() {
  const t = T.loadTaste()
  const sites = allSiteRecords()
  const prefs = [...t.preferences].sort((a, b) => Number(b.on) - Number(a.on) || b.confidence - a.confidence || b.updatedAt.localeCompare(a.updatedAt)).map((p) => prefView(p, t, sites))
  const live = t.events.filter((e) => !e.undone)
  const comments = live.filter((e) => e.text).length
  const decisions = new Set(t.decisions.map((d) => `${d.site}/${d.date}`)).size
  const onSites = new Set([...live.map((e) => e.site), ...t.decisions.map((d) => d.site)].filter(Boolean)).size
  const active = T.activePrefs(t).length
  const parts = [comments ? `${comments} comment${comments === 1 ? "" : "s"}` : "", decisions ? `${decisions} decision${decisions === 1 ? "" : "s"} (sent or skipped)` : ""].filter(Boolean)
  const summary = !parts.length && !t.preferences.length
    ? "Nothing learned yet. Comment on a site, send it to outreach or skip it: what you like goes into the next builds."
    : `Learned from ${parts.join(" and ") || "your own words"}${onSites ? ` on ${onSites} site${onSites === 1 ? "" : "s"}` : ""}. ${active ? `${active} preference${active === 1 ? " goes" : "s go"} into every build and every edit.` : "No preference is on right now."}`
  const rows = await outcomes()
  let rules: any = {}; try { const { readRulesFile } = await import("../../learning/scripts/learn.ts"); rules = readRulesFile() || {} } catch { /* none */ }
  const label = new Map<string, string>()
  for (const s of new Set(rows.map((o) => o.industry))) label.set(s, await tradeLabel(s))
  const picks = pickSentences(rows, rules, (k) => label.get(k) || k)
  const called = await calledLeads()
  const words: Record<Channel, ReturnType<typeof wordsView>> = { email: wordsView("email", angleStats("email", emailAngles(), rows)), call: wordsView("call", angleStats("call", callAngles(), rows, called)) }
  for (const ch of ["email", "call"] as Channel[]) words[ch].next = pickAngle(ch, "next", angleStats(ch, ch === "email" ? emailAngles() : callAngles(), rows, ch === "call" ? called : undefined))
  return { summary, active, preferences: prefs, picks, words, mode: distillMode() }
}

/** which preferences a site was built with, in words */
export function siteView(id: string, date: string) {
  const t = T.loadTaste()
  const { taste, traits } = siteRecord(id, date)
  const known = new Map(t.preferences.map((p) => [p.id, p]))
  const applied = (taste?.applied || []).map((p) => ({ id: p.id, text: known.get(p.id)?.text || p.text, on: known.get(p.id)?.on ?? false, exists: known.has(p.id) }))
  const skipped = (taste?.skipped || []).map((p) => ({ id: p.id, text: known.get(p.id)?.text || p.text, why: p.why }))
  const n = applied.length
  const sentence = n ? `Built with ${n} of your preferences` : taste?.given?.length ? `Built with none of your ${taste.given.length} preferences` : t.preferences.length ? "Built before it had your preferences" : "No preferences yet: your feedback on a site becomes one"
  return { id, date, sentence, applied, skipped, given: (taste?.given || []).length || applied.length, traits, at: taste?.at || null }
}

// ── the routes ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** true when the request was a learning route (answered) */
export async function learningRoute(req: IncomingMessage, res: ServerResponse, path: string, url: URL): Promise<boolean> {
  if (!path.startsWith("/api/learning") || !ctx) return false
  const { sendJson, parseBody } = ctx
  try {
    if (path === "/api/learning" && req.method === "GET") { sendJson(res, await learningView()); return true }
    if (path === "/api/learning/site" && req.method === "GET") {
      const id = url.searchParams.get("id") || "", date = url.searchParams.get("date") || ""
      if (!ctx.siteDir(id, date)) { sendJson(res, { error: "Unknown site" }, 404); return true }
      sendJson(res, siteView(id, date)); return true
    }
    if (path === "/api/learning/feedback" && req.method === "POST") {
      const b = await parseBody(req)
      const kind = ["comment", "rebuild", "reject", "approve"].includes(b?.kind) ? b.kind : "comment"
      if (!b || !validId(b.id) || typeof b.text !== "string" || !b.text.trim()) { sendJson(res, { error: "Expected {id, text} (and kind: comment, rebuild, reject or approve)" }, 400); return true }
      if (!existsSync(join(PROSPECTS, `${b.id}.json`)) && !existsSync(join(SITES, b.id))) { sendJson(res, { error: "Not a site or a prospect of this agency" }, 404); return true }
      const date = typeof b.date === "string" && ctx.siteDir(b.id, b.date) ? b.date : latestSite(b.id)
      sendJson(res, { ok: true, remember: await onFeedback({ kind, id: b.id, date, text: b.text }) }); return true
    }
    if (path === "/api/learning/undo" && req.method === "POST") {
      const b = await parseBody(req)
      if (!b || typeof b.undo !== "string") { sendJson(res, { error: "Expected {undo}" }, 400); return true }
      const r = await withTaste((t) => T.undoFeedback(t, b.undo))
      if (!r.ok) { sendJson(res, { error: "Nothing to undo (already undone, or unknown)" }, 404); return true }
      emit({ type: "learning" })
      sendJson(res, { ok: true, removed: r.removed, weakened: r.weakened, restored: r.restored, text: r.removed.length || r.weakened.length ? "Forgotten." : "Nothing was learned from it." }); return true
    }
    if (path === "/api/learning/preference" && (req.method === "POST" || req.method === "DELETE")) {
      const b = req.method === "DELETE" ? { id: url.searchParams.get("id"), delete: true } : await parseBody(req)
      if (!b) { sendJson(res, { error: "bad json" }, 400); return true }
      if (!b.id && typeof b.text === "string") {
        const text = T.cleanText(b.text)
        if (!text) { sendJson(res, { error: "Write the preference first" }, 400); return true }
        const a = await withTaste((t) => T.applyFeedback(t, { id: T.newEventId(), kind: "you", at: new Date().toISOString() }, [{ text, area: "other" }]))
        emit({ type: "learning" })
        sendJson(res, { ok: true, preference: a.created[0] || a.strengthened[0] || null, remember: remember(a) }); return true
      }
      if (typeof b.id !== "string" || !T.SAFE_PREF_ID.test(b.id)) { sendJson(res, { error: "Expected {id}" }, 400); return true }
      if (b.delete === true) {
        const ok = await withTaste((t) => T.deletePref(t, b.id))
        if (!ok) { sendJson(res, { error: "No such preference" }, 404); return true }
        emit({ type: "learning" }); sendJson(res, { ok: true, deleted: b.id }); return true
      }
      if (typeof b.text === "string" && !T.cleanText(b.text)) { sendJson(res, { error: "A preference can't be empty: delete it instead" }, 400); return true }
      if (typeof b.on !== "boolean" && typeof b.text !== "string") { sendJson(res, { error: "Expected {id, on} or {id, text} or {id, delete: true}" }, 400); return true }
      const p = await withTaste((t) => T.setPref(t, b.id, { on: typeof b.on === "boolean" ? b.on : undefined, text: typeof b.text === "string" ? b.text : undefined }))
      if (!p) { sendJson(res, { error: "No such preference" }, 404); return true }
      emit({ type: "learning" }); sendJson(res, { ok: true, preference: p }); return true
    }
    sendJson(res, { error: `Unknown API route ${path}` }, 404); return true
  } catch (e) {
    sendJson(res, { error: String((e as Error).message).slice(0, 300) }, 500); return true
  }
}
