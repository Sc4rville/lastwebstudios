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
import { spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { getDb, getMeta, setMeta, tryDb } from "../../packages/shared/db.ts"
import { claimNextBatch, markBatchDone, markBatchError, appendBatchLog, listBatches, type BatchRow } from "../../packages/shared/batch.ts"
import { reindexProspect, reindexSite } from "../../packages/shared/reindex.ts"
import { saveResearch } from "../../outreach/scripts/research-save.ts"
import { stopState } from "../../packages/shared/cage.ts"
import { lineSplitter } from "../../packages/shared/lines.mjs"

export const HEARTBEAT_KEY = "worker.heartbeat"
export const HEARTBEAT_FRESH_MS = 60_000
export type JobEvent = { type: "job"; id: number; mode: string; status: "running" | "done" | "error"; step?: string; pct?: number; text?: string; found?: number }
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

// ── the simulated agency (sandbox) ────────────────────────────────────────────────────────────────────────────
const FR_NAMES = ["Atelier Marvelin", "Maison Dorsay", "Bassins Lauvel", "Cuisines Orbelle", "Menuiserie Tarcel", "Piscines Vireuil", "Studio Calvine", "Ateliers Brémond", "Cuisines Avrance", "Bois & Lignes Verdoie", "Piscines Sauvelune", "Agencement Mirelle", "Charpentes Noriac", "Cuisines Vallore", "Paysages Clairemont"]
const FR_TOWNS = ["Valmont-sur-Lys", "Castel-Aurin", "Brézelonne", "Sornac-le-Haut", "Véreuil", "Quillanne-sur-Orme", "Lavrenne-la-Côte", "Saint-Aubry-des-Prés", "Mont-Rozel", "Orvilliers-le-Vieux"]
const US_NAMES = ["Harborline Pools", "Cedar & Oak Cabinets", "Ridgeway Roofing", "Blue Heron Plumbing", "Maple Street Kitchens", "Granite Bay Landscaping", "Northwind Carpentry", "Lakeside Pool & Spa", "Summit Electric Co.", "Willow Creek Builders", "Ironbark Fencing", "Prairie Painters"]
const US_TOWNS = [["Fairhaven", "ME", "04099"], ["Oakmont", "TX", "73301"], ["Riverbend", "OH", "43099"], ["Pinecrest", "CO", "80499"], ["Silver Hollow", "OR", "97099"], ["Eastbrook", "NC", "27099"]]
const REASONS = [["No mobile version", "pas responsive (pas de viewport)"], ["No HTTPS", "pas de HTTPS (sécurité + SEO pénalisé)"], ["Site from 2012", "dernière trace de maj : 2012"], ["Almost no content", "page très pauvre (peu de contenu)"], ["No photos", "aucune photo"], ["Invisible on Google", "SEO pauvre (pas de description / OG)"]]
const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
function rnd(seed: number) { let x = seed || 1; return () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff } }

/** fictional prospects for the sandbox: new names, reserved domains, fiction phone ranges, never a real business */
export function inventProspects(p: FindParams, country: string, seed: number): any[] {
  const r = rnd(seed)
  const n = Math.max(3, Math.min(8, Math.round(p.count / 3) || 4))
  const us = country === "US"
  const trades = p.trades.length ? p.trades : us ? ["pisciniste", "menuisier", "cuisiniste", "paysagiste"] : ["cuisiniste", "menuisier", "pisciniste"]
  const out: any[] = []
  for (let i = 0; i < n; i++) {
    const trade = trades[i % trades.length]
    const name = (us ? US_NAMES : FR_NAMES)[Math.floor(r() * (us ? US_NAMES : FR_NAMES).length)] + (r() < 0.3 ? ` ${["& Fils", "Studio", "Co."][Math.floor(r() * 3)]}` : "")
    const town = us ? US_TOWNS[Math.floor(r() * US_TOWNS.length)] : [FR_TOWNS[Math.floor(r() * FR_TOWNS.length)], "", ""]
    const place = (p.place || "").replace(/,.*$/, "").trim()
    const city = place && !/^[A-Z]{2}$/.test(place) ? place : town[0]
    if (us && place && city === place) { const st = ((p.place || "").match(/,\s*([A-Z]{2})$/) || [])[1]; town[1] = st || { austin: "TX", dallas: "TX", houston: "TX", denver: "CO", portland: "OR", seattle: "WA", miami: "FL", boston: "MA", chicago: "IL", phoenix: "AZ", atlanta: "GA", nashville: "TN" }[place.toLowerCase()] || town[1] }
    const id = `${slug(name)}-${slug(city)}-${(seed % 9000 + 1000).toString(36)}` // a different cast on every search
    const phone = us ? `(${["207", "512", "614", "303", "503", "919"][Math.floor(r() * 6)]}) 555-01${String(10 + Math.floor(r() * 89))}` : `0${[1, 2, 3, 4, 5][Math.floor(r() * 5)]} 99 00 ${String(10 + Math.floor(r() * 89))} ${String(10 + Math.floor(r() * 89))}`
    const picked = REASONS.filter(() => r() < 0.55).slice(0, 4); if (!picked.length) picked.push(REASONS[0])
    const value = 62 + Math.floor(r() * 33)
    out.push({
      id, industry: trade,
      identity: { name, city, ...(us ? { state: town[1], zip: town[2] } : {}), phone, ...(r() < 0.7 ? { email: `contact@${slug(name)}.example` } : {}), hours: us ? "Mon–Fri 8 am – 5 pm" : "Lun–Ven 8h–18h" },
      content: { services: ["service 1", "service 2", "service 3"], tagline: "" }, assets: { photos: [] },
      existing: { url: `http://${slug(name)}.example/` },
      score: { value, tier: value >= 75 ? "hot" : "warm", reasons: picked.map((x) => x[1]), accroche: `Votre site : ${picked[0][1]}.`, at: Date.now() },
      _sample: "fictional prospect invented by the sandbox engine",
    })
  }
  return out
}

