/**
 * serve.ts — THE CONTROL STATION (link 4: human review).
 *
 * A single `node:http` server (run through tsx), bound to 127.0.0.1 only. It is a SCRIPT:
 * NO LLM here. It READS output/ + design/templates/ + video/fonts/, and only WRITES:
 *   - the `## commentaire` section of a control.md (through control.ts),
 *   - screenshots pasted into a site's dated folder (visual feedback),
 *   - the lab notes in output/lab/ (gitignored).
 * Rebuilds are delegated to the filler (npm run fill / review:batch). Live through SSE + fs.watch.
 *
 * Usage: npm run backoffice
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { createServer as netServer } from "node:net"
import { watch, existsSync, statSync, realpathSync, createReadStream, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { readFile, writeFile, readdir, stat, mkdir, rm, copyFile } from "node:fs/promises"
import { listInvoices, getInvoice, createInvoice, updateInvoice, createAvoir, avoirProblem, deleteProblem, deleteInvoice, listWithCancels, getSettings, saveSettings, renderInvoiceHtml, withTotals, invoiceProblem, sellerProblem, sellerFieldProblem, taxDefault, demoSellerKeys, isDemoValue } from "./invoices.ts"
import { join, resolve, extname, sep, basename } from "node:path"
import { spawnTracked, stopChildren } from "./children.ts"
import { timingSafeEqual, createHmac } from "node:crypto"
import { lineSplitter, textCollector } from "../../packages/shared/lines.mjs"
import { parseControl, writeCommentText } from "../../packages/shared/control.ts"
import { readTemplates, readFonts } from "./templates.ts"
import { readSkills, readStash, SKILLS_DIR } from "./skills.ts"
import { getDb, tryDb } from "../../packages/shared/db.ts"
import { reindexAll, reindexSite, reindexProspect, reindexAssets, reindexSkills, reindexStash } from "../../packages/shared/reindex.ts"
import { enqueueBatch, enqueueEdit, enqueueResearch, listBatches, buildsInFlight, type BatchMode } from "../../packages/shared/batch.ts"
import { urlFor, storageBase, exists as storageExists } from "../../packages/shared/storage.ts"
import { handleTracking } from "../../outreach/tracking/endpoint.ts"
import { readEvents } from "../../outreach/tracking/events.ts"
import { readableLinks } from "../../outreach/tracking/links.ts"
import { cageStatus, setStop, loadBreaker, saveBreaker, stopState, budgetStatus, buildsStatus, buildsCap } from "../../packages/shared/cage.ts"
import { sendWindow, wallLabel, windowLabel } from "../../outreach/scripts/lib/window.ts"
import { evaluateBreaker, resetBreaker } from "../../packages/shared/breaker.ts"
import { recordOutcome } from "../../learning/scripts/record.ts"
import { machineSnapshot } from "./machine.ts"
import { agency, agencyFile, clearAgencyCache } from "../../packages/shared/agency.mjs"
import { demoLeftovers, readExamples, demoCopyByCountry } from "../../packages/shared/agency-demo.mjs"
import { startEngine, kickEngine, jobsView, type JobEvent } from "./engine.ts"
import { interpretBrief, parseBrief, pickMix, validateBrief } from "./brief.ts"
import { whyTags, whyCodes, insights as insightBullets, simulatedAsk, simulatedFirstEmail, heldSay } from "./insights.ts"
import { prospectLang, prospectCountry, renderOldSite, planTaste, findOwnPhoto } from "./sim-site.ts"
import { initLearning, learningRoute, onFeedback, onDecision, onRebuild, sitePrefCount, refreshPicks, firstEmailAngle, callAnglesFor, callOpeningParams } from "./learning.ts"
import { claudeAuth } from "../../packages/llm/claude-code-status.ts"
import { codexAuth } from "../../packages/llm/codex-status.ts"
/** why this cockpit has no database, set once at start (the local one turned off, busy, failed, or never asked for) */
let noDbWhy = ""
/** the one sentence every route (and the banner) says when there is no database : the real reason and its one fix */
function noDbReason(): string {
  if (noDbWhy) return noDbWhy
  if (process.env.LWS_LOCAL_DB === "0") return "No database: the local one is turned off (LWS_LOCAL_DB=0). Remove that setting and restart the cockpit, or set DATABASE_URL."
  return "No database: start the cockpit with `npm run backoffice` (it keeps a local one), or set DATABASE_URL."
}

try {
  process.loadEnvFile()
} catch {
  /* no .env: read the environment instead (the refill needs it for the API) */
}

// ── `npm run backoffice` on a laptop with no database : an embedded Postgres (PGlite, on disk in data/pglite), served on
// 127.0.0.1 like a real one, so Find prospects, the call list and the job queue work as on a server. start.sh asks for
// it (LWS_LOCAL_DB=1) ; a DATABASE_URL, LWS_LOCAL_DB=0 or a second cockpit on the same folder go without.
let localDb: { stop: () => Promise<void> } | null = null
if (!process.env.DATABASE_URL && process.env.LWS_LOCAL_DB === "1") {
  const dir = join("data", "pglite"), lock = join(dir, ".cockpit-pid")
  const holderNow = () => { try { const pid = Number(readFileSync(lock, "utf8")); if (pid && pid !== process.pid) { process.kill(pid, 0); return pid } } catch { /* free */ } return 0 }
  // a restart (start.sh stops the previous cockpit) : the old one closes the database first, give it a few seconds
  let holder = holderNow()
  for (let i = 0; holder && i < 25; i++) { await new Promise((r) => setTimeout(r, 200)); holder = holderNow() }
  if (holder) { console.warn(`ℹ The local database is open in another cockpit (pid ${holder}): this one runs without it.`); noDbWhy = `No database here: the local one is open in another cockpit (pid ${holder}). Use that one, or stop it and restart this one.` }
  else {
    try {
      const { PGlite } = await import("@electric-sql/pglite")
      const { startPgliteServer } = await import("../../scripts/lib/pglite-server.mjs")
      const { initDb } = await import("../../db/init.ts")
      mkdirSync(dir, { recursive: true }); writeFileSync(lock, String(process.pid))
      const db = await PGlite.create(dir)
      const srv = await startPgliteServer({ db })
      await initDb(srv.url)
      process.env.DATABASE_URL = srv.url; process.env.DB_SSL = "disable"; process.env.DB_POOL_MAX ||= "1"
      localDb = { stop: async () => { try { await srv.stop() } catch { /* */ } try { await db.close() } catch { /* */ } try { rmSync(lock, { force: true }) } catch { /* */ } } }
      console.log("✓ Local database (data/pglite): searches, the call list and jobs work on this machine")
    } catch (e) {
      try { rmSync(lock, { force: true }) } catch { /* */ }
      const why = (e as Error).message.split("\n")[0].slice(0, 120)
      console.warn(`ℹ No database (${why}): the cockpit reads output/ ; Find prospects needs one (npm run doctor says how)`)
      noDbWhy = `No database: the local one could not start (${why}). Restart the cockpit; if it fails again, \`npm run doctor\` says why.`
    }
  }
}

const HOST = process.env.BACKOFFICE_HOST || "127.0.0.1" // 0.0.0.0 in a container (Hetzner/Coolify); loopback locally
// ── sharing through a tunnel (cloudflared): the station stays bound to loopback; the tunnel relays it ──
// BACKOFFICE_ALLOWED_HOST: the tunnel domain to allow (e.g. ".trycloudflare.com" = any subdomain).
// BACKOFFICE_PASSWORD: when set, requires Basic auth on EVERY request (otherwise: local, no auth).
const ALLOWED_HOST = (process.env.BACKOFFICE_ALLOWED_HOST || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase()
const AUTH_USER = process.env.BACKOFFICE_USER || "lws"
const AUTH_PASS = process.env.BACKOFFICE_PASSWORD || ""
function hostAllowed(h: string): boolean {
  const host = (h || "").replace(/:\d+$/, "").toLowerCase()
  if (/^(127\.0\.0\.1|localhost|\[?::1\]?)$/.test(host)) return true
  if (AUTH_PASS) return true // a password is configured → it already protects; no need to allowlist the host (Hetzner/Coolify)
  if (!ALLOWED_HOST) return false
  return ALLOWED_HOST.startsWith(".") ? host === ALLOWED_HOST.slice(1) || host.endsWith(ALLOWED_HOST) : host === ALLOWED_HOST
}
function authOk(req: IncomingMessage): boolean {
  if (!AUTH_PASS) return true // no password configured → local use, no auth
  const m = /^Basic (.+)$/.exec(req.headers.authorization || "")
  if (!m) return false
  let dec = ""; try { dec = Buffer.from(m[1], "base64").toString("utf8") } catch { return false }
  const i = dec.indexOf(":"); if (i < 0) return false
  const pass = Buffer.from(dec.slice(i + 1)), want = Buffer.from(AUTH_PASS)
  return dec.slice(0, i) === AUTH_USER && pass.length === want.length && timingSafeEqual(pass, want)
}
const SITES = "output/sites"
const TEMPLATES = "design/templates"
const FONTS = "video/fonts"
const DESIGN_FONTS = "design/fonts" // font library (Host Grotesk, Geist…) served through /designfont/
const DATA_ASSETS = "data/assets"
const PUBLIC = "backoffice/reviewpipe/public"
const OUTREACH = "data/outreach"        // outreach records per prospect (prepared by `npm run outreach`)
const LAB_NOTES = "output/lab/templates" // gitignored (output/), like the control.md files

// Type catalogue (design/fonts) for the lab: families + representative face + blacklist + curated pairs.
async function readDesignFonts(): Promise<unknown> {
  try {
    const idx = JSON.parse(await readFile(join(DESIGN_FONTS, "index.json"), "utf8"))
    const blRaw = await readFile(join(DESIGN_FONTS, "blacklist.txt"), "utf8").catch(() => "")
    const black = new Set(blRaw.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")))
    let pairings: unknown[] = []
    try { const p = JSON.parse(await readFile(join(DESIGN_FONTS, "pairings.json"), "utf8")); pairings = Array.isArray(p) ? p : (p.pairings || []) } catch { /* */ }
    const families = Object.entries(idx.families || {}).map(([name, f]: [string, any]) => {
      const faces = f.faces || []
      const face = faces.find((x: any) => x.style === "normal" && /(^|[^0-9])400/.test(String(x.weight))) || faces.find((x: any) => x.style === "normal") || faces[0]
      return { name, slug: f.slug, file: face ? face.file : null, weight: face ? face.weight : "", blacklisted: black.has(f.slug) || black.has(name.toLowerCase()) }
    }).filter((x) => x.file)
    return { count: families.length, families, pairings }
  } catch (e) { return { count: 0, families: [], pairings: [], error: String(e) } }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".avif": "image/avif", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf",
  ".otf": "font/otf", ".ico": "image/x-icon", ".mp4": "video/mp4", ".webm": "video/webm",
  ".mov": "video/quicktime", ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8",
}
// streamed types with Range request support (video seeking)
const STREAMABLE = new Set([".mp4", ".webm", ".mov"])

// ---- path guards: resolves `rel` UNDER `base`, refuses `..` AND symlinks that escape ----
function safeUnder(base: string, rel: string): string | null {
  const baseAbs = resolve(base)
  let clean: string
  try { clean = decodeURIComponent(rel).replace(/^\/+/, "") } catch { return null }
  const target = resolve(baseAbs, clean)
  if (target !== baseAbs && !target.startsWith(baseAbs + sep)) return null
  // resolve() does not canonicalise links: a symlink under `base` pointing outside would pass the
  // lexical test. We check the REAL path when the target exists (otherwise sendFile returns a 404).
  try {
    if (existsSync(target)) {
      const real = realpathSync(target)
      if (real !== baseAbs && !real.startsWith(baseAbs + sep)) return null
    }
  } catch { return null }
  return target
}

// forgiving statSync: a broken symlink or an entry deleted mid-scan does not break the loop
function isDir(p: string): boolean {
  try { return statSync(p).isDirectory() } catch { return false }
}

const NOSNIFF = { "X-Content-Type-Options": "nosniff" } // no MIME-sniffing of an uploaded asset as HTML
// Browser cache: heavy, repeated files are cached LONG (images/fonts/video — especially avant.png ~4 MB
// and the woff2 files) → clicking a site again no longer re-downloads everything. The station shell (html/js/css) and
// live data (json/md) stay FRESH (no-cache) so changes show without a hard refresh.
const cacheCtl = (type: string) => /^(image|font|video)\//.test(type) ? "public, max-age=86400" : "no-cache"
async function sendFile(res: ServerResponse, absPath: string, req?: IncomingMessage): Promise<void> {
  try {
    let p = absPath
    let st = await stat(p)
    if (st.isDirectory()) { p = join(p, "index.html"); st = await stat(p) }
    const ext = extname(p).toLowerCase()
    const type = MIME[ext] || "application/octet-stream"
    // video: streaming + Range (seeking is required on Safari/Chrome, otherwise no playback)
    if (STREAMABLE.has(ext)) {
      const size = st.size
      // SAFE pipe: an 'error' with no listener = uncaught exception (the headers are already sent → no
      // promise to reject) = process CRASH. We swallow the error; we destroy the stream if the
      // client leaves midway (otherwise the fd leaks).
      const pipeStream = (opts?: { start: number; end: number }) => {
        const stream = createReadStream(p, opts)
        stream.on("error", () => res.destroy())
        res.on("close", () => stream.destroy())
        stream.pipe(res)
      }
      const m = req?.headers?.range ? /^bytes=(\d*)-(\d*)$/.exec(req.headers.range.trim()) : null
      if (m && (m[1] || m[2])) {
        let start: number, end: number
        if (m[1] === "") { end = size - 1; start = Math.max(0, size - (parseInt(m[2], 10) || 0)) } // suffixe : derniers N octets
        else { start = parseInt(m[1], 10); end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1 } // end clamped to size-1
        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
          res.writeHead(416, { "Content-Range": `bytes */${size}` }); res.end(); return
        }
        res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1, "Cache-Control": cacheCtl(type), ...NOSNIFF })
        pipeStream({ start, end }); return
      }
      res.writeHead(200, { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": size, "Cache-Control": cacheCtl(type), ...NOSNIFF })
      pipeStream(); return
    }
    res.writeHead(200, { "Content-Type": type, "Cache-Control": cacheCtl(type), ...NOSNIFF })
    res.end(await readFile(p))
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" })
    res.end("Not found")
  }
}

function sendJson(res: ServerResponse, obj: unknown, code = 200): void {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...NOSNIFF })
  res.end(JSON.stringify(obj))
}

// STORAGE fallback: a missing local media file (gitignored, absent from the VM — e.g. hero.mp4) → 302 to the bucket.
function redirectTo(res: ServerResponse, url: string): void {
  res.writeHead(302, { Location: url, "Cache-Control": "no-cache" })
  res.end()
}

