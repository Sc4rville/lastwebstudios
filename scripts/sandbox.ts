/**
 * sandbox.ts · `npm run sandbox` : a FICTIONAL agency that runs, in one command, with no key, no account, no .env.
 *
 *   1. a throwaway folder `.sandbox/<run>/` (gitignored) : the repository's code (scripts/lib/files.mjs, never the real
 *      data/ or output/) + the fictional cast (data/sample/ : the US studio's Austin businesses by default, the French
 *      studio's with --country FR) + its sites ;
 *   2. an EMBEDDED Postgres database : PGlite (Postgres in WebAssembly, in memory) served over TCP by
 *      scripts/lib/pglite-server.mjs ; the product connects with its usual `postgres` library and DATABASE_URL (a pool of
 *      1 per process : DB_POOL_MAX=1) ; `db/schema.sql` is applied by `npm run db:init` ;
 *   3. the cockpit (Prospects, Sites, Outreach, the call panel, Billing) on a free port of 127.0.0.1 ;
 *   4. the STORY played by the real processes, on a clock set back to past working days (sending hours of the agency) :
 *      approvals, the test-mode email sequence (each email an .eml file), a signed click, a one-click unsubscribe
 *      (RFC 8058), the next email unlocked by the click, a reply, a meeting → won, a lost deal, a call noted, a lead in
 *      the emails, a build in the queue, `npm run learn`.
 *
 * Nothing goes out : the sequencer in test mode (dryRun), LWS_LIVE_SEND removed, a simulated mail transport, replies
 * read from a file, a fictional agency, no key read. Ctrl-C stops everything (cockpit, database) cleanly.
 *
 * Usage : npm run sandbox                   the US demo studio (Austin businesses, English, dollars) on
 *                                           http://127.0.0.1:<port>, until Ctrl-C
 *         npm run sandbox -- --country FR   the French demo studio (Lyon area businesses, French sites, euros)
 *         npm run sandbox -- --check        starts, plays, CHECKS every view, prints them and exits
 *         options : --port <n> · --dir <folder> (default .sandbox/<run>) · --json (with --check) · --verbose
 *                   --db pglite (default) | docker (a throwaway Postgres, scripts/sandbox/postgres.compose.yml)
 *                        | postgres://…@127.0.0.1:<port>/<db> (a local Postgres of yours, this machine only)
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { dirname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { codeFiles, copyFiles, linkNodeModules } from "./lib/files.mjs"
import { startPgliteServer } from "./lib/pglite-server.mjs"
import { agency } from "../packages/shared/agency.mjs"
import { textCollector } from "../packages/shared/lines.mjs"
import { renderNewSite, renderOldSiteSvg, siteLang, planTaste, openCapturer, captureOldSite } from "../backoffice/reviewpipe/sim-site.ts"
import { writeSiteTaste } from "../learning/scripts/taste.ts"
import { atWall } from "../outreach/scripts/lib/window.ts"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
export const CAST_FILE = join("data", "sample", "cast.json")
/** the cast of a US demo studio : Austin businesses, English sites, US phones (data/sample/us/) */
export const CAST_US_FILE = join("data", "sample", "cast.us.json")
export const SANDBOX_MARK = ".lws-sandbox"
/** the demo studios : US (the default : English, dollars, an Austin cast) and FR (`--country FR`) */
export const COUNTRY_AGENCY: Record<string, string> = { US: "agency.config.example.us.json", FR: "agency.config.example.json" }
/** what `npm run sandbox` shows with no --country : the English demo */
export const DEFAULT_COUNTRY = "US"

export type Role = "won" | "lost" | "call" | "sequence" | "build" | "noted"
type CastProspect = { id: string; name: string; trade: string; stage: string; role?: Role; oldSite?: string; site?: { from?: string; standIn?: boolean; date: string }; story: string }
type CastStory = { reply?: { from: string; subject: string; text: string }; rdvNote?: string; lostNote?: string; callNote?: string; feedback?: { role: Role; text: string } }
type Cast = { agency: string; data?: string; trades: string[]; story?: CastStory; prospects: CastProspect[]; seller?: Record<string, string> }
export type SandboxOptions = { check: boolean; port?: number; dir: string; db: string; json: boolean; quiet: boolean; verbose?: boolean; country?: string }
type Check = { view: string; ok: boolean; detail: string }

export function parseArgs(argv: string[]): SandboxOptions {
  const val = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined }
  const known = new Set(["--check", "--json", "--quiet", "--verbose", "--port", "--dir", "--db", "--country"])
  for (const a of argv) if (a.startsWith("--") && !known.has(a)) throw new Error(`unknown option: ${a}`)
  const port = val("--port") ? Number(val("--port")) : undefined
  if (port !== undefined && !(port > 0 && port < 65536)) throw new Error(`--port ${val("--port")}: a port between 1 and 65535`)
  const db = val("--db") || "pglite"
  if (!["pglite", "docker"].includes(db) && !/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(db)) throw new Error(`--db ${db}: pglite | docker | postgres://…@127.0.0.1:<port>/<db> (this machine only)`)
  const country = val("--country")?.toUpperCase()
  if (argv.includes("--country") && (!country || !COUNTRY_AGENCY[country])) throw new Error(`--country ${val("--country") || ""}: ${Object.keys(COUNTRY_AGENCY).join(" or ")} (the demo studios shipped)`)
  // one folder PER RUN by default (.sandbox/<pid>-<time>) : two sandboxes in one clone never kill each other
  const dir = val("--dir") ? resolve(ROOT, val("--dir")!) : join(ROOT, ".sandbox", `${process.pid}-${Date.now().toString(36)}`)
  return { check: argv.includes("--check"), json: argv.includes("--json"), quiet: argv.includes("--quiet"), verbose: argv.includes("--verbose"), port, dir, db, ...(country ? { country } : {}) }
}

/** The cast of the agency that runs : a US demo studio gets the Austin cast (English sites, US phones), any other the
 *  French one. `agencyFile` = the agency's config (default : a demo file LWS_AGENCY_CONFIG points at, else the US demo). */