async function sleep(ms: number) { await new Promise((r) => setTimeout(r, ms)) }
function exampleSites(root = "."): string[] {
  const ex = join(root, "examples"); if (!existsSync(ex)) return []
  return readdirSync(ex).filter((d) => existsSync(join(ex, d, "site", "index.html"))).map((d) => join(ex, d))
}

async function runFindSimulated(b: BatchRow, emit: Emit): Promise<void> {
  const p = findParams(b)
  let country = "FR"; try { const { agency } = await import("../../packages/shared/agency.mjs"); country = agency().country } catch { /* */ }
  const list = inventProspects(p, country, b.id * 7919 + b.created_at)
  await appendBatchLog(b.id, `🔎 looking for ${p.trades.join(", ") || "a mix of trades"} ${p.place ? `near ${p.place}` : ""} (${list.length} to find)`)
  mkdirSync("data/prospects", { recursive: true }); mkdirSync("data/raw", { recursive: true })
  let found = 0
  for (const sheet of list) {
    await sleep(700 + Math.random() * 500)
    await writeFile(join("data/prospects", `${sheet.id}.json`), JSON.stringify(sheet, null, 2) + "\n")
    await writeFile(join("data/raw", `${sheet.id}.score.json`), JSON.stringify({ ...sheet.score, _sample: "score fictif" }, null, 2) + "\n")
    try { await reindexProspect(sheet.id) } catch { /* no db */ }
    found++
    await appendBatchLog(b.id, `＋ ${sheet.identity.name} · ${sheet.identity.city}`)
    emit({ type: "job", id: b.id, mode: "find", status: "running", step: "finding", pct: Math.round((found / list.length) * 100), text: `${found} found`, found })
    emit({ type: "prospects" })
  }
  await markBatchDone(b.id, { ok: true, found, simulated: true })
  emit({ type: "job", id: b.id, mode: "find", status: "done", pct: 100, text: `${found} found`, found })
}

async function runBuildSimulated(b: BatchRow, emit: Emit): Promise<void> {
  let ids: string[] = []; try { ids = JSON.parse(b.params_json || "{}").ids || [] } catch { /* */ }
  if (!ids.length) { // a « find and build N » job without ids: take new sheets without a site
    const all = existsSync("data/prospects") ? readdirSync("data/prospects").filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)) : []
    ids = all.filter((id) => !existsSync(join("output/sites", id))).slice(0, Number(b.lim) || 1)
  }
  const examples = exampleSites()
  const steps = [["diagnose", "reading their site"], ["compose", "composing"], ["check", "checking on desktop and mobile"], ["judge", "the blind judge"]]
  for (const id of ids) {
    let name = id.replace(/-/g, " "); try { name = JSON.parse(await readFile(join("data/prospects", `${id}.json`), "utf8")).identity?.name || name } catch { /* */ }
    await appendBatchLog(b.id, `🏗 ${name}`)
    for (let i = 0; i < steps.length; i++) {
      emit({ type: "job", id: b.id, mode: "composer", status: "running", step: steps[i][0], pct: Math.round((i / steps.length) * 100), text: `Building ${name} · ${steps[i][1]}` })
      await appendBatchLog(b.id, `  ${steps[i][1]}`)
      await sleep(1600 + Math.random() * 800)
    }
    const date = `${new Date().toISOString().slice(0, 10)}-composer`
    const dest = join("output/sites", id, date)
    const src = examples.length ? examples[(id.length + b.id) % examples.length] : null
    mkdirSync(dest, { recursive: true })
    if (src) {
      cpSync(join(src, "site"), dest, { recursive: true })
      for (const [from, to] of [["captures/apres-desktop.png", "_after.png"], ["captures/apres-mobile.png", "_after.mobile.png"]]) if (existsSync(join(src, from))) cpSync(join(src, from), join(dest, to))
    } else await writeFile(join(dest, "index.html"), `<!doctype html><title>${name}</title><h1>${name}</h1>`)
    await writeFile(join(dest, "control.md"), `# ${id}\n\ntemplate: composer\nverdict: PASS (simulated judge)\n`)
    try { await reindexSite(id, date) } catch { /* */ }
    emit({ type: "job", id: b.id, mode: "composer", status: "running", step: "done", pct: 100, text: `${name} is built` })
    emit({ type: "sites" })
  }
  await markBatchDone(b.id, { ok: true, built: ids.length, simulated: true })
  emit({ type: "job", id: b.id, mode: "composer", status: "done", pct: 100, text: `${ids.length} site(s) built` })
}

