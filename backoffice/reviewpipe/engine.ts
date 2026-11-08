/**
 * engine.ts · THE BUILT-IN ENGINE of the cockpit: when nobody else runs the jobs, the cockpit runs them itself.
 *
 *   - An external worker (`npm run worker`, the 24/7 box) writes a heartbeat in `meta` every tick. While that
 *     heartbeat is fresh (< 60 s), the cockpit stays out of the way.
 *   - Otherwise the cockpit claims one queued job at a time, every 3 s, and runs it:
 *       · real mode  → `tsx worker/worker.ts --once` as a child (same code path as the box: Claude Code agents)
 *                      for composer / edit / research ; `find` runs the lead engine (scrape → score → sheet).
 *       · simulated  → LWS_SANDBOX=1 (npm run sandbox): no key, no network. `find` invents fictional prospects
 *                      from a seed list (.example domains, ARCEP / 555 phones) arriving one by one ; `composer`
 *                      plays diagnose → compose → check → judge (~8 s) and delivers one of the shipped example
 *                      sites ; `research` writes a script instantly.
 *   Progress is written to the batch log (appendBatchLog) and pushed to the UI through `emit` (SSE).
 */
import { spawnTracked } from "./children.ts"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { getDb, getMeta, setMeta, tryDb } from "../../packages/shared/db.ts"
import { claimNextBatch, markBatchDone, markBatchError, appendBatchLog, listBatches, capBuildBatch, type BatchRow, type BatchMode } from "../../packages/shared/batch.ts"
import { reindexProspect, reindexSite } from "../../packages/shared/reindex.ts"
import { saveResearch } from "../../outreach/scripts/research-save.ts"
import { stopState, budgetStatus, buildsStatus, recordBuild } from "../../packages/shared/cage.ts"
import { lineSplitter } from "../../packages/shared/lines.mjs"
import { invent, toSheet, SIM_MAX } from "./sim-data.ts"
import { openCapturer, captureOldSite, writeSite, siteLang, renderWithTaste } from "./sim-site.ts"
import { promptPreferences, writeSiteTaste, withControlPreferences } from "../../learning/scripts/taste.ts"
import { parseControl, writeCommentText } from "../../packages/shared/control.ts"

export const HEARTBEAT_KEY = "worker.heartbeat"
export const HEARTBEAT_FRESH_MS = 60_000
export type JobEvent = { type: "job"; id: number; mode: string; status: "running" | "done" | "error"; step?: string; pct?: number; text?: string; found?: number; asked?: number; capped?: number; stopped?: boolean; ids?: string[]; done?: string[] }
export type Emit = (e: JobEvent | { type: string; [k: string]: unknown }) => void

export const SIMULATED = process.env.LWS_SANDBOX === "1"
const ENGINE_ID = `cockpit#${process.pid}`

/** Is a real worker alive? (the box, or `npm run worker` on this machine) */
export async function externalWorkerAlive(): Promise<boolean> {
  try { const raw = await getMeta(HEARTBEAT_KEY); if (!raw) return false; const j = JSON.parse(raw); return Date.now() - Number(j.at || 0) < HEARTBEAT_FRESH_MS && !String(j.id || "").startsWith("cockpit#") } catch { return false }
}

export type FindParams = { brief?: string; trades: string[]; place?: string; country?: string; count: number; mix?: boolean }
export function findParams(b: BatchRow): FindParams {
  let p: any = {}; try { p = JSON.parse(b.params_json || "{}") } catch { /* */ }
  return { brief: p.brief || b.note || "", trades: Array.isArray(p.trades) ? p.trades : b.industry ? [b.industry] : [], place: p.place || "", country: p.country || "", count: Math.max(1, Math.min(500, Number(p.count) || Number(b.lim) || 10)), mix: !!p.mix }
}

// ── the simulated agency (sandbox) : coherent fictional prospects (sim-data.ts), bespoke sites (sim-site.ts) ──
async function sleep(ms: number) { await new Promise((r) => setTimeout(r, ms)) }
function exampleSites(root = "."): string[] {
  const ex = join(root, "examples"); if (!existsSync(ex)) return []
  return readdirSync(ex).filter((d) => existsSync(join(ex, d, "site", "index.html"))).map((d) => join(ex, d))
}