export function readCast(root = ROOT, agencyFile?: string): Cast {
  const fr: Cast = JSON.parse(readFileSync(join(root, CAST_FILE), "utf8"))
  const file = agencyFile ?? (exampleFromEnv() || COUNTRY_AGENCY[DEFAULT_COUNTRY])
  let country = ""; try { country = String(agency({ LWS_AGENCY_CONFIG: file }, root).country || "").toUpperCase() } catch { /* */ }
  if (country === "US" && existsSync(join(root, CAST_US_FILE))) return { ...JSON.parse(readFileSync(join(root, CAST_US_FILE), "utf8")), agency: file }
  return { ...fr, agency: file }
}
const byRole = (cast: Cast, r: Role) => cast.prospects.find((p) => p.role === r)

const freePort = () => new Promise<number>((res, rej) => { const s = createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)) }) })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * The story's clock, on the agency's own clock and inside its sending hours (Mon–Fri) : day 0 is a working day at least
 * four days ago whose day 3 is a working day too (the click-unlocked email goes out on day 3), the lead in the emails
 * joined on the last working day. Whatever the hour or the weekday the demo starts, the same story plays : every email
 * is written at 10:00 or 11:00 their time, never at night, and the next one is due inside the sending hours.
 */
export function storyClock(tz: string, now = Date.now()): Record<"enroll0" | "tick0" | "click" | "unsub" | "tick3" | "reply" | "tickReply" | "enrollSeq" | "tickSeq" | "meeting", string> {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((x) => [x.type, x.value]))
  const y = Number(p.year), m = Number(p.month), d = Number(p.day)
  const day = (k: number) => new Date(Date.UTC(y, m - 1, d - k))
  const work = (k: number) => { const w = day(k).getUTCDay(); return w >= 1 && w <= 5 }
  const at = (k: number, h: number, min = 0) => { const x = day(k); return new Date(atWall(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate(), h, min, tz)).toISOString() }
  let k = 4; while (!(work(k) && work(k - 3))) k++
  let j = 1; while (!work(j)) j++
  let f = -2; while (!work(f)) f-- // the meeting : a working day, two or more days ahead, at 10:00
  return {
    enroll0: at(k, 9, 30), tick0: at(k, 10), click: at(k - 1, 12), unsub: at(k - 2, 12), tick3: at(k - 3, 11),
    reply: at(k - 3, 15), tickReply: at(k - 3, 16), enrollSeq: at(j, 16, 30), tickSeq: at(j, 16, 45), meeting: at(f, 10),
  }
}

// variables that would give access to the real thing (database, sending, paid LLM, box, Gmail): never in the sandbox's processes
const REAL_ENV = /^(DATABASE_URL|DB_SSL|SUPABASE_.*|ANTHROPIC_.*|OPENAI_.*|HIGGSFIELD_.*|HF_.*|TELEGRAM_.*|CLAUDE_CODE_OAUTH_TOKEN|GOOGLE_.*|GMAIL_.*|ASSETS_BASE_URL|OUTREACH_.*|COOLIFY_.*|LWS_LIVE_SEND|DIGEST_TO|DIGEST_FROM|BACKOFFICE_.*|TRACK_BASE|LWS_TRACK_SECRET|LWS_REPLY_READER|LWS_MAIL_TRANSPORT|LWS_STOP_FILE|LWS_AGENCY_CONFIG|LWS_LLM|LWS_MODEL.*|WORKER_.*)$/