async function runResearchSimulated(b: BatchRow, emit: Emit): Promise<void> {
  let ids: string[] = []; try { ids = JSON.parse(b.params_json || "{}").ids || [] } catch { /* */ }
  for (const id of ids) {
    let s: any = {}; try { s = JSON.parse(await readFile(join("data/prospects", `${id}.json`), "utf8")) } catch { /* */ }
    const name = s.identity?.name || id
    let who = "our studio"; try { const { agency } = await import("../../packages/shared/agency.mjs"); who = agency().mail.signature || agency().name || who } catch { /* */ }
    await saveResearch(id, { callScript: `Hi, this is [your name] from ${who}. Am I speaking with the owner of ${name}?\n\nI build websites for local businesses and I took the liberty of building a new one for ${name}: it already exists, I'd love to show it to you in ten minutes this week.`, research: { brief: `${name}: ${(s.score?.reasons || []).slice(0, 2).join(", ")}`, angle: "show the new site next to the old one", contact: null } }).catch(() => {})
  }
  await markBatchDone(b.id, { ok: true, simulated: true })
  emit({ type: "job", id: b.id, mode: "research", status: "done", pct: 100, text: "call script ready" }); emit({ type: "sales" })
}

// ── real mode: the worker's code path, one job, as a child ────────────────────────────────────────────────────
function runChild(cmd: string, args: string[], env: NodeJS.ProcessEnv, onLine: (l: string) => void): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] })
    const out = lineSplitter((l: string) => { if (l.trim()) onLine(l) }), err = lineSplitter((l: string) => { if (l.trim()) onLine(l) })
    child.stdout.on("data", (b: Buffer) => out.push(b)); child.stderr.on("data", (b: Buffer) => err.push(b))
    child.on("error", () => resolve(-1)); child.on("close", (c) => { out.end(); err.end(); resolve(c ?? -1) })
  })
}
async function runFindReal(b: BatchRow, emit: Emit): Promise<void> {
  // the lead engine itself: for each trade, scrape the missing delta, score, parse, write the sheet (no design)
  const p = findParams(b)
  const trades = p.trades.length ? p.trades : ["cuisiniste"]
  const per = Math.max(1, Math.ceil(p.count / trades.length))
  const zone = (p.country || "").toLowerCase() || "fr"
  let found = 0
  for (const trade of trades) {
    emit({ type: "job", id: b.id, mode: "find", status: "running", step: "find", pct: Math.round((trades.indexOf(trade) / trades.length) * 100), text: `Looking for ${trade}${p.place ? ` near ${p.place}` : ""}` })
    await appendBatchLog(b.id, `🔎 ${trade} · ${zone}${p.place ? ` · ${p.place}` : ""} · ${per}`)
    const code = await runChild(process.execPath, ["--import", "tsx", "architecture/orchestration/run.ts"], { ...process.env, DESIGN: "0", INDUSTRY: trade, ZONE: zone, LIMIT: String(per), PIPELINE_JSON: "1" }, (l) => {
      let e: any; try { e = JSON.parse(l) } catch { void appendBatchLog(b.id, l.slice(0, 300)); return }
      if (e.type === "prospect-done") { found++; void appendBatchLog(b.id, `＋ ${e.id} · ${e.verdict}`); void reindexProspect(e.id).catch(() => {}); emit({ type: "prospects" }); emit({ type: "job", id: b.id, mode: "find", status: "running", step: "find", text: `${found} found`, found }) }
    })
    if (code !== 0) await appendBatchLog(b.id, `⚠ ${trade}: exit ${code}`)
  }
  await markBatchDone(b.id, { ok: true, found })
  emit({ type: "job", id: b.id, mode: "find", status: "done", pct: 100, text: `${found} found`, found })
}
async function runWorkerOnce(b: BatchRow, emit: Emit): Promise<void> {
  // the job is already claimed by us: hand it to the worker's runner by id (same code path as the box)
  const code = await runChild(process.execPath, ["--import", "tsx", "worker/worker.ts", "--job", String(b.id)], { ...process.env, WORKER_NAME: "cockpit" }, (l) => {
    const m = /^(?:  )?(🔬|✍️|🎬|🔎|🚧|▶|💬|⚙️)\s*(.*)$/.exec(l)
    emit({ type: "job", id: b.id, mode: b.mode, status: "running", text: (m ? m[2] : l).slice(0, 140) })
  })
  const row = (await listBatches(50)).find((x) => x.id === b.id)
  const st = row?.status === "done" ? "done" : row?.status === "error" ? "error" : code === 0 ? "done" : "error"
  if (!row || row.status === "running") { if (st === "done") await markBatchDone(b.id, { ok: true, via: "cockpit" }); else await markBatchError(b.id, `exit ${code}`) }
  emit({ type: "job", id: b.id, mode: b.mode, status: st, pct: 100, text: st === "done" ? "done" : (row?.note || `exit ${code}`).slice(0, 140) })
  emit({ type: "sites" }); emit({ type: "sales" }); emit({ type: "batches" })
}