/** STOP raised while a job runs : it ends between two prospects or two sites, never mid-write */
async function stopped(): Promise<boolean> { const st = await stopState().catch(() => null); return !!st?.on }
const STOPPED_TEXT = "stopped: you pressed Stop"
/** prospects the owner skipped (the cockpit's own state file) : an automatic pick never builds one */
function skippedIds(): Set<string> { try { const j = JSON.parse(readFileSync("data/prospects-state.json", "utf8")); return new Set(Array.isArray(j.skipped) ? j.skipped : []) } catch { return new Set() } }

async function agencyInfo(): Promise<{ country: string; language: string; state: string }> {
  try { const { agency } = await import("../../packages/shared/agency.mjs"); const a = agency(); return { country: a.country, language: a.language, state: (/,\s*([A-Z]{2})\s+\d{5}/.exec(String(a.postalAddress || "")) || [])[1] || "" } } catch { return { country: "US", language: "en", state: "" } }
}
async function runFindSimulated(b: BatchRow, emit: Emit): Promise<void> {
  const p = findParams(b)
  const ag = await agencyInfo()
  const country = (p.country || ag.country).toUpperCase()
  const files = existsSync("data/prospects") ? readdirSync("data/prospects").filter((f) => f.endsWith(".json")) : []
  const taken = new Set<string>(files.map((f) => f.slice(0, -5)))
  // the numbers already on the list (cast, earlier searches) : a new business never shares one
  const takenPhones = new Set<string>()
  for (const f of files) { try { const ph = JSON.parse(readFileSync(join("data/prospects", f), "utf8"))?.identity?.phone; if (ph) takenPhones.add(String(ph)) } catch { /* */ } }
  const list = invent({ trades: p.trades, place: p.place, country, count: p.count, seed: b.id * 7919 + (b.created_at % 100003), taken, takenPhones, home: ag.state })
  // the demo stops at SIM_MAX per search : said in the job line, never a silent clamp
  const capped = p.count > list.length && list.length >= SIM_MAX
  await appendBatchLog(b.id, `🔎 looking for ${p.trades.join(", ") || "a mix of trades"}${p.place ? ` near ${p.place}` : ""} (${list.length} to find${capped ? `, the demo stops at ${SIM_MAX}` : ""})`)
  mkdirSync("data/prospects", { recursive: true }); mkdirSync("data/raw", { recursive: true })
  let found = 0
  const cap = await openCapturer()
  try {
    for (const sp of list) {
      await sleep(400 + Math.random() * 300)
      if (await stopped()) { await appendBatchLog(b.id, `⏹ ${STOPPED_TEXT}`); break }
      const sheet = toSheet(sp, country)
      // its own old site, captured (or drawn when no browser is installed) : the thumbnail and the « before » are never missing
      await captureOldSite(cap, sheet, siteLang(sheet, ag.language), join("data/assets", sp.id))
      await writeFile(join("data/prospects", `${sp.id}.json`), JSON.stringify(sheet, null, 2) + "\n")
      await writeFile(join("data/raw", `${sp.id}.score.json`), JSON.stringify({ ...sheet.score, _sample: "fictional score" }, null, 2) + "\n")
      try { await reindexProspect(sp.id) } catch { /* no db */ }
      found++
      await appendBatchLog(b.id, `＋ ${sp.name} · ${sp.city}`)
      emit({ type: "job", id: b.id, mode: "find", status: "running", step: "finding", pct: Math.round((found / list.length) * 100), text: `${found} found`, found })
      emit({ type: "prospects" })
    }
  } finally { await cap.close() }
  const halted = found < list.length && await stopped()
  // fewer than asked is said with both numbers, and why (here : the demo's own cap)
  const text = halted ? `${found} found, ${STOPPED_TEXT}` : capped ? `${found} of ${p.count} found (the demo finds up to ${SIM_MAX} per search)` : found < p.count ? `${found} of ${p.count} found` : `${found} found`
  await markBatchDone(b.id, { ok: true, found, asked: p.count, simulated: true, ...(halted ? { stopped: true } : {}), ...(capped ? { capped: SIM_MAX } : {}) })
  emit({ type: "job", id: b.id, mode: "find", status: "done", pct: 100, text, found, asked: p.count, ...(capped ? { capped: SIM_MAX } : {}), ...(halted ? { stopped: true } : {}) })
}