const pidAlive = (pid: number): boolean => { if (!pid || pid === process.pid) return false; try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM" } }
const LOCK = ".lock"
/** the pid of the live sandbox using `dir` (its .lock), or 0 */
export function dirInUse(dir: string): number { try { const pid = Number(readFileSync(join(dir, LOCK), "utf8")); return pidAlive(pid) ? pid : 0 } catch { return 0 } }
/** the live sandbox of this clone (`npm run sandbox` without --check writes .sandbox/.running), or null */
export function runningSandbox(root = ROOT): { pid: number; url: string | null; dir: string } | null {
  try { const r = JSON.parse(readFileSync(join(root, ".sandbox", ".running"), "utf8")); return pidAlive(Number(r.pid)) ? { pid: Number(r.pid), url: r.url || null, dir: r.dir || "" } : null } catch { return null }
}
/** per-run folders (.sandbox/<pid>-<t>) left by a sandbox that was killed : removed when nobody holds them */
function sweepStale(root = ROOT): void {
  const base = join(root, ".sandbox"); if (!existsSync(base)) return
  for (const d of readdirSync(base)) {
    if (!/^\d+-[a-z0-9]+$/.test(d)) continue
    const full = join(base, d)
    let mt = 0; try { mt = statSync(full).mtimeMs } catch { continue }
    if (dirInUse(full) || (!existsSync(join(full, LOCK)) && Date.now() - mt < 10 * 60_000)) continue
    try { rmSync(full, { recursive: true, force: true }) } catch { /* */ }
  }
}

/**
 * The cast's old sites, captured when a browser is there (the drawings buildSandbox wrote stay otherwise) : their own
 * old site when the cast ships one (served at /old/<id>/), else the dated page the demo renders for them ; the page
 * itself, never a wide screen of wallpaper. A capture that fails keeps the drawing.
 */
async function captureCastOldSites(dir: string, cast: Cast): Promise<void> {
  if (!existsSync(join(dir, "data", "assets"))) return
  const todo = readdirSync(join(dir, "data", "assets")).filter((id) => existsSync(join(dir, "data", "assets", id, "avant.svg")) && !existsSync(join(dir, "data", "assets", id, "avant.png")))
  if (!todo.length) return
  const cap = await openCapturer()
  try {
    const lang = String(agency({ LWS_AGENCY_CONFIG: agencyFileFor(cast) }, ROOT).language || "en")
    for (const id of todo) {
      let sheet: any; try { sheet = JSON.parse(readFileSync(join(dir, "data", "prospects", `${id}.json`), "utf8")) } catch { continue }
      const assets = join(dir, "data", "assets", id), own = join(dir, "data", "old-sites", id, "index.html")
      const ok = existsSync(own)
        ? await cap.shot("", join(assets, "avant.png"), { url: `file://${own}`, width: 1024, height: 768, selector: "#page, #cap, #w", fullPage: true, mobile: join(assets, "avant.mobile.png") })
        : (await captureOldSite(cap, { ...sheet, id }, siteLang(sheet, lang), assets)) === "png"
      if (ok) rmSync(join(assets, "avant.svg"), { force: true })
    }
  } finally { await cap.close() }
}

/** Builds the sandbox folder: code + fictional cast + sites from real runs. Never wipes a folder a live sandbox uses. */
export function buildSandbox(dir: string, cast: Cast): { files: number; sites: CastProspect[] } {
  if (resolve(dir) === ROOT || ROOT.startsWith(resolve(dir) + "/")) throw new Error("--dir cannot be the repository or one of its parents")
  // only a sandbox folder (.lws-sandbox marker) or an empty folder is ever emptied : never `--dir ~` by mistake
  const ours = resolve(dir) === join(ROOT, ".sandbox") || resolve(dir).startsWith(join(ROOT, ".sandbox") + sep) || existsSync(join(dir, SANDBOX_MARK))
  if (existsSync(dir) && readdirSync(dir).length && !ours) throw new Error(`${dir} is not empty and is not a sandbox (no ${SANDBOX_MARK}): pick another --dir`)
  const holder = dirInUse(dir)
  if (holder) throw new Error(`${dir} is in use by a running sandbox (pid ${holder}): pick another --dir, or stop that one first`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, LOCK), String(process.pid)) // ours from now on : a second run with this --dir is refused, never wipes it
  writeFileSync(join(dir, SANDBOX_MARK), "throwaway folder of `npm run sandbox`: emptied and rebuilt at every start\n")
  const files = copyFiles(ROOT, dir, codeFiles(ROOT))
  linkNodeModules(ROOT, dir)
  cpSync(join(ROOT, cast.data || join("data", "sample", "data")), join(dir, "data"), { recursive: true })
  const lang = String(agency({ LWS_AGENCY_CONFIG: agencyFileFor(cast) }, ROOT).language || "fr")
  // a cast prospect with no capture of its old site gets its drawing : no card ever says « no capture »
  for (const f of readdirSync(join(dir, "data", "prospects")).filter((x) => x.endsWith(".json") && !x.endsWith(".example.json"))) {
    const id = f.slice(0, -5), assets = join(dir, "data", "assets", id)
    if (existsSync(join(assets, "avant.png")) || existsSync(join(assets, "avant.svg"))) continue
    try { const sheet = JSON.parse(readFileSync(join(dir, "data", "prospects", f), "utf8")); mkdirSync(assets, { recursive: true }); writeFileSync(join(assets, "avant.svg"), renderOldSiteSvg(sheet, siteLang(sheet, lang))) } catch { /* a sheet that does not parse keeps its placeholder */ }
  }
  // their old sites, served by the cockpit at /old/<id>/ (a fictional .example address resolves nowhere)
  for (const p of cast.prospects) {
    if (p.oldSite && existsSync(join(ROOT, p.oldSite, "index.html"))) cpSync(join(ROOT, p.oldSite), join(dir, "data", "old-sites", p.id), { recursive: true })
  }
  // Billing › Your business : the fictional studio, complete (marked as the demo's) : a demo invoice prints whole
  if (cast.seller) { mkdirSync(join(dir, "data", "invoices"), { recursive: true }); writeFileSync(join(dir, "data", "invoices", "_settings.json"), JSON.stringify({ ...cast.seller, _sample: "the demo studio's fictional business details" }, null, 2) + "\n") }
  const sites: CastProspect[] = []
  for (const p of cast.prospects) {
    if (!p.site) continue
    const to = join(dir, "output", "sites", p.id, p.site.date)
    if (p.site.standIn) {
      // a cast with no real run (the US one) : its sites are the demo's stand-ins, built from their own facts and said
      // as such in Sites (.lws-demo) ; the real builds stay in examples/
      let sheet: any; try { sheet = JSON.parse(readFileSync(join(dir, "data", "prospects", `${p.id}.json`), "utf8")) } catch { continue }
      mkdirSync(to, { recursive: true })
      writeFileSync(join(to, "index.html"), renderNewSite(sheet, siteLang(sheet, lang)))
      writeFileSync(join(to, "control.md"), `# ${p.id}\n\ntemplate: composer\nverdict: PASS (simulated judge)\n`)
      writeFileSync(join(to, ".lws-demo"), "a demo build of the sandbox (a stand-in made from the fictional prospect's facts)\n")
      // its record : built before any preference, with its traits (light or dark, photo or type) for what you send or skip
      writeSiteTaste(to, { at: new Date().toISOString(), by: "demo", given: [], applied: [], traits: planTaste(sheet, []).traits })
      sites.push(p); continue
    }
    if (!p.site.from || !existsSync(join(ROOT, p.site.from, "site", "index.html"))) continue
    cpSync(join(ROOT, p.site.from, "site"), to, { recursive: true })
    for (const [from, name] of [["captures/apres-desktop.png", "_after.png"], ["captures/apres-mobile.png", "_after.mobile.png"], ["first-site.json", "first-site.json"]] as const) {
      if (existsSync(join(ROOT, p.site.from, from))) cpSync(join(ROOT, p.site.from, from), join(to, name))
    }
    sites.push(p)
  }
  // sequencer: ALWAYS in dry-run, mailboxes on the fictional agency's domain (read from its file, nothing hard-coded)
  const cfgPath = join(dir, "outreach", "sequencer", "config.json")
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"))
  const fictive = agency({ LWS_AGENCY_CONFIG: agencyFileFor(cast) }, ROOT)
  const domain = fictive.mail.heloDomain
  if (!/\.(example|test|invalid)$/.test(domain)) throw new Error(`${cast.agency}: the sandbox agency must be fictional (a reserved domain), got ${domain}`)
  const box = (local: string) => ({ email: `${local}@${domain}`, throttlePerDay: 8 })
  cfg.dryRun = true
  cfg.inboxes = { A: [box("bonjour")], B: [box(fictive.brand.expediteur.toLowerCase() || "contact"), box("studio")] }
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n")
  // no spend is seeded : the demo calls no AI, so its usage meter honestly reads $0.00 (the daily limit still shows)
  mkdirSync(join(dir, "data", "logs"), { recursive: true })
  return { files, sites }
}