// Preview placeholder (never a raw "Not found"): the main page of a site not built yet.
// Served in the iframe → the operator sees "being built", not a broken 404.
function sendPreviewPlaceholder(res: ServerResponse): void {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>building</title></head>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#141417;color:#a8a8b2;font:15px/1.6 system-ui,-apple-system,sans-serif">
<div style="text-align:center;padding:24px">
  <div style="width:34px;height:34px;margin:0 auto 18px;border:3px solid #27272c;border-top-color:#d8ff3e;border-radius:50%;animation:s 1s linear infinite"></div>
  <div style="color:#f1f1f4;font-size:16px">Building this site…</div>
  <div style="margin-top:6px;font-size:13px;color:#8a8a94">The preview shows up as soon as it is built.</div>
</div>
<style>@keyframes s{to{transform:rotate(360deg)}}</style></body></html>`
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...NOSNIFF })
  res.end(html)
}

// IMAGE placeholder for the "before" shot (never a broken image): if the capture is really missing (local AND bucket),
// serve a clean visual instead of a 404 → the comparison stays presentable. SVG = crisp, light.
function sendAvantPlaceholder(res: ServerResponse): void {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900">
<rect width="1440" height="900" fill="#141417"/>
<text x="720" y="450" fill="#6b6b73" font-family="system-ui,sans-serif" font-size="34" font-weight="600" text-anchor="middle">No capture of the old site yet</text>
<text x="720" y="498" fill="#46464d" font-family="system-ui,sans-serif" font-size="20" text-anchor="middle">It is captured when the prospect is read.</text></svg>`
  res.writeHead(200, { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store", ...NOSNIFF })
  res.end(svg)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((res, rej) => {
    // bytes collected then decoded ONCE: an accented character split across two TCP packets used to stay "��" (comment, note)
    const body = textCollector()
    req.on("data", (c: Buffer) => {
      body.push(c)
      if (body.bytes > 16_000_000) { rej(new Error("payload too large")); req.destroy() }
    })
    req.on("end", () => res(body.text()))
    req.on("error", rej)
  })
}

// forgiving JSON parse: null if the body is missing/malformed or not an OBJECT (an array `[…]` used to pass, then crash
// the handlers that read body.id) → the caller returns 400 (not 500)
async function parseBody(req: IncomingMessage): Promise<any> {
  try {
    const obj = JSON.parse(await readBody(req))
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null
  } catch { return null }
}

// ---- site state: read from the DB (a cache of the FS), falling back to walking the disk ----
// `date` = the FULL folder name (dir_slug, e.g. 2026-06-08-composer) → keeps the contract with the UI.
interface SiteRow {
  id: string; date: string; hasIndex: boolean
  template: string; counts: string; generated: string; history: string[]; hasComment: boolean
  status?: string; variant?: string | null; genDate?: string | null
  name?: string; city?: string; oppScore?: number | null; oppTier?: string | null
  love?: number // 0-3: love level (a sorting tag on the cards), independent of the workflow status
  crmStage?: string | null // where the lead stands in Outreach (lost, nurturing, signature…), null when not there
  simulated?: boolean // a demo build (the sandbox's stand-in, marked .lws-demo), said as such in Sites
  preferences?: number // how many of the owner's preferences it was built with (learning.ts)
  shot?: boolean // a capture of the new site exists (/thumb/<id>/<date> serves it) ; else the cockpit draws the page itself
}
/** a capture of a built site, taken by the build (its page at 1440, the verify pass) : the cockpit's thumbnails use it */
const hasShot = (dir: string): boolean => ["_thumb.png", "_after.png", "_full.png", "_verify.png", "after.png"].some((f) => existsSync(join(dir, f)))

// the DB: one query, no more walk+parse on every call; enriched with the status (DB-owned) + prospect sheet.
async function listSitesDb(): Promise<SiteRow[]> {
  const rows = await getDb().prepare(`
    SELECT g.prospect_id AS id, g.dir_slug AS date, g.gen_date AS "genDate", g.variant AS variant,
           g.has_index AS "hasIndex", g.template AS template, g.counts AS counts,
           g.generated_label AS generated, g.has_comment AS "hasComment", g.status AS status,
           COALESCE(g.love, 0) AS love,
           p.name AS name, p.city AS city, p.opp_score AS "oppScore", p.opp_tier AS "oppTier", c.stage AS "crmStage"
    FROM generations g LEFT JOIN prospects p ON p.id = g.prospect_id LEFT JOIN crm_leads c ON c.prospect_id = g.prospect_id
    WHERE g.present = 1
    ORDER BY g.gen_date DESC NULLS LAST, COALESCE(g.created_at, g.indexed_at, 0) DESC, g.prospect_id ASC
  `).all() as any[]
  return rows.map((r) => ({
    id: r.id, date: r.date, genDate: r.genDate, variant: r.variant,
    hasIndex: !!r.hasIndex, template: r.template ?? "", counts: r.counts ?? "",
    generated: r.generated ?? "", history: [], hasComment: !!r.hasComment,
    status: r.status ?? "draft", name: r.name ?? "", city: r.city ?? "",
    oppScore: r.oppScore ?? null, oppTier: r.oppTier ?? null, love: r.love ?? 0, crmStage: r.crmStage ?? null,
    simulated: existsSync(join(SITES, r.id, r.date, ".lws-demo")),
    preferences: sitePrefCount(join(SITES, r.id, r.date)), // « Built with 3 of your preferences » (GET /api/learning/site says which)
    shot: hasShot(join(SITES, r.id, r.date)),
  }))
}

// fallback: the DB is a CACHE, never a hard dependency → if it is missing, walk the FS.
async function listSitesFs(): Promise<SiteRow[]> {
  if (!existsSync(SITES)) return []
  const rows: { row: SiteRow; mt: number }[] = []
  for (const id of await readdir(SITES)) {
    const idDir = join(SITES, id)
    if (!isDir(idDir)) continue
    for (const date of await readdir(idDir)) {
      const dir = join(idDir, date)
      if (!isDir(dir)) continue
      const ctlPath = join(dir, "control.md")
      const ctl = existsSync(ctlPath) ? parseControl(await readFile(ctlPath, "utf8")) : null
      // real recency: mtime of control.md (written at build time + on every edit), falling back to the folder
      let mt = 0
      try { mt = statSync(existsSync(ctlPath) ? ctlPath : dir).mtimeMs } catch { /* */ }
      rows.push({ mt, row: {
        id, date, hasIndex: existsSync(join(dir, "index.html")),
        template: ctl?.template ?? "", counts: ctl?.counts ?? "", generated: ctl?.generated ?? "",
        history: ctl?.history ?? [], hasComment: ctl?.hasComment ?? false, status: "draft",
        simulated: existsSync(join(dir, ".lws-demo")), preferences: sitePrefCount(dir), shot: hasShot(dir),
      } })
    }
  }
  // most recently touched FIRST (no more hunting); deterministic fallback on date then id
  rows.sort((a, b) => b.mt - a.mt || b.row.date.localeCompare(a.row.date) || a.row.id.localeCompare(b.row.id))
  return rows.map((r) => r.row)
}

async function listSites(): Promise<SiteRow[]> {
  try { return await listSitesDb() } catch { return listSitesFs() }
}

// DISK fallback for the lead pipe (no DB): same fields as the /api/leads SQL query, read from the sheets
// data/prospects/*.json; hasSite = at least one folder in output/sites/<id>/ with an index.html. Sorted the same way.
async function listLeadsFs(): Promise<any[]> {
  if (!existsSync(PROSPECTS)) return []
  const out: any[] = []
  for (const f of await readdir(PROSPECTS)) {
    if (!f.endsWith(".json") || f.endsWith(".example.json")) continue
    const id = f.slice(0, -5)
    if (!validProspectId(id)) continue
    const s = await readSheet(id)
    if (!s) continue
    const base = join(SITES, id)
    let hasSite = false
    try { hasSite = isDir(base) && (await readdir(base)).some((d) => existsSync(join(base, d, "index.html"))) } catch { /* */ }
    out.push({
      id, name: s.identity?.name ?? null, city: s.identity?.city ?? null, region: s.identity?.state || s.identity?.region || "", zip: s.identity?.zip || s.identity?.postalCode || "", industry: s.industry ?? null,
      oppScore: typeof s.score?.value === "number" ? s.score.value : null, oppTier: s.score?.tier ?? null,
      oldUrl: s.existing?.url ?? null, hasSite,
    })
  }
  out.sort((a, b) => (b.oppScore ?? -1) - (a.oppScore ?? -1) || String(a.name ?? "").localeCompare(String(b.name ?? "")))
  return out.slice(0, 2000)
}

// a prospect's LATEST build (dated folder with an index.html) — for the video / outreach preparation.
async function latestGen(id: string): Promise<string> {
  const base = join(SITES, id)
  if (!validProspectId(id) || !existsSync(base)) return ""
  const dirs = (await readdir(base)).filter((d) => existsSync(join(base, d, "index.html"))).sort()
  return dirs.length ? dirs[dirs.length - 1] : ""
}

// a site's folder, validated (really exists, no escape) — for control.md / upload
// `date` = the FULL dir_slug: YYYY-MM-DD with an optional variant suffix (-composer, -freetest…).
function siteDir(id: string, date: string): string | null {
  if (!/^[a-z0-9._-]+$/i.test(id) || !/^\d{4}-\d{2}-\d{2}(-[a-z0-9._-]+)?$/i.test(date)) return null
  const dir = safeUnder(SITES, `${id}/${date}`)
  if (!dir || !isDir(dir)) return null
  return dir
}

// validated prospect id (for data/assets/<id>/ and data/prospects/<id>.json)
// typeof first: `test(undefined)` tests the string "undefined" (true!) then `.includes` crashed with a 500 (blitz test)
function validProspectId(id: unknown): id is string { return typeof id === "string" && /^[a-z0-9._-]+$/i.test(id) && !id.includes("..") }

// ── home: what the entrepreneur wants to know, never the mechanics ──
async function homeSnapshot(): Promise<unknown> {
  const weekAgo = Date.now() - 7 * 86400_000
  // prospects: found this week (recent scoring files or sheets), "good fit" = hot/warm
  let found = 0, fit = 0
  const latest: { id: string; name: string; industry: string; city: string; fit: boolean; at: number }[] = []
  const seen = new Set<string>()
  const push = (id: string, name: string, industry: string, city: string, tier: string, at: number) => {
    if (seen.has(id)) return; seen.add(id)
    const good = tier === "hot" || tier === "warm"
    found++; if (good) fit++
    latest.push({ id, name, industry, city, fit: good, at })
  }
  try {
    const rows = await getDb().prepare(`SELECT id, name, city, industry, opp_tier AS tier, COALESCE(sheet_mtime, indexed_at, 0) AS at FROM prospects WHERE present = 1 ORDER BY COALESCE(sheet_mtime, indexed_at, 0) DESC LIMIT 200`).all() as any[]
    for (const r of rows) push(r.id, r.name || r.id, r.industry || "", r.city || "", String(r.tier || ""), Number(r.at) || 0)
  } catch { /* disque */ }
  if (!found && existsSync(PROSPECTS)) {
    for (const f of await readdir(PROSPECTS)) {
      if (!f.endsWith(".json") || f.endsWith(".example.json")) continue
      try { const j = JSON.parse(await readFile(join(PROSPECTS, f), "utf8")); let at = 0; try { at = statSync(join(PROSPECTS, f)).mtimeMs } catch { /* */ } push(f.slice(0, -5), j.identity?.name || f.slice(0, -5), j.industry || "", j.identity?.city || "", String(j.score?.tier || ""), at) } catch { /* */ }
    }
  }
  latest.sort((a, b) => b.at - a.at)
  const thisWeek = latest.filter((x) => x.at >= weekAgo).length
  // sites: built, waiting for your review (draft), being built
  const sites = await listSites()
  const built = sites.filter((x) => x.hasIndex).length
  const toReview = sites.filter((x) => x.hasIndex && (x.status === "draft" || !x.status)).length
  let building = 0
  try { building = (await listBatches(30)).filter((b) => b.mode === "composer" && (b.status === "queued" || b.status === "running")).length } catch { /* */ }
  // outreach: running sequences, replies
  let inFlight = 0, replies = 0, sent = 0
  try {
    let st: any[] = []
    try { const rows = await getDb().prepare("SELECT data FROM sequencer_state").all(); st = rows.map((r: any) => (typeof r.data === "string" ? JSON.parse(r.data) : r.data)) } catch { /* */ }
    if (!st.length && existsSync("data/sequencer/state.json")) st = JSON.parse(await readFile("data/sequencer/state.json", "utf8"))
    inFlight = st.filter((x) => x.status === "active" || x.status === "waiting-content").length
    replies = st.filter((x) => x.status === "replied").length
    sent = st.reduce((n, x) => n + ((x.sends || []).length), 0)
  } catch { /* */ }
  // calls: to call (hot, outside nurturing), meetings (closing, upcoming rdv_at), clients (signature)
  let toCall = 0, meetings = 0, nextMeeting: number | null = null, won = 0
  try {
    const rows = await getDb().prepare("SELECT pipeline, stage, rdv_at FROM crm_leads").all() as any[]
    for (const r of rows) {
      if (r.pipeline === "hot" && r.stage !== "nurturing" && r.stage !== "lost") toCall++
      if (r.pipeline === "closing" && r.stage === "signature") won++
      else if (r.pipeline === "closing") { meetings++; const t = Number(r.rdv_at); if (t && (!nextMeeting || t < nextMeeting)) nextMeeting = t }
    }
  } catch { /* no database: no CRM */ }
  let revenue = 0, invoices = 0
  try { for (const inv of (await listInvoices()).map(withTotals)) if (inv.kind !== "avoir" && inv.status !== "draft") { revenue += inv.totals.ttc; invoices++ } } catch { /* */ }
  return {
    at: new Date().toISOString(),
    agency: agency().name,
    prospects: { found, thisWeek, fit, latest: latest.slice(0, 12) },
    sites: { built, toReview, building },
    outreach: { inFlight, replies, sent },
    calls: { toCall, meetings, nextMeeting },
    clients: { won, revenue, invoices },
    cage: await cageStatus(),
  }
}

/** an email the sequencer wrote (RFC 822, one text/plain part in base64) → its sender, recipient, subject, body and
 *  legal footer (split at the footer's blank line), for the call panel's Email tab */
function parseEml(raw: string): { from: string; to: string; subject: string; body: string; footer: string } | null {
  if (!raw) return null
  const cut = raw.indexOf("\r\n\r\n"); if (cut < 0) return null
  const head = raw.slice(0, cut), payload = raw.slice(cut + 4)
  const h: Record<string, string> = {}
  for (const line of head.split("\r\n")) { const i = line.indexOf(":"); if (i > 0) h[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim() }
  const words = (v: string) => v.replace(/=\?utf-8\?b\?([^?]+)\?=/gi, (_, b) => Buffer.from(b, "base64").toString("utf8")).replace(/=\?utf-8\?q\?([^?]+)\?=/gi, (_, q) => decodeURIComponent(q.replace(/_/g, " ").replace(/=([0-9a-f]{2})/gi, "%$1")))
  let text = ""
  try { text = /base64/i.test(h["content-transfer-encoding"] || "") ? Buffer.from(payload.replace(/\s+/g, ""), "base64").toString("utf8") : payload } catch { text = payload }
  const f = text.lastIndexOf("\n\n \n")
  return { from: words(h.from || ""), to: words(h.to || ""), subject: words(h.subject || ""), body: (f >= 0 ? text.slice(0, f) : text).trim(), footer: f >= 0 ? text.slice(f + 4).trim() : "" }
}

// the sequencer's state : the SHARED database first (sequencer_state, seen from every machine), else the local file of
// the machine that runs the sequencer
async function loadSeqStateAll(): Promise<any[]> {
  try {
    const rows = await getDb().prepare("SELECT data FROM sequencer_state").all()
    if (rows.length) return rows.map((r: any) => (typeof r.data === "string" ? JSON.parse(r.data) : r.data))
  } catch { /* no database / no table → the file */ }
  try { if (existsSync("data/sequencer/state.json")) return JSON.parse(await readFile("data/sequencer/state.json", "utf8")) } catch { /* empty */ }
  return []
}
/** prospect id → its latest sequence (a re-enrolled lead has several : the last one says where it stands) */
async function seqById(): Promise<Record<string, any>> {
  const out: Record<string, any> = {}
  try { for (const s of await loadSeqStateAll()) if (s?.prospectId && (!out[s.prospectId] || String(s.enrolledAt) >= String(out[s.prospectId].enrolledAt))) out[s.prospectId] = s } catch { /* */ }
  return out
}
const liveSeq = (s: any): boolean => !!s && (s.status === "active" || s.status === "waiting-content")
/** stops a live email sequence for the owner's own reason (a meeting, won, lost, the site skipped) : the sequencer's
 *  own command (its lock), awaited so the next read says « Emails stopped: … » ; best-effort, never fails the action */
async function stopSequence(id: string, reason: "meeting" | "won" | "lost" | "skipped"): Promise<boolean> {
  try {
    const s = (await seqById())[id]
    if (!liveSeq(s)) return false
    await runSequencer(["stop", id, reason])
    return true
  } catch { return false }
}
/** a link to a fictional business's old site (.example, .test, .invalid : no DNS will ever answer) opens the copy the
 *  cockpit serves (/old/<id>/) ; a real site keeps its real address */
const RESERVED_HOST = /^https?:\/\/[^/]*\.(example|test|invalid)(?::\d+)?(\/|$)/i
function oldLink(id: string, url: string): string { return url && RESERVED_HOST.test(url) ? `/old/${encodeURIComponent(id)}/` : url }

// ── prospects: cockpit state (skipped, automatic mode) on disk ──
const PSTATE_FILE = "data/prospects-state.json"
/** `pending` : good prospects Hands-off accepted past today's cap in builds, built on the next days (first in line) */
async function readPState(): Promise<{ skipped: string[]; automatic: boolean; auto: Record<string, number>; autoSince?: number; pending: string[] }> {
  try { if (existsSync(PSTATE_FILE)) { const j = JSON.parse(await readFile(PSTATE_FILE, "utf8")); return { skipped: Array.isArray(j.skipped) ? j.skipped : [], automatic: !!j.automatic, auto: j.auto && typeof j.auto === "object" ? j.auto : {}, autoSince: Number(j.autoSince) || 0, pending: Array.isArray(j.pending) ? j.pending.filter(validProspectId) : [] } } } catch { /* */ }
  return { skipped: [], automatic: false, auto: {}, autoSince: 0, pending: [] }
}
/** today's builds : the cap (LWS_BUILDS_PER_DAY, or the daily limit ÷ one build's estimate), done, being built or queued
 *  for today, and what is left. The $ limit reached (other spends) leaves nothing either. */
async function buildsToday(): Promise<{ cap: number | null; from: string | null; done: number; inFlight: number; left: number | null; perBuildUsd: number; resetsAt: string }> {
  const st = buildsStatus()
  const inFlight = await buildsInFlight({ queued: true }).catch(() => 0)
  let left = st.cap == null ? null : Math.max(0, st.cap - st.done - inFlight)
  try { if (left != null && budgetStatus().reached) left = 0 } catch { /* */ }
  return { cap: st.cap, from: st.from, done: st.done, inFlight, left, perBuildUsd: st.perBuildUsd, resetsAt: st.resetsAt }
}
/** what Hands-off may build : good prospects, new (not built, not building, not in outreach, not skipped), that someone
 *  can contact (a phone or an email), in the agency's own country */
function handsoffSplit(items: any[], st: { auto: Record<string, number> }, home: string): { ids: string[]; abroad: any[]; noContact: any[] } {
  const waiting = items.filter((x: any) => x.fit && x.status === "new" && !st.auto[x.id])
  const abroad = waiting.filter((x: any) => x.country && home && x.country !== home)
  const noContact = waiting.filter((x: any) => !abroad.includes(x) && !x.phone && !x.email)
  return { ids: waiting.filter((x: any) => !abroad.includes(x) && !noContact.includes(x)).map((x: any) => x.id), abroad, noContact }
}
async function writePState(st: unknown): Promise<void> { await mkdir("data", { recursive: true }); await writeFile(PSTATE_FILE, JSON.stringify(st, null, 2) + "\n") }
const plainReasons = (sheet: any): string[] => whyTags(sheet)
/** a prospect the agency knows (its sheet on disk, or its row in the database) : a build is only ever queued for one */
async function prospectExists(id: string): Promise<boolean> {
  if (!validProspectId(id)) return false
  if (existsSync(join(PROSPECTS, `${id}.json`))) return true
  try { return !!(await getDb().prepare("SELECT 1 AS x FROM prospects WHERE id=?").get(id)) } catch { return false }
}
/** the build or the feedback already queued or running for a site (one job per site at a time : never paid twice) */
async function pendingSiteJob(id: string): Promise<{ id: number; mode: string } | null> {
  let rows: any[] = []; try { rows = await listBatches(50) } catch { return null }
  for (const b of rows) {
    if (!(b.status === "queued" || b.status === "running") || !(b.mode === "composer" || b.mode === "edit" || b.mode === "template-fill")) continue
    let p: any = {}; try { p = JSON.parse(b.params_json || "{}") } catch { /* */ }
    if ((Array.isArray(p.ids) && p.ids.includes(id)) || p.id === id) return { id: b.id, mode: b.mode }
  }
  return null
}
const busySay = (name: string, j: { mode: string }) => j.mode === "edit" ? `${name}: your feedback is already being applied. Wait for it to finish.` : `${name} is already being built. Wait for it to finish.`
async function prospectsList(): Promise<unknown> {
  const st = await readPState()
  const skipped = new Set(st.skipped)
  const sites = await listSites()
  const byId: Record<string, SiteRow[]> = {}
  for (const x of sites) (byId[x.id] ||= []).push(x)
  let batches: any[] = []
  try { batches = await listBatches(50) } catch { /* */ }
  // id → when its build started : a prospect whose site landed AFTER that is built, even while the batch goes on
  const buildingSince = new Map<string, number>()
  const tomorrow = new Map<string, number>() // queued past today's cap in builds : built when it resets
  for (const b of batches) if (b.mode === "composer" && (b.status === "queued" || b.status === "running")) { try { for (const id of JSON.parse(b.params_json || "{}").ids || []) { buildingSince.set(id, Number(b.started_at || b.created_at) || 0); if (b.status === "queued" && Number(b.retry_after) > Date.now()) tomorrow.set(id, Number(b.retry_after)) } } catch { /* */ } }
  // a business in an email sequence (or on the Outreach board) is in outreach, never « New » nor offered for a build
  const seqs = await seqById()
  const landedAfter = (id: string, date: string | undefined, t: number): boolean => { if (!date || !t) return false; try { return statSync(join(SITES, id, date)).mtimeMs >= t } catch { return false } }
  const ids = new Set<string>()
  if (existsSync(PROSPECTS)) for (const f of await readdir(PROSPECTS)) if (f.endsWith(".json") && !f.endsWith(".example.json") && validProspectId(f.slice(0, -5))) ids.add(f.slice(0, -5))
  try { for (const r of await getDb().prepare("SELECT id FROM prospects WHERE present = 1").all() as any[]) if (validProspectId(r.id)) ids.add(r.id) } catch { /* */ }
  const items: any[] = []
  for (const id of ids) {
    let sheet: any = await readSheet(id)
    if (!sheet) { try { const r = await getDb().prepare("SELECT sheet_json FROM prospects WHERE id=?").get(id) as any; if (r?.sheet_json) sheet = JSON.parse(r.sheet_json) } catch { /* */ } }
    if (!sheet) continue
    const tier = String(sheet.score?.tier || "")
    const gens = byId[id] || []
    const latest = gens.find((g) => g.hasIndex)
    let at = 0; try { at = statSync(join(PROSPECTS, `${id}.json`)).mtimeMs } catch { at = Number(sheet.score?.at) || 0 }
    const since = buildingSince.get(id)
    // the FURTHEST state, the same one Sites and Outreach show : a won client is « Won » here too, never « Built »
    const sent = gens.some((g) => ["approved", "sent", "drafted"].includes(String(g.status)))
    const crm = gens.find((g) => g.crmStage)?.crmStage || null
    // Skip in Sites (the site rejected) is the same Skip as here : one business, one status
    const rejected = !!latest && String(latest.status) === "rejected" && !sent
    const inSeq = !!seqs[id]
    const status = skipped.has(id) || rejected ? "skipped" : since !== undefined && !landedAfter(id, latest?.date, since) ? "building"
      : crm === "signature" ? "won" : crm === "lost" ? "lost" : latest ? (sent || inSeq ? "outreach" : "built") : inSeq ? "outreach" : "new"
    items.push({
      id, name: sheet.identity?.name || id.replace(/-/g, " "), industry: sheet.industry || "", city: sheet.identity?.city || "",
      region: sheet.identity?.region || sheet.identity?.state || "", zip: sheet.identity?.zip || sheet.identity?.postalCode || "",
      phone: sheet.identity?.phone || "", email: sheet.identity?.email || "", oldUrl: sheet.existing?.url || "", oldHref: oldLink(id, sheet.existing?.url || ""), country: prospectCountry(sheet),
      ...(tomorrow.has(id) ? { waitsUntil: tomorrow.get(id) } : {}),
      fit: tier === "hot" || tier === "warm", strong: tier === "hot", reasons: plainReasons(sheet), status, at,
      // « Why it's on your list » (Sites), in sentences
      why: whyCodes(sheet).map((w) => w.say),
      site: latest ? { date: latest.date, status: latest.status } : null,
      hasBefore: existsSync(join(DATA_ASSETS, id, "avant.png")) || existsSync(join(DATA_ASSETS, id, "avant.svg")),
      hasBeforeMobile: existsSync(join(DATA_ASSETS, id, "avant.mobile.png")), // their old site captured on a phone
    })
  }
  items.sort((a, b) => b.at - a.at || a.name.localeCompare(b.name))
  const n = (s: string) => items.filter((x) => x.status === s).length
  const counts = { total: items.length, new: n("new"), building: n("building"), built: n("built"), outreach: n("outreach"), won: n("won"), lost: n("lost"), skipped: n("skipped") }
  const trades = [...new Set(items.map((x) => x.industry).filter(Boolean))].sort()
  const cities = [...new Set(items.map((x) => x.city).filter(Boolean))].sort()
  const noDb = !tryDb()
  return { items, counts, trades, cities, automatic: !!st.automatic, country: agency().country, toCall: await toCallCount(), noDb, ...(noDb ? { noDbWhy: noDbReason() } : {}), sandbox: process.env.LWS_SANDBOX === "1" }
}
/** the lane a lead shows in : « emails » while the sequence writes to it and nobody clicked yet, else its stage (a
 *  stage « emails » whose emails ended, or got a click, is on the call list) */
function laneOf(stage: string | null, s: any): string {
  const writing = liveSeq(s) && !(s.clicks || []).length
  if (!stage || stage === "emails") return writing ? "emails" : "call0"
  return stage
}
/** why a sequence no longer writes, in the owner's words : the card says « Emails stopped: meeting booked » */
function stopSay(s: any, total: number): string {
  const t = String(s?.stoppedBy?.type || "")
  if (s?.status === "replied" || t === "reply") return "Emails stopped: they replied"
  if (t === "meeting") return "Emails stopped: meeting booked"
  if (t === "won") return "Emails stopped: won"
  if (t === "lost") return "Emails stopped: marked lost"
  if (t === "skipped") return "Emails stopped: site skipped"
  if (t === "unsub") return "Emails stopped: they unsubscribed"
  if (t === "complaint") return "Emails stopped: marked as spam"
  if (t === "bounce") return "Emails stopped: the address bounced"
  if (s?.status === "nurturing") return "Emails paused: no click on the last one"
  if (s?.status === "done") return `All ${total} emails written`
  return "Emails stopped"
}
/** calls to make (the Outreach badge): approved sites whose lead is in a call step (first call or a follow-up), not lost */
async function toCallCount(): Promise<number | null> {
  if (!tryDb()) return null
  try {
    // a lead with no phone is not a call to make (it says « no phone, no email » on its card instead)
    const r = await getDb().prepare(`SELECT a.prospect_id AS id, c.stage AS stage FROM (SELECT DISTINCT g.prospect_id FROM generations g WHERE g.present = 1 AND g.status IN ('approved','drafted','sent')) a
      LEFT JOIN crm_leads c ON c.prospect_id = a.prospect_id LEFT JOIN prospects p ON p.id = a.prospect_id
      WHERE (c.prospect_id IS NULL OR c.pipeline IS NULL OR (c.pipeline = 'hot' AND c.stage NOT IN ('nurturing','lost'))) AND COALESCE(p.phone, '') <> ''`).all() as any[]
    // a lead the emails are still writing to (no click yet) is not a call to make : the same rule as the board's lanes
    const seqs = await seqById()
    return r.filter((x: any) => laneOf(x.stage ?? null, seqs[x.id]) !== "emails").length
  } catch { return null }
}
/** Hands-off : after a search brings NEW good-fit prospects, they are built without asking (the toggle itself asks first). */
async function autoBuild(): Promise<void> {
  const st = await readPState()
  // never without a ceiling (no daily cap → nothing is built on its own), never past it : what is left today, the rest
  // waits in `pending` and goes first on the next days
  if (!st.automatic || !tryDb() || buildsCap().cap == null) return
  const b = await buildsToday()
  const list = await prospectsList() as any
  const home = String(agency().country || "").toUpperCase()
  const pend = new Set(st.pending)
  // good prospects of the agency's own country only (a search abroad is left to you), someone can contact
  const ok = new Set(handsoffSplit(list.items, st, home).ids)
  const todo = list.items.filter((x: any) => ok.has(x.id) && (pend.has(x.id) || x.at > (st.autoSince || 0))).map((x: any) => x.id as string)
  todo.sort((x: string, y: string) => Number(pend.has(y)) - Number(pend.has(x)))
  const now = todo.slice(0, b.left ?? 0), later = todo.slice(b.left ?? 0)
  const pendingChanged = later.join() !== st.pending.join()
  if (!now.length) { if (pendingChanged) { st.pending = later; await writePState(st).catch(() => {}) } return }
  try {
    await enqueueBatch({ mode: "composer", ids: now, lim: now.length, requestedBy: "hands-off", note: "hands-off: new good-fit prospects" })
    for (const id of now) st.auto[id] = Date.now()
    st.pending = later
    await writePState(st)
    broadcast({ type: "batches" }); broadcast({ type: "prospects" }); kickEngine()
  } catch { /* best-effort */ }
}

// ── connect your agent (data/agent.json) ──
const AGENT_FILE = "data/agent.json"
type AgentConfig = { mode: "sequencer" | "webhook" | "manual"; url: string; updatedAt?: string }
async function readAgentConfig(): Promise<AgentConfig> {
  try {
    if (existsSync(AGENT_FILE)) {
      const j = JSON.parse(await readFile(AGENT_FILE, "utf8"))
      if (["sequencer", "webhook", "manual"].includes(j.mode)) return { mode: j.mode, url: typeof j.url === "string" ? j.url : "", updatedAt: j.updatedAt }
    }
  } catch { /* unreadable → default */ }
  // a fresh install starts with the gentlest choice : your call list, no email until you pick « Send emails automatically »
  return { mode: "manual", url: "" }
}
/** Approving under « Send emails automatically » puts the lead in the email sequence (the sequencer's own enroll, which
 *  refuses an unsubscribe, a complaint or a bouncing address) ; in the sandbox its next round runs at once (test mode,
 *  nothing leaves). Best-effort : approving never fails because of it. */
function runSequencer(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const c = spawnTracked(process.execPath, ["--import", "tsx", "outreach/scripts/sequencer.ts", ...args], { cwd: process.cwd(), env: process.env, stdio: "ignore" })
    c.on("error", () => resolve(-1)); c.on("close", (code) => resolve(code ?? -1))
  })
}
async function enrollOnApprove(id: string): Promise<void> {
  try {
    if ((await readAgentConfig()).mode !== "sequencer") return
    const sheet = await readSheet(id)
    if (!sheet?.identity?.email) return
    // a lead already in a deal (meeting, proposal, won) or lost is never sent cold emails again (a rebuilt site included)
    try { const c = await getDb().prepare("SELECT pipeline, stage FROM crm_leads WHERE prospect_id=?").get(id) as any; if (c && (c.pipeline === "closing" || c.stage === "lost")) return } catch { /* no CRM yet */ }
    // the demo writes the first email at once (the real one comes from the generate-savior skill) : the Email tab never
    // sits on « not written yet » in a demo that would never write it
    if (process.env.LWS_SANDBOX === "1" && !existsSync(join("data", "savior", `${id}.json`))) {
      const a = agency() as any
      // its opening : each one in turn, then leaning on the one that gets replies (learning/scripts/words.ts), said why
      const pick = await firstEmailAngle(id)
      const m = simulatedFirstEmail(sheet, a.brand?.expediteur ? `${a.brand.expediteur}, ${a.name}` : a.name || "", prospectLang(sheet, a.language || "en"), pick.angle)
      await mkdir(join("data", "savior"), { recursive: true })
      await writeFile(join("data", "savior", `${id}.json`), JSON.stringify({ _sample: "demo first email, written by the sandbox", prospectId: id, senderName: a.mail?.senderName || a.name, ...m, angle: pick.angle, angleWhy: pick.why }, null, 2) + "\n")
    }
    await runSequencer(["enroll", id])
    if (process.env.LWS_SANDBOX === "1") await runSequencer(["tick"])
    // the lane follows the choice : a lead the emails write to sits in « Emails », not « To call » (a click, a reply or
    // the end of the emails brings it to the call list)
    try {
      if (liveSeq((await seqById())[id])) await getDb().prepare("INSERT INTO crm_leads(prospect_id, pipeline, stage, updated_at) VALUES (?, 'hot', 'emails', ?) ON CONFLICT (prospect_id) DO UPDATE SET stage='emails', updated_at=EXCLUDED.updated_at WHERE crm_leads.pipeline='hot' AND crm_leads.stage='call0'").run(id, Date.now())
    } catch { /* no CRM : the board places it from the sequence */ }
    broadcast({ type: "sales" })
  } catch { /* best-effort */ }
}
/** When a site is approved and the connected agent is a webhook: POST the prospect + site + script. Best-effort, bounded, signed. */
async function notifyAgent(id: string, date: string): Promise<void> {
  const cfg = await readAgentConfig()
  if (cfg.mode !== "webhook" || !cfg.url) return
  let sheet: any = {}
  try { const f = join(PROSPECTS, `${id}.json`); if (existsSync(f)) sheet = JSON.parse(await readFile(f, "utf8")) } catch { /* */ }
  if (!sheet?.id) { try { const r = await getDb().prepare("SELECT sheet_json FROM prospects WHERE id=?").get(id) as any; if (r?.sheet_json) sheet = JSON.parse(r.sheet_json) } catch { /* */ } }
  let callScript: string | null = null, research: unknown = null
  try { const r = await getDb().prepare("SELECT call_script, research_json FROM crm_leads WHERE prospect_id=?").get(id) as any; callScript = r?.call_script || null; research = r?.research_json ? JSON.parse(r.research_json) : null } catch { /* */ }
  const payload = JSON.stringify({ event: "site.approved", at: new Date().toISOString(), prospect: { id, ...sheet }, site: { date, path: `/preview/${id}/${date}/index.html` }, callScript, research })
  const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "lastwebstudios-cockpit" }
  const secret = process.env.LWS_TRACK_SECRET || ""
  if (secret) headers["x-lws-signature"] = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex")
  try {
    const r = await fetch(cfg.url, { method: "POST", headers, body: payload, signal: AbortSignal.timeout(8000) })
    broadcast({ type: "agent", id, delivered: r.ok, status: r.status })
  } catch (e) { broadcast({ type: "agent", id, delivered: false, error: String((e as Error).message).slice(0, 120) }) }
}