async function runBuildSimulated(b: BatchRow, emit: Emit): Promise<void> {
  let ids: string[] = []; try { ids = JSON.parse(b.params_json || "{}").ids || [] } catch { /* */ }
  if (!ids.length) {
    const skipped = skippedIds()
    const all = existsSync("data/prospects") ? readdirSync("data/prospects").filter((f) => f.endsWith(".json") && !f.endsWith(".example.json")).map((f) => f.slice(0, -5)) : []
    ids = all.filter((id) => !skipped.has(id) && !existsSync(join("output/sites", id))).slice(0, Number(b.lim) || 1)
  }
  const ag = await agencyInfo()
  // the owner's taste (D6) : the preferences on now go into every demo build, which honours the ones it can show
  const prefs = await promptPreferences()
  // a demo build takes a few seconds per site, like a real one shows its stages ; the site appears only when it is DONE
  const steps = [["diagnose", "reading their site"], ["compose", "designing the new site"], ["check", "checking it on desktop and phone"], ["judge", "final check"]]
  const cap = await openCapturer()
  const built: string[] = []
  let halted = false
  try {
    for (const [n, id] of ids.entries()) {
      if (await stopped()) { halted = true; await appendBatchLog(b.id, `⏹ ${STOPPED_TEXT}`); break }
      let sheet: any = {}; try { sheet = JSON.parse(await readFile(join("data/prospects", `${id}.json`), "utf8")) } catch { sheet = { id, identity: { name: id.replace(/-/g, " ") }, content: {} } }
      const name = sheet.identity?.name || id.replace(/-/g, " ")
      const lang = siteLang(sheet, ag.language)
      await appendBatchLog(b.id, `🏗 ${name}`)
      const date = `${new Date().toISOString().slice(0, 10)}-composer`
      const dest = join("output/sites", id, date)
      // composed OUTSIDE output/sites (the watcher would index a half site as built), moved in place at the end
      const work = join("data", "tmp", `build-${b.id}-${id}`)
      rmSync(work, { recursive: true, force: true })
      const of = ids.length > 1 ? ` (${n + 1} of ${ids.length})` : ""
      let applied: string[] = []
      for (let i = 0; i < steps.length; i++) {
        // overall progress : the bar moves forward across the whole batch, never back to 5 % at each site
        emit({ type: "job", id: b.id, mode: "composer", status: "running", step: steps[i][0], pct: Math.round(((n + i / steps.length) / ids.length) * 100), text: `${name} · ${steps[i][1]}${of}`, ids, done: built })
        await appendBatchLog(b.id, `  ${steps[i][1]}`)
        if (steps[i][0] === "compose") {
          // a site for THAT prospect : its name, trade, place, phone, services, palette, in its own language, with the
          // owner's preferences it can show (their photo in the hero, the phone at the top…) and its record of them
          mkdirSync(work, { recursive: true })
          const t = renderWithTaste({ ...sheet, id: sheet.id || id }, lang, work, prefs)
          writeSite(work, t.html); writeSiteTaste(work, t.record); applied = t.record.applied.map((p) => p.id)
          await writeFile(join(work, "control.md"), `# ${id}\n\ntemplate: composer\nverdict: (simulated) composing…\n`)
        }
        if (steps[i][0] === "check") await cap.shot(await readFile(join(work, "index.html"), "utf8"), join(work, "_after.png"), { mobile: join(work, "_after.mobile.png"), fullPage: true })
        if (!existsSync(join("data/assets", id, "avant.png")) && !existsSync(join("data/assets", id, "avant.svg"))) await captureOldSite(cap, sheet, lang, join("data/assets", id))
        await sleep(1200 + Math.random() * 600)
      }
      const ctl = `# ${id}\n\ntemplate: composer\nverdict: PASS (simulated judge)\n`
      await writeFile(join(work, "control.md"), applied.length ? withControlPreferences(ctl, applied) : ctl)
      await writeFile(join(work, ".lws-demo"), "a demo build of the sandbox (a stand-in made from the fictional prospect's facts)\n")
      mkdirSync(join("output/sites", id), { recursive: true })
      rmSync(dest, { recursive: true, force: true })
      try { renameSync(work, dest) } catch { cpSync(work, dest, { recursive: true }); rmSync(work, { recursive: true, force: true }) } // data/ and output/ on two volumes
      try { await reindexSite(id, date) } catch { /* */ }
      // one build in today's count (the daily cap is said in builds) : a demo build counts like a real one
      recordBuild({ id, source: "cockpit", simulated: true, batchId: b.id })
      built.push(id)
      emit({ type: "job", id: b.id, mode: "composer", status: "running", step: "done", pct: Math.round(((n + 1) / ids.length) * 100), text: `${name} is built${of}`, ids, done: built })
      emit({ type: "sites" }); emit({ type: "prospects" })
    }
  } finally { await cap.close() }
  const text = halted ? `${built.length} of ${ids.length} built, ${STOPPED_TEXT}` : `${built.length} site${built.length === 1 ? "" : "s"} built`
  await markBatchDone(b.id, { ok: true, built: built.length, simulated: true, ...(halted ? { stopped: true } : {}) })
  emit({ type: "job", id: b.id, mode: "composer", status: "done", pct: 100, text, ids, done: built })
}