type Running = { child: ChildProcess; out: () => string }
function startChild(cmd: string, args: string[], o: { cwd: string; env: NodeJS.ProcessEnv }): Running {
  const child = spawn(cmd, args, { cwd: o.cwd, env: o.env, stdio: ["ignore", "pipe", "pipe"], detached: true })
  const buf = textCollector(4_000_000) // decoded as read: an accent cut between two chunks stays intact
  child.stdout!.on("data", (b: Buffer) => buf.push(b))
  child.stderr!.on("data", (b: Buffer) => buf.push(b))
  return { child, out: () => buf.text() }
}
function killGroup(c?: ChildProcess) { try { if (c?.pid && c.exitCode === null) process.kill(-c.pid, "SIGTERM") } catch { /* parti */ } }
/** SIGTERM to the group, then SIGKILL after `ms` : the cockpit is gone before its database stops (never an orphan) */
async function stopGroup(c?: ChildProcess, ms = 5000): Promise<void> {
  if (!c?.pid || c.exitCode !== null || c.signalCode !== null) return
  const gone = new Promise<void>((res) => c.once("exit", () => res()))
  killGroup(c)
  const t = setTimeout(() => { try { process.kill(-c.pid!, "SIGKILL") } catch { /* parti */ } }, ms)
  await Promise.race([gone, new Promise((r) => setTimeout(r, ms + 1000))]); clearTimeout(t)
}

function runCli(script: string, args: string[], o: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number }): Promise<{ code: number; out: string }> {
  return new Promise((res) => {
    const r = startChild(process.execPath, ["--import", "tsx", script, ...args], o)
    const t = setTimeout(() => { killGroup(r.child) }, o.timeoutMs ?? 90_000)
    r.child.on("close", (code) => { clearTimeout(t); res({ code: code ?? 1, out: r.out() }) })
  })
}

/** The database: embedded PGlite (default), a throwaway Postgres (docker), or a given local Postgres. */
async function startDatabase(kind: string): Promise<{ url: string; label: string; stop: () => Promise<void> }> {
  if (kind === "pglite") {
    let PGlite: any
    try { ({ PGlite } = await import("@electric-sql/pglite")) } catch {
      throw new Error("PGlite is missing: run `npm ci` (dev dependency @electric-sql/pglite), or use --db docker")
    }
    const db = await PGlite.create()
    const srv = await startPgliteServer({ db })
    return { url: srv.url, label: `PGlite (Postgres in WebAssembly, in memory) on 127.0.0.1:${srv.port}`, stop: async () => { await srv.stop(); await db.close() } }
  }
  if (kind === "docker") {
    const port = await freePort()
    const file = join(ROOT, "scripts", "sandbox", "postgres.compose.yml")
    const env = { ...process.env, SANDBOX_PG_PORT: String(port) }
    const up = spawnSync("docker", ["compose", "-f", file, "up", "-d", "--wait"], { env, encoding: "utf8" })
    if (up.status !== 0) throw new Error(`docker compose: ${(up.stderr || up.stdout || "").trim().split("\n").pop()}`)
    return { url: `postgres://lws:lws@127.0.0.1:${port}/lws`, label: `throwaway Postgres 17 (docker) on 127.0.0.1:${port}`, stop: async () => { spawnSync("docker", ["compose", "-f", file, "down", "-v"], { env, stdio: "ignore" }) } }
  }
  return { url: kind, label: `local Postgres ${kind.replace(/:[^:@/]+@/, ":***@")}`, stop: async () => {} }
}

export type SandboxRun = { url: string; dir: string; ms: number; checks: Check[]; ok: boolean; stop: () => Promise<void>; counts?: { businesses: number; sites: number }; agency?: string }

/** LWS_AGENCY_CONFIG may point at ANOTHER fictional agency (a *.example*.json file) : the same guard (reserved domain) */
const exampleFromEnv = (): string => (process.env.LWS_AGENCY_CONFIG && /\.example(\.[a-z]+)?\.json$/.test(process.env.LWS_AGENCY_CONFIG) ? process.env.LWS_AGENCY_CONFIG : "")
export const agencyFileFor = (cast: Cast): string => exampleFromEnv() || cast.agency