// ── CRM stages: fixed keys (the server's contract), editable labels ──
const STAGES_FILE = "data/crm-stages.json"
// « emails » : a lead the email sequence is writing to (approved under « Send emails automatically »), no click yet ;
// a click, a reply or the end of the emails puts it on the call list (To call). Shown by laneOf, never chosen by hand.
const STAGE_DEFAULTS: { hot: [string, string][]; closing: [string, string][] } = {
  hot: [["emails", "Emails"], ["call0", "To call"], ["relance1", "Follow-up 1"], ["relance2", "Follow-up 2"], ["relance3", "Follow-up 3"], ["nurturing", "Nurturing"]],
  closing: [["demo", "Meeting"], ["propal", "Proposal"], ["nego", "Negotiation"], ["signature", "Won"]],
}
const STAGE_KEYS = new Set([...STAGE_DEFAULTS.hot, ...STAGE_DEFAULTS.closing].map(([k]) => k))
async function crmStages(): Promise<{ hot: { key: string; label: string }[]; closing: { key: string; label: string }[] }> {
  let labels: Record<string, string> = {}
  try { if (existsSync(STAGES_FILE)) labels = JSON.parse(await readFile(STAGES_FILE, "utf8")).labels || {} } catch { /* */ }
  const map = (arr: [string, string][]) => arr.map(([key, label]) => ({ key, label: typeof labels[key] === "string" && labels[key].trim() ? labels[key] : label }))
  return { hot: map(STAGE_DEFAULTS.hot), closing: map(STAGE_DEFAULTS.closing) }
}
const PROSPECTS = "data/prospects"
async function readSheet(id: string): Promise<any | null> {
  const f = join(PROSPECTS, `${id}.json`)
  if (!existsSync(f)) return null
  try { return JSON.parse(await readFile(f, "utf8")) } catch { return null }
}
async function writeSheet(id: string, sheet: any): Promise<void> {
  await writeFile(join(PROSPECTS, `${id}.json`), JSON.stringify(sheet, null, 2) + "\n")
}

// ---- outreach records (data/outreach/<id>.json): read/write for the sales console ----
async function readOutreach(id: string): Promise<any | null> {
  if (!validProspectId(id)) return null
  const f = join(OUTREACH, `${id}.json`)
  if (!existsSync(f)) return null
  try { return JSON.parse(await readFile(f, "utf8")) } catch { return null }
}
async function writeOutreach(id: string, rec: any): Promise<void> {
  await mkdir(OUTREACH, { recursive: true })
  await writeFile(join(OUTREACH, `${id}.json`), JSON.stringify(rec, null, 2) + "\n")
}
const escHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
// regenerates htmlBody from the edited text: CLEAN demo link (▶), clickable URLs, <br> per line.
// Keeps the "never a scary raw URL" rule even after a manual edit in the platform.
function bodyToHtml(body: string, demoUrl?: string): string {
  const lines = (body || "").split("\n").map((line) => {
    if (demoUrl && line.includes(demoUrl)) return `<a href="${demoUrl}">▶ Voir la démo (30 s)</a>`
    return escHtml(line).replace(/(https?:\/\/[^\s)]+)/g, '<a href="$1">$1</a>')
  })
  return `<div style="font-family:system-ui,-apple-system,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">${lines.join("<br>")}</div>`
}
// asset swap log (DB-owned, best-effort)
async function logAssetEvent(id: string, action: string, oldRel: string | null, newRel: string | null, reason?: string): Promise<void> {
  try {
    await tryDb()?.prepare("INSERT INTO asset_events(prospect_id,action,old_rel_path,new_rel_path,reason,actor,created_at) VALUES(?,?,?,?,?, 'operator', ?)")
      .run(id, action, oldRel, newRel, reason ?? null, Date.now())
  } catch { /* best-effort */ }
}
const IMG_RE = /\.(png|jpe?g|webp|gif|avif|svg)$/i
const VID_RE = /\.(mp4|webm|mov)$/i

// an existing skill's folder, validated
function skillDir(name: string): string | null {
  if (!/^[a-z0-9-]+$/.test(name)) return null
  const dir = safeUnder(SKILLS_DIR, name)
  if (!dir || !isDir(dir)) return null
  return dir
}

// skill draft in TEST MODE (see /skilldraft § 6): to flesh out, never automatic, promoted after ≥3
function draftScaffold(slug: string, brief: string, signal: string): string {
  return `---
name: ${slug}
status: test
---

> ⚠ test mode — draft created from the brain. Flesh it out (\`/skilldraft\`), warn before use,
> do not wire it to run automatically; promoted after ≥ 3 validated uses.

# ${slug}

**Idea.** ${brief || "(to be specified)"}

${signal ? `**Signal.** ${signal}\n\n` : ""}## Quand l'utiliser
(to be completed)

## Steps
(to be completed)
`
}

// ---- SSE: broadcast to every client, with event-id + ring buffer (replay on reconnect) ----
const clients = new Set<ServerResponse>()
let watchOk = true // did an fs watcher fail at startup? (honest heartbeat)
let seq = 0
const ring: { id: number; line: string }[] = []
const RING_CAP = 500
function broadcast(obj: unknown): void {
  const id = ++seq
  const line = `id: ${id}\ndata: ${JSON.stringify(obj)}\n\n`
  ring.push({ id, line })
  if (ring.length > RING_CAP) ring.shift()
  // when a write fails (dead client), REMOVE it from the Set (no leaking ghost connection)
  for (const res of clients) { try { res.write(line) } catch { clients.delete(res) } }
}
initLearning({ broadcast, sendJson, parseBody, siteDir })

// ---- learning loop: a CRM outcome → data/outcomes.jsonl (+ database mirror), once per prospect ----
// `npm run learn` (the lws-learn nightly timer) then recomputes the scoring gate's rules.
async function learnFrom(id: string, kind: "won" | "lost" | "meeting"): Promise<{ outcome: string; recorded: boolean } | null> {
  try {
    const r = await recordOutcome(id, kind, { source: `cockpit:${AUTH_USER}` })
    if (r.recorded) { broadcast({ type: "machine", stage: "learn", outcome: kind }); void refreshPicks() } // the picks follow at once
    return { outcome: kind, recorded: r.recorded }
  } catch { return null } // learning never breaks a CRM action
}

/** what the agency answers first after a feedback : « Got it, changing it on this site. », unless this is a demo site and
 *  nothing it just learned can show on it (the demo has no photo of theirs…) : then it says so, never « changing it »
 *  over a preview that stays the same */
async function feedbackHead(id: string, date: string, remember: any): Promise<string> {
  const head = "Got it, changing it on this site."
  const learned: any[] = remember?.preferences || []
  const dir = dir0(id, date)
  if (!learned.length || process.env.LWS_SANDBOX !== "1" || !dir || !existsSync(join(dir, ".lws-demo"))) return head
  try {
    const sheet = { ...(await readSheet(id)), id }
    const plan = planTaste(sheet, learned.map((p) => ({ id: p.id, key: String(p.id).replace(/^p-/, ""), text: p.text })), { photo: !!findOwnPhoto(sheet) })
    if (plan.applied.length || !plan.skipped.length) return head
    return `Got it. ${plan.skipped[0].why.replace(/\.?$/, ".")}`
  } catch { return head }
}
/** the owner's comment on a site (its control.md), distilled into preferences : « I'll remember: … » + an undo id */
const dir0 = (id: string, date: string) => siteDir(id, date) || ""
async function feedbackFrom(dir: string, id: string, date: string) {
  try { const ctl = parseControl(await readFile(join(dir, "control.md"), "utf8")); return await onFeedback({ kind: "comment", id, date, text: ctl.feedback }) } catch { return null }
}

// ---- generic job runner: spawn npm + stream stdout line by line over SSE, one lock per key ----
// Used by "feedback" (surgical edit), the re-fill after an asset swap, and later the pipeline.
const running = new Set<string>()
function runJob(key: string, args: string[], label: string, meta: Record<string, unknown>, extraEnv?: NodeJS.ProcessEnv): void {
  if (running.has(key)) { broadcast({ type: "refill", ...meta, line: "already running…" }); return }
  running.add(key)
  broadcast({ type: "refill", ...meta, line: `${label}…` })
  const child = spawnTracked("npm", args, { cwd: process.cwd(), env: { ...process.env, ...(extraEnv || {}) } })
  // one line per event, rejoined if the pipe splits it (otherwise a log line arrives in two halves)
  const onLine = (line: string) => { if (line) broadcast({ type: "refill", ...meta, line }) }
  const out = lineSplitter(onLine), errLines = lineSplitter(onLine)
  child.stdout?.on("data", (b: Buffer) => out.push(b))
  child.stderr?.on("data", (b: Buffer) => errLines.push(b))
  // without this handler, a spawn failure (npm missing…) emits 'error' → unhandled exception = crash,
  // and 'close' never fires → the key stays locked in `running`.
  child.on("error", (err) => {
    running.delete(key)
    broadcast({ type: "refill", ...meta, line: `could not start: ${err.message}` })
    broadcast({ type: "refill-done", ...meta, code: -1 })
  })
  child.on("close", (code) => {
    out.end(); errLines.end()
    running.delete(key)
    broadcast({ type: "refill-done", ...meta, code })
  })
}
// captures a command's output (best-effort, bounded) — to query systemctl
function execCapture(cmd: string, args: string[], timeoutMs = 2500): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnTracked(cmd, args, { cwd: process.cwd(), env: process.env })
    const out = textCollector(1_000_000)
    const to = setTimeout(() => { try { child.kill() } catch { /* */ } reject(new Error("timeout")) }, timeoutMs)
    child.stdout?.on("data", (b: Buffer) => out.push(b))
    child.on("error", (e) => { clearTimeout(to); reject(e) })
    child.on("close", () => { clearTimeout(to); resolve(out.text()) })
  })
}

// feedback = SURGICAL edit (npm run edit): applies only the comment, no full rebuild.
function refill(id: string, date: string): void {
  runJob(`edit:${id}/${date}`, ["run", "edit", "--", id, date], `feedback (surgical) : ${id}/${date}`, { id, date })
}

// ---- live pipeline: spawn `npm run pipeline` with PIPELINE_JSON=1, re-broadcast per link ----
// run.ts already emits run-start/prospect-start/step/prospect-done/run-end → relayed over SSE {type:'run'}.
type RunRow = { id: string; name?: string; steps: Record<string, string> }
let currentRun: { startedAt: number; rows: Record<string, RunRow> } | null = null
function startPipeline(opts: { limit?: number; force?: boolean; design?: boolean }): boolean {
  // a single run, and not while a manual re-fill runs (they would collide on output/sites/<id>)
  if (currentRun || [...running].some((k) => k.startsWith("fill:"))) return false
  const env: NodeJS.ProcessEnv = { ...process.env, PIPELINE_JSON: "1" }
  if (opts.limit) env.LIMIT = String(opts.limit)
  if (opts.force) env.FORCE = "1"
  if (opts.design === false) env.DESIGN = "0"
  currentRun = { startedAt: Date.now(), rows: {} }
  const child = spawnTracked("npm", ["run", "pipeline"], { cwd: process.cwd(), env })
  // JSON events line by line: a line split by the pipe is rejoined (lineSplitter), never relayed as two "log" events
  const out = lineSplitter((raw) => {
    const t = raw.trim()
    if (!t) return
    let e: any
    try { e = JSON.parse(t) } catch { broadcast({ type: "run", ev: { type: "log", line: t } }); return }
    if (currentRun) {
      if (e.type === "prospect-start") currentRun.rows[e.id] = { id: e.id, name: e.name, steps: {} }
      else if (e.type === "step" && currentRun.rows[e.id]) { const r = currentRun.rows[e.id]; for (const k in r.steps) if (r.steps[k] === "run") r.steps[k] = "done"; r.steps[e.step] = "run" }
      else if (e.type === "prospect-done" && currentRun.rows[e.id]) { const r = currentRun.rows[e.id]; for (const k in r.steps) if (r.steps[k] === "run") r.steps[k] = e.verdict === "echec" ? "fail" : "done" }
    }
    broadcast({ type: "run", ev: e })
  })
  const errLines = lineSplitter((line) => { if (line) broadcast({ type: "run", ev: { type: "log", line } }) })
  child.stdout?.on("data", (b: Buffer) => out.push(b))
  child.stderr?.on("data", (b: Buffer) => errLines.push(b))
  child.on("error", (err) => { broadcast({ type: "run", ev: { type: "log", line: `could not start: ${err.message}` } }); broadcast({ type: "run-done", code: -1 }); currentRun = null })
  child.on("close", (code) => { out.end(); errLines.end(); broadcast({ type: "run-done", code }); currentRun = null })
  return true
}

// automatic mode: every 60 s, new "good fit" prospects go off to be built (if DATABASE_URL)
setInterval(() => { void autoBuild() }, 60_000).unref()
// THE BUILT-IN ENGINE: if no external worker has a heartbeat, the cockpit runs the jobs itself (simulated in the sandbox)
startEngine((e) => { broadcast(e); if ((e as JobEvent).type === "job" && (e as JobEvent).status === "done") void autoBuild() })

// SIGTERM / SIGINT → a real exit : a library listening to them (Playwright, while the engine captures a page) must
// never keep the cockpit alive ; process.exit runs the « exit » handlers, which close the browser it opened
// the local database is closed first (bounded : 3 s), so data/pglite is never left half-written
// the processes it started (a search's lead engine, a build, the sequencer) stop with it : SIGTERM, SIGKILL after 2 s
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => {
  const code = sig === "SIGINT" ? 130 : 143
  const t = setTimeout(() => process.exit(code), 5000)
  void stopChildren(2000).finally(() => { if (!localDb) { clearTimeout(t); process.exit(code) } void localDb.stop().finally(() => { clearTimeout(t); process.exit(code) }) })
})
// the working folder is gone (throwaway sandbox deleted) → stop cleanly instead of serving 500s
setInterval(() => { if (!existsSync(process.cwd()) || !existsSync(join(process.cwd(), "backoffice"))) { console.log("⏹ The working folder is gone: stopping"); process.exit(0) } }, 5000).unref()

/** what Settings offers (the same lists as the page's selects) : the server never saves a value outside them */
const AI_WAYS = ["claude-code", "codex", "anthropic", "openai-compatible", "anthropic-compatible"]
const SETTINGS_LISTS: Record<string, string[]> = {
  country: ["US", "GB", "CA", "AU", "NZ", "IE", "FR", "BE", "CH", "DE", "ES", "IT", "NL"],
  language: ["en", "fr", "de", "es", "it", "nl"],
  currency: ["USD", "EUR", "GBP", "CAD", "AUD", "NZD", "CHF"],
}
const validZone = (tz: string): boolean => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return /^[A-Za-z_]+\/[A-Za-z_\/-]+$|^UTC$/.test(tz) } catch { return false } }
/** one KEY=value line in .env (replaced, never duplicated), and live in this process at once */
async function setEnvVar(key: string, value: string): Promise<void> {
  const envPath = join(process.cwd(), ".env")
  let txt = ""; try { txt = await readFile(envPath, "utf8") } catch { /* new */ }
  txt = txt.split("\n").filter((l) => !new RegExp(`^\\s*${key}=`).test(l)).join("\n").replace(/\n*$/, "\n") + `${key}=${value}\n`
  await writeFile(envPath, txt.replace(/^\n+/, ""))
  process.env[key] = value
}
const AI_STATUS = new Map<string, { at: number; v: any }>()
/** what each AI choice NEEDS on this computer (what it covers is the choice's own description in Settings, said once) :
 *  building sites always runs in Claude Code, so a non-Claude choice says the Claude sign-in too, once */