async function runResearchSimulated(b: BatchRow, emit: Emit): Promise<void> {
  let ids: string[] = []; try { ids = JSON.parse(b.params_json || "{}").ids || [] } catch { /* */ }
  for (const id of ids) {
    let s: any = {}; try { s = JSON.parse(await readFile(join("data/prospects", `${id}.json`), "utf8")) } catch { /* */ }
    const name = s.identity?.name || id
    // no stored script : the call panel writes it live (the agency's name and the owner's first name as they are now)
    await saveResearch(id, { research: { brief: `${name}: ${(s.score?.reasons || []).slice(0, 2).join(", ")}`, angle: "show the new site next to the old one", contact: null } }).catch(() => {})
  }
  await markBatchDone(b.id, { ok: true, simulated: true })
  emit({ type: "job", id: b.id, mode: "research", status: "done", pct: 100, text: "call script ready" }); emit({ type: "sales" })
}

/**
 * The demo's feedback edit : a demo stand-in is rendered again from its facts with the owner's preferences on now
 * (the comment just given was distilled into them before this job ran : what it asked shows), re-captured, its record
 * and its control.md updated, the comment cleared like the real edit agent does. A real build from examples/ is left
 * as it is (a real run's agent edits it).
 */
async function runEditSimulated(b: BatchRow, emit: Emit): Promise<void> {
  let id = "", date = ""; try { const p = JSON.parse(b.params_json || "{}"); id = String(p.id || ""); date = String(p.date || "") } catch { /* */ }
  const dir = join("output/sites", id, date)
  emit({ type: "job", id: b.id, mode: "edit", status: "running", pct: 30, text: "applying your feedback" })
  await sleep(1200)
  let text = "feedback applied", unchanged = false
  if (id && date && existsSync(join(dir, ".lws-demo")) && existsSync(join(dir, "index.html"))) {
    let sheet: any = null; try { sheet = JSON.parse(await readFile(join("data/prospects", `${id}.json`), "utf8")) } catch { /* */ }
    if (sheet) {
      const ag = await agencyInfo(), lang = siteLang(sheet, ag.language)
      const before = await readFile(join(dir, "index.html"), "utf8").catch(() => "")
      const t = renderWithTaste({ ...sheet, id }, lang, dir, await promptPreferences(), "edit")
      writeSite(dir, t.html); writeSiteTaste(dir, t.record)
      unchanged = before === t.html
      const cap = await openCapturer()
      try { await cap.shot(t.html, join(dir, "_after.png"), { mobile: join(dir, "_after.mobile.png"), fullPage: true }) } finally { await cap.close() }
      let ctl = ""; try { ctl = await readFile(join(dir, "control.md"), "utf8") } catch { ctl = `# ${id}\n\ntemplate: composer\n` }
      if (parseControl(ctl).hasComment) ctl = writeCommentText(ctl, "")
      await writeFile(join(dir, "control.md"), withControlPreferences(ctl, t.record.applied.map((p) => p.id)))
      try { await reindexSite(id, date) } catch { /* */ }
      if (t.record.applied.length) text = `feedback applied · built with ${t.record.applied.length} of your preferences`
      // the demo could not show what was asked (no photo of theirs…) : said, never « applied » over the same page
      if (unchanged) text = "feedback noted · this demo site can't show it"
    }
  }
  await sleep(600)
  await markBatchDone(b.id, { ok: true, simulated: true })
  emit({ type: "job", id: b.id, mode: "edit", status: "done", pct: 100, text, unchanged }); emit({ type: "sites" })
}