export async function startSandbox(o: SandboxOptions): Promise<SandboxRun> {
  const t0 = Date.now()
  const say = (s: string) => { if (!o.quiet) console.log(s) }
  // --country FR / US : that fictional studio (and its cast) ; it wins over LWS_AGENCY_CONFIG. None : a demo file named by
  // LWS_AGENCY_CONFIG, else the US studio (the English demo)
  if (o.country) process.env.LWS_AGENCY_CONFIG = COUNTRY_AGENCY[o.country]
  const cast = readCast()
  const step = (n: number, label: string) => say(`[${n}/6] ${label} · ${((Date.now() - t0) / 1000).toFixed(1)} s`)

  // one live sandbox per clone (unless --check) : a second `npm run sandbox` is refused with the running URL, BEFORE
  // anything is built or started (no orphan folder, no database left behind) ; a --dir in use is never wiped
  const running = join(ROOT, ".sandbox", ".running")
  if (!o.check) {
    const live = runningSandbox()
    if (live) throw new Error(live.url ? `A sandbox is already running at ${live.url} (pid ${live.pid}). Open it, or stop it first (Ctrl-C in its terminal).` : `A sandbox is already starting in this clone (pid ${live.pid}). Wait for its address, or stop it first.`)
    mkdirSync(join(ROOT, ".sandbox"), { recursive: true }); writeFileSync(running, JSON.stringify({ pid: process.pid, url: null, dir: o.dir }))
  }
  sweepStale()
  const holder = dirInUse(o.dir)
  if (holder) { if (!o.check) rmSync(running, { force: true }); throw new Error(`${o.dir} is in use by a running sandbox (pid ${holder}): pick another --dir, or stop that one first`) }
  const perRun = resolve(o.dir).startsWith(join(ROOT, ".sandbox") + sep)
  let database: Awaited<ReturnType<typeof startDatabase>> | undefined
  let cockpit: Running | undefined
  let sql: ReturnType<typeof postgres> | null = null
  let built = false
  const stop = async () => {
    await stopGroup(cockpit?.child); try { await sql?.end({ timeout: 2 }) } catch { /* */ } try { await database?.stop() } catch { /* */ }
    try { if (JSON.parse(readFileSync(running, "utf8")).pid === process.pid) rmSync(running, { force: true }) } catch { /* */ }
    if (built) { try { if (perRun) rmSync(o.dir, { recursive: true, force: true }); else rmSync(join(o.dir, LOCK), { force: true }) } catch { /* */ } }
  }
  try {
    step(1, "throwaway folder: code, fictional cast, sites from real runs")
    const { files, sites } = buildSandbox(o.dir, cast)
    built = true
    await captureCastOldSites(o.dir, cast)
    const sheets = readdirSync(join(o.dir, "data", "prospects")).filter((f) => f.endsWith(".json") && !f.endsWith(".example.json")).length
    say(`      ${o.dir} · ${files} code files · ${agency({ LWS_AGENCY_CONFIG: agencyFileFor(cast) }, ROOT).name} · ${sheets} fictional businesses · ${sites.length} built sites`)

    step(2, "embedded Postgres")
    database = await startDatabase(o.db)
    say(`      ${database.label}`)

    const port = o.port ?? await freePort()
    const base = `http://127.0.0.1:${port}`
    const env: NodeJS.ProcessEnv = {}
    for (const [k, v] of Object.entries(process.env)) if (!REAL_ENV.test(k)) env[k] = v
    Object.assign(env, {
      DATABASE_URL: database.url, DB_SSL: "disable", DB_POOL_MAX: "1",
      LWS_AGENCY_CONFIG: agencyFileFor(cast), // the FICTIONAL agency (or another fictional one passed through LWS_AGENCY_CONFIG), even in the private repo
      BACKOFFICE_HOST: "127.0.0.1", BACKOFFICE_PORT: String(port),
      TRACK_BASE: base, LWS_TRACK_SECRET: randomBytes(36).toString("base64url"),
      // the demo's daily cap, in builds (what a subscriber understands) : never a plan's price
      LWS_REPLY_READER: "file", LWS_MAIL_TRANSPORT: "simulated", LWS_BUILDS_PER_DAY: "6",
      LWS_SIRENE: "0", VISUAL: "0", NODE_NO_WARNINGS: "1",
      LWS_SANDBOX: "1", // the cockpit's engine is SIMULATED: find / build / research play out with no key, no network
    })

    const init = await runCli("db/init.ts", [], { cwd: o.dir, env })
    if (init.code !== 0) throw new Error(`db:init: ${init.out.trim().split("\n").pop()}`)
    const tables = init.out.match(/(\d+)\/(\d+) tables/)
    say(`      database ready${tables ? ` (${tables[1]} tables)` : ""}`)

    step(3, "cockpit (Prospects, Sites, Outreach)")
    cockpit = startChild(process.execPath, ["--import", "tsx", "backoffice/reviewpipe/serve.ts"], { cwd: o.dir, env })
    for (let i = 0; i < 600 && !/Indexed →|No database: reading/.test(cockpit.out()); i++) {
      if (cockpit.child.exitCode !== null) throw new Error(`the cockpit stopped: ${cockpit.out().slice(-600)}`)
      await sleep(100)
    }
    if (!/Indexed →/.test(cockpit.out())) throw new Error(`the cockpit could not index the database: ${cockpit.out().slice(-600)}`)
    const listen = cockpit.out().match(/Cockpit → (http:\/\/[^\s]+)/)
    const url = listen ? listen[1] : base
    if (url !== base) env.TRACK_BASE = url // port already taken: the cockpit took the next one
    const idx = cockpit.out().match(/Indexed → (\d+) prospects? · (\d+)/)
    // no address yet : the demo is not ready before step 6 (an agent watching for a URL waits for the last line)
    say(`      the cockpit is up${idx ? ` · ${idx[1]} prospects · ${idx[2]} sites indexed` : ""}`)
    if (!o.check) { try { writeFileSync(running, JSON.stringify({ pid: process.pid, url, dir: o.dir })) } catch { /* */ } }

    step(4, "the story: approvals, sequence, click, unsubscribe, reply, meeting, signature, lost, call, batch")
    sql = postgres(database.url, { ssl: false, max: 1, onnotice: () => {}, prepare: false })
    await playStory({ dir: o.dir, base: url, env, sql, cast, sites })
    // from now on the demo shows the whole machine : a site YOU approve goes into the (test mode) email sequence.
    // Written after the story, which plays its own sequence on its own clock (an approval must not enroll anyone then)
    writeFileSync(join(o.dir, "data", "agent.json"), JSON.stringify({ mode: "sequencer", url: "" }, null, 2) + "\n")

    step(5, "learning (npm run learn)")
    const learn = await runCli("learning/scripts/learn.ts", [], { cwd: o.dir, env })
    if (learn.code !== 0) throw new Error(`learn: ${learn.out.slice(-600)}`)

    step(6, "checking the views")
    const checks = await checkViews(url, cast, sites)
    const ok = checks.every((c) => c.ok)
    // the first search and the build the story queued finish (a few seconds) : the counts said are the ones the page shows
    const counts = await settle(url)
    const ms = Date.now() - t0
    return { url, dir: o.dir, ms, checks, ok, stop, counts, agency: String(agency({ LWS_AGENCY_CONFIG: agencyFileFor(cast) }, ROOT).name || "") }
  } catch (e) {
    await stop()
    throw e
  }
}