const NEEDS = {
  "claude-code": { label: "Needs Claude Code signed in to your Claude plan on this computer", fix: "Sign in once from a terminal: `claude auth login`." },
  codex: { label: "Needs ChatGPT's command-line tool (Codex), signed in on this computer", fix: "Install it once from a terminal: `npm i -g @openai/codex`, then sign in: `codex login`.", builds: "Building sites also needs Claude, signed in: `claude auth login`." },
  anthropic: { label: "Needs a Claude API key, paid per use", fix: "Put `ANTHROPIC_API_KEY=…` in the .env file, then restart." },
  "openai-compatible": { label: "Needs your model server's address", fix: "Put it in the .env file (`OPENAI_BASE_URL=…`), then restart.", builds: "Building sites also needs Claude, signed in: `claude auth login`." },
  "anthropic-compatible": { label: "Needs your model server's address", fix: "Put it in the .env file (`ANTHROPIC_BASE_URL=…`), then restart.", builds: "Building sites also needs Claude, signed in: `claude auth login`." },
}
// ---- routeur ----
async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // anti DNS-rebinding: require a loopback Host (or the explicitly allowed tunnel domain).
  if (!hostAllowed(req.headers.host || "")) {
    res.writeHead(403, { "Content-Type": "text/plain" }); res.end("bad host"); return
  }
  // PUBLIC READ access to delivered sites (preview + assets): a site can be opened WITHOUT a
  // password (it is meant to be shown to the prospect). The cockpit UI + every API stay protected.
  const reqPath0 = (req.url || "/").split("?")[0]
  // + tracking /t/c|u/<token>, ALL methods: one-click unsubscribe (RFC 8058) arrives as a POST from the
  // Gmail/Yahoo servers or from the confirmation page, never authenticated; the signed token is the proof and
  // the endpoint itself refuses anything unexpected (405, 400, 403: see outreach/tracking/endpoint.ts).
  const publicRO = ((req.method === "GET" || req.method === "HEAD") && /^\/(preview|thumb|avant|asset|font|designfont|tpl|data\/assets|t)\//.test(reqPath0))
    || /^\/t\/[cu]\/[^/]*$/.test(reqPath0)
  // auth: if a password is configured (shared tunnel mode), require it — EXCEPT on these public paths.
  if (!publicRO && !authOk(req)) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="lastwebstudios station"', "Content-Type": "text/plain" })
    res.end("auth requise"); return
  }
  // anti-CSRF: a third-party page can POST as a "simple request". On every mutating method we require
  // a loopback Origin OR the allowed host (curl/tools without an Origin pass).
  if (req.method && req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.origin
    if (origin) {
      let oh = ""; try { oh = new URL(origin).host } catch { /* malformed origin */ }
      if (!hostAllowed(oh)) { res.writeHead(403, { "Content-Type": "text/plain" }); res.end("bad origin"); return }
    }
  }
  const url = new URL(req.url || "/", `http://${HOST}`)
  const path = url.pathname

  // ── SELF-HOSTED outreach tracking (public, in the emails): signed click + RFC 8058 unsubscribe (F-3 fixed).
  // Events go to outreach_events (database) or data/sequencer/events.jsonl; the sequencer ingests them on its tick
  // (click → unlocks the escalation, unsubscribe → drop). See outreach/tracking/README.md.
  if (path.startsWith("/t/")) {
    return handleTracking(req, res, path, { onEvent: (e, stored) => { if (stored !== "capped") broadcast({ type: "machine", stage: "sell", event: e.type }) } })
  }

  // the real builds shipped in examples/ (« See a real build » next to a demo stand-in) : /example/ opens the first one,
  // /example/<name>/… serves examples/<name>/site/ read-only
  if (path === "/example" || path.startsWith("/example/")) {
    const rest = path.slice("/example/".length)
    const names = existsSync("examples") ? (await readdir("examples")).filter((d) => existsSync(join("examples", d, "site", "index.html"))).sort() : []
    if (!rest) return names.length ? redirectTo(res, `/example/${names[0]}/`) : sendJson(res, { error: "no example in this folder" }, 404)
    const [name, ...file] = rest.split("/")
    if (!names.includes(name)) return sendJson(res, { error: "not found" }, 404)
    const target = safeUnder(join("examples", name, "site"), file.join("/") || "index.html")
    if (!target) return sendJson(res, { error: "bad path" }, 400)
    const f = existsSync(target) && isDir(target) ? join(target, "index.html") : target
    return existsSync(f) ? sendFile(res, f, req) : sendJson(res, { error: "not found" }, 404)
  }
  // /old/<id>/… : a FICTIONAL business's old site (its .example address resolves nowhere) served from this machine : the
  // dated site the demo keeps for it (data/old-sites/<id>/), else the old site drawn from its sheet (the same page the
  // « before » capture was taken from). A real business's link goes to its real address, never here.
  if (path.startsWith("/old/")) {
    const [rawId, ...rest] = path.slice("/old/".length).split("/")
    const id = decodeURIComponent(rawId || "")
    if (!validProspectId(id)) return sendJson(res, { error: "bad id" }, 400)
    const kept = join("data", "old-sites", id)
    if (existsSync(join(kept, "index.html"))) {
      const target = safeUnder(kept, rest.join("/") || "index.html")
      if (!target) return sendJson(res, { error: "bad path" }, 400)
      const f = existsSync(target) && isDir(target) ? join(target, "index.html") : target
      return existsSync(f) ? sendFile(res, f, req) : sendJson(res, { error: "not found" }, 404)
    }
    if (rest.join("/") && rest.join("/") !== "index.html") return sendJson(res, { error: "not found" }, 404)
    let sheet: any = await readSheet(id)
    if (!sheet) { try { const r = await getDb().prepare("SELECT sheet_json FROM prospects WHERE id=?").get(id) as any; if (r?.sheet_json) sheet = JSON.parse(r.sheet_json) } catch { /* */ } }
    if (!sheet || !RESERVED_HOST.test(String(sheet.existing?.url || ""))) return sendJson(res, { error: "not found" }, 404)
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", ...NOSNIFF })
    res.end(renderOldSite(sheet, prospectLang(sheet, agency().language || "en"))); return
  }
  // live previews of built sites (relative assets → root = the site's folder)
  if (path.startsWith("/preview/")) {
    const rel = path.slice("/preview/".length)
    const target = safeUnder(SITES, rel)
    if (!target) return sendJson(res, { error: "bad path" }, 400)
    // the agency's own marks next to a site (.lws-taste.json : the owner's preferences, .lws-demo…) are never public
    if (/(^|\/)\.lws-[^/]*$/.test(rel)) return sendJson(res, { error: "not found" }, 404)
    // ZERO raw "Not found": if the main PAGE (index.html / folder) is still missing
    // (site being built), serve a styled placeholder instead of the raw 404.
    const isMainPage = rel.endsWith("/") || rel.endsWith("index.html") || !extname(rel)
    if (isMainPage && !existsSync(join(target, "index.html")) && !(existsSync(target) && !isDir(target))) {
      // not local: if the PAGE exists in the BUCKET (site composed on another machine), SERVE it
      // from there instead of wrongly showing "being built". Otherwise (really not built) → placeholder.
      // ⚠ Supabase FORCES `text/plain` on uploaded HTML (anti-XSS) → if we 302 to the bucket, the
      // browser shows the SOURCE + broken accents. So we PROXY the page with the right Content-Type.
      // (Assets — images/videos/fonts — keep the 302 below: the bucket serves them correctly.)
      const key = "sites/" + (rel.endsWith("index.html") ? rel : rel.replace(/\/?$/, "/index.html"))
      if (storageBase() && await storageExists(key)) {
        try {
          const up = await fetch(urlFor(key))
          if (up.ok) {
            const buf = Buffer.from(await up.arrayBuffer())
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" })
            res.end(buf); return
          }
        } catch { /* bucket unreachable → fall back to the 302 */ }
        return redirectTo(res, urlFor(key))
      }
      return sendPreviewPlaceholder(res)
    }
    // STORAGE fallback: a site asset missing locally (gitignored, e.g. hero.mp4 on the VM) → 302 to the
    // bucket → the video/asset still PLAYS. Local wins (offline preview = ZERO regression).
    if (!isMainPage && !existsSync(target) && storageBase()) {
      return redirectTo(res, urlFor("sites/" + rel))
    }
    return sendFile(res, target, req)
  }
  // template previews
  if (path.startsWith("/tpl/")) {
    const target = safeUnder(TEMPLATES, path.slice("/tpl/".length))
    return target ? sendFile(res, target) : sendJson(res, { error: "bad path" }, 400)
  }
  // fonts (UI + lab specimens) — video foundry
  if (path.startsWith("/font/")) {
    const target = safeUnder(FONTS, path.slice("/font/".length))
    return target ? sendFile(res, target) : sendJson(res, { error: "bad path" }, 400)
  }
  // design font library (Host Grotesk for the UI body, Geist…)
  if (path.startsWith("/designfont/")) {
    const target = safeUnder(DESIGN_FONTS, path.slice("/designfont/".length))
    return target ? sendFile(res, target) : sendJson(res, { error: "bad path" }, 400)
  }
  // "before" capture (the prospect's real original site) → before/after comparison
  if (path.startsWith("/avant/")) {
    const id = path.slice("/avant/".length).split("/")[0]
    // ?m=1 : their old site on a phone, when it was captured there (never the desktop one passed off as a phone's)
    if (url.searchParams.get("m") === "1") {
      const m = safeUnder(DATA_ASSETS, `${id}/avant.mobile.png`)
      return m && existsSync(m) ? sendFile(res, m, req) : sendJson(res, { error: "no phone capture" }, 404)
    }
    const target = safeUnder(DATA_ASSETS, `${id}/avant.png`)
    if (!target) return sendJson(res, { error: "bad path" }, 400)
    if (existsSync(target)) return sendFile(res, target, req)        // local first (offline = zero regression)
    const drawn = safeUnder(DATA_ASSETS, `${id}/avant.svg`)          // sandbox without a browser: the drawing of the old site
    if (drawn && existsSync(drawn)) return sendFile(res, drawn, req)
    if (storageBase()) return redirectTo(res, urlFor(`prospects/${id}/avant.png`)) // otherwise the bucket (durable source)
    return sendAvantPlaceholder(res)                                 // never a broken image
  }
  // is there a "before" capture? (light check, zero body — the cockpit hides the
  // before/compare tabs when there is none, instead of showing an error message).
  if (path.startsWith("/has-avant/")) {
    const id = path.slice("/has-avant/".length).split("/")[0]
    const target = safeUnder(DATA_ASSETS, `${id}/avant.png`)
    if (target && existsSync(target)) return sendJson(res, { exists: true })
    if (existsSync(join(DATA_ASSETS, id.replace(/[^a-z0-9._-]/gi, ""), "avant.svg"))) return sendJson(res, { exists: true })
    return sendJson(res, { exists: storageBase() ? await storageExists(`prospects/${id}/avant.png`) : false })
  }
  // A site's THUMBNAIL: the BEST STATIC capture (instant, crisp) — for the overview.
  // Otherwise the grid would load 100+ live iframes (slow + scroll-reveal = empty tiles). /thumb/<id>/<date>.
  if (path.startsWith("/thumb/")) {
    const parts = path.slice("/thumb/".length).split("/")
    const dir = siteDir(parts[0], parts[1] || "")
    if (dir) {
      for (const name of ["_thumb.png", "_after.png", "_full.png", "_verify.png", "after.png"]) {
        const f = join(dir, name); if (existsSync(f)) return sendFile(res, f, req)
      }
    }
    const av = safeUnder(DATA_ASSETS, `${parts[0]}/avant.png`) // fallback: the real original site
    if (av && existsSync(av)) return sendFile(res, av, req)
    const avSvg = safeUnder(DATA_ASSETS, `${parts[0]}/avant.svg`)
    if (avSvg && existsSync(avSvg)) return sendFile(res, avSvg, req)
    // STORAGE fallback (cockpit container = built from git, captures are gitignored → always through the bucket).
    // We CHECK it exists before redirecting (otherwise a broken img): capture of the new site, failing that
    // the "before" capture (the original site) — better than an empty thumbnail.
    if (storageBase() && parts[1]) {
      if (await storageExists(`sites/${parts[0]}/${parts[1]}/_after.png`)) return redirectTo(res, urlFor(`sites/${parts[0]}/${parts[1]}/_after.png`))
      if (await storageExists(`prospects/${parts[0]}/avant.png`)) return redirectTo(res, urlFor(`prospects/${parts[0]}/avant.png`))
    }
    return sendJson(res, { error: "no thumb" }, 404)
  }
  // a prospect's source assets (photos, logo, video) → gallery + swap. Video with Range (req passed).
  if (path.startsWith("/asset/")) {
    const target = safeUnder(DATA_ASSETS, path.slice("/asset/".length))
    return target ? sendFile(res, target, req) : sendJson(res, { error: "bad path" }, 400)
  }
  // composer sites reference photos by relative disk path (../../../../data/assets/<id>/…),
  // which resolves to /data/assets/… once served by the cockpit. We serve it (otherwise ALL the images
  // of these sites are broken: voids + visible alt). Fixes every composer site at once.
  if (path.startsWith("/data/assets/")) {
    const target = safeUnder(DATA_ASSETS, path.slice("/data/assets/".length))
    return target && existsSync(target) ? sendFile(res, target, req) : sendJson(res, { error: "not found" }, 404)
  }
  // the old outreach platform (/outreach, /sales) now lives INSIDE the app: Pipeline tab. Old links follow.
  if (/^\/(outreach|sales)(\/.*)?$/.test(path)) return redirectTo(res, "/#pipeline")

  // ---- API ----
  if (path === "/api/sites") return sendJson(res, await listSites())
  // « What the agency learned » : preferences, picks, words (learning.ts)
  if (await learningRoute(req, res, path, url)) return

  const loadSeqState = loadSeqStateAll

  // ════ THE 24/7 CAGE: STOP, daily budget, circuit breaker, sending mode (Station banner + /outreach/) ════
  if (path === "/api/cage" && req.method === "GET") return sendJson(res, await cageStatus())
  // POST /api/cage/stop {on, reason} → sets / lifts the emergency stop (shared database: the box sees it; otherwise a STOP file)
  if (path === "/api/cage/stop" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body || typeof body.on !== "boolean") return sendJson(res, { error: "expected {on: true|false, reason?}" }, 400)
    const st = await setStop(body.on, typeof body.reason === "string" ? body.reason : "", AUTH_USER)
    if (st.on !== body.on) return sendJson(res, { error: "Stop was not saved (database unavailable?)", stop: st }, 503)
    broadcast({ type: "cage" })
    return sendJson(res, { ok: true, stop: st })
  }
  // POST /api/cage/breaker/reset → HUMAN re-arm of the circuit breaker (earlier incidents no longer count)
  if (path === "/api/cage/breaker/reset" && req.method === "POST") {
    const st = resetBreaker(await loadBreaker(), new Date().toISOString())
    await saveBreaker(st)
    broadcast({ type: "cage" })
    return sendJson(res, { ok: true, breaker: st })
  }
  // ════ HOME: the entrepreneur's 5 places (prospects, sites, outreach, calls, clients), as outcome numbers ════
  if (path === "/api/home") return sendJson(res, await homeSnapshot())

  // ════ MACHINE VIEW: the film's 7 stages, counters + latest event (DB or disk) ════
  if (path === "/api/machine") return sendJson(res, await machineSnapshot())

  // ════ SEQUENCES: the cold-email sequencer's state (dry-run) — to SEE the machine run ════
  if (path === "/api/sequences") {
    const state: any[] = await loadSeqState()
    let sends: any[] = []
    try {
      if (existsSync("data/sequencer/sends.jsonl"))
        sends = (await readFile("data/sequencer/sends.jsonl", "utf8")).split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    } catch { /* vide */ }
    let steps: any[] = []
    try { steps = JSON.parse(await readFile("outreach/sequencer/config.json", "utf8")).steps || [] } catch { /* default */ }
    const rows: any[] = []
    for (const s of state) {
      let name = s.prospectId
      let mails: any[] = []
      try { const f = `data/prospects/${s.prospectId}.json`; if (existsSync(f)) name = JSON.parse(await readFile(f, "utf8"))?.identity?.name || s.prospectId } catch { /* nom brut */ }
      try { const p = `data/personas/${s.prospectId}.json`; if (existsSync(p)) mails = JSON.parse(await readFile(p, "utf8")).personas || [] } catch { /* no personas */ }
      rows.push({ ...s, name, mails })
    }
    const by = (st: string) => state.filter((s) => s.status === st).length
    // events (tracking, reply reader) + circuit breaker: the state saved by the sequencer, otherwise evaluated
    // here on the local files (same machine), so incidents show before the next tick
    const events = await readEvents().catch(() => [])
    let cfgBreaker: any = null
    try { cfgBreaker = JSON.parse(await readFile("outreach/sequencer/config.json", "utf8")).breaker || null } catch { /* defaults */ }
    const stored = await loadBreaker()
    const now = new Date().toISOString()
    const breaker = stored?.open ? stored : (sends.length || events.length ? evaluateBreaker({ sends, events, now, prev: stored, thresholds: cfgBreaker }) : stored)
    const ev = (t: string) => events.filter((e) => e.type === t && !e.suspect).length
    const stats = { total: state.length, active: by("active"), waitingContent: by("waiting-content"), replied: by("replied"), done: by("done"), dropped: by("dropped"), nurturing: by("nurturing"), sends: sends.length,
      clicks: ev("click"), unsubs: ev("unsub"), bounces: ev("bounce"), complaints: ev("complaint"), scannerClicks: events.filter((e) => e.type === "click" && e.suspect).length }
    return sendJson(res, { sequences: rows, sends, steps, stats, breaker, cage: await cageStatus() })
  }

  // GET /api/sequences/emails?id=<prospect> → the emails the sequence wrote to them, readable : subject, body and the
  // legal footer, from the very message written (data/sequencer/outbox/*.eml : what went out, or would have in test mode)
  if (path === "/api/sequences/emails") {
    const id = url.searchParams.get("id") || ""
    if (!validProspectId(id)) return sendJson(res, { error: "bad id" }, 400)
    let sends: any[] = []
    try { if (existsSync("data/sequencer/sends.jsonl")) sends = (await readFile("data/sequencer/sends.jsonl", "utf8")).split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter((x) => x && x.prospectId === id) } catch { /* */ }
    let steps: any[] = []
    try { steps = JSON.parse(await readFile("outreach/sequencer/config.json", "utf8")).steps || [] } catch { /* */ }
    const LABEL: Record<string, string> = { savior: "First email", demo: "Personal demo", seo: "SEO article", contenu: "Personal content" }
    let files: string[] = []; try { files = existsSync("data/sequencer/outbox") ? await readdir("data/sequencer/outbox") : [] } catch { /* */ }
    const win = sendWindow()
    const emails: any[] = []
    for (const [i, x] of sends.entries()) {
      const f = files.find((n) => x.trackingId && n.includes(x.trackingId))
      const m = f ? parseEml(await readFile(join("data/sequencer/outbox", f), "utf8").catch(() => "")) : null
      const src = steps.find((st: any) => st.id === x.step)?.source || ""
      emails.push({ n: i + 1, step: x.step, label: LABEL[src] || String(x.step || "").replace(/-/g, " "), at: x.at, atLabel: wallLabel(Date.parse(x.at), win), test: !!x.dryRun,
        from: m?.from || x.inbox || "", to: m?.to || x.to || "", subject: m?.subject || x.subject || "", body: m?.body == null ? null : readableLinks(m.body, id), footer: m?.footer == null ? null : readableLinks(m.footer, id) })
    }
    return sendJson(res, { id, total: steps.length, emails })
  }

  // ════ BILLING: built-in invoicing tool (JSON store data/invoices/, see invoices.ts) ════
  if (path === "/api/invoice-settings") {
    if (req.method === "POST") {
      const b = await parseBody(req); if (!b || typeof b !== "object" || Array.isArray(b)) return sendJson(res, { error: "bad json" }, 400)
      if (typeof b.name === "string" && !b.name.trim()) return sendJson(res, { error: "Your business name can't be empty.", field: "name" }, 400)
      // what cannot be right is refused for its field (never « Saved. » over a SIRET « abc » or a javascript: link)
      const bad = sellerFieldProblem(b as Record<string, unknown>); if (bad) return sendJson(res, bad, 400)
      const patch = Object.fromEntries(Object.entries(b).filter(([k, v]) => !k.startsWith("_") && (typeof v === "string" || v == null)).map(([k, v]) => [k, String(v ?? "").trim()]))
      const saved = await saveSettings(patch as Record<string, unknown>)
      return sendJson(res, { ...saved, _demo: demoSellerKeys(saved), sandbox: process.env.LWS_SANDBOX === "1" })
    }
    // the fields still holding a demo studio's value are named (_demo) : Your business shows them empty, to be replaced
    // (in the demo itself, its fictional business is complete : a demo invoice prints whole)
    const s = await getSettings()
    return sendJson(res, { ...s, _demo: demoSellerKeys(s), sandbox: process.env.LWS_SANDBOX === "1" })
  }
  if (path === "/api/invoices") {
    if (req.method === "POST") {
      const b = await parseBody(req); if (!b) return sendJson(res, { error: "bad json" }, 400)
      const bad = invoiceProblem(b); if (bad) return sendJson(res, { error: bad }, 400)
      // a document a client receives never carries a placeholder nor the demo studio's details : yours first (Billing › Your business)
      const sp = sellerProblem(await getSettings()); if (sp) return sendJson(res, { error: sp, seller: true }, 400)
      return sendJson(res, await createInvoice(b, new Date().toISOString()))
    }
    return sendJson(res, (await listWithCancels()).map((i) => ({ ...withTotals(i), cancelledBy: (i as any).cancelledBy })))
  }
  if (path.startsWith("/api/invoices/")) {
    const parts = path.split("/")
    const invId = parts[3] || ""
    // LEGAL cancellation of an issued invoice: POST /api/invoices/<no.>/avoir → a negative credit note (never a deletion);
    // one per invoice, never on a draft (refused with the reason, 409)
    if (req.method === "POST" && parts[4] === "avoir") {
      const why = await avoirProblem(invId)
      if (why) return sendJson(res, { error: why }, /not found/i.test(why) ? 404 : 409)
      const av = await createAvoir(invId, new Date().toISOString())
      return av ? sendJson(res, av) : sendJson(res, { error: (await avoirProblem(invId)) || "Not created" }, 409)
    }
    // DELETE /api/invoices/<n°> : only the last number of its year, still a draft (the sequence never gets a hole)
    if (req.method === "DELETE") {
      const why = await deleteProblem(invId)
      if (why) return sendJson(res, { error: why }, /not found/i.test(why) ? 404 : 409)
      await deleteInvoice(invId)
      return sendJson(res, { ok: true })
    }
    if (req.method === "POST") { const b = await parseBody(req); if (!b) return sendJson(res, { error: "bad json" }, 400); const up = await updateInvoice(invId, b); return up ? sendJson(res, up) : sendJson(res, { error: "Not found" }, 404) }
    const inv = await getInvoice(invId); return inv ? sendJson(res, inv) : sendJson(res, { error: "Not found" }, 404)
  }
  if (path.startsWith("/facture/") || path.startsWith("/invoice/")) {
    const inv = await getInvoice(path.split("/")[2] || "")
    if (!inv) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Invoice not found"); return }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...NOSNIFF })
    res.end(renderInvoiceHtml(inv, await getSettings())); return
  }

  // ════ LEAD PIPE: the prospects in the pool (scoring, industries) to analyse/sort/scrape ════
  // DB first (shared index); without a DB (fresh clone, local mode), DISK FALLBACK: the data/prospects sheets.
  if (path === "/api/leads") {
    let rows: any[] = []
    if (!tryDb()) rows = await listLeadsFs()
    else try {
      rows = await getDb().prepare(`
        SELECT p.id, p.name, p.city, p.industry, p.opp_score AS "oppScore", p.opp_tier AS "oppTier",
               p.existing_url AS "oldUrl",
               COALESCE(substring(p.sheet_json from '"identity"\\s*:\\s*\\{[^{}]*"state"\\s*:\\s*"([^"]{1,40})"'), '') AS region,
               COALESCE(substring(p.sheet_json from '"identity"\\s*:\\s*\\{[^{}]*"zip"\\s*:\\s*"([^"]{1,12})"'), '') AS zip,
               EXISTS(SELECT 1 FROM generations g WHERE g.prospect_id = p.id AND g.present = 1) AS "hasSite"
        FROM prospects p
        ORDER BY p.opp_score DESC NULLS LAST, p.name ASC
        LIMIT 2000
      `).all() as any[]
    } catch { /* no DB → empty pool */ }
    const byInd: Record<string, { industry: string; count: number; sum: number; withSite: number }> = {}
    for (const r of rows) {
      const k = r.industry || "?"
      const b = byInd[k] || (byInd[k] = { industry: k, count: 0, sum: 0, withSite: 0 })
      b.count++; b.sum += Number(r.oppScore) || 0; if (r.hasSite) b.withSite++
    }
    const industries = Object.values(byInd)
      .map((x) => ({ industry: x.industry, count: x.count, avg: x.count ? Math.round(x.sum / x.count) : 0, withSite: x.withSite }))
      .sort((a, b) => b.count - a.count)
    return sendJson(res, { prospects: rows.map((r) => ({ ...r, hasSite: !!r.hasSite })), industries, total: rows.length })
  }

  // outreach email drafts — from the sheet (DB) ENRICHED with the VERIFIED record (`npm run outreach`).
  // The agent (claude.ai session) creates the REAL Gmail drafts; this endpoint serves the preview + the verified
  // contact (real email + source + phone + draft status) so the operator knows who it goes to.
  if (path === "/api/outreach") {
    const id = url.searchParams.get("id") || ""
    if (!id) return sendJson(res, { error: "no id" }, 400)
    let fiche: any = {}
    try { const r = await getDb().prepare("SELECT sheet_json FROM prospects WHERE id=?").get(id) as any; if (r?.sheet_json) fiche = JSON.parse(r.sheet_json) } catch { /* no DB/sheet → generic drafts */ }
    // verified outreach record (real scraped email + composed draft + Gmail draft status)
    let rec: any = null
    if (/^[\w-]+$/.test(id)) { try { const p = join("data", "outreach", `${id}.json`); if (existsSync(p)) rec = JSON.parse(await readFile(p, "utf8")) } catch { /* no record */ } }
    const name = rec?.name || fiche?.identity?.name || id
    const old = rec?.oldUrl || fiche?.existing?.url || ""
    const accroche = fiche?.score?.accroche || ""
    const email = rec?.to || fiche?.identity?.email || ""
    const phone = rec?.phone || fiche?.identity?.phone || ""
    const emailVerified = rec ? !!rec.emailVerified : !!fiche?.identity?.emailVerified
    const emailSource = rec?.emailSource || (emailVerified ? fiche?.identity?.emailSource : "") || ""
    const drafts = [
      ...(rec?.subject && rec?.body ? [{ label: "Verified (prepared)", subject: rec.subject, body: rec.body }] : []),
      { label: "Direct", subject: `${name} - j'ai refait votre site`, body: `Bonjour,\n\n${accroche || `Je suis tombé sur le site de ${name} et je trouve qu'il mérite mieux.`}\n\nJ'en ai fait une nouvelle version, gratuitement, juste pour vous montrer. Aperçu : [lien de votre nouveau site]\n${old ? `(votre site actuel : ${old})\n` : ""}\nSi ça vous plaît, je vous l'installe. Vous voulez y jeter un oeil ?\n\nBien à vous,\n[Votre nom] - ${agency().mail.signature}` },
      { label: "Short", subject: `Une refonte pour ${name}`, body: `Bonjour,\n\nJ'ai redessiné le site de ${name} - aperçu ici : [lien].\n\nIntéressé ? Je vous le mets en ligne en un clic.\n\n[Votre nom]` },
    ]
    return sendJson(res, { id, name, email, phone, emailSource, emailVerified, ready: rec?.ready ?? null, skipReason: rec?.skipReason ?? "", draftStatus: rec?.status ?? null, gmailDraftId: rec?.gmailDraftId ?? null, drafts })
  }

  // the agency's public identity (agency.config.json) for the call scripts and the UI's drafts
  // ════ PROSPECTS: the engine's output, in the entrepreneur's words (why picked, state, current site) ════
  if (path === "/api/prospects") return sendJson(res, await prospectsList())
  // POST /api/prospects/skip {id, on} → skips (or restores) a prospect; state on disk, never in the sheet
  if (path === "/api/prospects/skip" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body || !validProspectId(body.id)) return sendJson(res, { error: "bad id" }, 400)
    const st = await readPState()
    const on = body.on !== false
    st.skipped = (st.skipped || []).filter((x: string) => x !== body.id); if (on) st.skipped.push(body.id)
    await writePState(st)
    broadcast({ type: "prospects" })
    return sendJson(res, { ok: true, skipped: on })
  }
  // POST /api/brief {text} → what the agency understood (trades, place, country, count, mix). The live preview is
  // ALWAYS the deterministic parser: free and instant, no model call while the owner types (the skill runs at Find)
  if (path === "/api/brief" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body || typeof body.text !== "string") return sendJson(res, { error: "expected {text}" }, 400)
    const b = parseBrief(body.text.slice(0, 500))
    if (b.mix && !b.trades.length) b.trades = await pickMix(4, b.country)
    return sendJson(res, b)
  }
  // POST /api/prospects/find {text | trades, place, country, count, mix} → a `find` job (the engine runs it)
  if (path === "/api/prospects/find" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body || typeof body !== "object" || Array.isArray(body)) return sendJson(res, { error: "bad json" }, 400)
    // the database first : a job that cannot be queued must never cost a model call
    if (!tryDb()) return sendJson(res, { error: noDbReason(), noDb: true }, 503)
    const st0 = await stopState().catch(() => null)
    if (st0?.on) return sendJson(res, { error: "Paused — resume to run", paused: true }, 409)
    let brief: any = null
    if (typeof body.text === "string" && body.text.trim()) brief = await interpretBrief(body.text.slice(0, 500))
    else if (Array.isArray(body.trades) || typeof body.place === "string") brief = validateBrief(body)
    if (!brief) return sendJson(res, { error: "Tell the agency what you're after" }, 400)
    if (brief.error) return sendJson(res, { error: brief.error, brief }, 400)
    if (brief.mix && !brief.trades.length) brief.trades = await pickMix(4, brief.country)
    if (!brief.trades.length && !brief.place) return sendJson(res, { error: "Say a trade or a place" }, 400)
    try { // the same search already queued or running → say so
      const live = (await listBatches(30)).filter((b) => b.mode === "find" && (b.status === "queued" || b.status === "running"))
      const key = (x: any) => `${[...(x.trades || [])].sort().join(",")}|${(x.place || "").toLowerCase()}|${x.country}|${x.count}`
      const same = live.find((b) => { try { return key(JSON.parse(b.params_json || "{}")) === key(brief) } catch { return false } })
      if (same) return sendJson(res, { ok: true, duplicate: true, id: same.id, brief, message: "Already looking for that" })
    } catch { /* */ }
    try {
      const row = await enqueueBatch({ mode: "find" as BatchMode, industry: brief.trades[0] || null, lim: brief.count, requestedBy: AUTH_USER, note: (typeof body.text === "string" ? body.text : `${brief.trades.join(", ")} ${brief.place}`).slice(0, 200), ids: null, params: { brief: typeof body.text === "string" ? body.text.slice(0, 500) : "", ...brief } })
      broadcast({ type: "batches" }); kickEngine()
      return sendJson(res, { ok: true, id: row.id, brief })
    } catch (e) { return sendJson(res, { error: String((e as Error).message) }, 500) }
  }
  // GET /api/trades → key → label in the agency's language (the cockpit never shows a raw key)
  if (path === "/api/trades") {
    const { INDUSTRIES, normalizeIndustry } = await import("../../leadengine/1_scraping/scripts/industries.ts")
    // ?q=<anything the owner typed> → the engine's key + English label (or 404 when it is not a trade the engine knows)
    const q = url.searchParams.get("q")
    if (q !== null) { const k = normalizeIndustry(q); const v = INDUSTRIES[k] as any; return v ? sendJson(res, { key: k, label: v.en?.label || v.label }) : sendJson(res, { error: `Unknown trade: ${q}` }, 404) }
    // the cockpit's UI is English: the English label whenever the engine has one
    return sendJson(res, Object.fromEntries(Object.entries(INDUSTRIES).map(([k, v]: [string, any]) => [k, v.en?.label || v.label])))
  }
  // GET /api/jobs → running / queued / just finished jobs for the job strip
  if (path === "/api/jobs") return sendJson(res, await jobsView())
  // POST /api/crm/ask {id, ask} → a follow-up email or a call angle from the prospect's facts (smart prompt place).
  // Checked BEFORE any model call: a database (the CRM), a lead that exists, the agency not stopped, and never an email
  // drafted for someone who unsubscribed or complained (a call angle stays possible)
  if (path === "/api/crm/ask" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body || !validProspectId(body.id) || typeof body.ask !== "string" || !body.ask.trim()) return sendJson(res, { error: "expected {id, ask}" }, 400)
    if (!tryDb()) return sendJson(res, { error: noDbReason(), noDb: true }, 503)
    let sheet: any = await readSheet(body.id)
    if (!sheet) { try { const r = await getDb().prepare("SELECT sheet_json FROM prospects WHERE id=?").get(body.id) as any; if (r?.sheet_json) sheet = JSON.parse(r.sheet_json) } catch { /* */ } }
    if (!sheet) return sendJson(res, { error: "No prospect with that id" }, 404)
    { const sp = await stopState().catch(() => null); if (sp?.on) return sendJson(res, { error: "Stopped — resume to ask the agent", paused: true }, 409) }
    const name = sheet.identity?.name || body.id
    let wantsEmail = /e-?mail|mail|follow|relance|courriel/i.test(body.ask)
    let note = ""
    if (wantsEmail) {
      const seq = (await loadSeqState().catch(() => [])).filter((x: any) => x.prospectId === body.id).pop()
      const why = seq?.stoppedBy?.type
      if (why === "unsub" || why === "complaint") return sendJson(res, { error: `${name} ${why === "unsub" ? "unsubscribed" : "reported your email as spam"}: no more emails to them. A call angle is still fine.`, optedOut: true }, 409)
      // no address to write to : never an email nobody can receive, a call angle instead (said, not hidden)
      const rec = await readOutreach(body.id).catch(() => null)
      if (!sheet.identity?.email && !rec?.to) {
        wantsEmail = false
        note = sheet.identity?.phone ? `No email address for ${name}: here is a call angle instead.` : `No email address and no phone for ${name}: find a contact first. Here is what to say once you have one.`
      }
    }
    const ask = wantsEmail ? body.ask : "a call angle for the phone"
    // what is said to the prospect is in THEIR language (a US business in English), else the agency's
    const lang = prospectLang(sheet, agency().language || "en")
    if (process.env.LWS_SANDBOX === "1") {
      // the sandbox writes from the engine's codes (insights.ts): the count it says is the count it lists
      await new Promise((r) => setTimeout(r, 1200))
      const a = agency() as any
      return sendJson(res, { ok: true, text: simulatedAsk({ ...sheet, identity: { ...(sheet.identity || {}), name } }, wantsEmail ? body.ask : ask, a.brand?.expediteur ? `${a.brand.expediteur}, ${a.name}` : a.name || "", lang), simulated: true, ...(note ? { note } : {}) })
    }
    try {
      const { runSkill } = await import("../../packages/utils/run-skill.ts")
      const r = await runSkill(".claude/skills/generate-savior", { prospect: sheet, ask: ask.slice(0, 500) }, "smart", 2000)
      return sendJson(res, { ok: true, text: typeof r === "string" ? r : (r.text || r.body || JSON.stringify(r)), ...(note ? { note } : {}) })
    } catch (e) {
      console.warn(`ask: ${(e as Error).message.slice(0, 300)}`)
      return sendJson(res, { error: "The agent could not answer. `npm run doctor` says what is missing." }, 502)
    }
  }
  // POST /api/agency/brand {text} → stored in agency config `brand.team` (what the agency says about itself)
  if (path === "/api/agency/brand" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body || typeof body.text !== "string") return sendJson(res, { error: "expected {text}" }, 400)
    const file = agencyFile()
    if (!body.text.replace(/<[^>]*>/g, "").trim()) return sendJson(res, { error: "This paragraph can't be empty: it goes in your emails.", field: "brand" }, 400)
    // saved in YOUR agency file (agency.config.json, created from the demo one on first save) : a shipped example is never written
    const target = join(process.cwd(), "agency.config.json")
    try {
      const j = JSON.parse(await readFile(file && existsSync(file) ? file : target, "utf8"))
      j.brand = { ...(j.brand || {}), team: body.text.replace(/<[^>]*>/g, "").trim().slice(0, 1200) }
      await writeFile(target, JSON.stringify(j, null, 2) + "\n")
      process.env.LWS_AGENCY_CONFIG = target; clearAgencyCache()
      return sendJson(res, { ok: true, team: j.brand.team })
    } catch (e) { return sendJson(res, { error: String((e as Error).message) }, 500) }
  }
  // POST /api/budget {usdDay} → the daily limit (LWS_BUDGET_USD_DAY in .env, live at once) : what Hands-off and every
  // unattended build stay under. Raising or setting it is the owner's own act ; it is never removed from here.
  // POST /api/budget {buildsDay} → the daily cap in BUILDS (LWS_BUILDS_PER_DAY), what a subscriber understands ;
  // {usdDay} → the daily limit in $ of plan usage (LWS_BUDGET_USD_DAY). Raising or setting it is the owner's own act.
  if (path === "/api/budget" && req.method === "POST") {
    const body = await parseBody(req)
    if (body?.buildsDay !== undefined) {
      const n = Number(body.buildsDay)
      if (!Number.isInteger(n) || n < 1 || n > 200) return sendJson(res, { error: "A daily cap between 1 and 200 builds.", field: "buildsDay" }, 400)
      try { await setEnvVar("LWS_BUILDS_PER_DAY", String(n)) } catch (e) { return sendJson(res, { error: `.env not writable: ${(e as Error).message}` }, 500) }
      broadcast({ type: "cage" })
      return sendJson(res, { ok: true, buildsCap: n, builds: buildsStatus() })
    }
    const usd = Number(body?.usdDay)
    if (!Number.isFinite(usd) || usd < 1 || usd > 1000) return sendJson(res, { error: "A daily limit between $1 and $1,000.", field: "usdDay" }, 400)
    const v = String(Math.round(usd * 100) / 100)
    try { await setEnvVar("LWS_BUDGET_USD_DAY", v) } catch (e) { return sendJson(res, { error: `.env not writable: ${(e as Error).message}` }, 500) }
    broadcast({ type: "cage" })
    return sendJson(res, { ok: true, capUsd: Number(v), builds: buildsStatus() })
  }
  // GET/POST /api/automatic → good-fit prospects go to build without your validation
  if (path === "/api/automatic") {
    const st = await readPState()
    if (req.method === "POST") {
      const body = await parseBody(req)
      if (!body || typeof body.on !== "boolean") return sendJson(res, { error: "expected {on: true|false}" }, 400)
      // unattended builds never run without a ceiling : no daily limit → Hands-off asks for one first
      if (body.on && buildsCap().cap == null) return sendJson(res, { error: "Set a daily cap first: Hands-off never builds without one.", needsCap: true }, 409)
      st.automatic = body.on
      if (body.on) st.autoSince = Date.now() // existing cards are never built by the toggle : only what the next searches bring
      let canceled = 0
      if (!body.on && tryDb()) { // off = cancel the auto-queued builds still waiting
        try { canceled = (await getDb().prepare("UPDATE batch_requests SET status='canceled', finished_at=? WHERE status='queued' AND requested_by IN ('hands-off','automatic') RETURNING id").all(Date.now()) as any[]).length } catch { /* */ }
      }
      await writePState(st)
      broadcast({ type: "prospects" }); broadcast({ type: "batches" })
      return sendJson(res, { automatic: !!st.automatic, canceled })
    }
    return sendJson(res, { automatic: !!st.automatic })
  }

  // ════ CONNECT YOUR AGENT: who takes over after approval (data/agent.json, never committed) ════
  //   sequencer (default): the built-in sequencer (dry-run until both switches are set)
  //   webhook            : on each approval, POST {prospect, site, script} to the URL (HMAC-signed if LWS_TRACK_SECRET)
  //   manual             : nothing automatic
  if (path === "/api/agent") {
    if (req.method === "POST") {
      const body = await parseBody(req)
      if (!body || typeof body !== "object" || Array.isArray(body)) return sendJson(res, { error: "bad json" }, 400)
      const mode = String(body.mode || "")
      if (!["sequencer", "webhook", "manual"].includes(mode)) return sendJson(res, { error: "Pick what happens when you approve a site" }, 400)
      let urlV = ""
      if (mode === "webhook") {
        urlV = typeof body.url === "string" ? body.url.trim().slice(0, 2000) : ""
        let ok = false; try { const u = new URL(urlV); ok = u.protocol === "https:" || u.protocol === "http:" } catch { /* */ }
        if (!ok) return sendJson(res, { error: "Your tool's address must start with http(s)://" }, 400)
      }
      const cfg = { mode, url: urlV, updatedAt: new Date().toISOString() }
      try { await mkdir("data", { recursive: true }); await writeFile(AGENT_FILE, JSON.stringify(cfg, null, 2) + "\n") } catch (e) { return sendJson(res, { error: String((e as Error).message) }, 500) }
      broadcast({ type: "agent" })
      return sendJson(res, { ok: true, ...cfg })
    }
    return sendJson(res, await readAgentConfig())
  }
  // ════ CRM STAGES: editable labels (data/crm-stages.json); the keys stay the server's ════
  if (path === "/api/crm/stages") {
    if (req.method === "POST") {
      const body = await parseBody(req)
      if (!body || typeof body !== "object" || Array.isArray(body)) return sendJson(res, { error: "bad json" }, 400)
      const labels: Record<string, string> = {}
      for (const [k, v] of Object.entries(body.labels && typeof body.labels === "object" && !Array.isArray(body.labels) ? body.labels as Record<string, unknown> : {})) {
        if (STAGE_KEYS.has(k) && typeof v === "string" && v.trim()) labels[k] = v.trim().slice(0, 40)
      }
      try { await mkdir("data", { recursive: true }); await writeFile(STAGES_FILE, JSON.stringify({ labels }, null, 2) + "\n") } catch (e) { return sendJson(res, { error: String((e as Error).message) }, 500) }
      broadcast({ type: "sales" })
      return sendJson(res, { ok: true, ...(await crmStages()) })
    }
    return sendJson(res, await crmStages())
  }

  // ════ SETTINGS : agency (name, country, language, currency, address, who signs) + which AI (LWS_LLM in .env) ════
  // Saved over the ACTIVE agency file (LWS_AGENCY_CONFIG, e.g. the US example), never over another one ; what still
  // belongs to the demo studio is listed (leftovers) so « make it yours » says what is left. The server checks what the
  // form checks : a name, the paragraph, a postal address in the US (CAN-SPAM), plain text only.
  if (path === "/api/settings") {
    const a = agency() as any
    const file = agencyFile()
    const readCfg = async (f: string | null | undefined): Promise<any> => { try { return f && existsSync(f) ? JSON.parse(await readFile(f, "utf8")) : null } catch { return null } }
    const sandbox = process.env.LWS_SANDBOX === "1"
    if (req.method === "POST") {
      const body = await parseBody(req)
      if (!body) return sendJson(res, { error: "bad json" }, 400)
      const target = join(process.cwd(), "agency.config.json")
      // the agency AS IT RUNS (the active file), else the saved one, else the demo : never the wrong country's demo
      const j: any = (await readCfg(file)) || (await readCfg(target)) || (await readCfg(join(process.cwd(), "agency.config.example.us.json"))) || {}
      const plain = (v: unknown, max: number) => String(v ?? "").replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
      const bad = (field: string, error: string) => sendJson(res, { error, field }, 400)
      // switching country while a field still holds the old demo studio's text : the new demo's text replaces it (a field
      // the owner wrote is never touched) ; the form does the same as soon as the country changes
      {
        const was = String(j.country || "").toUpperCase(), now = typeof body.country === "string" ? body.country.trim().toUpperCase() : was
        const copy = demoCopyByCountry(readExamples(process.cwd())), oldEx = copy[was], newEx = copy[now]
        if (now !== was && oldEx && newEx) for (const k of ["name", "firstName", "brand", "offer", "guarantee", "phone", "contactEmail", "website"] as const) {
          if (typeof body[k] === "string" && oldEx[k] && body[k].trim() === oldEx[k].trim()) body[k] = newEx[k]
        }
      }
      // what is too long or cannot be right is refused with a message, never cut or kept silently
      const tooLong = ([["name", 80, "The agency name"], ["firstName", 40, "Your first name"], ["offer", 400, "What you offer"], ["guarantee", 300, "Your promise"], ["postalAddress", 300, "The postal address"], ["website", 200, "The website"], ["contactEmail", 120, "The email"], ["phone", 40, "The phone"]] as const).find(([k, max]) => typeof body[k] === "string" && body[k].trim().length > max)
      if (tooLong) return bad(tooLong[0], `${tooLong[2]} is too long: ${tooLong[1]} characters at most.`)
      if (typeof body.phone === "string" && body.phone.trim() && !(/^[+(\d][\d\s().\-+/]*$/.test(body.phone.trim()) && body.phone.replace(/\D/g, "").length >= 7)) return bad("phone", "That phone number doesn't look right.")
      if (body.name !== undefined && !plain(body.name, 80)) return bad("name", "The agency needs a name.")
      if (body.brand !== undefined && !String(body.brand).replace(/<[^>]*>/g, "").trim()) return bad("brand", "This paragraph can't be empty: it goes in your emails.")
      // country, language, currency, time zone and AI : one of the values the page offers (or the one already saved)
      const norm = (k: string, v: string) => k === "language" ? v.toLowerCase() : v.toUpperCase()
      for (const [k, say] of [["country", "Pick a country from the list."], ["language", "Pick a language from the list."], ["currency", "Pick a currency from the list."]] as const) {
        const v = typeof body[k] === "string" ? body[k].trim() : ""
        if (v && !SETTINGS_LISTS[k].includes(norm(k, v)) && norm(k, v) !== norm(k, String(j[k] || ""))) return bad(k, say)
      }
      if (typeof body.timezone === "string" && body.timezone.trim() && !validZone(body.timezone.trim())) return bad("timezone", "Pick a time zone from the list.")
      if (body.ai !== undefined && body.ai !== null && body.ai !== "" && !AI_WAYS.includes(String(body.ai))) return bad("ai", "Pick one of the AI choices.")
      if (typeof body.contactEmail === "string" && body.contactEmail.trim() && !/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(body.contactEmail.trim())) return bad("contactEmail", "That email doesn't look right.")
      if (typeof body.website === "string" && body.website.trim() && !/^https?:\/\/\S+$/i.test(body.website.trim())) return bad("website", "Your website must start with http(s)://")
      const country = (typeof body.country === "string" && body.country.trim() ? body.country.trim() : String(j.country || "")).toUpperCase()
      const addr = typeof body.postalAddress === "string" ? plain(body.postalAddress, 300) : String(j.postalAddress || "")
      if (country === "US" && (!addr || /<[^>]+>/.test(addr))) return bad("postalAddress", "A US agency needs a postal address: it goes in every email (CAN-SPAM).")
      const oldName = String(j.name || ""), oldSlug = String(j.slug || "")
      // a value still a demo studio's : empty, a placeholder, a reserved domain, the old name, or a shipped example's value
      const exampleValues = new Set(readExamples(process.cwd()).flatMap((e: any) => [e.name, e.phone, e.contactEmail, e.website, e.postalAddress, ...Object.values(e.invoice?.seller || {})]).filter((v) => typeof v === "string" && v.trim()).map((v) => String(v).trim()))
      const demoish = (v: unknown) => !v || /\.(example|invalid|test)\b|<[^>]+>/i.test(String(v)) || (!!oldSlug && String(v).includes(oldSlug)) || (!!oldName && String(v).includes(oldName)) || exampleValues.has(String(v).trim())
      j.mail = { ...(j.mail || {}) }; j.brand = { ...(j.brand || {}) }; j.http = { ...(j.http || {}) }
      j.invoice = { ...(j.invoice || {}), seller: { ...((j.invoice || {}).seller || {}) } }
      if (body.name !== undefined) {
        j.name = plain(body.name, 80)
        j.slug = j.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agency"
        j.mail.signature = j.name; j.mail.legalIdentity = j.name
        if (demoish(j.invoice.seller.name) || j.invoice.seller.name === oldName) j.invoice.seller.name = j.name
      }
      // who signs : the first name, everywhere it speaks (« Hi, this is Sam from … », the sender of the emails)
      const first = typeof body.firstName === "string" ? plain(body.firstName, 40) : "" // (longer : refused above)
      if (first) { j.brand.expediteur = first; j.mail.senderName = `${first} · ${j.name}` }
      // an emptied first name signs with the agency's name alone (never the demo's « Camille » left behind)
      else if (typeof body.firstName === "string") { j.brand.expediteur = ""; j.mail.senderName = j.name }
      else if (body.name !== undefined && oldName && String(j.mail.senderName || "").includes(oldName)) j.mail.senderName = String(j.mail.senderName).split(oldName).join(j.name)
      const oldCountry = String(j.country || "").toUpperCase()
      for (const k of ["country", "language", "currency", "timezone"]) if (typeof body[k] === "string" && body[k].trim()) j[k] = plain(body[k], 32)
      if (j.country) j.country = String(j.country).toUpperCase().slice(0, 2)
      if (j.currency) j.currency = String(j.currency).toUpperCase()
      if (j.language) j.language = String(j.language).toLowerCase()
      // another country : the locale and time zone are derived again (agency.mjs) unless the body sets them
      if (j.country && j.country !== oldCountry) { if (typeof body.locale !== "string") delete j.locale; if (typeof body.timezone !== "string") delete j.timezone }
      if (typeof body.postalAddress === "string") { j.postalAddress = addr; if (addr && demoish(j.invoice.seller.address)) j.invoice.seller.address = addr }
      if (body.brand !== undefined) j.brand.team = String(body.brand).replace(/<[^>]*>/g, "").trim().slice(0, 1200)
      // emptying a field empties it : never the demo studio's offer, promise, phone or a website you never typed
      if (typeof body.offer === "string") j.brand.offer = plain(body.offer, 400)
      if (typeof body.guarantee === "string") j.brand.garantie = plain(body.guarantee, 300)
      if (typeof body.phone === "string") { j.phone = plain(body.phone, 40); if (j.phone && demoish(j.invoice.seller.phone)) j.invoice.seller.phone = j.phone }
      if (typeof body.website === "string") j.website = body.website.trim().slice(0, 200)
      if (typeof body.contactEmail === "string") {
        j.contactEmail = body.contactEmail.trim().slice(0, 120)
        const domain = j.contactEmail.split("@")[1] || ""
        if (j.contactEmail && demoish(j.invoice.seller.email)) j.invoice.seller.email = j.contactEmail
        // the mail server's name follows your email's domain while it is still the demo's ; the website is only derived
        // when the form did not send one at all (an emptied website stays empty)
        if (domain && demoish(j.mail.heloDomain)) j.mail.heloDomain = domain
        if (domain && demoish(j.website) && body.website === undefined) j.website = `https://${domain}`
      }
      // how the agency introduces itself to open-data services and to the sites it reads (still the demo's → yours)
      if (demoish(j.http.userAgent) && j.slug && j.website && !demoish(j.website)) { j.http.userAgent = `${j.slug}/1.0 (+${j.website})`; j.http.crawlerUserAgent = `Mozilla/5.0 (compatible; ${j.slug}/1.0; +${j.website})` }
      if (/\.(example|invalid|test)\b/i.test(String(j.calendarUrl || ""))) delete j.calendarUrl
      try { await writeFile(target, JSON.stringify(j, null, 2) + "\n") } catch (e) { return sendJson(res, { error: String((e as Error).message) }, 500) }
      if (typeof body.ai === "string" && AI_WAYS.includes(body.ai)) {
        AI_STATUS.clear()
        try { await setEnvVar("LWS_LLM", body.ai) } catch (e) { return sendJson(res, { error: `agency saved, but .env not writable: ${(e as Error).message}` }, 500) }
      }
      // Billing › Your business follows what you typed here while it still holds a demo studio's value (or nothing) : the
      // address, the name, the email and the phone are never typed twice
      try {
        const cur = await getSettings() as any, patch: Record<string, string> = {}
        const sync = (k: string, v: unknown) => { const t = String(v || "").trim(); if (t && (demoish(cur[k]) || isDemoValue(cur[k]))) patch[k] = t }
        if (typeof body.postalAddress === "string") sync("address", j.postalAddress)
        if (body.name !== undefined) sync("name", j.name)
        if (typeof body.contactEmail === "string" && !/\.(example|invalid|test)\b/i.test(j.contactEmail)) sync("email", j.contactEmail)
        if (typeof body.phone === "string") sync("phone", j.phone)
        if (Object.keys(patch).length) await saveSettings(patch)
      } catch { /* Billing keeps its own values */ }
      // the agency module caches by path : the next requests must see the new file
      process.env.LWS_AGENCY_CONFIG = target // the saved file wins over the example (also inside the sandbox)
      clearAgencyCache()
      broadcast({ type: "agency" })
      // what is still the demo's (untouched) and what is a placeholder you typed (an .example address reaches nobody)
      const left = demoLeftovers(j, readExamples(process.cwd()))
      return sendJson(res, { ok: true, leftovers: left.filter((x) => x.why === "demo"), placeholders: left.filter((x) => x.why === "placeholder"), sandbox })
    }
    const cfg = (await readCfg(file)) || {}
    const all = demoLeftovers(cfg, readExamples(process.cwd()))
    const leftovers = all.filter((x) => x.why === "demo"), placeholders = all.filter((x) => x.why === "placeholder")
    const demo = !file || /example/.test(file) || leftovers.some((x) => x.key === "name")
    // demoCopy : each demo studio's text by country, so the form swaps the untouched fields when the country changes
    return sendJson(res, { demo, sandbox, leftovers, placeholders, demoCopy: demoCopyByCountry(readExamples(process.cwd())), file, name: a.name, firstName: a.brand?.expediteur || "", country: a.country, language: a.language, currency: a.currency, timezone: a.timezone, postalAddress: a.postalAddress || "", phone: a.phone || "", contactEmail: a.contactEmail || "", website: a.website || "", brand: a.brand?.team || "", offer: a.brand?.offer || "", guarantee: a.brand?.garantie || "", ai: process.env.LWS_LLM || "claude-code" })
  }
  // GET /api/ai-status[?way=claude-code|codex|anthropic|openai-compatible] → is that AI connected ? Never a paid call,
  // never a key typed in the page: the status, or the exact one-line fix. Cached 30 s (the CLIs answer slowly).
  if (path === "/api/ai-status") {
    const asked = url.searchParams.get("way") || ""
    const way = ["claude-code", "codex", "anthropic", "openai-compatible", "anthropic-compatible"].includes(asked) ? asked : (process.env.LWS_LLM || "claude-code")
    // the demo calls nothing, but says what each choice needs for real (a ChatGPT-only owner learns it here, not after installing)
    if (process.env.LWS_SANDBOX === "1") return sendJson(res, { way, ok: true, demo: true, checked: false, ...NEEDS[way as keyof typeof NEEDS] })
    const hit = AI_STATUS.get(way); if (hit && Date.now() - hit.at < 30_000) return sendJson(res, hit.v)
    let v: { way: string; ok: boolean; label: string; fix?: string; installed?: boolean }
    // plain words and the one command to copy (the page shows it with a Copy button) ; never a key typed in the page
    if (way === "claude-code") { const a = claudeAuth(process.env.CLAUDE_BIN || "claude"); v = { way, ok: a.installed && a.loggedIn, installed: a.installed, label: !a.installed ? "Claude isn't installed on this computer" : a.loggedIn ? "Connected" : "Not signed in", fix: !a.installed ? "Install it once from a terminal: `curl -fsSL https://claude.ai/install.sh | bash`" : a.loggedIn ? "" : "Sign in once from a terminal: `claude auth login`" } }
    else if (way === "codex") { const c = codexAuth(process.env.LWS_CODEX_BIN || "codex"); v = { way, ok: c.installed && c.loggedIn, label: !c.installed ? "ChatGPT's command-line tool (Codex) isn't installed" : c.loggedIn ? "Connected" : "Not signed in to ChatGPT", fix: !c.installed ? "Install it once from a terminal: `npm i -g @openai/codex`, then sign in: `codex login`." : c.loggedIn ? "" : "Sign in to ChatGPT once from a terminal: `codex login`." } }
    else if (way === "anthropic") v = { way, ok: !!process.env.ANTHROPIC_API_KEY, label: process.env.ANTHROPIC_API_KEY ? "Connected (your key is in the .env file)" : "No API key yet", fix: process.env.ANTHROPIC_API_KEY ? "" : "Put `ANTHROPIC_API_KEY=…` in the .env file, then restart" }
    else { const base = process.env.OPENAI_BASE_URL || process.env.ANTHROPIC_BASE_URL; v = { way, ok: !!base, label: base ? `Connected to ${base}` : "No model server yet", fix: base ? "" : "Put your model server's address in the .env file (`OPENAI_BASE_URL=http://127.0.0.1:11434/v1` for one on this computer), then restart" } }
    if (way !== "claude-code" && way !== "anthropic") { // the builds themselves run in Claude Code, whatever runs the lighter steps
      const cc = claudeAuth(process.env.CLAUDE_BIN || "claude")
      ;(v as any).builds = cc.installed && cc.loggedIn ? "Building sites: Claude is signed in on this computer." : "Building sites also needs Claude, signed in: `claude auth login`."
    }
    AI_STATUS.set(way, { at: Date.now(), v })
    return sendJson(res, v)
  }
  // GET /api/handsoff/pending → what Hands-off WOULD build now (count + estimate) ; POST /api/handsoff/run {ids} → build them
  if (path === "/api/handsoff/pending") {
    const list = await prospectsList() as any
    const st = await readPState()
    const home = String(agency().country || "").toUpperCase()
    // good prospects in the agency's own country that someone can contact ; a search elsewhere (Boise for a French
    // studio) and a business with no phone and no email are left to you
    const { ids, abroad, noContact } = handsoffSplit(list.items, st, home)
    // what today's cap in builds covers : built now ; the rest tomorrow (Hands-off keeps them first in line) ; no cap
    // set → said, Hands-off asks for one. The counts are the ones /api/handsoff/run applies.
    const b = await buildsToday()
    const today = b.left == null ? ids.length : Math.min(ids.length, b.left)
    const bs = budgetStatus()
    return sendJson(res, { ids, count: ids.length, today, later: ids.length - today, buildsCap: b.cap, buildsFrom: b.from, buildsDone: b.done, buildsInFlight: b.inFlight, buildsLeft: b.left, resetsAt: b.resetsAt, fitsToday: b.left,
      perSiteUsd: b.perBuildUsd, estimateUsd: Math.round(today * b.perBuildUsd * 100) / 100, capUsd: bs.capUsd, spentUsd: bs.spentUsd,
      abroad: abroad.length, abroadPlaces: [...new Set(abroad.map((x: any) => [x.city, x.region].filter(Boolean).join(", ")))].slice(0, 3), noContact: noContact.length,
      pending: st.pending.length, country: home, simulated: process.env.LWS_SANDBOX === "1" })
  }
  if (path === "/api/handsoff/run" && req.method === "POST") {
    const body = await parseBody(req)
    let ids: string[] = Array.isArray(body?.ids) ? body.ids.filter(validProspectId).slice(0, 200) : []
    if (!ids.length) return sendJson(res, { ok: true, built: 0, later: 0 })
    if (!tryDb()) return sendJson(res, { error: noDbReason(), noDb: true }, 503)
    { const sp = await stopState().catch(() => null); if (sp?.on) return sendJson(res, { error: "Paused — resume to run", paused: true }, 409) }
    // only good new prospects someone can contact, that exist and are not already being built (the same rule as the count)
    const st = await readPState()
    const allowed = new Set(handsoffSplit(((await prospectsList()) as any).items, st, String(agency().country || "").toUpperCase()).ids)
    const keep: string[] = []; for (const id of ids) if (allowed.has(id) && (await prospectExists(id)) && !(await pendingSiteJob(id))) keep.push(id)
    if (!keep.length) return sendJson(res, { ok: true, built: 0, later: 0 })
    // today's cap in builds : what is left now, the rest first in line on the next days
    const b = await buildsToday()
    const room = b.left == null ? keep.length : b.left // no cap set (Hands-off itself never runs without one) : all of them
    const now = keep.slice(0, room), later = keep.slice(room)
    st.pending = [...new Set([...later, ...st.pending.filter((x) => !now.includes(x))])]
    try {
      if (now.length) await enqueueBatch({ mode: "composer", ids: now, lim: now.length, requestedBy: "hands-off", note: "hands-off: good-fit prospects" })
      for (const id of now) st.auto[id] = Date.now()
      await writePState(st); broadcast({ type: "batches" }); broadcast({ type: "prospects" }); kickEngine()
      return sendJson(res, { ok: true, built: now.length, later: later.length, buildsCap: b.cap })
    } catch (e) { return sendJson(res, { error: String((e as Error).message) }, 500) }
  }
  // GET /api/won → clients won (for billing prefill)
  if (path === "/api/won") {
    try {
      const rows = await getDb().prepare("SELECT c.prospect_id AS id, p.name, p.city, p.email, p.phone, p.sheet_json AS sheet FROM crm_leads c LEFT JOIN prospects p ON p.id = c.prospect_id WHERE c.pipeline='closing' AND c.stage='signature' ORDER BY c.updated_at DESC LIMIT 50").all() as any[]
      return sendJson(res, { won: rows.map((r) => {
        let idn: any = {}; try { idn = JSON.parse(r.sheet || "{}").identity || {} } catch { /* */ }
        const region = idn.state || idn.region || "", zip = idn.zip || idn.postalCode || ""
        // « Austin, TX 78731 » for a US place, « 69003 Lyon » in France : the line printed under the client's name
        const address = [idn.address || idn.street || "", region ? `${r.city || ""}, ${[region, zip].filter(Boolean).join(" ")}` : [zip, r.city || ""].filter(Boolean).join(" ")].filter(Boolean).join(", ")
        return { id: r.id, name: r.name || r.id, city: r.city || "", region, zip, address, email: r.email || idn.email || "", phone: r.phone || "" }
      }) })
    } catch { return sendJson(res, { won: [] }) }
  }

  if (path === "/api/agency") {
    const a = agency()
    return sendJson(res, { name: a.name, firstName: (a as any).brand?.expediteur || "", signature: a.mail.signature, senderName: a.mail.senderName, website: a.website, phone: a.phone, calendarUrl: a.calendarUrl, country: a.country, language: a.language, locale: a.locale, currency: a.currency, timezone: a.timezone, brand: { team: (a as any).brand?.team || "" }, tax: taxDefault(a.country) })
  }

  // ════ OUTREACH CONSOLE (/sales platform): the LIKED prospects + their draft/video state, actionable ════
  // GET /api/sales → every liked prospect (love>0, latest build per prospect) enriched with the outreach record.
  // It is the bridge "I like it in the cockpit → it shows up in the outreach platform" (love>0 = the target).
  if (path === "/api/sales") {
    let rows: any[] = []
    try {
      rows = await getDb().prepare(`
        SELECT DISTINCT ON (g.prospect_id)
          g.prospect_id AS id, g.dir_slug AS date, COALESCE(g.love,0) AS love, g.status AS status,
          p.name AS name, p.city AS city, p.sheet_json AS sheet
        FROM generations g LEFT JOIN prospects p ON p.id = g.prospect_id
        WHERE g.present = 1 AND g.status IN ('approved','drafted','sent')
        ORDER BY g.prospect_id, g.gen_date DESC NULLS LAST
      `).all() as any[]
    } catch { /* no DB → empty list (the platform says so) */ }
    const items: any[] = []
    for (const r of rows) {
      let sheet: any = {}; try { sheet = r.sheet ? JSON.parse(r.sheet) : {} } catch { /* */ }
      const rec = await readOutreach(r.id)
      const genDir = rec?.genDir || r.date
      const dir = siteDir(r.id, genDir)
      const demoKey = `sites/${r.id}/${genDir}/demo.mp4`
      const hasVideo = !!rec?.demoUrl || (dir ? existsSync(join(dir, "demo.mp4")) : false) || (storageBase() ? await storageExists(demoKey) : false)
      const demoUrl = rec?.demoUrl || (hasVideo && storageBase() ? urlFor(demoKey) : "")
      items.push({
        id: r.id, name: rec?.name || sheet?.identity?.name || r.name || r.id,
        industry: rec?.industry || sheet?.industry || "", city: sheet?.identity?.city || r.city || "",
        love: r.love, genDir, thumb: `/thumb/${r.id}/${genDir}`, siteUrl: `/preview/${r.id}/${genDir}/index.html`,
        oldUrl: rec?.oldUrl || sheet?.existing?.url || "",
        email: rec?.to || sheet?.identity?.email || "", emailVerified: rec ? !!rec.emailVerified : !!sheet?.identity?.emailVerified,
        prepared: !!rec, hasVideo, demoUrl,
        draft: rec ? {
          subject: rec.subject || "", body: rec.body || "", htmlBody: rec.htmlBody || "",
          status: rec.status || (rec.gmailDraftId ? "drafted" : "ready"),
          gmailDraftId: rec.gmailDraftId || null, draftedGenDir: rec.draftedGenDir || null,
          draftedAt: rec.draftedAt || null, pendingGmail: !!rec.pendingGmail,
        } : null,
        fresh: rec?.draftedGenDir ? rec.draftedGenDir !== genDir : false,
        competitor: rec?.competitor || null, seoIssue: rec?.seoIssue || "",
        ready: rec?.ready ?? null, skipReason: rec?.skipReason || "",
      })
    }
    // sort: to handle first (prepared without a draft, or site changed), then by ♥, sent ones at the bottom
    const rank = (it: any) => it.draft?.status === "sent" ? 3 : (it.fresh || (it.prepared && !it.draft?.gmailDraftId)) ? 0 : it.prepared ? 1 : 2
    items.sort((a, b) => rank(a) - rank(b) || b.love - a.love || String(a.name).localeCompare(String(b.name)))
    return sendJson(res, { items })
  }

  // ════ OUTREACH CRM (/outreach platform): kanban with 2 pipelines (hot lead → closing) ════
  // Stages : hot = call0→relance1→relance2→relance3→nurturing · closing = demo→propal→nego→signature.
  // ENROLMENT: anything approved (status approved/drafted/sent) WITHOUT a crm_leads row enters hot/call0.
  if (path === "/api/crm") {
    let rows: any[] = []
    try {
      // same approved ones as /api/sales (DISTINCT ON prospect, latest build) + CRM state + assets for name/city.
      rows = await getDb().prepare(`
        SELECT DISTINCT ON (g.prospect_id)
          g.prospect_id AS id, g.dir_slug AS date, COALESCE(g.love,0) AS love, g.status AS status,
          p.name AS name, p.city AS city, p.industry AS industry, p.sheet_json AS sheet,
          p.opp_score AS "oppScore", p.opp_tier AS "oppTier",
          c.pipeline AS pipeline, c.stage AS stage, c.call_count AS "callCount",
          c.rdv_at AS "rdvAt", c.nurturing_until AS "nurturingUntil", c.notes_json AS "notesJson",
          c.linkedin AS linkedin, c.call_script AS "callScript", c.research_json AS "researchJson",
          c.assigned_to AS "assignedTo", c.answered AS answered
        FROM generations g
        LEFT JOIN prospects p ON p.id = g.prospect_id
        LEFT JOIN crm_leads c ON c.prospect_id = g.prospect_id
        WHERE g.present = 1 AND g.status IN ('approved','drafted','sent')
        ORDER BY g.prospect_id, g.gen_date DESC NULLS LAST
      `).all() as any[]
    } catch { /* no DB → empty kanban (the platform says so) */ }
    const hot: Record<string, any[]> = { emails: [], call0: [], relance1: [], relance2: [], relance3: [], nurturing: [] }
    const closing: Record<string, any[]> = { demo: [], propal: [], nego: [], signature: [] }
    const lost: any[] = [] // said no (the call panel's Lost) : off the board, behind the « N lost » filter
    const now = Date.now()
    // EMAIL FUNNEL (sequencer): join on prospect_id → each card shows where the email stands, next to the call round.
    const mailSeqs: Record<string, any> = await seqById()
    let mailSteps: any[] = []
    try { mailSteps = JSON.parse(await readFile("outreach/sequencer/config.json", "utf8")).steps || [] } catch { /* default */ }
    const win = sendWindow()
    const test = (await cageStatus().catch(() => null))?.send?.mode !== "réel"
    const callAngle = await callAnglesFor() // each lead's call opening (learning/scripts/words.ts), the winner leaned on once it leads
    for (const r of rows) {
      // enrolment: approved without a crm_leads row → CREATE the row (hot/call0) and show it there.
      let pipeline = r.pipeline, stage = r.stage
      if (!pipeline) {
        // a lead the emails are writing to starts in « Emails », any other on the call list
        const first = laneOf(null, mailSeqs[r.id])
        try { await getDb().prepare("INSERT INTO crm_leads(prospect_id, pipeline, stage, updated_at) VALUES (?,?,?,?) ON CONFLICT (prospect_id) DO NOTHING").run(r.id, "hot", first, now) } catch { /* */ }
        pipeline = "hot"; stage = first
      } else if (pipeline === "hot" && stage === "emails" && laneOf(stage, mailSeqs[r.id]) !== "emails") {
        // the emails ended (or they clicked) : on the call list now, said once in the database too
        stage = "call0"
        try { await getDb().prepare("UPDATE crm_leads SET stage='call0', updated_at=? WHERE prospect_id=? AND stage='emails'").run(now, r.id) } catch { /* */ }
      }
      let sheet: any = {}; try { sheet = r.sheet ? JSON.parse(r.sheet) : {} } catch { /* */ }
      let notes: any[] = []; try { notes = r.notesJson ? JSON.parse(r.notesJson) : [] } catch { /* */ }
      const rec = await readOutreach(r.id)
      const genDir = rec?.genDir || r.date
      const dir = siteDir(r.id, genDir)
      const demoKey = `sites/${r.id}/${genDir}/demo.mp4`
      const hasVideo = !!rec?.demoUrl || (dir ? existsSync(join(dir, "demo.mp4")) : false) || (storageBase() ? await storageExists(demoKey) : false)
      let research: any = null; try { research = r.researchJson ? JSON.parse(r.researchJson) : null } catch { /* */ }
      const lead = {
        id: r.id,
        name: rec?.name || sheet?.identity?.name || r.name || r.id,
        industry: rec?.industry || sheet?.industry || r.industry || "",
        city: sheet?.identity?.city || r.city || "",
        region: sheet?.identity?.state || sheet?.identity?.region || "", zip: sheet?.identity?.zip || sheet?.identity?.postalCode || "",
        love: Number(r.love) || 0,
        pipeline, stage,
        callCount: Number(r.callCount) || 0,
        rdvAt: r.rdvAt != null ? Number(r.rdvAt) : null,
        nurturingUntil: r.nurturingUntil != null ? Number(r.nurturingUntil) : null,
        notes, // full history (for the detail panel); lastNote = card snippet
        lastNote: notes.length ? notes[notes.length - 1] : null,
        assignedTo: r.assignedTo || null, // an operator from agency.config.json › operators | null (unassigned)
        answered: r.answered != null ? Number(r.answered) : null, // phone tag: 1 green · 0 red · null neutral
        linkedin: r.linkedin || null,
        draftStatus: rec?.status || (rec?.gmailDraftId ? "drafted" : rec ? "ready" : r.status) || null,
        hasVideo,
        email: rec?.to || sheet?.identity?.email || "",
        // for the CALL SCRIPT (read during the call): the enriched script (skill /account-research) +
        // the facts that feed the deterministic base script (generated in the front end if not enriched).
        callScript: r.callScript || null,
        research,
        // ── CALL COCKPIT: everything needed to sell on the phone ──────────────────
        // phone: outreach record first (resolved/persisted at approval), falling back to the sheet.
        phone: rec?.phone || sheet?.identity?.phone || "",
        // decision maker (the owner): research first, falling back to the sheet. null if unknown (never made up).
        contact: research?.contact || sheet?.identity?.contact || null,
        linkedinUrl: research?.linkedin || null, // the decision maker's LinkedIn profile (research), null if unknown
        emailVerified: rec ? !!rec.emailVerified : !!sheet?.identity?.emailVerified,
        oldUrl: rec?.oldUrl || sheet?.existing?.url || "",
        oldHref: oldLink(r.id, rec?.oldUrl || sheet?.existing?.url || ""),
        siteUrl: `/preview/${r.id}/${genDir}/index.html`, // the NEW site (proof to show/quote)
        thumb: `/thumb/${r.id}/${genDir}`,
        oppScore: r.oppScore != null ? Number(r.oppScore) : null,
        oppTier: r.oppTier || null,
        seoIssue: rec?.seoIssue || "",
        competitor: rec?.competitor || null,
        // ── INSIGHTS: 3 to 6 short facts for the call, backed by the site (research, gate diagnosis, contact) ──
        insights: insightBullets(sheet, research, rec),
        // the language what is SAID to them is in (call script, email) : theirs when known, else the agency's
        lang: prospectLang(sheet, agency().language || "en"),
        // they unsubscribed or complained : no more emails, ever (a call is still allowed) — the card says so
        optOut: (() => { const t = mailSeqs[r.id]?.stoppedBy?.type; return t === "unsub" || t === "complaint" ? t : null })(),
        // ── EMAIL FUNNEL (sequencer): null if not in a sequence, otherwise the state for the card's badge ──
        mail: (() => {
          const s = mailSeqs[r.id]
          if (!s) return null
          const live = s.status === "active" || s.status === "waiting-content" // held for lack of content = still in the sequence
          const stepId = live ? (mailSteps[s.step]?.id ?? "fin") : s.status
          const sends = (s.sends || []).length
          const clicks = s.clicks || []
          const next = live && s.status === "active" && s.nextRunAt ? Date.parse(s.nextRunAt) : NaN
          return {
            // `written` = the emails actually written (test mode) or sent : the step the card and the Email tab say
            written: sends, test,
            // why the emails stopped, in the owner's words (a meeting, won, lost, a reply, an unsubscribe…) ; null while live
            stopped: live ? null : stopSay(s, mailSteps.length),
            // the next email : a full date on the agency's clock, inside the sending hours
            nextLabel: Number.isFinite(next) ? (next > Date.now() ? wallLabel(next, win) : "at the next sending round") : null,
            hours: windowLabel(win),
            status: s.status, step: s.step, stepId, total: mailSteps.length, sends, clicks: clicks.length,
            lastMail: sends ? s.sends[sends - 1].step : null,
            // timestamps for the email × call MERGE (funnel-strategy §5): "clicked 1h ago" → call NOW
            lastClickAt: clicks.length ? clicks[clicks.length - 1] : null,
            lastSendAt: sends ? s.sends[sends - 1].at : null,
            nextRunAt: live ? s.nextRunAt || null : null, // "next email: tomorrow" on the card
            // held : WHY, in the owner's words (the sequencer's own detail is a log line, French, with a file path)
            waiting: s.status === "waiting-content" && s.waiting ? heldSay(s.waiting, mailSteps) : null,
          }
        })(),
      }
      // its call opening (hot leads only : a meeting or a client is past the opening line) — the call script splices it in
      if (pipeline === "hot" && stage !== "lost") (lead as any).callAngle = callAngle({ id: r.id, name: lead.name, industry: lead.industry, lang: lead.lang })
      if (stage === "lost") { lost.push(lead); continue }
      // a lead in a call step keeps it ; a fresh one the emails write to shows in « Emails »
      if (pipeline === "hot" && stage === "emails") { hot.emails.push(lead); continue }
      const bucket = pipeline === "closing" ? closing : hot
      if (bucket[stage]) bucket[stage].push(lead)
      else (pipeline === "closing" ? closing.demo : hot.call0).push(lead) // stage inconnu → garde-fou
    }
    return sendJson(res, { hot, closing, lost })
  }

  // POST /api/crm/outcome {id, outcome, note, rdvAt?} → end of call: applies the spec's EXACT transition.
  if (path === "/api/crm/outcome" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, outcome, note, rdvAt, slot } = body as { id: string; outcome?: string; note?: string; rdvAt?: number; slot?: string }
    if (!validProspectId(id)) return sendJson(res, { error: "bad id" }, 400)
    if (!["reach", "unreach", "rdv", "note", "lost"].includes(String(outcome))) return sendJson(res, { error: "bad outcome" }, 400)
    const now = Date.now()
    // make sure a row exists (an approved prospect never opened might not have one yet).
    try { await getDb().prepare("INSERT INTO crm_leads(prospect_id, updated_at) VALUES (?,?) ON CONFLICT (prospect_id) DO NOTHING").run(id, now) } catch { return sendJson(res, { error: noDbReason(), noDb: true }, 503) }
    const row = await getDb().prepare("SELECT pipeline, stage, call_count, notes_json FROM crm_leads WHERE prospect_id=?").get(id) as any
    if (!row) return sendJson(res, { error: "Not found" }, 404)
    let notes: any[] = []; try { notes = row.notes_json ? JSON.parse(row.notes_json) : [] } catch { /* */ }
    // the call's time slot (morning/noon/afternoon), computed in the front end (local time). Used to spread
    // call-backs over DIFFERENT moments: the cockpit reads the slots already tried and suggests the next one.
    const slotV = typeof slot === "string" && /^(matin|midi|aprem)$/.test(slot) ? slot : null
    // we log the meaningful events (note with text, meeting) AND every unanswered attempt (with
    // its slot) — that trail is what makes the per-slot cadence possible. The history stays readable.
    const txt = typeof note === "string" ? note.trim() : ""
    if (txt || outcome === "rdv") notes.push({ at: now, outcome, text: txt, ...(slotV ? { slot: slotV } : {}) })
    else if (outcome === "unreach") notes.push({ at: now, outcome: "unreach", text: "", slot: slotV })
    let pipeline = row.pipeline || "hot", stage = row.stage || "call0", callCount = Number(row.call_count) || 0
    let rdv_at: number | null = null, nurturing_until: number | null = null, answered: number | null = null
    if (outcome === "reach") {
      // answered → GREEN phone tag. Moving to the next stage is DECOUPLED (the ">>" button).
      answered = 1
    } else if (outcome === "unreach") {
      // no answer → RED phone tag (the slot trail is kept above for the cadence).
      // No automatic advance: ">>" does it.
      answered = 0
    } else if (outcome === "rdv") {
      // meeting booked: moves to closing/demo + rdv_at (the front end's date picker provides rdvAt epochMs).
      pipeline = "closing"; stage = "demo"
      rdv_at = (typeof rdvAt === "number" && rdvAt > 0) ? rdvAt : now
    } else if (outcome === "lost") {
      // LOST (they said no) : the outcome feeds the learning, the lead leaves the board (the « N lost » filter shows
      // it) ; never Nurturing, which is an active step of light touches
      if (!txt) notes.push({ at: now, outcome: "lost", text: "" })
      pipeline = "hot"; stage = "lost"
    }
    // 'note': note only, we STAY in the column.
    try {
      await getDb().prepare(`UPDATE crm_leads SET pipeline=?, stage=?, call_count=?,
        rdv_at = COALESCE(?, rdv_at), nurturing_until = COALESCE(?, nurturing_until),
        answered = COALESCE(?, answered),
        notes_json=?, updated_at=? WHERE prospect_id=?`).run(
        pipeline, stage, callCount, rdv_at, nurturing_until, answered, JSON.stringify(notes), now, id)
    } catch { return sendJson(res, { error: noDbReason(), noDb: true }, 503) }
    // a meeting booked or a lead lost : the email sequence stops, and says why
    const mailStopped = outcome === "rdv" ? await stopSequence(id, "meeting") : outcome === "lost" ? await stopSequence(id, "lost") : false
    // THE LEARNING LOOP, automatic: meeting booked = "meeting", lost = "lost" (once per prospect)
    const learned = outcome === "rdv" ? await learnFrom(id, "meeting") : outcome === "lost" ? await learnFrom(id, "lost") : null
    broadcast({ type: "sales" })
    return sendJson(res, { ok: true, ...(learned ? { learned } : {}), ...(mailStopped ? { mailStopped: true } : {}) })
  }

  // POST /api/crm/assign {id, operator} → assigns the prospect to a team operator (agency.config.json ›
  // operators) or null/"" to unassign.
  if (path === "/api/crm/assign" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, operator } = body as { id: string; operator?: string | null }
    if (!validProspectId(id)) return sendJson(res, { error: "bad id" }, 400)
    const op = operator && agency().operators.includes(operator) ? operator : null
    const now = Date.now()
    try {
      await getDb().prepare("INSERT INTO crm_leads(prospect_id, assigned_to, updated_at) VALUES (?,?,?) ON CONFLICT (prospect_id) DO UPDATE SET assigned_to=EXCLUDED.assigned_to, updated_at=EXCLUDED.updated_at").run(id, op, now)
    } catch { return sendJson(res, { error: noDbReason(), noDb: true }, 503) }
    broadcast({ type: "sales" })
    return sendJson(res, { ok: true, operator: op })
  }

  // POST /api/crm/split → deals the still UNASSIGNED prospects of the 'hot' pipeline round-robin between the
  // team operators (agency.config.json › operators). Idempotent: leaves the already assigned ones alone.
  if (path === "/api/crm/split" && req.method === "POST") {
    const ops = agency().operators
    if (!ops.length) return sendJson(res, { error: "No operators yet: add \"operators\" to agency.config.json" }, 400)
    const now = Date.now()
    try {
      const rows = await getDb().prepare(`
        SELECT g.prospect_id AS id FROM generations g
        LEFT JOIN crm_leads c ON c.prospect_id = g.prospect_id
        WHERE g.present = 1 AND g.status IN ('approved','drafted','sent')
          AND (c.assigned_to IS NULL OR c.assigned_to = '')
          AND COALESCE(c.pipeline, 'hot') = 'hot'
        GROUP BY g.prospect_id ORDER BY g.prospect_id
      `).all() as any[]
      let n = 0
      for (let i = 0; i < rows.length; i++) {
        const op = ops[i % ops.length]
        await getDb().prepare("INSERT INTO crm_leads(prospect_id, assigned_to, updated_at) VALUES (?,?,?) ON CONFLICT (prospect_id) DO UPDATE SET assigned_to=EXCLUDED.assigned_to, updated_at=EXCLUDED.updated_at").run(rows[i].id, op, now)
        n++
      }
      broadcast({ type: "sales" })
      return sendJson(res, { ok: true, assigned: n })
    } catch { return sendJson(res, { error: noDbReason(), noDb: true }, 503) }
  }

  // POST /api/crm/stage {id, pipeline, stage} → MANUAL move between columns (validates stage ∈ pipeline).
  if (path === "/api/crm/stage" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, pipeline, stage } = body as { id: string; pipeline?: string; stage?: string }
    if (!validProspectId(id)) return sendJson(res, { error: "bad id" }, 400)
    const stages: Record<string, string[]> = {
      hot: ["call0", "relance1", "relance2", "relance3", "nurturing", "lost"],
      closing: ["demo", "propal", "nego", "signature"],
    }
    if (!stages[String(pipeline)] || !stages[String(pipeline)].includes(String(stage))) return sendJson(res, { error: "bad stage" }, 400)
    const now = Date.now()
    try {
      const nurturing_until = (pipeline === "hot" && stage === "nurturing") ? now + 60 * 24 * 60 * 60 * 1000 : null
      await getDb().prepare("INSERT INTO crm_leads(prospect_id, pipeline, stage, nurturing_until, updated_at) VALUES (?,?,?,?,?) ON CONFLICT (prospect_id) DO UPDATE SET pipeline=EXCLUDED.pipeline, stage=EXCLUDED.stage, nurturing_until=COALESCE(EXCLUDED.nurturing_until, crm_leads.nurturing_until), updated_at=EXCLUDED.updated_at").run(id, pipeline, stage, nurturing_until, now)
    } catch { return sendJson(res, { error: noDbReason(), noDb: true }, 503) }
    // a deal step (meeting, proposal, negotiation), won or lost : no more cold emails, the card says why
    const mailStopped = pipeline === "closing" ? await stopSequence(id, stage === "signature" ? "won" : "meeting") : stage === "lost" ? await stopSequence(id, "lost") : false
    // THE LEARNING LOOP, automatic: a card dropped in Signature = "won" (once per prospect)
    const learned = pipeline === "closing" && stage === "signature" ? await learnFrom(id, "won") : null
    broadcast({ type: "sales" })
    return sendJson(res, { ok: true, ...(learned ? { learned } : {}), ...(mailStopped ? { mailStopped: true } : {}) })
  }

  // POST /api/crm/note {id, text} → adds a free note (outcome 'note'), no transition.
  if (path === "/api/crm/note" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, text } = body as { id: string; text?: string }
    if (!validProspectId(id) || typeof text !== "string" || !text.trim()) return sendJson(res, { error: "bad args" }, 400)
    const now = Date.now()
    try { await getDb().prepare("INSERT INTO crm_leads(prospect_id, updated_at) VALUES (?,?) ON CONFLICT (prospect_id) DO NOTHING").run(id, now) } catch { return sendJson(res, { error: noDbReason(), noDb: true }, 503) }
    const row = await getDb().prepare("SELECT notes_json FROM crm_leads WHERE prospect_id=?").get(id) as any
    let notes: any[] = []; try { notes = row?.notes_json ? JSON.parse(row.notes_json) : [] } catch { /* */ }
    notes.push({ at: now, outcome: "note", text })
    try { await getDb().prepare("UPDATE crm_leads SET notes_json=?, updated_at=? WHERE prospect_id=?").run(JSON.stringify(notes), now, id) } catch { return sendJson(res, { error: noDbReason(), noDb: true }, 503) }
    broadcast({ type: "sales" })
    return sendJson(res, { ok: true })
  }

  // POST /api/crm/script {id, callScript?, research?} → saves the CALL SCRIPT + the research brief
  // (produced by the /account-research skill, persisted through `npm run research:save`). The CRM shows them.
  if (path === "/api/crm/script" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, callScript, research } = body as { id: string; callScript?: string; research?: unknown }
    if (!validProspectId(id)) return sendJson(res, { error: "bad id" }, 400)
    const now = Date.now()
    const cs = typeof callScript === "string" ? callScript.slice(0, 20000) : null
    const rj = research != null ? JSON.stringify(research).slice(0, 60000) : null
    try {
      await getDb().prepare(
        `INSERT INTO crm_leads(prospect_id, call_script, research_json, updated_at) VALUES (?,?,?,?)
         ON CONFLICT (prospect_id) DO UPDATE SET
           call_script = COALESCE(EXCLUDED.call_script, crm_leads.call_script),
           research_json = COALESCE(EXCLUDED.research_json, crm_leads.research_json),
           updated_at = EXCLUDED.updated_at`,
      ).run(id, cs, rj, now)
    } catch { return sendJson(res, { error: noDbReason(), noDb: true }, 503) }
    broadcast({ type: "sales" })
    return sendJson(res, { ok: true })
  }

  // POST /api/crm/linkedin {id, state} → LinkedIn thread state ('added' = added · 'messaged' = message sent).
  if (path === "/api/crm/linkedin" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, state } = body as { id: string; state?: string }
    if (!validProspectId(id) || !["added", "messaged"].includes(String(state))) return sendJson(res, { error: "bad args" }, 400)
    const now = Date.now()
    try {
      await getDb().prepare("INSERT INTO crm_leads(prospect_id, linkedin, updated_at) VALUES (?,?,?) ON CONFLICT (prospect_id) DO UPDATE SET linkedin=EXCLUDED.linkedin, updated_at=EXCLUDED.updated_at").run(id, state, now)
    } catch { return sendJson(res, { error: noDbReason(), noDb: true }, 503) }
    broadcast({ type: "sales" })
    return sendJson(res, { ok: true })
  }

  // POST /api/crm/research-now {id} → MANUAL TRIGGER of the auto-research (the "resolve/enrich" button
  // in the call cockpit): reruns research + script + resolution of missing contacts for this prospect.
  // Same queue as auto-approval; the worker is idempotent. Best-effort (a DB is required for the queue).
  if (path === "/api/crm/research-now" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id } = body as { id: string }
    if (!validProspectId(id)) return sendJson(res, { error: "bad id" }, 400)
    if (!tryDb()) return sendJson(res, { error: noDbReason(), noDb: true }, 503)
    try {
      const row = await enqueueResearch(id, AUTH_USER)
      broadcast({ type: "sales" })
      return sendJson(res, { ok: true, queued: true, batchId: row.id })
    } catch (e) {
      return sendJson(res, { error: String((e as Error).message) }, 500)
    }
  }

  // POST /api/sales/draft {id, subject, body, push?} → writes the edited copy (regenerates a clean htmlBody)
  // + pendingGmail flag if push. The REAL push to Gmail is done by /out (the Gmail connector lives in
  // the agent's session, never on the VM) — the platform curates/edits, /out executes.
  if (path === "/api/sales/draft" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, subject, body: text, push } = body as { id: string; subject?: string; body?: string; push?: boolean }
    const rec = await readOutreach(id)
    if (!rec) return sendJson(res, { error: "Not prepared yet" }, 404)
    // CLEAN demo link guaranteed even on an old record without a demoUrl field: derived from the build.
    const demoUrl = rec.demoUrl || (rec.genDir && storageBase() ? urlFor(`sites/${id}/${rec.genDir}/demo.mp4`) : undefined)
    if (demoUrl) rec.demoUrl = demoUrl
    if (typeof subject === "string") rec.subject = subject
    if (typeof text === "string") { rec.body = text; rec.htmlBody = bodyToHtml(text, demoUrl) }
    rec.editedAt = Date.now()
    if (push) rec.pendingGmail = true
    await writeOutreach(id, rec)
    broadcast({ type: "sales" })
    return sendJson(res, { ok: true, pendingGmail: !!rec.pendingGmail })
  }

  // POST /api/sales/push {id} → marks "to push to Gmail" (drained on the next /out).
  if (path === "/api/sales/push" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const rec = await readOutreach((body as any).id)
    if (!rec) return sendJson(res, { error: "Not prepared yet" }, 404)
    rec.pendingGmail = true
    await writeOutreach((body as any).id, rec)
    broadcast({ type: "sales" })
    return sendJson(res, { ok: true })
  }

  // POST /api/sales/video {id} → regenerates the demo video. The server does it ITSELF (it runs on the VM,
  // ffmpeg installed) → progress over SSE {type:'refill', id}.
  if (path === "/api/sales/video" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id } = body as { id: string }
    if (!validProspectId(id)) return sendJson(res, { error: "bad id" }, 400)
    const rec = await readOutreach(id)
    const genDir = rec?.genDir || (await latestGen(id))
    if (!genDir) return sendJson(res, { error: "No site built for this prospect yet" }, 404)
    runJob(`demo:${id}`, ["run", "demo", "--", id, genDir], `demo video: ${id}`, { id, sales: true }, { DEMO_FORCE: "1" })
    return sendJson(res, { ok: true, queued: true, genDir })
  }

  // POST /api/sales/prepare {id} → prepares the outreach (record + video) of a liked prospect not prepared yet.
  if (path === "/api/sales/prepare" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id } = body as { id: string }
    if (!validProspectId(id)) return sendJson(res, { error: "bad id" }, 400)
    runJob(`prepare:${id}`, ["run", "outreach", "--", id], `outreach preparation: ${id}`, { id, sales: true })
    return sendJson(res, { ok: true, queued: true })
  }

  if (path === "/api/control") {
    const id = url.searchParams.get("id") || ""
    const date = url.searchParams.get("date") || ""
    const dir = siteDir(id, date)
    if (!dir) return sendJson(res, { error: "unknown site" }, 404)
    if (req.method === "POST") {
      const body = await parseBody(req)
      if (!body) return sendJson(res, { error: "bad json" }, 400)
      const { comment } = body as { comment: string }
      const ctlPath = join(dir, "control.md")
      const prev = existsSync(ctlPath) ? await readFile(ctlPath, "utf8") : ""
      await writeFile(ctlPath, writeCommentText(prev, comment ?? ""))
      return sendJson(res, { ok: true })
    }
    const ctlPath = join(dir, "control.md")
    const ctl = existsSync(ctlPath) ? parseControl(await readFile(ctlPath, "utf8")) : null
    const files = (await readdir(dir)).filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f))
    return sendJson(res, { id, date, control: ctl, images: files })
  }

  // a build's status (the "approve" verb: draft → approved → sent). DB-owned, no file.
  if (path === "/api/status" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, date, status } = body as { id: string; date: string; status: string }
    if (!siteDir(id, date)) return sendJson(res, { error: "unknown site" }, 404)
    const allowed = ["draft", "approved", "sent", "rejected", "superseded", "drafted"]
    if (!allowed.includes(status)) return sendJson(res, { error: "bad status" }, 400)
    try {
      const db = getDb()
      await reindexSite(id, date) // makes sure the row exists before the UPDATE
      // status BEFORE the change → so the auto-research only fires on the REAL switch to 'approved'.
      const prev = await db.prepare("SELECT status FROM generations WHERE prospect_id=? AND dir_slug=?").get(id, date) as any
      const now = Date.now()
      await db.prepare(
        "UPDATE generations SET status=?, status_changed_at=?, sent_at=CASE WHEN ?='sent' THEN ? ELSE sent_at END WHERE prospect_id=? AND dir_slug=?",
      ).run(status, now, status, now, id, date)
      // AUTO ON APPROVAL: the site becomes approved (and was not) → start research + script +
      // resolution of missing contacts on its own (the worker is idempotent). Best-effort: never blocks
      // the status response, never surfaces an error to the operator.
      if (status === "approved" && prev?.status !== "approved") {
        try { if (tryDb()) await enqueueResearch(id, AUTH_USER, await callOpeningParams(id)) } catch { /* best-effort */ }
        void notifyAgent(id, date); void enrollOnApprove(id)
      }
      // a site skipped after it went to outreach : its emails stop too (never an email about a site you dropped)
      if (status === "rejected") await stopSequence(id, "skipped")
      // sent or skipped : what the agency learns from it (with the reason, when you gave one)
      const remember = await onDecision({ id, date, status, reason: typeof (body as any).reason === "string" ? (body as any).reason : null }).catch(() => null)
      broadcast({ type: "sites" })
      return sendJson(res, { ok: true, status, ...(remember ? { remember } : {}) })
    } catch (e) {
      return sendJson(res, { error: String((e as Error).message) }, 500)
    }
  }

  // BULK status (multi-select → approve/skip fast). Same logic as /api/status, applied to
  // each {id,date} in the list; ignores invalid ones (unknown site). Allowed status: approved/rejected/draft.
  if (path === "/api/status/bulk" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { items, status } = body as { items: { id: string; date: string }[]; status: string }
    if (!["approved", "rejected", "draft"].includes(status)) return sendJson(res, { error: "bad status" }, 400)
    if (!Array.isArray(items)) return sendJson(res, { error: "bad items" }, 400)
    let n = 0
    try {
      const db = getDb()
      const now = Date.now()
      for (const it of items) {
        const id = it && it.id, date = it && it.date
        if (!id || !date || !siteDir(id, date)) continue // ignores invalid ones
        await reindexSite(id, date) // makes sure the row exists before the UPDATE
        const prev = await db.prepare("SELECT status FROM generations WHERE prospect_id=? AND dir_slug=?").get(id, date) as any
        await db.prepare(
          "UPDATE generations SET status=?, status_changed_at=?, sent_at=CASE WHEN ?='sent' THEN ? ELSE sent_at END WHERE prospect_id=? AND dir_slug=?",
        ).run(status, now, status, now, id, date)
        // BULK approval → also fires the auto-research (like single /api/status), best-effort
        if (status === "approved" && prev?.status !== "approved") { try { await enqueueResearch(id, AUTH_USER, await callOpeningParams(id)) } catch { /* */ } void notifyAgent(id, date); void enrollOnApprove(id) }
        void onDecision({ id, date, status }).catch(() => null)
        n++
      }
      broadcast({ type: "sites" })
      return sendJson(res, { ok: true, n })
    } catch (e) {
      return sendJson(res, { error: String((e as Error).message) }, 500)
    }
  }

  // love level (0-3): the sorting HEART, its own column, independent of the status (coach/operator)
  if (path === "/api/love" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, date, love } = body as { id: string; date: string; love: number }
    if (!siteDir(id, date)) return sendJson(res, { error: "unknown site" }, 404)
    const lv = Math.max(0, Math.min(3, Math.round(Number(love) || 0)))
    try {
      const db = getDb()
      await reindexSite(id, date) // makes sure the row exists before the UPDATE
      await db.prepare("UPDATE generations SET love=? WHERE prospect_id=? AND dir_slug=?").run(lv, id, date)
      broadcast({ type: "sites" })
      return sendJson(res, { ok: true, love: lv })
    } catch (e) {
      return sendJson(res, { error: String((e as Error).message) }, 500)
    }
  }

  // ════ SCORING (0-100 gauges per axis): feeds learning/ (self-improvement). DB-owned (scores_json). ════
  // GET /api/score?id&date → parsed scores ({} if absent). dims = {global,typo,layout,animation,couleurs,contenu,
  // [section-N…]} (entiers 0-100), notes = { <axe>: "pourquoi" }, updatedAt = ms.
  if (path === "/api/score" && req.method === "GET") {
    const id = url.searchParams.get("id") || ""
    const date = url.searchParams.get("date") || ""
    if (!siteDir(id, date)) return sendJson(res, { error: "unknown site" }, 404)
    if (!tryDb()) return sendJson(res, {}) // without a DB: no persisted score → "not scored" (never a 500)
    try {
      const r = await getDb().prepare("SELECT scores_json FROM generations WHERE prospect_id=? AND dir_slug=?").get(id, date) as any
      let scores: any = {}
      if (r?.scores_json) { try { scores = JSON.parse(r.scores_json) || {} } catch { scores = {} } }
      return sendJson(res, scores)
    } catch (e) {
      return sendJson(res, { error: String((e as Error).message) }, 500)
    }
  }
  // POST /api/score {id,date,dims,notes} → writes scores_json ({dims,notes,updatedAt}) on the build.
  if (path === "/api/score" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, date, dims, notes } = body as { id: string; date: string; dims?: Record<string, unknown>; notes?: Record<string, unknown> }
    if (!siteDir(id, date)) return sendJson(res, { error: "unknown site" }, 404)
    // dims: keep only 0-100 integers; notes: only strings (bounded). Robust against free input.
    const cleanDims: Record<string, number> = {}
    if (dims && typeof dims === "object") {
      for (const [k, v] of Object.entries(dims)) {
        if (!/^[a-z0-9-]+$/i.test(k)) continue
        const n = Math.round(Number(v))
        if (Number.isFinite(n)) cleanDims[k] = Math.max(0, Math.min(100, n))
      }
    }
    const cleanNotes: Record<string, string> = {}
    if (notes && typeof notes === "object") {
      for (const [k, v] of Object.entries(notes)) {
        if (!/^[a-z0-9-]+$/i.test(k)) continue
        if (typeof v === "string" && v.trim()) cleanNotes[k] = v.slice(0, 1000)
      }
    }
    const scores = { dims: cleanDims, notes: cleanNotes, updatedAt: Date.now() }
    try {
      const db = getDb()
      await reindexSite(id, date) // makes sure the row exists before the UPDATE (like /api/love)
      await db.prepare("UPDATE generations SET scores_json=? WHERE prospect_id=? AND dir_slug=?").run(JSON.stringify(scores), id, date)
      broadcast({ type: "sites" })
      return sendJson(res, { ok: true })
    } catch (e) {
      return sendJson(res, { error: String((e as Error).message) }, 500)
    }
  }

  // upload of a pasted screenshot → written next to control.md, referenced as ![](file)
  if (path === "/api/upload" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, date, name, dataUrl } = body as { id: string; date: string; name: string; dataUrl: string }
    const dir = siteDir(id, date)
    if (!dir) return sendJson(res, { error: "unknown site" }, 404)
    const m = /^data:(image\/[a-z+]+);base64,(.+)$/s.exec(dataUrl || "")
    if (!m) return sendJson(res, { error: "bad image" }, 400)
    const ext = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" }[m[1]] || ".png"
    const safe = basename(name || "capture").replace(/[^a-z0-9._-]/gi, "-").replace(/\.[^.]*$/, "") + ext
    await writeFile(join(dir, safe), Buffer.from(m[2], "base64"))
    return sendJson(res, { file: safe })
  }

  // feedback: applies the comment to the site. The container cannot edit (neither Claude nor Playwright)
  // → we QUEUE an edit job for the WORKER (box), like the batches. Local fallback without a DB (dev).
  if (path === "/api/refill" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, date } = body as { id: string; date: string }
    if (!siteDir(id, date)) return sendJson(res, { error: "unknown site" }, 404)
    { const sp = await stopState().catch(() => null); if (sp?.on) return sendJson(res, { error: "Paused — resume to run", paused: true }, 409) }
    if (tryDb()) {
      // one job per site at a time : feedback while it is being rebuilt (or a second Apply) waits for the first
      const j = await pendingSiteJob(id)
      if (j) { const sh = await readSheet(id); return sendJson(res, { error: busySay(sh?.identity?.name || id, j), busy: true }, 409) }
      try {
        // what the comment says about the owner's taste is learned BEFORE the edit runs (it receives it too)
        const remember = await feedbackFrom(dir0(id, date), id, date)
        const row = await enqueueEdit(id, date, AUTH_USER)
        broadcast({ type: "batches" }); kickEngine()
        return sendJson(res, { ok: true, queued: true, batchId: row.id, remember, head: await feedbackHead(id, date, remember) })
      } catch (e) { return sendJson(res, { error: String((e as Error).message) }, 500) }
    }
    // local dev (no DB): the surgical editor (template-fill path). Missing from the open-source edition → say so
    if (!existsSync(join("design", "scripts", "edit.ts"))) return sendJson(res, { error: "Feedback is applied by the agent as a job: run `npm run db:init` (or try the sandbox), then it is queued for the agent", noDb: true }, 503)
    const remember = await feedbackFrom(dir0(id, date), id, date)
    refill(id, date) // spawn direct
    return sendJson(res, { ok: true, remember })
  }

  // ---- a prospect's assets: list / reorder / remove / add / upload / recompose ----
  if (path === "/api/assets") {
    const id = url.searchParams.get("id") || ""
    if (!validProspectId(id)) return sendJson(res, { error: "bad id" }, 400)
    const dir = safeUnder(DATA_ASSETS, id)
    const sheet = await readSheet(id)
    let files: string[] = []
    if (dir && isDir(dir)) files = (await readdir(dir)).filter((f) => !f.startsWith("."))
    const onDisk = new Set(files)
    const rel = (f: string) => `${id}/${f}`
    const logoName = sheet?.assets?.logo ? basename(sheet.assets.logo) : null
    const videoName = sheet?.assets?.video?.src ? basename(sheet.assets.video.src) : null
    const sheetPhotos: string[] = (sheet?.assets?.photos || []).map((p: string) => basename(p)).filter((n: string) => onDisk.has(n))
    const sheetSet = new Set(sheetPhotos)
    const extra = files.filter((f) => IMG_RE.test(f) && !sheetSet.has(f) && f !== logoName && !/^avant\./i.test(f))
    return sendJson(res, {
      id,
      logo: logoName && onDisk.has(logoName) ? rel(logoName) : null,
      video: videoName && onDisk.has(videoName) ? { src: rel(videoName), poster: sheet?.assets?.video?.poster ? rel(basename(sheet.assets.video.poster)) : null } : null,
      videosOnDisk: files.filter((f) => VID_RE.test(f)).map(rel),
      photos: sheetPhotos.map(rel),   // in the sheet's order
      extra: extra.map(rel),          // on disk but outside the sheet
    })
  }

  // reorder the sheet's photos (the filler follows this order)
  if (path === "/api/asset/order" && req.method === "POST") {
    const body = await parseBody(req); if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, order } = body as { id: string; order: string[] }
    if (!validProspectId(id) || !Array.isArray(order)) return sendJson(res, { error: "bad args" }, 400)
    const sheet = await readSheet(id); if (!sheet) return sendJson(res, { error: "unknown prospect" }, 404)
    sheet.assets = sheet.assets || { photos: [] }
    // always store "assets/<id>/<file>" (the filler resolves by basename)
    sheet.assets.photos = order.map((r) => `assets/${id}/${basename(String(r))}`)
    await writeSheet(id, sheet)
    logAssetEvent(id, "reorder", null, null)
    await reindexProspect(id).catch(() => {}) // re-indexes the rewritten sheet (photos) AND its assets
    broadcast({ type: "assets", id })
    return sendJson(res, { ok: true })
  }

  // remove a photo from the sheet (the file stays on disk, under "outside the sheet")
  if (path === "/api/asset/remove" && req.method === "POST") {
    const body = await parseBody(req); if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, rel } = body as { id: string; rel: string }
    if (!validProspectId(id) || !rel) return sendJson(res, { error: "bad args" }, 400)
    const name = basename(String(rel))
    const sheet = await readSheet(id); if (!sheet) return sendJson(res, { error: "unknown prospect" }, 404)
    sheet.assets = sheet.assets || { photos: [] } // sheet without an assets key → do not dereference undefined (500)
    if (sheet.assets.video && basename(sheet.assets.video.src) === name) delete sheet.assets.video
    else sheet.assets.photos = (sheet.assets.photos || []).filter((p: string) => basename(p) !== name)
    await writeSheet(id, sheet)
    logAssetEvent(id, "discard", `assets/${id}/${name}`, null)
    await reindexProspect(id).catch(() => {}) // re-indexes the rewritten sheet (photos) AND its assets
    broadcast({ type: "assets", id })
    return sendJson(res, { ok: true })
  }

  // (re)attach an "outside the sheet" file to the sheet (photo, logo or video)
  if (path === "/api/asset/add" && req.method === "POST") {
    const body = await parseBody(req); if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, rel, as } = body as { id: string; rel: string; as?: string }
    if (!validProspectId(id) || !rel) return sendJson(res, { error: "bad args" }, 400)
    const name = basename(String(rel))
    const sheet = await readSheet(id); if (!sheet) return sendJson(res, { error: "unknown prospect" }, 404)
    sheet.assets = sheet.assets || { photos: [] }
    const p = `assets/${id}/${name}`
    if (as === "logo") sheet.assets.logo = p
    else if (as === "video" || VID_RE.test(name)) sheet.assets.video = { src: p }
    else { sheet.assets.photos = sheet.assets.photos || []; if (!sheet.assets.photos.some((x: string) => basename(x) === name)) sheet.assets.photos.push(p) }
    await writeSheet(id, sheet)
    logAssetEvent(id, "add", null, p)
    await reindexProspect(id).catch(() => {}) // re-indexes the rewritten sheet (photos) AND its assets
    broadcast({ type: "assets", id })
    return sendJson(res, { ok: true })
  }

  // upload of an asset (photo/video/logo) as base64 → written to data/assets/<id>/ + added to the sheet
  if (path === "/api/asset/upload" && req.method === "POST") {
    const body = await parseBody(req); if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, name, dataUrl, as } = body as { id: string; name: string; dataUrl: string; as?: string }
    if (!validProspectId(id)) return sendJson(res, { error: "bad id" }, 400)
    const dir = safeUnder(DATA_ASSETS, id); if (!dir) return sendJson(res, { error: "bad id" }, 400)
    const m = /^data:([a-z0-9/+.-]+);base64,(.+)$/is.exec(dataUrl || "")
    if (!m) return sendJson(res, { error: "bad data" }, 400)
    const mime = m[1].toLowerCase()
    // strict ALLOWLIST (no svg/html: executable inline; no fallback deriving the ext from an arbitrary mime)
    const extByMime: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/avif": ".avif", "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov" }
    const ext = extByMime[mime]
    if (!ext) return sendJson(res, { error: "Unsupported file type (images and videos only)" }, 400)
    const safe = (basename(name || "asset").replace(/[^a-z0-9._-]/gi, "-").replace(/\.[^.]*$/, "") || "asset") + ext
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, safe), Buffer.from(m[2], "base64"))
    const p = `assets/${id}/${safe}`
    const sheet = await readSheet(id)
    if (sheet) {
      sheet.assets = sheet.assets || { photos: [] }
      if (as === "logo") sheet.assets.logo = p
      else if (as === "video" || /^video\//.test(mime)) sheet.assets.video = { src: p }
      else { sheet.assets.photos = sheet.assets.photos || []; sheet.assets.photos.push(p) }
      await writeSheet(id, sheet)
    }
    logAssetEvent(id, "add", null, p)
    await reindexProspect(id).catch(() => {}) // re-indexes the rewritten sheet (photos) AND its assets
    broadcast({ type: "assets", id })
    return sendJson(res, { file: `${id}/${safe}` })
  }

  // shared library: every asset of ALL prospects, deduplicated by fingerprint (hash)
  if (path === "/api/library") {
    try {
      const rows = await getDb().prepare("SELECT rel_path, kind, prospect_id, hash, mime FROM assets WHERE present=1 AND included=1 AND kind IN ('photo','video','logo') ORDER BY prospect_id").all() as any[]
      const byHash = new Map<string, { rel: string; kind: string; mime: string; usedBy: Set<string> }>()
      for (const r of rows) {
        const key = r.hash || r.rel_path
        const rel = String(r.rel_path).replace(/^assets\//, "") // → "<id>/<file>" (the form served by /asset/)
        const cur = byHash.get(key)
        if (cur) cur.usedBy.add(r.prospect_id)
        else byHash.set(key, { rel, kind: r.kind, mime: r.mime, usedBy: new Set([r.prospect_id]) })
      }
      const items = [...byHash.values()].map((x) => ({ rel: x.rel, kind: x.kind, mime: x.mime, usedBy: x.usedBy.size }))
      return sendJson(res, { items })
    } catch { return sendJson(res, { items: [] }) }
  }

  // reuse a library asset on the current prospect (copied into its folder + sheet)
  if (path === "/api/asset/from-library" && req.method === "POST") {
    const body = await parseBody(req); if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, rel } = body as { id: string; rel: string } // rel = "<srcId>/<file>"
    if (!validProspectId(id) || !rel) return sendJson(res, { error: "bad args" }, 400)
    const src = safeUnder(DATA_ASSETS, String(rel))
    if (!src || !existsSync(src)) return sendJson(res, { error: "File not found" }, 404)
    const sheet = await readSheet(id); if (!sheet) return sendJson(res, { error: "unknown prospect" }, 404)
    const name = basename(String(rel))
    const destDir = safeUnder(DATA_ASSETS, id); if (!destDir) return sendJson(res, { error: "bad id" }, 400)
    await mkdir(destDir, { recursive: true })
    const dest = join(destDir, name)
    if (resolve(src) !== resolve(dest)) await copyFile(src, dest) // physical copy into the prospect's folder
    sheet.assets = sheet.assets || { photos: [] }
    const p = `assets/${id}/${name}`
    if (VID_RE.test(name)) sheet.assets.video = { src: p }
    else { sheet.assets.photos = sheet.assets.photos || []; if (!sheet.assets.photos.some((x: string) => basename(x) === name)) sheet.assets.photos.push(p) }
    await writeSheet(id, sheet)
    logAssetEvent(id, "add", `assets/${rel}`, p, "from library")
    await reindexProspect(id).catch(() => {})
    broadcast({ type: "assets", id })
    return sendJson(res, { ok: true, file: `${id}/${name}` })
  }

  // recompute: the asset swap "acts on it" → full re-fill (guarded by a UI confirm)
  if (path === "/api/asset/refill" && req.method === "POST") {
    const body = await parseBody(req); if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id } = body as { id: string }
    if (!validProspectId(id) || !existsSync(join(PROSPECTS, `${id}.json`))) return sendJson(res, { error: "unknown prospect" }, 404)
    if (currentRun) return sendJson(res, { error: "A run is in progress — try again after it" }, 409) // no fill during a run
    runJob(`fill:${id}`, ["run", "fill", "--", id], `rebuild (filler) after asset swap: ${id}`, { id })
    return sendJson(res, { ok: true })
  }

  // start the full pipeline live (cockpit) — one run at a time
  if (path === "/api/pipeline" && req.method === "POST") {
    const body = (await parseBody(req)) || {}
    const ok = startPipeline({ limit: Number(body.limit) || 0, force: !!body.force, design: body.design !== false })
    return ok ? sendJson(res, { ok: true }) : sendJson(res, { error: "A run is already in progress" }, 409)
  }
  // state of a running run (re-hydration of a client that opens the page during a run)
  if (path === "/api/run") return sendJson(res, currentRun ? { active: true, startedAt: currentRun.startedAt, rows: Object.values(currentRun.rows) } : { active: false })

  // ---- batch QUEUE (cloud): the cockpit pushes, the WORKER (box) pops ----
  // In a Coolify container, the cockpit cannot build by itself (no Claude Code/Playwright):
  // "start a batch" writes a request into Supabase; the native worker on the box picks it up.
  if (path === "/api/batch" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "expected {mode, ids?}" }, 400)
    if (body.mode !== "composer" && body.mode !== "template-fill") return sendJson(res, { error: `Unknown build mode${typeof body.mode === "string" ? `: ${body.mode.slice(0, 40)}` : ""} (composer)` }, 400)
    if (body.ids !== undefined && !Array.isArray(body.ids)) return sendJson(res, { error: "ids: a list of prospects" }, 400)
    if (!tryDb()) return sendJson(res, { error: noDbReason(), noDb: true }, 503)
    { const st = await stopState().catch(() => null); if (st?.on) return sendJson(res, { error: "Paused — resume to run", paused: true }, 409) }
    const mode: BatchMode = body.mode
    const lim = Number(body.limit) || null
    const industry = typeof body.industry === "string" && body.industry.trim() ? body.industry.trim() : null
    let ids: string[], remember: Awaited<ReturnType<typeof onRebuild>> = null
    if (Array.isArray(body.ids)) {
      ids = body.ids.filter(validProspectId).slice(0, 200)
      if (!ids.length) return sendJson(res, { error: "No prospect to build" }, 400)
      // only prospects the agency knows : an unknown id would spend a build on nothing (and show a site for no one)
      const unknown: string[] = []; for (const id of ids) if (!(await prospectExists(id))) unknown.push(id)
      if (unknown.length) return sendJson(res, { error: `Not a prospect of this agency: ${unknown.slice(0, 3).join(", ")}${unknown.length > 3 ? ` and ${unknown.length - 3} more` : ""}`, unknown }, 404)
      // one job per site at a time : a site already building or getting feedback is never queued twice (paid twice)
      const busyIds: string[] = []; let firstBusy: { id: string; job: { mode: string } } | null = null
      for (const id of ids) { const j = await pendingSiteJob(id); if (j) { busyIds.push(id); firstBusy ||= { id, job: j } } }
      if (busyIds.length === ids.length && firstBusy) { const sh = await readSheet(firstBusy.id); return sendJson(res, { error: ids.length === 1 ? busySay(sh?.identity?.name || firstBusy.id, firstBusy.job) : "These sites are already being built.", busy: busyIds }, 409) }
      ids = ids.filter((id) => !busyIds.includes(id))
      // a rebuild says « not this one » about the version it replaces (and what you wrote is learned before it builds)
      remember = await onRebuild(ids, typeof body.feedback === "string" ? body.feedback : null).catch(() => null)
    } else {
      // no ids : the cockpit picks the next NEW prospects itself (best first), never a skipped, built or building one
      const list = await prospectsList() as any
      ids = list.items.filter((x: any) => x.status === "new" && (!industry || x.industry === industry)).sort((a: any, b: any) => Number(b.strong) - Number(a.strong)).slice(0, lim || 1).map((x: any) => x.id)
      if (!ids.length) return sendJson(res, { error: "Nothing new to build: every prospect is built, being built or skipped" }, 400)
    }
    // today's cap in builds : said back (« 3 today, 2 tomorrow ») ; the engine keeps to it whoever queued the job
    const bt = mode === "composer" ? await buildsToday() : null
    const asked = ids.length || lim || 1
    const today = bt && bt.left != null ? Math.min(asked, bt.left) : asked
    try {
      const row = await enqueueBatch({
        mode, industry,
        seed: typeof body.seed === "string" && body.seed.trim() ? body.seed.trim() : null,
        lim,
        force: !!body.force,
        requestedBy: AUTH_USER, // the authenticated operator (Basic Auth); otherwise "lws"
        note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
        ids,
      })
      broadcast({ type: "batches" }); kickEngine()
      return sendJson(res, { ok: true, id: row.id, today, tomorrow: Math.max(0, asked - today), buildsCap: bt?.cap ?? null, ...(remember ? { remember } : {}) })
    } catch (e) {
      // without a database, the queue does not exist: 503 and the steps to follow (like /api/crm/split), not an opaque 500
      if (!tryDb()) return sendJson(res, { error: "No database: builds run as jobs (DATABASE_URL + npm run db:init), or run `npm run batch -- composer` locally" }, 503)
      return sendJson(res, { error: String((e as Error).message) }, 500)
    }
  }
  // the queue (last N batches) — for the cockpit's "batches" panel
  if (path === "/api/batches") {
    try { return sendJson(res, { batches: await listBatches(30) }) }
    catch (e) { return sendJson(res, { batches: [], error: String((e as Error).message) }) }
  }

  // scheduling state (cron/systemd): last run + status + installed? + next runs (best-effort)
  if (path === "/api/schedule") {
    const home = process.env.HOME || ""
    const jobs: Record<string, unknown> = {}
    const JOBS = ["pipeline", "review", "scrape", "sequencer", "learn"] // architecture/scheduling/lws-<job>.{service,timer}
    for (const j of JOBS) {
      const f = join("data/logs", `last-${j}.json`)
      let last: unknown = null
      if (existsSync(f)) { try { last = JSON.parse(await readFile(f, "utf8")) } catch { /* */ } }
      const installed = home ? existsSync(join(home, ".config/systemd/user", `lws-${j}.timer`)) : false
      jobs[j] = { last, installed }
    }
    const timers = await execCapture("systemctl", ["--user", "list-timers", ...JOBS.map((j) => `lws-${j}.timer`), "--all", "--no-pager"]).catch(() => "")
    return sendJson(res, { jobs, timers: timers.trim() || null })
  }

  if (path === "/api/templates") return sendJson(res, await readTemplates())
  if (path === "/api/fonts") return sendJson(res, await readFonts())
  if (path === "/api/designfonts") return sendJson(res, await readDesignFonts())

  // ---- brain: the brain (.claude/ skills + skillstash ideas), funnel ideas → test → active ----
  if (path === "/api/brain") return sendJson(res, { skills: await readSkills(), stash: await readStash() })

  // change request on a skill (the skills' "comment" loop, like control.md)
  if (path === "/api/skill-feedback" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { name, text } = body as { name: string; text: string }
    const dir = skillDir(name)
    if (!dir) return sendJson(res, { error: "unknown skill" }, 404)
    const fb = join(dir, "feedback.md")
    const clean = (text ?? "").trim()
    if (clean) await writeFile(fb, clean + "\n")
    else await rm(fb, { force: true }) // comment emptied → no ghost feedback.md (0 bytes)
    return sendJson(res, { ok: true })
  }

  // put an idea to the test / draft by hand → skill draft in TEST MODE
  if (path === "/api/skill-draft" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const slug = String((body.name ?? "")).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    if (!slug) return sendJson(res, { error: "bad name" }, 400)
    const dir = safeUnder(SKILLS_DIR, slug)
    if (!dir) return sendJson(res, { error: "bad name" }, 400)
    if (existsSync(dir)) return sendJson(res, { error: "That skill already exists" }, 409)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, "SKILL.md"), draftScaffold(slug, String(body.brief ?? ""), String(body.signal ?? "")))
    return sendJson(res, { ok: true, slug })
  }

  // promote a skill in test → active (removes status: test + the warning)
  if (path === "/api/skill-promote" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const dir = skillDir(String(body.name ?? ""))
    if (!dir) return sendJson(res, { error: "unknown skill" }, 404)
    const file = existsSync(join(dir, "SKILL.md")) ? join(dir, "SKILL.md") : join(dir, "prompt.md")
    if (!existsSync(file)) return sendJson(res, { error: "no skill file" }, 404)
    let txt = await readFile(file, "utf8")
    txt = txt.replace(/^status:\s*test\s*$\n?/im, "") // removes the frontmatter line
      .replace(/^>.*mode test[\s\S]*?(?:\n\n|\n(?=#))/im, "") // retire l'avertissement ⚠
    await writeFile(file, txt)
    return sendJson(res, { ok: true })
  }

  // lab notes per template (gitignored under output/lab/)
  if (path === "/api/notes") {
    const slug = (url.searchParams.get("slug") || "").replace(/[^a-z0-9._-]/gi, "").replace(/^\.+/, "") // never "....x.md"
    if (!slug) return sendJson(res, { error: "bad slug" }, 400)
    const file = join(LAB_NOTES, slug + ".md")
    if (req.method === "POST") {
      const body = await parseBody(req)
      if (!body) return sendJson(res, { error: "bad json" }, 400)
      const { text } = body as { text: unknown }
      if (text != null && typeof text !== "string") return sendJson(res, { error: "text must be a string" }, 400)
      await mkdir(LAB_NOTES, { recursive: true })
      await writeFile(file, text ?? "")
      return sendJson(res, { ok: true })
    }
    return sendJson(res, { text: existsSync(file) ? await readFile(file, "utf8") : "" })
  }

  // flux live
  if (path === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive",
    })
    res.write("data: " + JSON.stringify({ type: "connected" }) + "\n\n")
    // replay of events missed during an outage (native gap recovery through Last-Event-ID)
    const last = Number(req.headers["last-event-id"] || 0)
    if (last) for (const e of ring) if (e.id > last) { try { res.write(e.line) } catch { /* parti */ } }
    clients.add(res)
    // heartbeat = a real event (outside the ring): also reports the WATCHER'S HEALTH (not just the socket's)
    const beat = setInterval(() => {
      try { res.write(`data: ${JSON.stringify({ type: "heartbeat", watch: watchOk })}\n\n`) } catch { clearInterval(beat) }
    }, 30000)
    req.on("close", () => { clearInterval(beat); clients.delete(res) })
    return
  }

  // ---- frontend statique ----
  if (path.startsWith("/api/")) return sendJson(res, { error: `Unknown API route ${path}` }, 404)
  const rel = path === "/" ? "index.html" : path.slice(1)
  const target = safeUnder(PUBLIC, rel)
  return target ? sendFile(res, target) : sendJson(res, { error: "bad path" }, 400)
}