// ── the loop ───────────────────────────────────────────────────────────────────────────────────────────────────
let busy = false, timer: NodeJS.Timeout | null = null, kick: (() => void) | null = null
export function kickEngine(): void { if (kick) setTimeout(kick, 50) }
/** one job at a time for the heavy ones (find, build, edit) ; research is light and runs alongside */
export async function tick(emit: Emit): Promise<void> {
  if (!tryDb()) return
  if (await externalWorkerAlive()) return
  const st = await stopState().catch(() => null); if (st?.on) return
  let b: BatchRow | null = null
  try { b = await claimNextBatch(ENGINE_ID, busy ? ["research"] : undefined) } catch { return }
  if (!b) return
  if (b.mode === "research" && busy) { void runOne(b, emit); return }
  busy = true
  try { await runOne(b, emit) } finally { busy = false }
}
async function runOne(b: BatchRow, emit: Emit): Promise<void> {
  try {
    await setMeta(HEARTBEAT_KEY, JSON.stringify({ id: ENGINE_ID, at: Date.now() })).catch(() => {})
    await appendBatchLog(b.id, `▶ ${SIMULATED ? "simulated engine" : "built-in engine"} (${ENGINE_ID})`)
    console.log(`⚙ engine: job #${b.id} ${b.mode} ${SIMULATED ? "(simulated)" : ""}`)
    emit({ type: "batches" }); emit({ type: "job", id: b.id, mode: b.mode, status: "running", pct: 0, text: "starting" })
    if (b.mode === "find") await (SIMULATED ? runFindSimulated : runFindReal)(b, emit)
    else if (SIMULATED && b.mode === "composer") await runBuildSimulated(b, emit)
    else if (SIMULATED && b.mode === "research") await runResearchSimulated(b, emit)
    else if (SIMULATED && b.mode === "edit") { await sleep(2500); await markBatchDone(b.id, { ok: true, simulated: true }); emit({ type: "job", id: b.id, mode: "edit", status: "done", pct: 100, text: "feedback applied" }); emit({ type: "sites" }) }
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
/** running + queued jobs with their last log line, for the job strip */
export async function jobsView(): Promise<{ jobs: any[] }> {
  let rows: BatchRow[] = []; try { rows = await listBatches(30) } catch { return { jobs: [] } }
  const live = rows.filter((r) => r.status === "queued" || r.status === "running" || (r.finished_at && Date.now() - Number(r.finished_at) < 20_000))
  return { jobs: live.map((r) => ({ id: r.id, mode: r.mode, status: r.status, note: r.note, params: (() => { try { return JSON.parse(r.params_json || "{}") } catch { return {} } })(), last: (r.log || "").trim().split("\n").filter(Boolean).slice(-1)[0] || "", finishedAt: r.finished_at, startedAt: r.started_at, error: r.status === "error" ? (r.result_json || r.note || "") : null })) }
}
export async function externalWorkerHeartbeat(): Promise<void> { await setMeta(HEARTBEAT_KEY, JSON.stringify({ id: "external", at: Date.now() })) }
void getDb