async function playStory(o: { dir: string; base: string; env: NodeJS.ProcessEnv; sql: ReturnType<typeof postgres>; cast: Cast; sites: CastProspect[] }) {
  const { dir, base, env, sql, cast, sites } = o
  const has = (id: string) => cast.prospects.some((p) => p.id === id)
  const built = (id: string) => sites.find((p) => p.id === id)
  const post = async (path: string, body: unknown) => {
    const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`)
    return r.json().catch(() => ({}))
  }
  const must = async (p: Promise<{ code: number; out: string }>, what: string) => { const r = await p; if (r.code !== 0) throw new Error(`${what}: ${r.out.slice(-800)}`) }
  const seq = (args: string[]) => runCli("outreach/scripts/sequencer.ts", args, { cwd: dir, env })
  // the story is played by ROLE (cast.json / cast.us.json say who is won, lost, to call…), in the cast's own words
  const id = (r: Role) => byRole(cast, r)?.id || ""
  const WON = id("won"), LOST = id("lost"), CALL = id("call"), SEQ = id("sequence"), BUILD = id("build")
  const story = cast.story || {}
  const clock = storyClock(String(agency({ LWS_AGENCY_CONFIG: agencyFileFor(cast) }, ROOT).timezone || "UTC"))

  // ⓪ the owner's feedback on one site while reviewing it (the learning loop, D6) : the comment is applied to that site
  // (a demo edit) and what it says about their taste becomes preferences, which the build queued at ⑧ applies
  const fb = story.feedback ? built(id(story.feedback.role)) : undefined
  if (fb && story.feedback) {
    await post(`/api/control?id=${encodeURIComponent(fb.id)}&date=${encodeURIComponent(fb.site!.date)}`, { comment: story.feedback.text })
    await post("/api/refill", { id: fb.id, date: fb.site!.date })
  }
  // ① the sites are chosen (the second human approval) : loved, then approved ; the lead in the emails too (an email
  // sequence always starts from an approved site : its first email links to it)
  for (const [pid, love] of [[WON, 3], [LOST, 2], [CALL, 2], [SEQ, 1]] as const) {
    const p = built(pid)
    if (!p) continue
    await post("/api/love", { id: pid, date: p.site!.date, love })
    await post("/api/status", { id: pid, date: p.site!.date, status: "approved" })
  }
  // ② the sequence (test mode) : day 0, a working morning
  const first = [WON, LOST].filter((x) => x && has(x))
  if (first.length) {
    await must(seq(["enroll", first.join(","), "--now", clock.enroll0]), "enroll")
    await must(seq(["tick", "--now", clock.tick0]), "tick day 0")
  }
  const sends = readFileSync(join(dir, "data/sequencer/sends.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
  const eml = (pid: string) => {
    const s = sends.find((x) => x.prospectId === pid)
    if (!s) return null
    const f = readdirSync(join(dir, "data/sequencer/outbox")).find((n) => n.includes(s.trackingId))
    if (!f) return null
    const raw = readFileSync(join(dir, "data/sequencer/outbox", f), "utf8")
    const [head, body] = raw.split("\r\n\r\n")
    return { inbox: s.inbox as string, head, text: Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8") }
  }
  // ③ the won one clicks the signed link of its email (the next day, on the story's clock)
  const mo = WON ? eml(WON) : null
  if (mo) {
    const link = mo.text.match(/https?:\/\/[^\s]+\/t\/c\/[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{16}/)?.[0]
    if (!link) throw new Error(`no signed link in ${WON}'s email`)
    const r = await fetch(link, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148" } })
    if (r.status !== 302) throw new Error(`signed click → ${r.status}`)
    await sql`UPDATE outreach_events SET at = ${Date.parse(clock.click)} WHERE type = 'click'`
  }
  // ④ the lost one unsubscribes in one click (RFC 8058), two days later
  const mb = LOST ? eml(LOST) : null
  if (mb) {
    const unsub = mb.head.match(/List-Unsubscribe: <(http[^>]+)>/)?.[1]
    if (!unsub) throw new Error(`no List-Unsubscribe header in ${LOST}'s email`)
    const u = await fetch(unsub, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" })
    if (u.status !== 200) throw new Error(`unsubscribe → ${u.status}`)
    await sql`UPDATE outreach_events SET at = ${Date.parse(clock.unsub)} WHERE type = 'unsub'`
  }
  // ⑤ day 3 : the click-gated step unlocks the won one's demo email
  await must(seq(["tick", "--now", clock.tick3]), "tick day 3")
  // ⑥ the won one replies (read by the « file » reply reader at the next tick)
  if (mo && story.reply) {
    writeFileSync(join(dir, "data/sequencer/inbox.jsonl"), JSON.stringify({ inbox: mo.inbox, id: "sandbox-reply-1", ...story.reply, at: clock.reply }) + "\n")
    await must(seq(["tick", "--now", clock.tickReply]), "tick reply")
  }
  // the one in the emails joined on the last working day : its first email is written, the next one waits for day 3
  // (inside the sending hours) or a click ; it sits in Outreach › Emails
  if (SEQ && has(SEQ)) {
    await must(seq(["enroll", SEQ, "--now", clock.enrollSeq]), "enroll (in the emails)")
    await must(seq(["tick", "--now", clock.tickSeq]), "tick (in the emails)")
    // as an approval under « Send emails automatically » does (serve.ts › enrollOnApprove) : its lane is « Emails »
    await sql`INSERT INTO crm_leads(prospect_id, pipeline, stage, updated_at) VALUES (${SEQ}, 'hot', 'emails', ${Date.now()}) ON CONFLICT (prospect_id) DO UPDATE SET stage = 'emails' WHERE crm_leads.pipeline = 'hot' AND crm_leads.stage = 'call0'`
  }
  // ⑦ the CRM : won → meeting → proposal → signed ; lost ; the one to call on the call list, with a note
  if (WON && built(WON)) {
    await post("/api/crm/outcome", { id: WON, outcome: "rdv", rdvAt: Date.parse(clock.meeting), note: story.rdvNote || "" })
    for (const stage of ["propal", "signature"]) await post("/api/crm/stage", { id: WON, pipeline: "closing", stage })
  }
  if (LOST && built(LOST)) await post("/api/crm/outcome", { id: LOST, outcome: "lost", note: story.lostNote || "" })
  if (CALL && built(CALL)) {
    await post("/api/crm/stage", { id: CALL, pipeline: "hot", stage: "call0" })
    if (story.callNote) await post("/api/crm/note", { id: CALL, text: story.callNote })
  }
  // ⑧ the next build in the queue (the built-in engine plays it)
  if (BUILD && has(BUILD)) await post("/api/batch", { mode: "composer", ids: [BUILD], limit: 1, note: "sandbox: the built-in engine plays this build" })
}

/** waits (≤ 20 s) for the jobs the story queued, then counts what the cockpit shows : businesses (Prospects) and sites */
async function settle(base: string): Promise<{ businesses: number; sites: number }> {
  for (let i = 0; i < 80; i++) {
    try { const j = await (await fetch(base + "/api/jobs")).json(); if (!(j.jobs || []).some((x: any) => x.status === "queued" || x.status === "running")) break } catch { break }
    await sleep(250)
  }
  try {
    const p = await (await fetch(base + "/api/prospects")).json()
    const s = await (await fetch(base + "/api/sites")).json()
    const list: any[] = Array.isArray(s) ? s : (s.sites || s.items || [])
    return { businesses: Number(p.counts?.total) || 0, sites: new Set(list.filter((x) => x.hasIndex !== false).map((x) => x.id)).size }
  } catch { return { businesses: 0, sites: 0 } }
}

async function checkViews(base: string, cast: Cast, sites: CastProspect[]): Promise<Check[]> {
  const out: Check[] = []
  const get = async (p: string) => { const r = await fetch(base + p); return { status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text() } }
  const add = (view: string, ok: boolean, detail: string) => out.push({ view, ok, detail })
  const names = (arr: any[] = []) => arr.map((x) => x.name || x.id)
  try {
    const s = await get("/api/sites")
    const list: any[] = Array.isArray(s.body) ? s.body : (s.body.sites || s.body.items || [])
    add("rail (built sites)", s.status === 200 && list.length >= sites.length && sites.length >= 2, `${list.length} site(s) : ${[...new Set(list.map((x) => x.id))].join(", ")}`)
    for (const p of sites) {
      const pv = await get(`/preview/${p.id}/${p.site!.date}/index.html`)
      const av = await fetch(`${base}/avant/${p.id}`)
      add(`compare ${p.name} (before / after)`, pv.status === 200 && av.status === 200, `after ${pv.status} · before ${av.status}`)
    }
    const c = await get("/api/crm")
    const hot = c.body.hot || {}, closing = c.body.closing || {}
    const won = names(closing.signature), queue = names(hot.call0), lost = names(c.body.lost)
    const expectWon = sites.some((p) => p.role === "won"), expectCall = sites.some((p) => p.role === "call"), expectLost = sites.some((p) => p.role === "lost")
    add("outreach (kanban)", c.status === 200 && (!expectWon || won.length > 0) && (!expectLost || lost.length > 0), `Won: ${won.join(", ") || "—"} · lost: ${lost.join(", ") || "—"}`)
    add("outreach (to call)", c.status === 200 && (!expectCall || queue.length > 0), queue.join(", ") || "empty")
    const callable = [...(hot.call0 || []), ...(closing.signature || [])][0]
    add("call panel (phone, script, insights)", !!callable && !!callable.phone && Array.isArray(callable.insights) && callable.insights.length > 0, callable ? `${callable.name} · ${callable.phone} · ${(callable.insights || []).length} insight(s) · ${(callable.notes || []).length} note(s)` : "no card")
    const st = await get("/api/crm/stages")
    add("outreach (steps)", st.status === 200 && (st.body.hot || []).length === 6 && (st.body.closing || []).length === 4, `${(st.body.hot || []).map((x: any) => x.label).join(" · ")} | ${(st.body.closing || []).map((x: any) => x.label).join(" · ")}`)
    // the lead the emails write to sits in « Emails » (the lane matches the choice), its card says what was written
    const inEmails = names(hot.emails), seqRole = cast.prospects.find((p) => p.role === "sequence")
    const mailed = [...(hot.emails || [])][0]
    add("outreach (in the emails)", c.status === 200 && (!seqRole || !sites.some((p) => p.id === seqRole.id) || (inEmails.length > 0 && mailed?.mail?.written >= 1 && !!mailed?.mail?.nextLabel)), `${inEmails.join(", ") || "—"}${mailed?.mail ? ` · ${mailed.mail.written} written of ${mailed.mail.total} · next ${mailed.mail.nextLabel}` : ""}`)
    const wonLead = (closing.signature || [])[0]
    if (wonLead) add("a won client's emails say why they stopped", !wonLead.mail || !!wonLead.mail.stopped, wonLead.mail?.stopped || "no emails")
    if (mailed) {
      const em = await get(`/api/sequences/emails?id=${encodeURIComponent(mailed.id)}`)
      const e0 = (em.body.emails || [])[0]
      add("the written email reads in full (subject, body, footer)", em.status === 200 && !!e0?.subject && !!e0?.body && !!e0?.footer, e0 ? `« ${e0.subject} » · ${e0.atLabel}` : String(em.status))
    }
    const ag = await get("/api/agent")
    add("after approval (automation)", ag.status === 200 && ["sequencer", "webhook", "manual"].includes(ag.body.mode), `mode ${ag.body.mode}`)
    const q = await get("/api/sequences")
    const seqs: any[] = q.body.sequences || q.body.items || (Array.isArray(q.body) ? q.body : [])
    add("email tab (sequences, dry-run)", q.status === 200 && seqs.length >= 3, `${seqs.length} sequence(s) · ${seqs.map((x) => `${x.prospectId?.split("-")[0]}:${x.status}`).join(" ")}`)
    const pr = await get("/api/prospects")
    const pb = pr.body || {}, pitems: any[] = pb.items || []
    // a built site shows its furthest state on its card (in outreach, won, lost) : the same one as Sites and Outreach
    const furthest = (x: any) => ["built", "outreach", "won", "lost"].includes(x.status)
    // a business in the emails is never « New » ; an old site of a fictional business opens here, never a dead .example
    const seqId = cast.prospects.find((p) => p.role === "sequence")?.id
    add("a business in the emails is in outreach, never new", !seqId || pitems.find((x) => x.id === seqId)?.status === "outreach", `${seqId}: ${pitems.find((x) => x.id === seqId)?.status}`)
    const fict = pitems.filter((x) => /\.(example|test|invalid)\b/.test(String(x.oldUrl || "")))
    const sample = fict[0]
    const oldPage = sample ? await fetch(base + sample.oldHref) : null
    add("old sites open locally (no dead .example link)", fict.every((x) => String(x.oldHref).startsWith("/old/")) && (!oldPage || (oldPage.status === 200 && /<html/i.test(await oldPage.text()))), sample ? `${fict.length} link(s) · ${sample.oldHref} → ${oldPage?.status}` : "none")
    add("prospects page (found, why picked, good fit, status)", pr.status === 200 && pitems.length >= 5 && pitems.some((x) => x.reasons?.length) && pitems.some((x) => x.fit) && pitems.some(furthest) && pitems.some((x) => x.status === "building") && (!expectWon || pitems.some((x) => x.status === "won")) && (!expectLost || pitems.some((x) => x.status === "lost")), `${pitems.length} prospects · new ${pb.counts?.new} · building ${pb.counts?.building} · built ${pb.counts?.built} · in outreach ${pb.counts?.outreach} · won ${pb.counts?.won} · lost ${pb.counts?.lost} · e.g. ${pitems[0]?.name}: ${(pitems[0]?.reasons || []).join(", ")}`)
    const agc0 = await get("/api/agency")
    const au = await get("/api/automatic")
    add("automatic toggle", au.status === 200 && typeof au.body.automatic === "boolean", `automatic ${au.body.automatic}`)
    // a first search in the agency's own market (a US studio looks around Austin, a French one near Lyon) : never a
    // US business placed in Lyon
    const us = String(agc0.body.country || "").toUpperCase() === "US", town = us ? "Austin" : "Lyon"
    const fs0 = await fetch(base + "/api/prospects/find", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: us ? `3 pool builders near ${town}` : `3 ${cast.trades[0]} near ${town}` }) })
    const fb = await fs0.json().catch(() => ({}))
    add("find prospects (brief understood, job queued)", fs0.status === 200 && (fb.brief?.trades || []).includes(cast.trades[0]) && String(fb.brief?.place || "").startsWith(town) && fb.brief?.country === (us ? "US" : "FR"), `${fs0.status} · ${JSON.stringify(fb.brief || {})}`)
    const br = await fetch(base + "/api/brief", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "surprise me, 8 of them" }) })
    const bj = await br.json().catch(() => ({}))
    add("brief: « surprise me » → a mix of trades", br.status === 200 && bj.mix === true && (bj.trades || []).length >= 3 && bj.count === 8, JSON.stringify(bj))
    const jb = await get("/api/jobs")
    add("jobs strip (built-in engine)", jb.status === 200 && Array.isArray(jb.body.jobs), `${(jb.body.jobs || []).length} live job(s)`)
    const se = await get("/api/settings"); const ais = await get("/api/ai-status"); const hp = await get("/api/handsoff/pending"); const wn = await get("/api/won")
    add("settings (agency, which AI, hands-off pending, clients won)", se.status === 200 && typeof se.body.demo === "boolean" && ais.status === 200 && typeof ais.body.ok === "boolean" && hp.status === 200 && Array.isArray(hp.body.ids) && wn.status === 200 && Array.isArray(wn.body.won), `demo ${se.body.demo} · ai ${ais.body.way} ${ais.body.label} · hands-off would build ${hp.body.count} · won ${wn.body.won.length}`)
    const nf = await fetch(base + "/api/nope"); add("unknown /api/* → JSON 404", nf.status === 404 && /json/.test(nf.headers.get("content-type") || ""), String(nf.status))
    // what the agency learned : the story's comment became preferences (on), the picks and the words say how far they are
    const ln = await get("/api/learning")
    const lp: any[] = ln.body?.preferences || []
    add("what the agency learned (preferences, picks, words)", ln.status === 200 && (!cast.story?.feedback || lp.some((x) => x.on && /^Your comment on /.test(x.sources?.[0]?.say || ""))) && !!ln.body?.picks && !!ln.body?.words?.email, `${lp.length} preference(s): ${lp.map((x) => x.text).join(" · ") || "—"} · picks: ${ln.body?.picks?.note || `${(ln.body?.picks?.items || []).length} sentence(s)`}`)
    const gib = await fetch(base + "/api/prospects/find", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "asdkjh qwe" }) })
    add("gibberish brief → no job, a hint", gib.status === 400 && /didn't catch a trade/.test((await gib.json().catch(() => ({}))).error || ""), String(gib.status))
    const agc = await get("/api/agency")
    add(`agency locale (${agc.body.country})`, agc.status === 200 && !!agc.body.country && !!agc.body.currency, `${agc.body.country} · ${agc.body.locale} · ${agc.body.currency}`)
    const g = await get("/api/cage")
    add("cage sheet (STOP, today's builds, breaker)", g.status === 200 && g.body.stop?.on === false && g.body.builds?.cap > 0, `STOP ${g.body.stop?.on ? "on" : "off"} · today ${g.body.builds?.done ?? "?"} of ${g.body.builds?.cap ?? "?"} builds · plan usage $${g.body.budget?.spentUsd ?? "?"} · sending: ${(g.body.send?.mode ?? g.body.send) === "dry-run" ? "test mode" : (g.body.send?.mode ?? g.body.send ?? "?")}`)
    for (const page of ["/", "/billing.html"]) { const r = await fetch(base + page); add(`page ${page}`, r.status === 200, String(r.status)) }
    const old = await fetch(base + "/outreach/", { redirect: "manual" })
    add("old /outreach/ link → /#pipeline", old.status === 302 && (old.headers.get("location") || "").endsWith("/#pipeline"), String(old.status))
    add("next step (kanban move)", true, "moves to the next column (tested in e2e)")
  } catch (e) { add("check", false, (e as Error).message) }
  void cast
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let o: SandboxOptions
  try { o = parseArgs(process.argv.slice(2)) } catch (e) { console.error(`✗ ${(e as Error).message}`); console.error("usage: npm run sandbox [-- --country FR|US (default US)] [--check] [--verbose] [--port <n>] [--dir <folder>] [--db pglite|docker|postgres://…]"); process.exit(2) }
  let run: SandboxRun | null = null
  const bye = async (code: number) => { try { await run?.stop() } catch { /* */ } process.exit(code) }
  process.on("SIGINT", () => { console.log("\n⏹ stopping the sandbox (cockpit, database)…"); void bye(130) })
  process.on("SIGTERM", () => void bye(143))
  try {
    run = await startSandbox(o!)
  } catch (e) {
    console.error(`✗ sandbox: ${(e as Error).message}`)
    process.exit(1)
  }
  const r = run!
  if (o!.json) console.log(JSON.stringify({ url: r.url, dir: r.dir, ms: r.ms, ok: r.ok, counts: r.counts, agency: r.agency, checks: r.checks }, null, 2))
  else {
    // the self-check speaks the engine's words : listed with --check or --verbose (or when one fails), one line otherwise
    const list = o!.check || o!.verbose || !r.ok
    if (list) for (const c of r.checks) console.log(`  ${c.ok ? "✓" : "✗"} ${c.view} : ${c.detail}`)
    else console.log(`  ✓ ${r.checks.length} views checked (npm run sandbox -- --check lists them)`)
    const what = r.counts ? ` · ${r.agency ? `${r.agency}, ` : ""}${r.counts.businesses} fictional businesses, ${r.counts.sites} sites` : ""
    console.log(`${r.ok ? "✓" : "✗"} Fictional agency ready in ${(r.ms / 1000).toFixed(1)} s → ${r.url}   (Sites: ${r.url}/#sites · Outreach: ${r.url}/#outreach)${what}`)
  }
  if (o!.check) await bye(r.ok ? 0 : 1)
  else console.log(`  Nothing is sent (test mode) · Ctrl-C to stop${o!.country === "FR" ? "" : " · the French demo studio: npm run sandbox -- --country FR"}`)
  // its folder deleted under it : the cockpit stops on its own, and so does this process (no orphan database)
  if (!o!.check) setInterval(() => { if (!existsSync(r.dir)) { console.log("⏹ the sandbox folder is gone — stopping"); void bye(0) } }, 5000).unref()
}