// ---- fs.watch → SSE (fichier → UI) ----
function startWatch(dir: string, kind: "sites" | "templates" | "skills" | "assets"): void {
  if (!existsSync(dir)) return
  let timer: ReturnType<typeof setTimeout> | null = null
  // changed control.md files (for the 'control' broadcast) AND touched folders (for the reindex, ANY change)
  const pendingControl = new Map<string, { id: string; date: string }>()
  const touched = new Set<string>() // "id/slug" (sites) or "id" (assets)
  try {
    watch(dir, { recursive: true }, (_e, filename) => {
      const name = filename ? filename.toString() : ""
      const parts = name.split(sep)
      if (kind === "sites" && parts.length >= 2 && parts[0] && parts[1]) {
        touched.add(`${parts[0]}/${parts[1]}`) // index.html, assets, control.md… everything counts
        if (name.endsWith("control.md")) pendingControl.set(`${parts[0]}/${parts[1]}`, { id: parts[0], date: parts[1] })
      } else if (kind === "assets" && parts[0]) {
        touched.add(parts[0])
      }
      if (timer) clearTimeout(timer)
      timer = setTimeout(async () => {
        // the watcher does REAL work: it updates the DB BEFORE notifying the UI (which will re-read the DB)
        if (kind === "sites") {
          for (const key of touched) {
            const i = key.indexOf("/")
            const id = key.slice(0, i), slug = key.slice(i + 1)
            try { await reindexSite(id, slug); await reindexAssets(id) } catch { /* best-effort */ }
          }
          touched.clear()
          broadcast({ type: "sites" })
          for (const c of pendingControl.values()) broadcast({ type: "control", ...c })
          pendingControl.clear()
        } else if (kind === "assets") {
          for (const id of touched) { try { await reindexAssets(id) } catch { /* */ } broadcast({ type: "assets", id }) }
          touched.clear()
        } else if (kind === "skills") {
          try { await reindexSkills(); await reindexStash() } catch { /* best-effort */ }
          broadcast({ type: kind })
        } else {
          broadcast({ type: kind })
        }
      }, 150)
    })
  } catch {
    watchOk = false // the heartbeat will report it to the UI ("stale" dot), and the poller takes over
    console.warn(`ℹ Live file watching is not available for ${dir}: checking every few seconds instead.`)
  }
}