// ── real mode: the worker's code path, one job, as a child ────────────────────────────────────────────────────
function runChild(cmd: string, args: string[], env: NodeJS.ProcessEnv, onLine: (l: string) => void): Promise<number> {
  return new Promise((resolve) => {
    // its own process group, tracked : stopping the cockpit stops it (and what it started), never an orphan scraper
    const child = spawnTracked(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] })
    const out = lineSplitter((l: string) => { if (l.trim()) onLine(l) }), err = lineSplitter((l: string) => { if (l.trim()) onLine(l) })
    child.stdout!.on("data", (b: Buffer) => out.push(b)); child.stderr!.on("data", (b: Buffer) => err.push(b))
    child.on("error", () => resolve(-1)); child.on("close", (c) => { out.end(); err.end(); resolve(c ?? -1) })
  })
}
async function runFindReal(b: BatchRow, emit: Emit): Promise<void> {
  // the lead engine itself: for each trade, scrape the missing delta, score, parse, write the sheet (no design)
  const p = findParams(b)
  const trades = p.trades.length ? p.trades : ["cuisiniste"]
  const per = Math.max(1, Math.ceil(p.count / trades.length))
  const st = /,\s*([A-Z]{2})$/.exec(p.place || "")?.[1]
  const zone = ((p.country || "").toLowerCase() || "fr") + (st && (p.country || "").toUpperCase() === "US" ? `-${st.toLowerCase()}` : "")
  let found = 0
  // the job strip speaks English : the trade's English name, never its key
  let label = (k: string) => k.replace(/-/g, " ")
  try { const { INDUSTRIES } = await import("../../leadengine/1_scraping/scripts/industries.ts"); label = (k) => String((INDUSTRIES as any)[k]?.en?.label || (INDUSTRIES as any)[k]?.label || k.replace(/-/g, " ")).toLowerCase() } catch { /* */ }
  for (const trade of trades) {
    if (await stopped()) { await appendBatchLog(b.id, `⏹ ${STOPPED_TEXT}`); break }
    emit({ type: "job", id: b.id, mode: "find", status: "running", step: "find", pct: Math.round((trades.indexOf(trade) / trades.length) * 100), text: `Looking for ${label(trade)}${p.place ? ` near ${p.place}` : ""}` })
    await appendBatchLog(b.id, `🔎 ${trade} · ${zone}${p.place ? ` · ${p.place}` : ""} · ${per}`)
    const code = await runChild(process.execPath, ["--import", "tsx", "architecture/orchestration/run.ts"], { ...process.env, DESIGN: "0", INDUSTRY: trade, ZONE: zone, LIMIT: String(per), PIPELINE_JSON: "1" }, (l) => {
      let e: any; try { e = JSON.parse(l) } catch { void appendBatchLog(b.id, l.slice(0, 300)); return }
      if (e.type === "prospect-done") { found++; void appendBatchLog(b.id, `＋ ${e.id} · ${e.verdict}`); void reindexProspect(e.id).catch(() => {}); emit({ type: "prospects" }); emit({ type: "job", id: b.id, mode: "find", status: "running", step: "find", text: `${found} found`, found }) }
    })
    if (code !== 0) await appendBatchLog(b.id, `⚠ ${trade}: exit ${code}`)
  }
  // fewer than asked : said with both numbers and the reason (the others nearby were left out : their site is fine)
  const short = found < p.count
  await markBatchDone(b.id, { ok: true, found, asked: p.count })
  emit({ type: "job", id: b.id, mode: "find", status: "done", pct: 100, text: short ? `${found} of ${p.count} found` : `${found} found`, found, asked: p.count })
}
/** the worker's log marks → the step the job strip shows, in plain English (its log lines stay in the job's log) */
const STEP_WORDS: Record<string, string> = { "🔬": "preparing the call script", "✍️": "applying your feedback", "🎬": "designing the new site", "🔎": "final check", "🚧": "building", "▶": "starting", "💬": "writing", "⚙️": "working" }
async function runWorkerOnce(b: BatchRow, emit: Emit): Promise<void> {
  // the job is already claimed by us: hand it to the worker's runner by id (same code path as the box)
  let last = ""
  const code = await runChild(process.execPath, ["--import", "tsx", "worker/worker.ts", "--job", String(b.id)], { ...process.env, WORKER_NAME: "cockpit" }, (l) => {
    const m = /^(?:  )?(🔬|✍️|🎬|🔎|🚧|▶|💬|⚙️)/.exec(l)
    const text = m ? STEP_WORDS[m[1]] : ""
    if (text && text !== last) { last = text; emit({ type: "job", id: b.id, mode: b.mode, status: "running", text }) }
  })
  const row = (await listBatches(50)).find((x) => x.id === b.id)
  const st = row?.status === "done" ? "done" : row?.status === "error" ? "error" : code === 0 ? "done" : "error"
  if (!row || row.status === "running") { if (st === "done") await markBatchDone(b.id, { ok: true, via: "cockpit" }); else await markBatchError(b.id, `exit ${code}`) }
  emit({ type: "job", id: b.id, mode: b.mode, status: st, pct: 100, text: st === "done" ? "done" : "failed — npm run doctor says what is missing" })
  emit({ type: "sites" }); emit({ type: "sales" }); emit({ type: "batches" })
}

// ── the loop ───────────────────────────────────────────────────────────────────────────────────────────────────
let timer: NodeJS.Timeout | null = null, kick: (() => void) | null = null
export function kickEngine(): void { if (kick) setTimeout(kick, 50) }
/** two lanes : « find » (searches) and « build » (composer, edit) never wait for each other ; research runs alongside */
const lanes = { find: false, build: false }
export async function tick(emit: Emit): Promise<void> {
  if (!tryDb()) return
  if (await externalWorkerAlive()) return
  const st = await stopState().catch(() => null); if (st?.on) return
  // the daily limit (LWS_BUDGET_USD_DAY) holds on a laptop too : once reached, nothing new is claimed until midnight UTC,
  // as the 24/7 worker does (queued jobs wait, said « waiting its turn »)
  try { if (budgetStatus().reached) return } catch { /* an unreadable spend log never stops the cockpit */ }
  // today's cap in builds reached : no new build starts (a feedback edit still does), the queued ones wait for tomorrow
  let buildsLeft = true; try { buildsLeft = !buildsStatus().reached } catch { /* an unreadable builds log never stops the cockpit */ }
  const want: BatchMode[] = ["research"]
  if (!lanes.find) want.push("find")
  if (!lanes.build) want.push(...(buildsLeft ? ["composer", "edit", "template-fill"] as BatchMode[] : ["edit"] as BatchMode[]))
  let b: BatchRow | null = null
  try { b = await claimNextBatch(ENGINE_ID, want) } catch { return }
  if (!b) return
  const lane = b.mode === "find" ? "find" : b.mode === "research" ? null : "build"
  if (lane) lanes[lane] = true // before the next claim : one job per lane
  const run = runOne(b, emit).finally(() => { if (lane) lanes[lane] = false })
  const other = tick(emit) // the other lane may have something waiting : it starts now, not after this job
  await run
  await other
  if (lane) await tick(emit) // this lane's next job ; the promise ends when the queue it can take is empty
}
async function runOne(b: BatchRow, emit: Emit): Promise<void> {
  try {
    await setMeta(HEARTBEAT_KEY, JSON.stringify({ id: ENGINE_ID, at: Date.now() })).catch(() => {})
    await appendBatchLog(b.id, `▶ ${SIMULATED ? "simulated engine" : "built-in engine"} (${ENGINE_ID})`)
    console.log(`⚙ engine: job #${b.id} ${b.mode} ${SIMULATED ? "(simulated)" : ""}`)
    // what fits today's cap in builds stays in this job, the rest waits for tomorrow in its own (said in its log)
    if (b.mode === "composer") {
      const cap = await capBuildBatch(b)
      if (!cap.run) { emit({ type: "batches" }); emit({ type: "prospects" }); return }
      if (cap.later.length) emit({ type: "prospects" })
    }
    emit({ type: "batches" }); emit({ type: "job", id: b.id, mode: b.mode, status: "running", pct: 0, text: "starting" })
    if (b.mode === "find") await (SIMULATED ? runFindSimulated : runFindReal)(b, emit)
    else if (SIMULATED && b.mode === "composer") await runBuildSimulated(b, emit)
    else if (SIMULATED && b.mode === "research") await runResearchSimulated(b, emit)
    else if (SIMULATED && b.mode === "edit") await runEditSimulated(b, emit)
    else await runWorkerOnce(b, emit)
  } catch (e) {
    console.warn(`⚙ engine: job #${b.id} failed: ${(e as Error).message}`)
    try { await markBatchError(b.id, (e as Error).message) } catch { /* */ }
    emit({ type: "job", id: b.id, mode: b.mode, status: "error", text: (e as Error).message.slice(0, 160) })
  } finally { emit({ type: "batches" }) }
}
export function startEngine(emit: Emit, everyMs = 3000): void {
  if (timer) return
  timer = setInterval(() => { void tick(emit) }, everyMs); timer.unref()
  // a job queued from the cockpit must start at once, not at the next tick
  kick = () => { void tick(emit) }
  setTimeout(() => { void tick(emit) }, 500).unref()
}
export function stopEngine(): void { if (timer) clearInterval(timer); timer = null }
/** a failed job in one short line : the error it recorded, never a raw JSON blob */
function errorLine(r: BatchRow): string {
  let e: any = null; try { e = r.result_json ? JSON.parse(r.result_json) : null } catch { e = r.result_json }
  const msg = typeof e === "string" ? e : (e && (e.error || e.message)) || r.note || ""
  return String(msg || "failed").split("\n")[0].slice(0, 140)
}
/** running + queued jobs with their last log line, for the job strip */
export async function jobsView(): Promise<{ paused?: boolean; jobs: any[] }> {
  let rows: BatchRow[] = []; try { rows = await listBatches(30) } catch { return { jobs: [] } }
  // a finished job stays a few seconds (its check mark), then the strip lets it go
  const live = rows.filter((r) => r.status === "queued" || r.status === "running" || (r.finished_at && Date.now() - Number(r.finished_at) < 8_000))
  const st = await stopState().catch(() => null)
  return { paused: !!st?.on, jobs: live.map((r) => ({ id: r.id, mode: r.mode, status: r.status, note: r.note, ...(r.status === "queued" && Number(r.retry_after) > Date.now() ? { waitsUntil: Number(r.retry_after) } : {}), params: (() => { try { return JSON.parse(r.params_json || "{}") } catch { return {} } })(), last: (r.log || "").trim().split("\n").filter(Boolean).slice(-1)[0] || "", finishedAt: r.finished_at, startedAt: r.started_at, error: r.status === "error" ? errorLine(r) : null })) }
}
export async function externalWorkerHeartbeat(): Promise<void> { await setMeta(HEARTBEAT_KEY, JSON.stringify({ id: "external", at: Date.now() })) }
void getDb