// ---- backup poller: recursive fs.watch can miss events / exhaust inotify (ENOSPC) on Linux.
// We stat a light signature (mtime of the folders + the control.md files); if it moves → reindex + 'sites'.
// It is the FLOOR that guarantees eventual consistency even if the watcher is dead.
function sitesSignature(): string {
  let sig = ""
  try {
    for (const id of readdirSync(SITES)) {
      const idDir = join(SITES, id); if (!isDir(idDir)) continue
      for (const d of readdirSync(idDir)) {
        const p = join(idDir, d); if (!isDir(p)) continue
        let dm = 0, cm = 0
        try { dm = Math.round(statSync(p).mtimeMs) } catch { /* */ }
        try { cm = Math.round(statSync(join(p, "control.md")).mtimeMs) } catch { /* */ }
        sig += `${id}/${d}:${dm}/${cm};`
      }
    }
    // prospect sheets (manual edit / outside the API) — the poller catches them (data/prospects is not watched)
    for (const f of readdirSync(PROSPECTS)) {
      if (!f.endsWith(".json")) continue
      try { sig += `p:${f}:${Math.round(statSync(join(PROSPECTS, f)).mtimeMs)};` } catch { /* */ }
    }
  } catch { /* */ }
  return sig
}
let lastSig = ""
// anti-pile-up guard: a reindexAll (heavy at 100+ sites, ~min) must not restart while it is already running.
let reindexing = false
async function safeReindexAll(): Promise<{ prospects: number; generations: number; ms: number } | null> {
  if (reindexing) return null
  reindexing = true
  try { return await reindexAll() } catch { return null } finally { reindexing = false }
}
function startPoller(): void {
  setInterval(async () => {
    if (reindexing) return // a reindex is running → do not pile up
    const sig = sitesSignature()
    if (sig !== lastSig) { lastSig = sig; await safeReindexAll(); broadcast({ type: "sites" }) }
  }, 8000)
}

// ---- findOpenPort (see impeccable/live-server.mjs), bounded to fail clearly ----
function findOpenPort(start: number, ceiling = start + 100): Promise<number> {
  return new Promise((res, rej) => {
    if (start > ceiling || start > 65535) {
      return rej(new Error(`no free port between ${ceiling - 100} and ${Math.min(ceiling, 65535)}`))
    }
    const srv = netServer()
    srv.listen(start, HOST, () => { const p = (srv.address() as { port: number }).port; srv.close(() => res(p)) })
    srv.on("error", () => res(findOpenPort(start + 1, ceiling)))
  })
}

const PREFERRED = parseInt(process.env.BACKOFFICE_PORT || "4000", 10)
const port = await findOpenPort(PREFERRED)

// idempotent migration: `love` column (0-3, the sorting heart) — additive, does not touch db.ts
try { await getDb().prepare("ALTER TABLE generations ADD COLUMN IF NOT EXISTS love INTEGER DEFAULT 0").run() } catch { /* no DB locally → FS fallback, no love */ }
// idempotent migration: `scores_json` column (0-100 score per axis + "why") — additive, feeds learning/
try { await getDb().prepare("ALTER TABLE generations ADD COLUMN IF NOT EXISTS scores_json TEXT").run() } catch { /* no DB locally → FS fallback, no scoring */ }
// CRM table (2 pipelines: hot lead → closing) — idempotent, additive, does not touch db.ts.
// pipeline 'hot' : call0→relance1→relance2→relance3→nurturing · pipeline 'closing' : demo→propal→nego→signature.
// notes_json = [{at, outcome:'reach'|'unreach'|'rdv'|'note', text}]. An approved prospect without a row enters hot/call0 (see /api/crm).
try {
  await getDb().prepare(`CREATE TABLE IF NOT EXISTS crm_leads(
    prospect_id TEXT PRIMARY KEY,
    pipeline TEXT NOT NULL DEFAULT 'hot',
    stage TEXT NOT NULL DEFAULT 'call0',
    call_count INTEGER NOT NULL DEFAULT 0,
    rdv_at BIGINT,
    nurturing_until BIGINT,
    notes_json TEXT NOT NULL DEFAULT '[]',
    linkedin TEXT,
    call_script TEXT,
    research_json TEXT,
    updated_at BIGINT
  )`).run()
  // additive (tables already created): call script + research brief (skill /account-research)
  await getDb().prepare("ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS call_script TEXT").run()
  await getDb().prepare("ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS research_json TEXT").run()
  // operator assignment (an id from agency.config.json › operators): who calls this prospect. NULL = unassigned.
  await getDb().prepare("ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS assigned_to TEXT").run()
  // phone tag: 1 = answered (green) · 0 = no answer (red) · NULL = never called. Decoupled from the stage.
  await getDb().prepare("ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS answered INTEGER").run()
} catch { /* no DB locally → no CRM (the platform says so) */ }

// ⚡ START THE SERVER FIRST — otherwise, with 100+ sites, the boot reindex (~2 min) blocks BEFORE
// the server listens → traefik returns "502 Bad Gateway" the whole time. The cockpit
// answers right away (it reads the already indexed Supabase); the reindex runs IN THE BACKGROUND.
createServer((req, res) => {
  handle(req, res).catch((e) => {
    try { sendJson(res, { error: String(e?.message || e) }, 500) } catch { /* noop */ }
  })
}).listen(port, HOST, () => {
  console.log(`✓ Cockpit → http://${HOST}:${port}`)
  console.log(`  Your sites are read from ${SITES}/ · Ctrl-C to stop`)
  if (ALLOWED_HOST) {
    console.log(`  Shared through a tunnel: host « ${ALLOWED_HOST} » allowed · password ${AUTH_PASS ? "on ✓" : "OFF"}`)
    if (!AUTH_PASS) console.warn(`  ⚠ An outside host is allowed WITHOUT a password: set BACKOFFICE_PASSWORD before you open the tunnel`)
  }
})

// DB index at boot, NON-BLOCKING (best-effort) — the cockpit was already serving before it finished.
lastSig = sitesSignature() // baseline for the poller (avoids a false positive on the 1st tick)
safeReindexAll().then((r) => {
  if (r) console.log(`✓ Indexed → ${r.prospects} prospects · ${r.generations} sites · ${r.ms} ms`)
  else console.log(`ℹ No database: reading output/ and data/ directly.`)
})
startWatch(SITES, "sites")
startWatch(TEMPLATES, "templates")
startWatch(SKILLS_DIR, "skills")
startWatch(DATA_ASSETS, "assets")
startPoller()
