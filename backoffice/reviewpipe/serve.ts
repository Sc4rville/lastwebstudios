/**
 * serve.ts — LA STATION DE CONTRÔLE (maillon 4 : review humaine).
 *
 * Un seul serveur `node:http` (lancé via tsx), bind 127.0.0.1 uniquement. C'est un SCRIPT :
 * AUCUN LLM ici. Il READ output/ + design/templates/ + video/fonts/, et n'ÉCRIT que :
 *   - la section `## commentaire` d'un control.md (via control.ts),
 *   - les captures collées dans le dossier daté d'un site (feedback visuel),
 *   - les notes du lab dans output/lab/ (gitignoré).
 * Le rebuild est délégué au filler (npm run fill / review:batch). Live via SSE + fs.watch.
 *
 * Usage : npm run backoffice
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { createServer as netServer } from "node:net"
import { watch, existsSync, statSync, realpathSync, createReadStream, readdirSync } from "node:fs"
import { readFile, writeFile, readdir, stat, mkdir, rm, copyFile, appendFile } from "node:fs/promises"
import { listInvoices, getInvoice, createInvoice, updateInvoice, createAvoir, getSettings, saveSettings, renderInvoiceHtml, withTotals } from "./invoices.ts"
import { join, resolve, extname, sep, basename } from "node:path"
import { spawn } from "node:child_process"
import { timingSafeEqual, createHmac } from "node:crypto"
import { lineSplitter, textCollector } from "../../packages/shared/lines.mjs"
import { parseControl, writeCommentText } from "../../packages/shared/control.ts"
import { readTemplates, readFonts } from "./templates.ts"
import { readSkills, readStash, SKILLS_DIR } from "./skills.ts"
import { getDb, tryDb } from "../../packages/shared/db.ts"
import { reindexAll, reindexSite, reindexProspect, reindexAssets, reindexSkills, reindexStash } from "../../packages/shared/reindex.ts"
import { enqueueBatch, enqueueEdit, enqueueResearch, listBatches, type BatchMode } from "../../packages/shared/batch.ts"
import { urlFor, storageBase, exists as storageExists } from "../../packages/shared/storage.ts"
import { handleTracking } from "../../outreach/tracking/endpoint.ts"
import { readEvents } from "../../outreach/tracking/events.ts"
import { cageStatus, setStop, loadBreaker, saveBreaker } from "../../packages/shared/cage.ts"
import { evaluateBreaker, resetBreaker } from "../../packages/shared/breaker.ts"
import { recordOutcome } from "../../learning/scripts/record.ts"
import { machineSnapshot } from "./machine.ts"
import { agency, agencyFile } from "../../packages/shared/agency.mjs"
import { startEngine, kickEngine, jobsView, type JobEvent } from "./engine.ts"
import { interpretBrief, pickMix } from "./brief.ts"

try {
  process.loadEnvFile()
} catch {
  /* pas de .env : on lira l'environnement (le refill en a besoin pour l'API) */
}

const HOST = process.env.BACKOFFICE_HOST || "127.0.0.1" // 0.0.0.0 en conteneur (Hetzner/Coolify) ; loopback en local
// ── partage via tunnel (cloudflared) : station reste bindée loopback ; le tunnel la relaie ──
// BACKOFFICE_ALLOWED_HOST : domaine du tunnel à autoriser (ex: ".trycloudflare.com" = tout sous-domaine).
// BACKOFFICE_PASSWORD : si défini, exige une auth Basic sur TOUTE requête (sinon : local, pas d'auth).
const ALLOWED_HOST = (process.env.BACKOFFICE_ALLOWED_HOST || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase()
const AUTH_USER = process.env.BACKOFFICE_USER || "lws"
const AUTH_PASS = process.env.BACKOFFICE_PASSWORD || ""
function hostAllowed(h: string): boolean {
  const host = (h || "").replace(/:\d+$/, "").toLowerCase()
  if (/^(127\.0\.0\.1|localhost|\[?::1\]?)$/.test(host)) return true
  if (AUTH_PASS) return true // un mot de passe est configuré → il protège déjà ; pas besoin d'allowlister l'hôte (Hetzner/Coolify)
  if (!ALLOWED_HOST) return false
  return ALLOWED_HOST.startsWith(".") ? host === ALLOWED_HOST.slice(1) || host.endsWith(ALLOWED_HOST) : host === ALLOWED_HOST
}
function authOk(req: IncomingMessage): boolean {
  if (!AUTH_PASS) return true // pas de mot de passe configuré → usage local, pas d'auth
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
const DESIGN_FONTS = "design/fonts" // bibliothèque de fonts (Host Grotesk, Geist…) servie via /designfont/
const DATA_ASSETS = "data/assets"
const PUBLIC = "backoffice/reviewpipe/public"
const OUTREACH = "data/outreach"        // records outreach par prospect (préparés par `npm run outreach`)
const LAB_NOTES = "output/lab/templates" // gitignoré (output/), comme les control.md

// Catalogue de typo (design/fonts) pour le lab : familles + face représentative + blacklist + paires curées.
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
// types streamés avec support des Range requests (seek vidéo)
const STREAMABLE = new Set([".mp4", ".webm", ".mov"])

// ---- garde-fous chemins : résout `rel` SOUS `base`, refuse `..` ET les symlinks qui s'échappent ----
function safeUnder(base: string, rel: string): string | null {
  const baseAbs = resolve(base)
  let clean: string
  try { clean = decodeURIComponent(rel).replace(/^\/+/, "") } catch { return null }
  const target = resolve(baseAbs, clean)
  if (target !== baseAbs && !target.startsWith(baseAbs + sep)) return null
  // resolve() ne canonicalise pas les liens : un symlink sous `base` pointant dehors passerait le
  // test lexical. On vérifie le chemin RÉEL quand la cible existe (sinon sendFile fera un 404).
  try {
    if (existsSync(target)) {
      const real = realpathSync(target)
      if (real !== baseAbs && !real.startsWith(baseAbs + sep)) return null
    }
  } catch { return null }
  return target
}

// statSync tolérant : un symlink cassé ou une entrée supprimée en cours de scan ne casse pas la boucle
function isDir(p: string): boolean {
  try { return statSync(p).isDirectory() } catch { return false }
}

const NOSNIFF = { "X-Content-Type-Options": "nosniff" } // pas de MIME-sniffing d'un asset uploadé en HTML
// Cache navigateur : on cache LONG le lourd qui se répète (images/fonts/vidéo — surtout avant.png ~4 Mo
// et les woff2) → re-cliquer un site ne re-télécharge plus tout. Le shell de la station (html/js/css) et
// les données live (json/md) restent FRAIS (no-cache) pour voir les changements sans hard-refresh.
const cacheCtl = (type: string) => /^(image|font|video)\//.test(type) ? "public, max-age=86400" : "no-cache"
async function sendFile(res: ServerResponse, absPath: string, req?: IncomingMessage): Promise<void> {
  try {
    let p = absPath
    let st = await stat(p)
    if (st.isDirectory()) { p = join(p, "index.html"); st = await stat(p) }
    const ext = extname(p).toLowerCase()
    const type = MIME[ext] || "application/octet-stream"
    // vidéo : streaming + Range (seek nécessaire sur Safari/Chrome, sinon pas de lecture)
    if (STREAMABLE.has(ext)) {
      const size = st.size
      // pipe SÛR : un 'error' sans listener = exception non catchée (les headers sont déjà envoyés → pas
      // de promesse à rejeter) = CRASH du process. On consomme l'erreur ; on détruit le stream si le
      // client part en plein milieu (sinon le fd fuit).
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
        else { start = parseInt(m[1], 10); end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1 } // end clampé à size-1
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

// repli STORAGE : un média local manquant (gitignoré, absent de la VM — ex. hero.mp4) → 302 vers le bucket.
function redirectTo(res: ServerResponse, url: string): void {
  res.writeHead(302, { Location: url, "Cache-Control": "no-cache" })
  res.end()
}

// Placeholder d'aperçu (jamais de « Not found » brut) : page principale d'un site pas encore bâti.
// Servi dans l'iframe → l'opérateur voit « génération en cours », pas un 404 cassé.
function sendPreviewPlaceholder(res: ServerResponse): void {
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>génération en cours</title></head>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#141417;color:#a8a8b2;font:15px/1.6 system-ui,-apple-system,sans-serif">
<div style="text-align:center;padding:24px">
  <div style="width:34px;height:34px;margin:0 auto 18px;border:3px solid #27272c;border-top-color:#d8ff3e;border-radius:50%;animation:s 1s linear infinite"></div>
  <div style="color:#f1f1f4;font-size:16px">génération en cours…</div>
  <div style="margin-top:6px;font-size:13px;color:#6b6b73">l'aperçu s'affiche dès que le site est bâti</div>
</div>
<style>@keyframes s{to{transform:rotate(360deg)}}</style></body></html>`
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...NOSNIFF })
  res.end(html)
}

// Placeholder IMAGE du « avant » (jamais d'image cassée) : si la capture manque vraiment (local ET bucket),
// on sert un visuel propre au lieu d'un 404 → le comparateur reste présentable. SVG = rendu net, léger.
function sendAvantPlaceholder(res: ServerResponse): void {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900">
<rect width="1440" height="900" fill="#141417"/>
<text x="720" y="450" fill="#6b6b73" font-family="system-ui,sans-serif" font-size="34" font-weight="600" text-anchor="middle">capture « avant » indisponible</text>
<text x="720" y="498" fill="#46464d" font-family="system-ui,sans-serif" font-size="20" text-anchor="middle">le site d'origine sera re-capturé</text></svg>`
  res.writeHead(200, { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store", ...NOSNIFF })
  res.end(svg)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((res, rej) => {
    // octets accumulés puis décodés UNE fois : un accent coupé entre deux paquets TCP restait « �� » (commentaire, note)
    const body = textCollector()
    req.on("data", (c: Buffer) => {
      body.push(c)
      if (body.bytes > 16_000_000) { rej(new Error("payload too large")); req.destroy() }
    })
    req.on("end", () => res(body.text()))
    req.on("error", rej)
  })
}

// parse JSON tolérant : null si corps absent/malformé ou pas un OBJET (un tableau `[…]` passait, puis plantait
// les handlers qui lisent body.id) → l'appelant renvoie 400 (pas 500)
async function parseBody(req: IncomingMessage): Promise<any> {
  try {
    const obj = JSON.parse(await readBody(req))
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null
  } catch { return null }
}

// ---- état des sites : lu depuis la DB (cache du FS), repli sur le parcours direct ----
// `date` = le nom de dossier COMPLET (dir_slug, ex: 2026-06-08-composer) → contrat préservé avec l'UI.
interface SiteRow {
  id: string; date: string; hasIndex: boolean
  template: string; counts: string; generated: string; history: string[]; hasComment: boolean
  status?: string; variant?: string | null; genDate?: string | null
  name?: string; city?: string; oppScore?: number | null; oppTier?: string | null
  love?: number // 0-3 : niveau d'amour (tag de tri sur les cartes), indépendant du status workflow
}

// la DB : une requête, plus de parcours+parse à chaque appel ; enrichie du statut (DB-owned) + fiche.
async function listSitesDb(): Promise<SiteRow[]> {
  const rows = await getDb().prepare(`
    SELECT g.prospect_id AS id, g.dir_slug AS date, g.gen_date AS "genDate", g.variant AS variant,
           g.has_index AS "hasIndex", g.template AS template, g.counts AS counts,
           g.generated_label AS generated, g.has_comment AS "hasComment", g.status AS status,
           COALESCE(g.love, 0) AS love,
           p.name AS name, p.city AS city, p.opp_score AS "oppScore", p.opp_tier AS "oppTier"
    FROM generations g LEFT JOIN prospects p ON p.id = g.prospect_id
    WHERE g.present = 1
    ORDER BY g.gen_date DESC NULLS LAST, COALESCE(g.created_at, g.indexed_at, 0) DESC, g.prospect_id ASC
  `).all() as any[]
  return rows.map((r) => ({
    id: r.id, date: r.date, genDate: r.genDate, variant: r.variant,
    hasIndex: !!r.hasIndex, template: r.template ?? "", counts: r.counts ?? "",
    generated: r.generated ?? "", history: [], hasComment: !!r.hasComment,
    status: r.status ?? "draft", name: r.name ?? "", city: r.city ?? "",
    oppScore: r.oppScore ?? null, oppTier: r.oppTier ?? null, love: r.love ?? 0,
  }))
}

// repli : la DB est un CACHE, jamais une dépendance dure → si elle manque, on parcourt le FS.
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
      // récence réelle : mtime du control.md (écrit à la génération + à chaque édit), repli sur le dossier
      let mt = 0
      try { mt = statSync(existsSync(ctlPath) ? ctlPath : dir).mtimeMs } catch { /* */ }
      rows.push({ mt, row: {
        id, date, hasIndex: existsSync(join(dir, "index.html")),
        template: ctl?.template ?? "", counts: ctl?.counts ?? "", generated: ctl?.generated ?? "",
        history: ctl?.history ?? [], hasComment: ctl?.hasComment ?? false, status: "draft",
      } })
    }
  }
  // le plus récemment touché EN TÊTE (fini de chercher) ; repli déterministe date puis id
  rows.sort((a, b) => b.mt - a.mt || b.row.date.localeCompare(a.row.date) || a.row.id.localeCompare(b.row.id))
  return rows.map((r) => r.row)
}

async function listSites(): Promise<SiteRow[]> {
  try { return await listSitesDb() } catch { return listSitesFs() }
}

// repli DISQUE du lead pipe (pas de DB) : mêmes champs que la requête SQL de /api/leads, lus dans les fiches
// data/prospects/*.json ; hasSite = au moins un dossier de output/sites/<id>/ avec index.html. Trié pareil.
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
      id, name: s.identity?.name ?? null, city: s.identity?.city ?? null, industry: s.industry ?? null,
      oppScore: typeof s.score?.value === "number" ? s.score.value : null, oppTier: s.score?.tier ?? null,
      oldUrl: s.existing?.url ?? null, hasSite,
    })
  }
  out.sort((a, b) => (b.oppScore ?? -1) - (a.oppScore ?? -1) || String(a.name ?? "").localeCompare(String(b.name ?? "")))
  return out.slice(0, 2000)
}

// la DERNIÈRE génération d'un prospect (dossier daté avec index.html) — pour vidéo/préparation outreach.
async function latestGen(id: string): Promise<string> {
  const base = join(SITES, id)
  if (!validProspectId(id) || !existsSync(base)) return ""
  const dirs = (await readdir(base)).filter((d) => existsSync(join(base, d, "index.html"))).sort()
  return dirs.length ? dirs[dirs.length - 1] : ""
}

// le dossier d'un site, validé (existe vraiment, pas d'échappée) — pour control.md / upload
// `date` = le dir_slug COMPLET : YYYY-MM-DD avec suffixe variant optionnel (-composer, -freetest…).
function siteDir(id: string, date: string): string | null {
  if (!/^[a-z0-9._-]+$/i.test(id) || !/^\d{4}-\d{2}-\d{2}(-[a-z0-9._-]+)?$/i.test(date)) return null
  const dir = safeUnder(SITES, `${id}/${date}`)
  if (!dir || !isDir(dir)) return null
  return dir
}

// id de prospect validé (pour data/assets/<id>/ et data/prospects/<id>.json)
// typeof d'abord : `test(undefined)` teste la chaîne « undefined » (vrai !) puis `.includes` plantait en 500 (test blitz)
function validProspectId(id: unknown): id is string { return typeof id === "string" && /^[a-z0-9._-]+$/i.test(id) && !id.includes("..") }

// ── home : ce que l'entrepreneur veut savoir, jamais la mécanique ──
async function homeSnapshot(): Promise<unknown> {
  const weekAgo = Date.now() - 7 * 86400_000
  // prospects : trouvés cette semaine (fichiers de scoring récents ou fiches), « good fit » = hot/warm
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
  // sites : construits, en attente de ta revue (draft), en construction
  const sites = await listSites()
  const built = sites.filter((x) => x.hasIndex).length
  const toReview = sites.filter((x) => x.hasIndex && (x.status === "draft" || !x.status)).length
  let building = 0
  try { building = (await listBatches(30)).filter((b) => b.mode === "composer" && (b.status === "queued" || b.status === "running")).length } catch { /* */ }
  // outreach : séquences en cours, réponses
  let inFlight = 0, replies = 0, sent = 0
  try {
    let st: any[] = []
    try { const rows = await getDb().prepare("SELECT data FROM sequencer_state").all(); st = rows.map((r: any) => (typeof r.data === "string" ? JSON.parse(r.data) : r.data)) } catch { /* */ }
    if (!st.length && existsSync("data/sequencer/state.json")) st = JSON.parse(await readFile("data/sequencer/state.json", "utf8"))
    inFlight = st.filter((x) => x.status === "active" || x.status === "waiting-content").length
    replies = st.filter((x) => x.status === "replied").length
    sent = st.reduce((n, x) => n + ((x.sends || []).length), 0)
  } catch { /* */ }
  // calls : à appeler (hot hors nurturing), rendez-vous (closing, rdv_at à venir), clients (signature)
  let toCall = 0, meetings = 0, nextMeeting: number | null = null, won = 0
  try {
    const rows = await getDb().prepare("SELECT pipeline, stage, rdv_at FROM crm_leads").all() as any[]
    for (const r of rows) {
      if (r.pipeline === "hot" && r.stage !== "nurturing") toCall++
      if (r.pipeline === "closing" && r.stage === "signature") won++
      else if (r.pipeline === "closing") { meetings++; const t = Number(r.rdv_at); if (t && (!nextMeeting || t < nextMeeting)) nextMeeting = t }
    }
  } catch { /* pas de base : pas de CRM */ }
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

// ── prospects : état cockpit (écartés, mode automatique) sur disque ──
const PSTATE_FILE = "data/prospects-state.json"
async function readPState(): Promise<{ skipped: string[]; automatic: boolean; auto: Record<string, number> }> {
  try { if (existsSync(PSTATE_FILE)) { const j = JSON.parse(await readFile(PSTATE_FILE, "utf8")); return { skipped: Array.isArray(j.skipped) ? j.skipped : [], automatic: !!j.automatic, auto: j.auto && typeof j.auto === "object" ? j.auto : {} } } } catch { /* */ }
  return { skipped: [], automatic: false, auto: {} }
}
async function writePState(st: unknown): Promise<void> { await mkdir("data", { recursive: true }); await writeFile(PSTATE_FILE, JSON.stringify(st, null, 2) + "\n") }
/** Why this prospect was picked, in the owner's words (from the gate's reasons, the audit and the diagnosis). Never a number. */
function plainReasons(sheet: any): string[] {
  const out: string[] = []
  const add = (t: string) => { if (t && !out.includes(t) && out.length < 4) out.push(t) }
  const reasons: string[] = Array.isArray(sheet?.score?.reasons) ? sheet.score.reasons : []
  const audit = sheet?.audit || {}
  const txt = reasons.join(" | ").toLowerCase()
  if (/responsive|viewport|mobile/.test(txt) || audit.mobile === false) add("No mobile version")
  if (/https/.test(txt) || audit.https === false) add("No HTTPS")
  const yr = /maj\s*:\s*(\d{4})|dernière.*?(\d{4})|(20[01]\d)/.exec(txt); if (yr) add(`Site from ${yr[1] || yr[2] || yr[3]}`)
  if (/peu de contenu|page très pauvre|thin/.test(txt)) add("Almost no content")
  if (/pas de photo|aucune photo|no photo/.test(txt) || (Array.isArray(sheet?.assets?.photos) && sheet.assets.photos.length === 0)) add("No photos")
  if (!sheet?.identity?.email && !audit?.form && (audit?.contact === false || /contact/.test(txt))) add("No way to contact them online")
  else if (!sheet?.identity?.email) add("No email on the site")
  if (/seo pauvre|seo/.test(txt) && out.length < 4) add("Invisible on Google")
  if (/jquery|socle technique|daté/.test(txt) && out.length < 4) add("Dated technology")
  for (const p of (sheet?.brief?.problems || []).slice(0, 2)) if (out.length < 4 && typeof p === "string") add(p.length > 70 ? p.slice(0, 67) + "…" : p)
  if (!out.length && sheet?.score?.accroche) add(String(sheet.score.accroche).split(":").slice(-1)[0].trim())
  return out
}
async function prospectsList(): Promise<unknown> {
  const st = await readPState()
  const skipped = new Set(st.skipped)
  const sites = await listSites()
  const byId: Record<string, SiteRow[]> = {}
  for (const x of sites) (byId[x.id] ||= []).push(x)
  let batches: any[] = []
  try { batches = await listBatches(50) } catch { /* */ }
  const building = new Set<string>()
  for (const b of batches) if (b.mode === "composer" && (b.status === "queued" || b.status === "running")) { try { for (const id of JSON.parse(b.params_json || "{}").ids || []) building.add(id) } catch { /* */ } }
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
    const status = skipped.has(id) ? "skipped" : building.has(id) ? "building" : latest ? "built" : "new"
    items.push({
      id, name: sheet.identity?.name || id.replace(/-/g, " "), industry: sheet.industry || "", city: sheet.identity?.city || "",
      region: sheet.identity?.region || sheet.identity?.state || "", zip: sheet.identity?.zip || sheet.identity?.postalCode || "",
      phone: sheet.identity?.phone || "", email: sheet.identity?.email || "", oldUrl: sheet.existing?.url || "",
      fit: tier === "hot" || tier === "warm", reasons: plainReasons(sheet), status, at,
      site: latest ? { date: latest.date, status: latest.status } : null,
      hasBefore: existsSync(join(DATA_ASSETS, id, "avant.png")),
    })
  }
  items.sort((a, b) => b.at - a.at || a.name.localeCompare(b.name))
  const counts = { total: items.length, new: items.filter((x) => x.status === "new").length, building: items.filter((x) => x.status === "building").length, built: items.filter((x) => x.status === "built").length, skipped: items.filter((x) => x.status === "skipped").length }
  const trades = [...new Set(items.map((x) => x.industry).filter(Boolean))].sort()
  const cities = [...new Set(items.map((x) => x.city).filter(Boolean))].sort()
  return { items, counts, trades, cities, automatic: !!st.automatic, country: agency().country }
}
/** Automatic mode: every good-fit prospect that is new (not skipped, no site, not building) is sent to build, once. */
async function autoBuild(): Promise<void> {
  const st = await readPState()
  if (!st.automatic || !tryDb()) return
  const list = await prospectsList() as any
  const todo = list.items.filter((x: any) => x.fit && x.status === "new" && !st.auto[x.id]).map((x: any) => x.id)
  if (!todo.length) return
  try {
    await enqueueBatch({ mode: "composer", ids: todo, lim: todo.length, requestedBy: "automatic", note: "automatic: good-fit prospects" })
    for (const id of todo) st.auto[id] = Date.now()
    await writePState(st)
    broadcast({ type: "batches" }); kickEngine()
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
  } catch { /* illisible → défaut */ }
  return { mode: "sequencer", url: "" }
}
/** À l'approbation d'un site, si l'agent connecté est un webhook : POST du prospect + site + script. Best-effort, borné, signé. */
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

// ── étapes du CRM : clés fixes (contrat du serveur), libellés éditables ──
const STAGES_FILE = "data/crm-stages.json"
const STAGE_DEFAULTS: { hot: [string, string][]; closing: [string, string][] } = {
  hot: [["call0", "To call"], ["relance1", "Follow-up 1"], ["relance2", "Follow-up 2"], ["relance3", "Follow-up 3"], ["nurturing", "Nurturing"]],
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

// ---- records outreach (data/outreach/<id>.json) : lecture/écriture pour la console commerciale ----
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
// régénère le htmlBody depuis le texte édité : lien démo PROPRE (▶), URLs cliquables, <br> par ligne.
// Garantit la règle « jamais l'URL brute flippante » même après une édition manuelle dans la plateforme.
function bodyToHtml(body: string, demoUrl?: string): string {
  const lines = (body || "").split("\n").map((line) => {
    if (demoUrl && line.includes(demoUrl)) return `<a href="${demoUrl}">▶ Voir la démo (30 s)</a>`
    return escHtml(line).replace(/(https?:\/\/[^\s)]+)/g, '<a href="$1">$1</a>')
  })
  return `<div style="font-family:system-ui,-apple-system,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">${lines.join("<br>")}</div>`
}
// journal des swaps d'assets (DB-owned, best-effort)
async function logAssetEvent(id: string, action: string, oldRel: string | null, newRel: string | null, reason?: string): Promise<void> {
  try {
    await tryDb()?.prepare("INSERT INTO asset_events(prospect_id,action,old_rel_path,new_rel_path,reason,actor,created_at) VALUES(?,?,?,?,?, 'operator', ?)")
      .run(id, action, oldRel, newRel, reason ?? null, Date.now())
  } catch { /* best-effort */ }
}
const IMG_RE = /\.(png|jpe?g|webp|gif|avif|svg)$/i
const VID_RE = /\.(mp4|webm|mov)$/i

// le dossier d'un skill existant, validé
function skillDir(name: string): string | null {
  if (!/^[a-z0-9-]+$/.test(name)) return null
  const dir = safeUnder(SKILLS_DIR, name)
  if (!dir || !isDir(dir)) return null
  return dir
}

// brouillon de skill en MODE TEST (cf. /skilldraft § 6) : à étoffer, jamais auto, promotion après ≥3
function draftScaffold(slug: string, brief: string, signal: string): string {
  return `---
name: ${slug}
status: test
---

> ⚠ mode test — brouillon créé depuis le brain. À étoffer (\`/skilldraft\`), prévenir avant usage,
> ne pas câbler en automatique ; promotion après ≥ 3 usages validés.

# ${slug}

**Idée.** ${brief || "(à préciser)"}

${signal ? `**Signal.** ${signal}\n\n` : ""}## Quand l'utiliser
(à compléter)

## Étapes
(à compléter)
`
}

// ---- SSE : broadcast à tous les clients, avec event-id + ring buffer (replay sur reconnexion) ----
const clients = new Set<ServerResponse>()
let watchOk = true // un watcher fs a-t-il échoué au démarrage ? (heartbeat honnête)
let seq = 0
const ring: { id: number; line: string }[] = []
const RING_CAP = 500
function broadcast(obj: unknown): void {
  const id = ++seq
  const line = `id: ${id}\ndata: ${JSON.stringify(obj)}\n\n`
  ring.push({ id, line })
  if (ring.length > RING_CAP) ring.shift()
  // sur écriture impossible (client mort), on le RETIRE du Set (pas de connexion fantôme qui fuit)
  for (const res of clients) { try { res.write(line) } catch { clients.delete(res) } }
}

// ---- boucle learning : une issue du CRM → data/outcomes.jsonl (+ miroir base), une fois par prospect ----
// `npm run learn` (timer de nuit lws-learn) recalcule ensuite les règles de la porte de scoring.
async function learnFrom(id: string, kind: "won" | "lost" | "meeting"): Promise<{ outcome: string; recorded: boolean } | null> {
  try {
    const r = await recordOutcome(id, kind, { source: `cockpit:${AUTH_USER}` })
    if (r.recorded) broadcast({ type: "machine", stage: "learn", outcome: kind })
    return { outcome: kind, recorded: r.recorded }
  } catch { return null } // le learning ne casse jamais une action du CRM
}

// ---- job runner générique : spawn npm + stream stdout ligne-à-ligne en SSE, lock par clé ----
// Sert le « feedback » (edit surgical), le re-fill après swap d'assets, et plus tard le pipeline.
const running = new Set<string>()
function runJob(key: string, args: string[], label: string, meta: Record<string, unknown>, extraEnv?: NodeJS.ProcessEnv): void {
  if (running.has(key)) { broadcast({ type: "refill", ...meta, line: "déjà en cours…" }); return }
  running.add(key)
  broadcast({ type: "refill", ...meta, line: `${label}…` })
  const child = spawn("npm", args, { cwd: process.cwd(), env: { ...process.env, ...(extraEnv || {}) } })
  // une ligne par évènement, recollée si le tube la coupe (sinon une ligne de journal arrive en deux moitiés)
  const onLine = (line: string) => { if (line) broadcast({ type: "refill", ...meta, line }) }
  const out = lineSplitter(onLine), errLines = lineSplitter(onLine)
  child.stdout?.on("data", (b: Buffer) => out.push(b))
  child.stderr?.on("data", (b: Buffer) => errLines.push(b))
  // sans ce handler, un échec de spawn (npm absent…) émet 'error' → exception non gérée = crash,
  // et 'close' ne se déclenche jamais → la clé reste verrouillée dans `running`.
  child.on("error", (err) => {
    running.delete(key)
    broadcast({ type: "refill", ...meta, line: `échec spawn : ${err.message}` })
    broadcast({ type: "refill-done", ...meta, code: -1 })
  })
  child.on("close", (code) => {
    out.end(); errLines.end()
    running.delete(key)
    broadcast({ type: "refill-done", ...meta, code })
  })
}
// capture la sortie d'une commande (best-effort, borné) — pour interroger systemctl
function execCapture(cmd: string, args: string[], timeoutMs = 2500): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: process.cwd(), env: process.env })
    const out = textCollector(1_000_000)
    const to = setTimeout(() => { try { child.kill() } catch { /* */ } reject(new Error("timeout")) }, timeoutMs)
    child.stdout?.on("data", (b: Buffer) => out.push(b))
    child.on("error", (e) => { clearTimeout(to); reject(e) })
    child.on("close", () => { clearTimeout(to); resolve(out.text()) })
  })
}

// feedback = édition CHIRURGICALE (npm run edit) : n'applique que le commentaire, pas de rebuild complet.
function refill(id: string, date: string): void {
  runJob(`edit:${id}/${date}`, ["run", "edit", "--", id, date], `feedback (surgical) : ${id}/${date}`, { id, date })
}

// ---- pipeline live : spawn `npm run pipeline` en PIPELINE_JSON=1, re-broadcast par maillon ----
// run.ts émet déjà run-start/prospect-start/step/prospect-done/run-end → on les relaie en SSE {type:'run'}.
type RunRow = { id: string; name?: string; steps: Record<string, string> }
let currentRun: { startedAt: number; rows: Record<string, RunRow> } | null = null
function startPipeline(opts: { limit?: number; force?: boolean; design?: boolean }): boolean {
  // un seul run, et pas pendant qu'un re-fill manuel tourne (ils se télescoperaient sur output/sites/<id>)
  if (currentRun || [...running].some((k) => k.startsWith("fill:"))) return false
  const env: NodeJS.ProcessEnv = { ...process.env, PIPELINE_JSON: "1" }
  if (opts.limit) env.LIMIT = String(opts.limit)
  if (opts.force) env.FORCE = "1"
  if (opts.design === false) env.DESIGN = "0"
  currentRun = { startedAt: Date.now(), rows: {} }
  const child = spawn("npm", ["run", "pipeline"], { cwd: process.cwd(), env })
  // évènements JSON ligne à ligne : une ligne coupée par le tube est recollée (lineSplitter), jamais relayée en deux « log »
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
  child.on("error", (err) => { broadcast({ type: "run", ev: { type: "log", line: `échec spawn : ${err.message}` } }); broadcast({ type: "run-done", code: -1 }); currentRun = null })
  child.on("close", (code) => { out.end(); errLines.end(); broadcast({ type: "run-done", code }); currentRun = null })
  return true
}

// mode automatique : toutes les 60 s, les nouveaux « good fit » partent en construction (si DATABASE_URL)
setInterval(() => { void autoBuild() }, 60_000).unref()
// LE MOTEUR INTÉGRÉ : si aucun worker externe ne bat, le cockpit exécute lui-même les jobs (simulé dans la sandbox)
startEngine((e) => { broadcast(e); if ((e as JobEvent).type === "job" && (e as JobEvent).status === "done") void autoBuild() })

// ---- routeur ----
async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // anti DNS-rebinding : on exige un Host loopback (ou le domaine du tunnel explicitement autorisé).
  if (!hostAllowed(req.headers.host || "")) {
    res.writeHead(403, { "Content-Type": "text/plain" }); res.end("bad host"); return
  }
  // accès PUBLIC en LECTURE des sites livrés (preview + assets) : on peut ouvrir un site SANS mot de
  // passe (c'est fait pour être montré au prospect). L'UI du cockpit + toutes les API restent protégées.
  const reqPath0 = (req.url || "/").split("?")[0]
  // + le tracking /t/c|u/<jeton>, TOUTES méthodes : la désinscription 1-clic (RFC 8058) arrive en POST des serveurs
  // de Gmail/Yahoo ou de la page de confirmation, jamais authentifiée ; le jeton signé fait office de preuve et
  // l'endpoint refuse lui-même ce qui n'est pas prévu (405, 400, 403 : cf. outreach/tracking/endpoint.ts).
  const publicRO = ((req.method === "GET" || req.method === "HEAD") && /^\/(preview|thumb|avant|asset|font|designfont|tpl|data\/assets|t)\//.test(reqPath0))
    || /^\/t\/[cu]\/[^/]*$/.test(reqPath0)
  // auth : si un mot de passe est configuré (mode tunnel partagé), on l'exige — SAUF sur ces chemins publics.
  if (!publicRO && !authOk(req)) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="lastwebstudios station"', "Content-Type": "text/plain" })
    res.end("auth requise"); return
  }
  // anti-CSRF : une page tierce peut POSTer en « simple request ». Sur toute méthode mutante on exige
  // une Origin loopback OU le host autorisé (curl/outils sans Origin passent).
  if (req.method && req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.origin
    if (origin) {
      let oh = ""; try { oh = new URL(origin).host } catch { /* origin malformée */ }
      if (!hostAllowed(oh)) { res.writeHead(403, { "Content-Type": "text/plain" }); res.end("bad origin"); return }
    }
  }
  const url = new URL(req.url || "/", `http://${HOST}`)
  const path = url.pathname

  // ── tracking outreach AUTO-HÉBERGÉ (public, dans les mails) : clic signé + désinscription RFC 8058 (F-3 corrigé).
  // Les évènements vont dans outreach_events (base) ou data/sequencer/events.jsonl ; le séquenceur les ingère au tick
  // (clic → débloque l'escalade, désinscription → drop). Cf. outreach/tracking/README.md.
  if (path.startsWith("/t/")) {
    return handleTracking(req, res, path, { onEvent: (e, stored) => { if (stored !== "capped") broadcast({ type: "machine", stage: "sell", event: e.type }) } })
  }

  // previews live des sites générés (assets relatifs → racine = le dossier du site)
  if (path.startsWith("/preview/")) {
    const rel = path.slice("/preview/".length)
    const target = safeUnder(SITES, rel)
    if (!target) return sendJson(res, { error: "bad path" }, 400)
    // ZÉRO « Not found » brut : si la PAGE principale (index.html / dossier) manque encore
    // (site en cours de génération), on sert un placeholder stylé au lieu du 404 brut.
    const isMainPage = rel.endsWith("/") || rel.endsWith("index.html") || !extname(rel)
    if (isMainPage && !existsSync(join(target, "index.html")) && !(existsSync(target) && !isDir(target))) {
      // pas en local : si la PAGE existe dans le BUCKET (site composé sur une autre machine), on la SERT
      // depuis là au lieu d'afficher « génération en cours » à tort. Sinon (vraiment pas bâti) → placeholder.
      // ⚠ Supabase FORCE `text/plain` sur le HTML uploadé (sécu anti-XSS) → si on 302 vers le bucket, le
      // navigateur affiche la SOURCE + accents cassés. On PROXY donc la page avec le bon Content-Type.
      // (Les assets — images/vidéos/fonts — gardent le 302 plus bas : le bucket les sert correctement.)
      const key = "sites/" + (rel.endsWith("index.html") ? rel : rel.replace(/\/?$/, "/index.html"))
      if (storageBase() && await storageExists(key)) {
        try {
          const up = await fetch(urlFor(key))
          if (up.ok) {
            const buf = Buffer.from(await up.arrayBuffer())
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" })
            res.end(buf); return
          }
        } catch { /* bucket injoignable → repli 302 */ }
        return redirectTo(res, urlFor(key))
      }
      return sendPreviewPlaceholder(res)
    }
    // repli STORAGE : un asset du site absent en local (gitignoré, ex. hero.mp4 sur la VM) → 302 vers le
    // bucket → la vidéo/asset JOUE quand même. Le local prime (preview offline = ZÉRO régression).
    if (!isMainPage && !existsSync(target) && storageBase()) {
      return redirectTo(res, urlFor("sites/" + rel))
    }
    return sendFile(res, target, req)
  }
  // previews des templates
  if (path.startsWith("/tpl/")) {
    const target = safeUnder(TEMPLATES, path.slice("/tpl/".length))
    return target ? sendFile(res, target) : sendJson(res, { error: "bad path" }, 400)
  }
  // polices (UI + specimens du lab) — fonderie vidéo
  if (path.startsWith("/font/")) {
    const target = safeUnder(FONTS, path.slice("/font/".length))
    return target ? sendFile(res, target) : sendJson(res, { error: "bad path" }, 400)
  }
  // bibliothèque de fonts design (Host Grotesk pour le corps de l'UI, Geist…)
  if (path.startsWith("/designfont/")) {
    const target = safeUnder(DESIGN_FONTS, path.slice("/designfont/".length))
    return target ? sendFile(res, target) : sendJson(res, { error: "bad path" }, 400)
  }
  // capture « avant » (le vrai site d'origine du prospect) → comparateur avant/après
  if (path.startsWith("/avant/")) {
    const id = path.slice("/avant/".length).split("/")[0]
    const target = safeUnder(DATA_ASSETS, `${id}/avant.png`)
    if (!target) return sendJson(res, { error: "bad path" }, 400)
    if (existsSync(target)) return sendFile(res, target, req)        // local d'abord (offline = zéro régression)
    if (storageBase()) return redirectTo(res, urlFor(`prospects/${id}/avant.png`)) // sinon le bucket (source durable)
    return sendAvantPlaceholder(res)                                 // jamais d'image cassée
  }
  // existe-t-il une capture « avant » ? (check léger, zéro corps — le cockpit masque les onglets
  // avant/comparer quand il n'y en a pas, au lieu d'afficher un message d'erreur).
  if (path.startsWith("/has-avant/")) {
    const id = path.slice("/has-avant/".length).split("/")[0]
    const target = safeUnder(DATA_ASSETS, `${id}/avant.png`)
    if (target && existsSync(target)) return sendJson(res, { exists: true })
    return sendJson(res, { exists: storageBase() ? await storageExists(`prospects/${id}/avant.png`) : false })
  }
  // VIGNETTE d'un site : la MEILLEURE capture STATIQUE (instantané, net) — pour la vue d'ensemble.
  // Sinon la grille chargerait 100+ iframes live (lent + scroll-reveal = tuiles vides). /thumb/<id>/<date>.
  if (path.startsWith("/thumb/")) {
    const parts = path.slice("/thumb/".length).split("/")
    const dir = siteDir(parts[0], parts[1] || "")
    if (dir) {
      for (const name of ["_thumb.png", "_after.png", "_full.png", "_verify.png", "after.png"]) {
        const f = join(dir, name); if (existsSync(f)) return sendFile(res, f, req)
      }
    }
    const av = safeUnder(DATA_ASSETS, `${parts[0]}/avant.png`) // repli : le vrai site d'origine
    if (av && existsSync(av)) return sendFile(res, av, req)
    // repli STORAGE (conteneur cockpit = bâti depuis git, les captures sont gitignorées → toujours via bucket).
    // On VÉRIFIE l'existence avant de rediriger (sinon img cassée) : capture du nouveau site, puis à défaut
    // la capture « avant » (le site d'origine) — mieux qu'une vignette vide.
    if (storageBase() && parts[1]) {
      if (await storageExists(`sites/${parts[0]}/${parts[1]}/_after.png`)) return redirectTo(res, urlFor(`sites/${parts[0]}/${parts[1]}/_after.png`))
      if (await storageExists(`prospects/${parts[0]}/avant.png`)) return redirectTo(res, urlFor(`prospects/${parts[0]}/avant.png`))
    }
    return sendJson(res, { error: "no thumb" }, 404)
  }
  // assets sources d'un prospect (photos, logo, vidéo) → galerie + swap. Vidéo en Range (req passé).
  if (path.startsWith("/asset/")) {
    const target = safeUnder(DATA_ASSETS, path.slice("/asset/".length))
    return target ? sendFile(res, target, req) : sendJson(res, { error: "bad path" }, 400)
  }
  // les sites composer référencent les photos en chemin disque relatif (../../../../data/assets/<id>/…),
  // qui se résout en /data/assets/… une fois servi par le cockpit. On le sert (sinon TOUTES les images
  // de ces sites sont cassées : voids + alt visible). Répare tous les sites composer d'un coup.
  if (path.startsWith("/data/assets/")) {
    const target = safeUnder(DATA_ASSETS, path.slice("/data/assets/".length))
    return target && existsSync(target) ? sendFile(res, target, req) : sendJson(res, { error: "not found" }, 404)
  }
  // l'ancienne plateforme outreach (/outreach, /sales) vit désormais DANS l'app : onglet Pipeline. Les vieux liens suivent.
  if (/^\/(outreach|sales)(\/.*)?$/.test(path)) return redirectTo(res, "/#pipeline")

  // ---- API ----
  if (path === "/api/sites") return sendJson(res, await listSites())

  // état du séquenceur : DB PARTAGÉE d'abord (table sequencer_state — visible de toutes les machines),
  // repli sur le fichier local de la machine qui fait tourner le séquenceur.
  const loadSeqState = async (): Promise<any[]> => {
    try {
      const rows = await getDb().prepare("SELECT data FROM sequencer_state").all()
      if (rows.length) return rows.map((r: any) => (typeof r.data === "string" ? JSON.parse(r.data) : r.data))
    } catch { /* pas de DB/table → repli fichier */ }
    try { if (existsSync("data/sequencer/state.json")) return JSON.parse(await readFile("data/sequencer/state.json", "utf8")) } catch { /* vide */ }
    return []
  }

  // ════ LA CAGE 24/7 : STOP, budget du jour, disjoncteur, mode d'envoi (bandeau Station + /outreach/) ════
  if (path === "/api/cage" && req.method === "GET") return sendJson(res, await cageStatus())
  // POST /api/cage/stop {on, reason} → pose / lève l'arrêt d'urgence (base partagée : la box le voit ; sinon fichier STOP)
  if (path === "/api/cage/stop" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body || typeof body.on !== "boolean") return sendJson(res, { error: "attendu : {on: true|false, reason?}" }, 400)
    const st = await setStop(body.on, typeof body.reason === "string" ? body.reason : "", AUTH_USER)
    if (st.on !== body.on) return sendJson(res, { error: "STOP non enregistré (base indisponible ?)", stop: st }, 503)
    broadcast({ type: "cage" })
    return sendJson(res, { ok: true, stop: st })
  }
  // POST /api/cage/breaker/reset → réarmement HUMAIN du disjoncteur (les incidents d'avant ne comptent plus)
  if (path === "/api/cage/breaker/reset" && req.method === "POST") {
    const st = resetBreaker(await loadBreaker(), new Date().toISOString())
    await saveBreaker(st)
    broadcast({ type: "cage" })
    return sendJson(res, { ok: true, breaker: st })
  }
  // ════ HOME : les 5 lieux de l'entrepreneur (prospects, sites, outreach, calls, clients), en chiffres d'issue ════
  if (path === "/api/home") return sendJson(res, await homeSnapshot())

  // ════ VUE MACHINE : les 7 étages du film, compteurs + dernier évènement (DB ou disque) ════
  if (path === "/api/machine") return sendJson(res, await machineSnapshot())

  // ════ SÉQUENCES : l'état du séquenceur cold-email (dry-run) — pour VOIR la machine tourner ════
  if (path === "/api/sequences") {
    const state: any[] = await loadSeqState()
    let sends: any[] = []
    try {
      if (existsSync("data/sequencer/sends.jsonl"))
        sends = (await readFile("data/sequencer/sends.jsonl", "utf8")).split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    } catch { /* vide */ }
    let steps: any[] = []
    try { steps = JSON.parse(await readFile("outreach/sequencer/config.json", "utf8")).steps || [] } catch { /* défaut */ }
    const rows: any[] = []
    for (const s of state) {
      let name = s.prospectId
      let mails: any[] = []
      try { const f = `data/prospects/${s.prospectId}.json`; if (existsSync(f)) name = JSON.parse(await readFile(f, "utf8"))?.identity?.name || s.prospectId } catch { /* nom brut */ }
      try { const p = `data/personas/${s.prospectId}.json`; if (existsSync(p)) mails = JSON.parse(await readFile(p, "utf8")).personas || [] } catch { /* pas de personas */ }
      rows.push({ ...s, name, mails })
    }
    const by = (st: string) => state.filter((s) => s.status === st).length
    // évènements (tracking, lecteur de réponses) + disjoncteur : l'état enregistré par le séquenceur, sinon évalué
    // ici sur les fichiers locaux (même machine), pour que des incidents se voient avant le prochain tick
    const events = await readEvents().catch(() => [])
    let cfgBreaker: any = null
    try { cfgBreaker = JSON.parse(await readFile("outreach/sequencer/config.json", "utf8")).breaker || null } catch { /* défauts */ }
    const stored = await loadBreaker()
    const now = new Date().toISOString()
    const breaker = stored?.open ? stored : (sends.length || events.length ? evaluateBreaker({ sends, events, now, prev: stored, thresholds: cfgBreaker }) : stored)
    const ev = (t: string) => events.filter((e) => e.type === t && !e.suspect).length
    const stats = { total: state.length, active: by("active"), waitingContent: by("waiting-content"), replied: by("replied"), done: by("done"), dropped: by("dropped"), nurturing: by("nurturing"), sends: sends.length,
      clicks: ev("click"), unsubs: ev("unsub"), bounces: ev("bounce"), complaints: ev("complaint"), scannerClicks: events.filter((e) => e.type === "click" && e.suspect).length }
    return sendJson(res, { sequences: rows, sends, steps, stats, breaker, cage: await cageStatus() })
  }

  // ════ FACTURATION : outil de facture intégré (store JSON data/invoices/, cf. invoices.ts) ════
  if (path === "/api/invoice-settings") {
    if (req.method === "POST") { const b = await parseBody(req); if (!b) return sendJson(res, { error: "bad json" }, 400); return sendJson(res, await saveSettings(b as Record<string, unknown>)) }
    return sendJson(res, await getSettings())
  }
  if (path === "/api/invoices") {
    if (req.method === "POST") { const b = await parseBody(req); if (!b) return sendJson(res, { error: "bad json" }, 400); return sendJson(res, await createInvoice(b, new Date().toISOString())) }
    return sendJson(res, (await listInvoices()).map(withTotals))
  }
  if (path.startsWith("/api/invoices/")) {
    const parts = path.split("/")
    const invId = parts[3] || ""
    // annulation LÉGALE d'une facture émise : POST /api/invoices/<n°>/avoir → avoir en négatif (jamais de suppression)
    if (req.method === "POST" && parts[4] === "avoir") {
      const av = await createAvoir(invId, new Date().toISOString())
      return av ? sendJson(res, av) : sendJson(res, { error: "introuvable (ou déjà un avoir)" }, 404)
    }
    if (req.method === "POST") { const b = await parseBody(req); if (!b) return sendJson(res, { error: "bad json" }, 400); const up = await updateInvoice(invId, b); return up ? sendJson(res, up) : sendJson(res, { error: "introuvable" }, 404) }
    const inv = await getInvoice(invId); return inv ? sendJson(res, inv) : sendJson(res, { error: "introuvable" }, 404)
  }
  if (path.startsWith("/facture/")) {
    const inv = await getInvoice(path.split("/")[2] || "")
    if (!inv) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("facture introuvable"); return }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...NOSNIFF })
    res.end(renderInvoiceHtml(inv, await getSettings())); return
  }

  // ════ LEAD PIPE : les prospects du vivier (scoring, industries) pour analyser/trier/scraper ════
  // DB d'abord (index partagé) ; sans DB (clone frais, mode local), REPLI DISQUE : les fiches data/prospects.
  if (path === "/api/leads") {
    let rows: any[] = []
    if (!tryDb()) rows = await listLeadsFs()
    else try {
      rows = await getDb().prepare(`
        SELECT p.id, p.name, p.city, p.industry, p.opp_score AS "oppScore", p.opp_tier AS "oppTier",
               p.existing_url AS "oldUrl",
               EXISTS(SELECT 1 FROM generations g WHERE g.prospect_id = p.id AND g.present = 1) AS "hasSite"
        FROM prospects p
        ORDER BY p.opp_score DESC NULLS LAST, p.name ASC
        LIMIT 2000
      `).all() as any[]
    } catch { /* pas de DB → vivier vide */ }
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

  // drafts de mail outreach — depuis la fiche (DB) ENRICHIE du record VÉRIFIÉ (`npm run outreach`).
  // L'agent (session claude.ai) crée les VRAIS drafts Gmail ; ce endpoint sert l'aperçu + le contact
  // vérifié (email réel + source + tél + statut du draft) pour que l'opérateur sache à qui ça part.
  if (path === "/api/outreach") {
    const id = url.searchParams.get("id") || ""
    if (!id) return sendJson(res, { error: "no id" }, 400)
    let fiche: any = {}
    try { const r = await getDb().prepare("SELECT sheet_json FROM prospects WHERE id=?").get(id) as any; if (r?.sheet_json) fiche = JSON.parse(r.sheet_json) } catch { /* pas de DB/fiche → drafts génériques */ }
    // record d'outreach vérifié (email réel scrapé + brouillon composé + statut du draft Gmail)
    let rec: any = null
    if (/^[\w-]+$/.test(id)) { try { const p = join("data", "outreach", `${id}.json`); if (existsSync(p)) rec = JSON.parse(await readFile(p, "utf8")) } catch { /* pas de record */ } }
    const name = rec?.name || fiche?.identity?.name || id
    const old = rec?.oldUrl || fiche?.existing?.url || ""
    const accroche = fiche?.score?.accroche || ""
    const email = rec?.to || fiche?.identity?.email || ""
    const phone = rec?.phone || fiche?.identity?.phone || ""
    const emailVerified = rec ? !!rec.emailVerified : !!fiche?.identity?.emailVerified
    const emailSource = rec?.emailSource || (emailVerified ? fiche?.identity?.emailSource : "") || ""
    const drafts = [
      ...(rec?.subject && rec?.body ? [{ label: "Vérifié (préparé)", subject: rec.subject, body: rec.body }] : []),
      { label: "Direct", subject: `${name} - j'ai refait votre site`, body: `Bonjour,\n\n${accroche || `Je suis tombé sur le site de ${name} et je trouve qu'il mérite mieux.`}\n\nJ'en ai fait une nouvelle version, gratuitement, juste pour vous montrer. Aperçu : [lien de votre nouveau site]\n${old ? `(votre site actuel : ${old})\n` : ""}\nSi ça vous plaît, je vous l'installe. Vous voulez y jeter un oeil ?\n\nBien à vous,\n[Votre nom] - ${agency().mail.signature}` },
      { label: "Court", subject: `Une refonte pour ${name}`, body: `Bonjour,\n\nJ'ai redessiné le site de ${name} - aperçu ici : [lien].\n\nIntéressé ? Je vous le mets en ligne en un clic.\n\n[Votre nom]` },
    ]
    return sendJson(res, { id, name, email, phone, emailSource, emailVerified, ready: rec?.ready ?? null, skipReason: rec?.skipReason ?? "", draftStatus: rec?.status ?? null, gmailDraftId: rec?.gmailDraftId ?? null, drafts })
  }

  // identité publique de l'agence (agency.config.json) pour les scripts d'appel et les brouillons de l'UI
  // ════ PROSPECTS : la sortie du moteur, en mots d'entrepreneur (pourquoi retenu, état, site actuel) ════
  if (path === "/api/prospects") return sendJson(res, await prospectsList())
  // POST /api/prospects/skip {id, on} → écarte (ou reprend) un prospect ; état sur disque, jamais dans la fiche
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
  // POST /api/brief {text} → what the agency understood (trades, place, country, count, mix) ; never a model in the sandbox
  if (path === "/api/brief" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body || typeof body.text !== "string") return sendJson(res, { error: "expected {text}" }, 400)
    const b = await interpretBrief(body.text.slice(0, 500))
    if (b.mix && !b.trades.length) b.trades = await pickMix(4)
    return sendJson(res, b)
  }
  // POST /api/prospects/find {text | trades, place, country, count, mix} → a `find` job (the engine runs it)
  if (path === "/api/prospects/find" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body || typeof body !== "object" || Array.isArray(body)) return sendJson(res, { error: "bad json" }, 400)
    let brief: any = null
    if (typeof body.text === "string" && body.text.trim()) brief = await interpretBrief(body.text.slice(0, 500))
    else if (Array.isArray(body.trades) || typeof body.place === "string") brief = { trades: Array.isArray(body.trades) ? body.trades.filter((t: unknown) => typeof t === "string").slice(0, 8) : [], place: typeof body.place === "string" ? body.place.slice(0, 80) : "", country: typeof body.country === "string" ? body.country.slice(0, 2).toUpperCase() : agency().country, count: Math.max(1, Math.min(200, Number(body.count) || 10)), mix: !!body.mix }
    if (!brief) return sendJson(res, { error: "tell the agency what you're after" }, 400)
    if (brief.mix && !brief.trades.length) brief.trades = await pickMix(4)
    if (!brief.trades.length && !brief.place) return sendJson(res, { error: "say a trade or a place" }, 400)
    if (!tryDb()) return sendJson(res, { error: "pas de DB : finding prospects runs as a job. Set DATABASE_URL (npm run db:init). Without a database: npm run scrape -- <trade>" }, 503)
    try {
      const row = await enqueueBatch({ mode: "find" as BatchMode, industry: brief.trades[0] || null, lim: brief.count, requestedBy: AUTH_USER, note: (typeof body.text === "string" ? body.text : `${brief.trades.join(", ")} ${brief.place}`).slice(0, 200), ids: null, params: { brief: typeof body.text === "string" ? body.text.slice(0, 500) : "", ...brief } })
      broadcast({ type: "batches" }); kickEngine()
      return sendJson(res, { ok: true, id: row.id, brief })
    } catch (e) { return sendJson(res, { error: String((e as Error).message) }, 500) }
  }
  // GET /api/trades → key → label in the agency's language (the cockpit never shows a raw key)
  if (path === "/api/trades") {
    const { INDUSTRIES } = await import("../../leadengine/1_scraping/scripts/industries.ts")
    // the cockpit's UI is English: the English label whenever the engine has one
    return sendJson(res, Object.fromEntries(Object.entries(INDUSTRIES).map(([k, v]: [string, any]) => [k, v.en?.label || v.label])))
  }
  // GET /api/jobs → running / queued / just finished jobs for the job strip
  if (path === "/api/jobs") return sendJson(res, await jobsView())
  // POST /api/crm/ask {id, ask} → a follow-up email or a call angle from the prospect's facts (smart prompt place)
  if (path === "/api/crm/ask" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body || !validProspectId(body.id) || typeof body.ask !== "string" || !body.ask.trim()) return sendJson(res, { error: "expected {id, ask}" }, 400)
    const sheet = await readSheet(body.id) || {}
    const name = sheet.identity?.name || body.id
    if (process.env.LWS_SANDBOX === "1") {
      await new Promise((r) => setTimeout(r, 1200))
      return sendJson(res, { ok: true, text: /email|mail/i.test(body.ask) ? `Subject: your new ${name} website

Hi,

I built a new website for ${name} so you can see it already done (not a mockup). Two things it fixes: ${(sheet.score?.reasons || []).slice(0, 2).join(" and ") || "mobile and contact"}.

Would a 10-minute call this week work?` : `Angle: open with the one thing their site cannot do today (${(sheet.score?.reasons || [])[0] || "work on a phone"}), then show the new site side by side. Ask what a new customer is worth to them before any number.`, simulated: true })
    }
    try {
      const { runSkill } = await import("../../packages/utils/run-skill.ts")
      const r = await runSkill(".claude/skills/generate-savior", { prospect: sheet, ask: body.ask.slice(0, 500) }, "smart", 2000)
      return sendJson(res, { ok: true, text: typeof r === "string" ? r : (r.text || r.body || JSON.stringify(r)) })
    } catch (e) { return sendJson(res, { error: `The agent could not answer: ${(e as Error).message.slice(0, 160)}` }, 502) }
  }
  // POST /api/agency/brand {text} → stored in agency config `brand.team` (what the agency says about itself)
  if (path === "/api/agency/brand" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body || typeof body.text !== "string") return sendJson(res, { error: "expected {text}" }, 400)
    const file = agencyFile()
    if (!file || !existsSync(file)) return sendJson(res, { error: "no agency.config.json: copy agency.config.example.json first" }, 400)
    try {
      const j = JSON.parse(await readFile(file, "utf8"))
      j.brand = { ...(j.brand || {}), team: body.text.trim().slice(0, 1200) }
      await writeFile(file, JSON.stringify(j, null, 2) + "\n")
      return sendJson(res, { ok: true, team: j.brand.team })
    } catch (e) { return sendJson(res, { error: String((e as Error).message) }, 500) }
  }
  // GET/POST /api/automatic → good-fit prospects go to build without your validation
  if (path === "/api/automatic") {
    const st = await readPState()
    if (req.method === "POST") {
      const body = await parseBody(req)
      if (!body || typeof body.on !== "boolean") return sendJson(res, { error: "expected {on: true|false}" }, 400)
      st.automatic = body.on; await writePState(st)
      broadcast({ type: "prospects" })
      if (body.on) void autoBuild()
    }
    return sendJson(res, { automatic: !!st.automatic })
  }

  // ════ CONNECT YOUR AGENT : qui prend le relais après l'approbation (data/agent.json, jamais commité) ════
  //   sequencer (défaut) : le séquenceur intégré (dry-run tant que les deux interrupteurs ne sont pas posés)
  //   webhook            : à chaque approbation, POST {prospect, site, script} à l'URL (signé HMAC si LWS_TRACK_SECRET)
  //   manual             : rien d'automatique
  if (path === "/api/agent") {
    if (req.method === "POST") {
      const body = await parseBody(req)
      if (!body || typeof body !== "object" || Array.isArray(body)) return sendJson(res, { error: "bad json" }, 400)
      const mode = String(body.mode || "")
      if (!["sequencer", "webhook", "manual"].includes(mode)) return sendJson(res, { error: "mode: sequencer | webhook | manual" }, 400)
      let urlV = ""
      if (mode === "webhook") {
        urlV = typeof body.url === "string" ? body.url.trim().slice(0, 2000) : ""
        let ok = false; try { const u = new URL(urlV); ok = u.protocol === "https:" || u.protocol === "http:" } catch { /* */ }
        if (!ok) return sendJson(res, { error: "webhook: http(s) URL required" }, 400)
      }
      const cfg = { mode, url: urlV, updatedAt: new Date().toISOString() }
      try { await mkdir("data", { recursive: true }); await writeFile(AGENT_FILE, JSON.stringify(cfg, null, 2) + "\n") } catch (e) { return sendJson(res, { error: String((e as Error).message) }, 500) }
      broadcast({ type: "agent" })
      return sendJson(res, { ok: true, ...cfg })
    }
    return sendJson(res, await readAgentConfig())
  }
  // ════ ÉTAPES DU CRM : libellés éditables (data/crm-stages.json) ; les clés restent celles du serveur ════
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

  if (path === "/api/agency") {
    const a = agency()
    return sendJson(res, { name: a.name, signature: a.mail.signature, senderName: a.mail.senderName, website: a.website, phone: a.phone, calendarUrl: a.calendarUrl, country: a.country, language: a.language, locale: a.locale, currency: a.currency, timezone: a.timezone, brand: { team: (a as any).brand?.team || "" } })
  }

  // ════ CONSOLE OUTREACH (plateforme /sales) : les LIKÉS + leur état brouillon/vidéo, actionnables ════
  // GET /api/sales → tous les prospects aimés (love>0, dernière gen par prospect) enrichis du record outreach.
  // C'est le pont « je like dans le cockpit → ça apparaît dans la plateforme outreach » (love>0 = la cible).
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
    } catch { /* pas de DB → liste vide (la plateforme l'indique) */ }
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
    // tri : à traiter d'abord (préparé sans draft, ou site changé), puis par ♥, l'envoyé en bas
    const rank = (it: any) => it.draft?.status === "sent" ? 3 : (it.fresh || (it.prepared && !it.draft?.gmailDraftId)) ? 0 : it.prepared ? 1 : 2
    items.sort((a, b) => rank(a) - rank(b) || b.love - a.love || String(a.name).localeCompare(String(b.name)))
    return sendJson(res, { items })
  }

  // ════ CRM OUTREACH (plateforme /outreach) : kanban à 2 pipelines (hot lead → closing) ════
  // Stages : hot = call0→relance1→relance2→relance3→nurturing · closing = demo→propal→nego→signature.
  // ENRÔLEMENT : tout approuvé (status approved/drafted/sent) SANS ligne crm_leads entre en hot/call0.
  if (path === "/api/crm") {
    let rows: any[] = []
    try {
      // mêmes approuvés que /api/sales (DISTINCT ON prospect, dernière gen) + état CRM + assets pour name/ville.
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
    } catch { /* pas de DB → kanban vide (la plateforme l'indique) */ }
    const hot: Record<string, any[]> = { call0: [], relance1: [], relance2: [], relance3: [], nurturing: [] }
    const closing: Record<string, any[]> = { demo: [], propal: [], nego: [], signature: [] }
    const now = Date.now()
    // FUNNEL MAIL (séquenceur) : join par prospect_id → chaque carte montre où en est le mail, à côté du round d'appel.
    const mailSeqs: Record<string, any> = {}
    try { for (const s of await loadSeqState()) mailSeqs[s.prospectId] = s } catch { /* pas de séquenceur → pas de badge mail */ }
    let mailSteps: any[] = []
    try { mailSteps = JSON.parse(await readFile("outreach/sequencer/config.json", "utf8")).steps || [] } catch { /* défaut */ }
    for (const r of rows) {
      // enrôlement : approuvé sans ligne crm_leads → on CRÉE la ligne (hot/call0) et on l'affiche là.
      let pipeline = r.pipeline, stage = r.stage
      if (!pipeline) {
        try { await getDb().prepare("INSERT INTO crm_leads(prospect_id, pipeline, stage, updated_at) VALUES (?,?,?,?) ON CONFLICT (prospect_id) DO NOTHING").run(r.id, "hot", "call0", now) } catch { /* */ }
        pipeline = "hot"; stage = "call0"
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
        love: Number(r.love) || 0,
        pipeline, stage,
        callCount: Number(r.callCount) || 0,
        rdvAt: r.rdvAt != null ? Number(r.rdvAt) : null,
        nurturingUntil: r.nurturingUntil != null ? Number(r.nurturingUntil) : null,
        notes, // historique complet (pour le panneau détail) ; lastNote = snippet carte
        lastNote: notes.length ? notes[notes.length - 1] : null,
        assignedTo: r.assignedTo || null, // un opérateur de agency.config.json › operators | null (non attribué)
        answered: r.answered != null ? Number(r.answered) : null, // tag tél : 1 vert · 0 rouge · null neutre
        linkedin: r.linkedin || null,
        draftStatus: rec?.status || (rec?.gmailDraftId ? "drafted" : rec ? "ready" : r.status) || null,
        hasVideo,
        email: rec?.to || sheet?.identity?.email || "",
        // pour le SCRIPT D'APPEL (à lire pendant l'appel) : le script enrichi (skill /account-research) +
        // les faits qui alimentent le script de base déterministe (généré côté front si pas d'enrichi).
        callScript: r.callScript || null,
        research,
        // ── COCKPIT D'APPEL : tout ce qu'il faut pour vendre au téléphone ──────────────────
        // téléphone : record outreach d'abord (résolu/persisté à l'approbation), repli fiche.
        phone: rec?.phone || sheet?.identity?.phone || "",
        // décisionnaire (le gérant) : recherche d'abord, repli fiche. null si inconnu (jamais inventé).
        contact: research?.contact || sheet?.identity?.contact || null,
        linkedinUrl: research?.linkedin || null, // profil LinkedIn du décisionnaire (recherche), null si inconnu
        emailVerified: rec ? !!rec.emailVerified : !!sheet?.identity?.emailVerified,
        oldUrl: rec?.oldUrl || sheet?.existing?.url || "",
        siteUrl: `/preview/${r.id}/${genDir}/index.html`, // le NOUVEAU site (preuve à montrer/citer)
        thumb: `/thumb/${r.id}/${genDir}`,
        oppScore: r.oppScore != null ? Number(r.oppScore) : null,
        oppTier: r.oppTier || null,
        seoIssue: rec?.seoIssue || "",
        competitor: rec?.competitor || null,
        // ── INSIGHTS : 3 à 6 faits courts pour l'appel, site à l'appui (recherche, diagnostic de la porte, contact) ──
        insights: (() => {
          const out: string[] = []
          const add = (x: unknown) => { const t = typeof x === "string" ? x.trim() : ""; if (t && !out.includes(t) && out.length < 6) out.push(t.length > 160 ? t.slice(0, 157) + "…" : t) }
          add(research?.angle); add(research?.brief)
          if (rec?.seoIssue) add(rec.seoIssue)
          for (const r of (sheet?.score?.reasons || []).slice(0, 3)) if (typeof r === "string" && !/^axes/.test(r)) add(r)
          if (rec?.competitor?.name) add(`Competitor nearby: ${rec.competitor.name}${rec.competitor.city ? ` (${rec.competitor.city})` : ""}`)
          if (sheet?.identity?.hours) add(`Hours: ${sheet.identity.hours}`)
          return out
        })(),
        // ── FUNNEL MAIL (séquenceur) : null si pas en séquence, sinon l'état pour le badge de la carte ──
        mail: (() => {
          const s = mailSeqs[r.id]
          if (!s) return null
          const live = s.status === "active" || s.status === "waiting-content" // tenu faute de contenu = toujours en séquence
          const stepId = live ? (mailSteps[s.step]?.id ?? "fin") : s.status
          const sends = (s.sends || []).length
          const clicks = s.clicks || []
          return {
            status: s.status, step: s.step, stepId, total: mailSteps.length, sends, clicks: clicks.length,
            lastMail: sends ? s.sends[sends - 1].step : null,
            // timestamps pour la FUSION mail × appel (funnel-strategy §5) : « a cliqué il y a 1h » → appeler MAINTENANT
            lastClickAt: clicks.length ? clicks[clicks.length - 1] : null,
            lastSendAt: sends ? s.sends[sends - 1].at : null,
            nextRunAt: live ? s.nextRunAt || null : null, // « prochain mail : demain » sur la carte
            waiting: s.status === "waiting-content" ? s.waiting || null : null, // { step, reason, detail } si tenu
          }
        })(),
      }
      const bucket = pipeline === "closing" ? closing : hot
      if (bucket[stage]) bucket[stage].push(lead)
      else (pipeline === "closing" ? closing.demo : hot.call0).push(lead) // stage inconnu → garde-fou
    }
    return sendJson(res, { hot, closing })
  }

  // POST /api/crm/outcome {id, outcome, note, rdvAt?} → fin d'appel : applique la transition EXACTE de la spec.
  if (path === "/api/crm/outcome" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, outcome, note, rdvAt, slot } = body as { id: string; outcome?: string; note?: string; rdvAt?: number; slot?: string }
    if (!validProspectId(id)) return sendJson(res, { error: "bad id" }, 400)
    if (!["reach", "unreach", "rdv", "note", "lost"].includes(String(outcome))) return sendJson(res, { error: "bad outcome" }, 400)
    const now = Date.now()
    // on s'assure d'une ligne (un approuvé jamais ouvert pourrait ne pas en avoir encore).
    try { await getDb().prepare("INSERT INTO crm_leads(prospect_id, updated_at) VALUES (?,?) ON CONFLICT (prospect_id) DO NOTHING").run(id, now) } catch { return sendJson(res, { error: "pas de DB" }, 503) }
    const row = await getDb().prepare("SELECT pipeline, stage, call_count, notes_json FROM crm_leads WHERE prospect_id=?").get(id) as any
    if (!row) return sendJson(res, { error: "introuvable" }, 404)
    let notes: any[] = []; try { notes = row.notes_json ? JSON.parse(row.notes_json) : [] } catch { /* */ }
    // créneau de l'appel (matin/midi/aprem), calculé côté front (heure locale FR). Sert à étaler les
    // rappels sur des moments DIFFÉRENTS : le cockpit lit les créneaux déjà tentés et propose le suivant.
    const slotV = typeof slot === "string" && /^(matin|midi|aprem)$/.test(slot) ? slot : null
    // on historise les événements porteurs (note avec texte, RDV) ET chaque tentative non aboutie (avec
    // son créneau) — c'est la trace qui permet la cadence par créneau. L'historique reste lisible.
    const txt = typeof note === "string" ? note.trim() : ""
    if (txt || outcome === "rdv") notes.push({ at: now, outcome, text: txt, ...(slotV ? { slot: slotV } : {}) })
    else if (outcome === "unreach") notes.push({ at: now, outcome: "unreach", text: "", slot: slotV })
    let pipeline = row.pipeline || "hot", stage = row.stage || "call0", callCount = Number(row.call_count) || 0
    let rdv_at: number | null = null, nurturing_until: number | null = null, answered: number | null = null
    if (outcome === "reach") {
      // a répondu → tag tél VERT. L'avancement d'étape est DÉCOUPLÉ (bouton « >> »).
      answered = 1
    } else if (outcome === "unreach") {
      // pas de réponse → tag tél ROUGE (la trace du créneau est gardée ci-dessus pour la cadence).
      // Pas d'avancement auto : le « >> » s'en charge.
      answered = 0
    } else if (outcome === "rdv") {
      // RDV calé : bascule en closing/demo + rdv_at (le sélecteur de date du front fournit rdvAt epochMs).
      pipeline = "closing"; stage = "demo"
      rdv_at = (typeof rdvAt === "number" && rdvAt > 0) ? rdvAt : now
    } else if (outcome === "lost") {
      // PERDU (il a dit non) : l'issue nourrit le learning, la carte part en nurturing (re-contact léger, 2 mois)
      if (!txt) notes.push({ at: now, outcome: "lost", text: "" })
      pipeline = "hot"; stage = "nurturing"; nurturing_until = now + 60 * 24 * 60 * 60 * 1000
    }
    // 'note' : note seule, on RESTE dans la colonne.
    try {
      await getDb().prepare(`UPDATE crm_leads SET pipeline=?, stage=?, call_count=?,
        rdv_at = COALESCE(?, rdv_at), nurturing_until = COALESCE(?, nurturing_until),
        answered = COALESCE(?, answered),
        notes_json=?, updated_at=? WHERE prospect_id=?`).run(
        pipeline, stage, callCount, rdv_at, nurturing_until, answered, JSON.stringify(notes), now, id)
    } catch { return sendJson(res, { error: "pas de DB" }, 503) }
    // LA BOUCLE LEARNING, automatique : RDV calé = « meeting », perdu = « lost » (une fois par prospect)
    const learned = outcome === "rdv" ? await learnFrom(id, "meeting") : outcome === "lost" ? await learnFrom(id, "lost") : null
    broadcast({ type: "sales" })
    return sendJson(res, { ok: true, ...(learned ? { learned } : {}) })
  }

  // POST /api/crm/assign {id, operator} → attribue le prospect à un opérateur de l'équipe (agency.config.json ›
  // operators) ou null/"" pour désattribuer.
  if (path === "/api/crm/assign" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, operator } = body as { id: string; operator?: string | null }
    if (!validProspectId(id)) return sendJson(res, { error: "bad id" }, 400)
    const op = operator && agency().operators.includes(operator) ? operator : null
    const now = Date.now()
    try {
      await getDb().prepare("INSERT INTO crm_leads(prospect_id, assigned_to, updated_at) VALUES (?,?,?) ON CONFLICT (prospect_id) DO UPDATE SET assigned_to=EXCLUDED.assigned_to, updated_at=EXCLUDED.updated_at").run(id, op, now)
    } catch { return sendJson(res, { error: "pas de DB" }, 503) }
    broadcast({ type: "sales" })
    return sendJson(res, { ok: true, operator: op })
  }

  // POST /api/crm/split → répartit à tour de rôle les prospects du pipeline 'hot' encore NON ATTRIBUÉS entre les
  // opérateurs de l'équipe (agency.config.json › operators). Idempotent : ne touche pas ceux déjà attribués.
  if (path === "/api/crm/split" && req.method === "POST") {
    const ops = agency().operators
    if (!ops.length) return sendJson(res, { error: "aucun opérateur : ajoute \"operators\" dans agency.config.json" }, 400)
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
    } catch (e) { return sendJson(res, { error: "pas de DB: " + (e as Error).message }, 503) }
  }

  // POST /api/crm/stage {id, pipeline, stage} → déplacement MANUEL entre colonnes (valide stage ∈ pipeline).
  if (path === "/api/crm/stage" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, pipeline, stage } = body as { id: string; pipeline?: string; stage?: string }
    if (!validProspectId(id)) return sendJson(res, { error: "bad id" }, 400)
    const stages: Record<string, string[]> = {
      hot: ["call0", "relance1", "relance2", "relance3", "nurturing"],
      closing: ["demo", "propal", "nego", "signature"],
    }
    if (!stages[String(pipeline)] || !stages[String(pipeline)].includes(String(stage))) return sendJson(res, { error: "bad stage" }, 400)
    const now = Date.now()
    try {
      const nurturing_until = (pipeline === "hot" && stage === "nurturing") ? now + 60 * 24 * 60 * 60 * 1000 : null
      await getDb().prepare("INSERT INTO crm_leads(prospect_id, pipeline, stage, nurturing_until, updated_at) VALUES (?,?,?,?,?) ON CONFLICT (prospect_id) DO UPDATE SET pipeline=EXCLUDED.pipeline, stage=EXCLUDED.stage, nurturing_until=COALESCE(EXCLUDED.nurturing_until, crm_leads.nurturing_until), updated_at=EXCLUDED.updated_at").run(id, pipeline, stage, nurturing_until, now)
    } catch { return sendJson(res, { error: "pas de DB" }, 503) }
    // LA BOUCLE LEARNING, automatique : la carte posée en Signature = « won » (une fois par prospect)
    const learned = pipeline === "closing" && stage === "signature" ? await learnFrom(id, "won") : null
    broadcast({ type: "sales" })
    return sendJson(res, { ok: true, ...(learned ? { learned } : {}) })
  }

  // POST /api/crm/note {id, text} → ajoute une note libre (outcome 'note'), sans transition.
  if (path === "/api/crm/note" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, text } = body as { id: string; text?: string }
    if (!validProspectId(id) || typeof text !== "string" || !text.trim()) return sendJson(res, { error: "bad args" }, 400)
    const now = Date.now()
    try { await getDb().prepare("INSERT INTO crm_leads(prospect_id, updated_at) VALUES (?,?) ON CONFLICT (prospect_id) DO NOTHING").run(id, now) } catch { return sendJson(res, { error: "pas de DB" }, 503) }
    const row = await getDb().prepare("SELECT notes_json FROM crm_leads WHERE prospect_id=?").get(id) as any
    let notes: any[] = []; try { notes = row?.notes_json ? JSON.parse(row.notes_json) : [] } catch { /* */ }
    notes.push({ at: now, outcome: "note", text })
    try { await getDb().prepare("UPDATE crm_leads SET notes_json=?, updated_at=? WHERE prospect_id=?").run(JSON.stringify(notes), now, id) } catch { return sendJson(res, { error: "pas de DB" }, 503) }
    broadcast({ type: "sales" })
    return sendJson(res, { ok: true })
  }

  // POST /api/crm/script {id, callScript?, research?} → enregistre le SCRIPT D'APPEL + le brief de recherche
  // (produits par le skill /account-research, persistés via `npm run research:save`). Le CRM les affiche.
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
    } catch { return sendJson(res, { error: "pas de DB" }, 503) }
    broadcast({ type: "sales" })
    return sendJson(res, { ok: true })
  }

  // POST /api/crm/linkedin {id, state} → état du fil LinkedIn ('added' = ajouté · 'messaged' = message envoyé).
  if (path === "/api/crm/linkedin" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, state } = body as { id: string; state?: string }
    if (!validProspectId(id) || !["added", "messaged"].includes(String(state))) return sendJson(res, { error: "bad args" }, 400)
    const now = Date.now()
    try {
      await getDb().prepare("INSERT INTO crm_leads(prospect_id, linkedin, updated_at) VALUES (?,?,?) ON CONFLICT (prospect_id) DO UPDATE SET linkedin=EXCLUDED.linkedin, updated_at=EXCLUDED.updated_at").run(id, state, now)
    } catch { return sendJson(res, { error: "pas de DB" }, 503) }
    broadcast({ type: "sales" })
    return sendJson(res, { ok: true })
  }

  // POST /api/crm/research-now {id} → DÉCLENCHEMENT MANUEL de l'auto-recherche (bouton « résoudre/enrichir »
  // du cockpit d'appel) : relance recherche + script + résolution des contacts manquants pour ce prospect.
  // Même file que l'auto-approbation ; le worker est idempotent. Best-effort (DB requise pour la file).
  if (path === "/api/crm/research-now" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id } = body as { id: string }
    if (!validProspectId(id)) return sendJson(res, { error: "bad id" }, 400)
    if (!tryDb()) return sendJson(res, { error: "pas de DB" }, 503)
    try {
      const row = await enqueueResearch(id, AUTH_USER)
      broadcast({ type: "sales" })
      return sendJson(res, { ok: true, queued: true, batchId: row.id })
    } catch (e) {
      return sendJson(res, { error: String((e as Error).message) }, 500)
    }
  }

  // POST /api/sales/draft {id, subject, body, push?} → écrit la copie éditée (régénère htmlBody propre)
  // + flag pendingGmail si push. Le push RÉEL vers Gmail est fait par /out (le connecteur Gmail vit dans
  // la session de l'agent, jamais sur la VM) — la plateforme curate/édite, /out exécute.
  if (path === "/api/sales/draft" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, subject, body: text, push } = body as { id: string; subject?: string; body?: string; push?: boolean }
    const rec = await readOutreach(id)
    if (!rec) return sendJson(res, { error: "non préparé" }, 404)
    // lien démo PROPRE garanti même sur un vieux record sans champ demoUrl : on le dérive de la gen.
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

  // POST /api/sales/push {id} → marque « à pousser vers Gmail » (drainé au prochain /out).
  if (path === "/api/sales/push" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const rec = await readOutreach((body as any).id)
    if (!rec) return sendJson(res, { error: "non préparé" }, 404)
    rec.pendingGmail = true
    await writeOutreach((body as any).id, rec)
    broadcast({ type: "sales" })
    return sendJson(res, { ok: true })
  }

  // POST /api/sales/video {id} → régénère la vidéo démo. Le serveur le fait LUI-MÊME (il tourne sur la VM,
  // ffmpeg installé) → progression en SSE {type:'refill', id}.
  if (path === "/api/sales/video" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id } = body as { id: string }
    if (!validProspectId(id)) return sendJson(res, { error: "bad id" }, 400)
    const rec = await readOutreach(id)
    const genDir = rec?.genDir || (await latestGen(id))
    if (!genDir) return sendJson(res, { error: "pas de génération" }, 404)
    runJob(`demo:${id}`, ["run", "demo", "--", id, genDir], `vidéo démo : ${id}`, { id, sales: true }, { DEMO_FORCE: "1" })
    return sendJson(res, { ok: true, queued: true, genDir })
  }

  // POST /api/sales/prepare {id} → prépare l'outreach (record + vidéo) d'un liké pas encore préparé.
  if (path === "/api/sales/prepare" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id } = body as { id: string }
    if (!validProspectId(id)) return sendJson(res, { error: "bad id" }, 400)
    runJob(`prepare:${id}`, ["run", "outreach", "--", id], `préparation outreach : ${id}`, { id, sales: true })
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

  // statut d'une génération (le verbe « valider » : draft → approved → sent). DB-owned, pas de fichier.
  if (path === "/api/status" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, date, status } = body as { id: string; date: string; status: string }
    if (!siteDir(id, date)) return sendJson(res, { error: "unknown site" }, 404)
    const allowed = ["draft", "approved", "sent", "rejected", "superseded", "drafted"]
    if (!allowed.includes(status)) return sendJson(res, { error: "bad status" }, 400)
    try {
      const db = getDb()
      await reindexSite(id, date) // garantit la ligne avant l'UPDATE
      // statut AVANT le changement → pour ne déclencher l'auto-recherche qu'à la VRAIE bascule vers 'approved'.
      const prev = await db.prepare("SELECT status FROM generations WHERE prospect_id=? AND dir_slug=?").get(id, date) as any
      const now = Date.now()
      await db.prepare(
        "UPDATE generations SET status=?, status_changed_at=?, sent_at=CASE WHEN ?='sent' THEN ? ELSE sent_at END WHERE prospect_id=? AND dir_slug=?",
      ).run(status, now, status, now, id, date)
      // AUTO À L'APPROBATION : le site passe approved (et ne l'était pas) → on lance recherche + script +
      // résolution des contacts manquants tout seul (le worker est idempotent). Best-effort : ne bloque
      // jamais la réponse status, jamais d'erreur remontée à l'opérateur.
      if (status === "approved" && prev?.status !== "approved") {
        try { if (tryDb()) await enqueueResearch(id, AUTH_USER) } catch { /* best-effort */ }
        void notifyAgent(id, date)
      }
      broadcast({ type: "sites" })
      return sendJson(res, { ok: true, status })
    } catch (e) {
      return sendJson(res, { error: String((e as Error).message) }, 500)
    }
  }

  // statut EN LOT (multi-sélection → approuver/écarter vite). Même logique que /api/status, appliquée à
  // chaque {id,date} de la liste ; ignore les invalides (site inconnu). status autorisé : approved/rejected/draft.
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
        if (!id || !date || !siteDir(id, date)) continue // ignore les invalides
        await reindexSite(id, date) // garantit la ligne avant l'UPDATE
        const prev = await db.prepare("SELECT status FROM generations WHERE prospect_id=? AND dir_slug=?").get(id, date) as any
        await db.prepare(
          "UPDATE generations SET status=?, status_changed_at=?, sent_at=CASE WHEN ?='sent' THEN ? ELSE sent_at END WHERE prospect_id=? AND dir_slug=?",
        ).run(status, now, status, now, id, date)
        // approbation EN LOT → déclenche aussi l'auto-recherche (comme /api/status unitaire), best-effort
        if (status === "approved" && prev?.status !== "approved") { try { await enqueueResearch(id, AUTH_USER) } catch { /* */ } void notifyAgent(id, date) }
        n++
      }
      broadcast({ type: "sites" })
      return sendJson(res, { ok: true, n })
    } catch (e) {
      return sendJson(res, { error: String((e as Error).message) }, 500)
    }
  }

  // niveau d'amour (0-3) : le CŒUR de tri, colonne dédiée, indépendant du status (coach/opérateur)
  if (path === "/api/love" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, date, love } = body as { id: string; date: string; love: number }
    if (!siteDir(id, date)) return sendJson(res, { error: "unknown site" }, 404)
    const lv = Math.max(0, Math.min(3, Math.round(Number(love) || 0)))
    try {
      const db = getDb()
      await reindexSite(id, date) // garantit la ligne avant l'UPDATE
      await db.prepare("UPDATE generations SET love=? WHERE prospect_id=? AND dir_slug=?").run(lv, id, date)
      broadcast({ type: "sites" })
      return sendJson(res, { ok: true, love: lv })
    } catch (e) {
      return sendJson(res, { error: String((e as Error).message) }, 500)
    }
  }

  // ════ NOTATION (jauges 0-100 par axe) : alimente learning/ (auto-amélioration). DB-owned (scores_json). ════
  // GET /api/score?id&date → scores parsés ({} si absent). dims = {global,typo,layout,animation,couleurs,contenu,
  // [section-N…]} (entiers 0-100), notes = { <axe>: "pourquoi" }, updatedAt = ms.
  if (path === "/api/score" && req.method === "GET") {
    const id = url.searchParams.get("id") || ""
    const date = url.searchParams.get("date") || ""
    if (!siteDir(id, date)) return sendJson(res, { error: "unknown site" }, 404)
    if (!tryDb()) return sendJson(res, {}) // sans DB : pas de notation persistée → « non noté » (jamais un 500)
    try {
      const r = await getDb().prepare("SELECT scores_json FROM generations WHERE prospect_id=? AND dir_slug=?").get(id, date) as any
      let scores: any = {}
      if (r?.scores_json) { try { scores = JSON.parse(r.scores_json) || {} } catch { scores = {} } }
      return sendJson(res, scores)
    } catch (e) {
      return sendJson(res, { error: String((e as Error).message) }, 500)
    }
  }
  // POST /api/score {id,date,dims,notes} → écrit scores_json ({dims,notes,updatedAt}) sur la génération.
  if (path === "/api/score" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, date, dims, notes } = body as { id: string; date: string; dims?: Record<string, unknown>; notes?: Record<string, unknown> }
    if (!siteDir(id, date)) return sendJson(res, { error: "unknown site" }, 404)
    // dims : on ne garde que des entiers 0-100 ; notes : que des chaînes (bornées). Robuste aux entrées libres.
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
      await reindexSite(id, date) // garantit la ligne avant l'UPDATE (comme /api/love)
      await db.prepare("UPDATE generations SET scores_json=? WHERE prospect_id=? AND dir_slug=?").run(JSON.stringify(scores), id, date)
      broadcast({ type: "sites" })
      return sendJson(res, { ok: true })
    } catch (e) {
      return sendJson(res, { error: String((e as Error).message) }, 500)
    }
  }

  // upload d'une capture collée → écrite à côté du control.md, référencée ![](fichier)
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

  // feedback : applique le commentaire au site. Le conteneur ne peut pas éditer (ni Claude ni Playwright)
  // → on EMPILE un job d'édition pour le WORKER (box), comme les batchs. Repli local si pas de DB (dev).
  if (path === "/api/refill" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, date } = body as { id: string; date: string }
    if (!siteDir(id, date)) return sendJson(res, { error: "unknown site" }, 404)
    if (tryDb()) {
      try {
        const row = await enqueueEdit(id, date, AUTH_USER)
        broadcast({ type: "batches" }); kickEngine()
        return sendJson(res, { ok: true, queued: true, batchId: row.id })
      } catch (e) { return sendJson(res, { error: String((e as Error).message) }, 500) }
    }
    // dev local (sans DB) : l'éditeur chirurgical (voie template-fill). Absent de l'édition open source → le dire
    if (!existsSync(join("design", "scripts", "edit.ts"))) return sendJson(res, { error: "L'édition par commentaire passe par le worker : pose DATABASE_URL (npm run db:init) et lance `npm run worker` ; le commentaire est alors empilé comme job d'édition pour l'agent." }, 503)
    refill(id, date) // spawn direct
    return sendJson(res, { ok: true })
  }

  // ---- assets d'un prospect : lister / réordonner / retirer / ajouter / uploader / recomposer ----
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
      photos: sheetPhotos.map(rel),   // dans l'ordre de la fiche
      extra: extra.map(rel),          // sur disque mais hors fiche
    })
  }

  // réordonner les photos de la fiche (le filler suit cet ordre)
  if (path === "/api/asset/order" && req.method === "POST") {
    const body = await parseBody(req); if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, order } = body as { id: string; order: string[] }
    if (!validProspectId(id) || !Array.isArray(order)) return sendJson(res, { error: "bad args" }, 400)
    const sheet = await readSheet(id); if (!sheet) return sendJson(res, { error: "unknown prospect" }, 404)
    sheet.assets = sheet.assets || { photos: [] }
    // on stocke toujours "assets/<id>/<file>" (le filler résout par basename)
    sheet.assets.photos = order.map((r) => `assets/${id}/${basename(String(r))}`)
    await writeSheet(id, sheet)
    logAssetEvent(id, "reorder", null, null)
    await reindexProspect(id).catch(() => {}) // ré-indexe la fiche réécrite (photos) ET ses assets
    broadcast({ type: "assets", id })
    return sendJson(res, { ok: true })
  }

  // retirer une photo de la fiche (le fichier reste sur disque, dans « hors fiche »)
  if (path === "/api/asset/remove" && req.method === "POST") {
    const body = await parseBody(req); if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, rel } = body as { id: string; rel: string }
    if (!validProspectId(id) || !rel) return sendJson(res, { error: "bad args" }, 400)
    const name = basename(String(rel))
    const sheet = await readSheet(id); if (!sheet) return sendJson(res, { error: "unknown prospect" }, 404)
    sheet.assets = sheet.assets || { photos: [] } // fiche sans clé assets → ne pas déréférencer undefined (500)
    if (sheet.assets.video && basename(sheet.assets.video.src) === name) delete sheet.assets.video
    else sheet.assets.photos = (sheet.assets.photos || []).filter((p: string) => basename(p) !== name)
    await writeSheet(id, sheet)
    logAssetEvent(id, "discard", `assets/${id}/${name}`, null)
    await reindexProspect(id).catch(() => {}) // ré-indexe la fiche réécrite (photos) ET ses assets
    broadcast({ type: "assets", id })
    return sendJson(res, { ok: true })
  }

  // (ré)intégrer un fichier « hors fiche » dans la fiche (photo ou logo ou vidéo)
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
    await reindexProspect(id).catch(() => {}) // ré-indexe la fiche réécrite (photos) ET ses assets
    broadcast({ type: "assets", id })
    return sendJson(res, { ok: true })
  }

  // upload d'un asset (photo/vidéo/logo) en base64 → écrit data/assets/<id>/ + ajout à la fiche
  if (path === "/api/asset/upload" && req.method === "POST") {
    const body = await parseBody(req); if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, name, dataUrl, as } = body as { id: string; name: string; dataUrl: string; as?: string }
    if (!validProspectId(id)) return sendJson(res, { error: "bad id" }, 400)
    const dir = safeUnder(DATA_ASSETS, id); if (!dir) return sendJson(res, { error: "bad id" }, 400)
    const m = /^data:([a-z0-9/+.-]+);base64,(.+)$/is.exec(dataUrl || "")
    if (!m) return sendJson(res, { error: "bad data" }, 400)
    const mime = m[1].toLowerCase()
    // ALLOWLIST stricte (pas de svg/html : exécutables inline ; pas de fallback qui dérive l'ext d'un mime arbitraire)
    const extByMime: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/avif": ".avif", "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov" }
    const ext = extByMime[mime]
    if (!ext) return sendJson(res, { error: "type non supporté (image/vidéo uniquement)" }, 400)
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
    await reindexProspect(id).catch(() => {}) // ré-indexe la fiche réécrite (photos) ET ses assets
    broadcast({ type: "assets", id })
    return sendJson(res, { file: `${id}/${safe}` })
  }

  // bibliothèque partagée : tous les assets de TOUS les prospects, dédupliqués par empreinte (hash)
  if (path === "/api/library") {
    try {
      const rows = await getDb().prepare("SELECT rel_path, kind, prospect_id, hash, mime FROM assets WHERE present=1 AND included=1 AND kind IN ('photo','video','logo') ORDER BY prospect_id").all() as any[]
      const byHash = new Map<string, { rel: string; kind: string; mime: string; usedBy: Set<string> }>()
      for (const r of rows) {
        const key = r.hash || r.rel_path
        const rel = String(r.rel_path).replace(/^assets\//, "") // → "<id>/<file>" (forme servie par /asset/)
        const cur = byHash.get(key)
        if (cur) cur.usedBy.add(r.prospect_id)
        else byHash.set(key, { rel, kind: r.kind, mime: r.mime, usedBy: new Set([r.prospect_id]) })
      }
      const items = [...byHash.values()].map((x) => ({ rel: x.rel, kind: x.kind, mime: x.mime, usedBy: x.usedBy.size }))
      return sendJson(res, { items })
    } catch { return sendJson(res, { items: [] }) }
  }

  // réutiliser un asset de la bibliothèque sur le prospect courant (copie dans son dossier + fiche)
  if (path === "/api/asset/from-library" && req.method === "POST") {
    const body = await parseBody(req); if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id, rel } = body as { id: string; rel: string } // rel = "<srcId>/<file>"
    if (!validProspectId(id) || !rel) return sendJson(res, { error: "bad args" }, 400)
    const src = safeUnder(DATA_ASSETS, String(rel))
    if (!src || !existsSync(src)) return sendJson(res, { error: "asset introuvable" }, 404)
    const sheet = await readSheet(id); if (!sheet) return sendJson(res, { error: "unknown prospect" }, 404)
    const name = basename(String(rel))
    const destDir = safeUnder(DATA_ASSETS, id); if (!destDir) return sendJson(res, { error: "bad id" }, 400)
    await mkdir(destDir, { recursive: true })
    const dest = join(destDir, name)
    if (resolve(src) !== resolve(dest)) await copyFile(src, dest) // copie physique dans le dossier du prospect
    sheet.assets = sheet.assets || { photos: [] }
    const p = `assets/${id}/${name}`
    if (VID_RE.test(name)) sheet.assets.video = { src: p }
    else { sheet.assets.photos = sheet.assets.photos || []; if (!sheet.assets.photos.some((x: string) => basename(x) === name)) sheet.assets.photos.push(p) }
    await writeSheet(id, sheet)
    logAssetEvent(id, "add", `assets/${rel}`, p, "depuis bibliothèque")
    await reindexProspect(id).catch(() => {})
    broadcast({ type: "assets", id })
    return sendJson(res, { ok: true, file: `${id}/${name}` })
  }

  // recompute : le swap d'assets « agit en conséquence » → re-fill complet (gardé par confirm UI)
  if (path === "/api/asset/refill" && req.method === "POST") {
    const body = await parseBody(req); if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { id } = body as { id: string }
    if (!validProspectId(id) || !existsSync(join(PROSPECTS, `${id}.json`))) return sendJson(res, { error: "unknown prospect" }, 404)
    if (currentRun) return sendJson(res, { error: "pipeline en cours — réessaie après" }, 409) // pas de fill pendant un run
    runJob(`fill:${id}`, ["run", "fill", "--", id], `rebuild (filler) après swap d'assets : ${id}`, { id })
    return sendJson(res, { ok: true })
  }

  // lancer le pipeline complet en direct (cockpit) — un seul run à la fois
  if (path === "/api/pipeline" && req.method === "POST") {
    const body = (await parseBody(req)) || {}
    const ok = startPipeline({ limit: Number(body.limit) || 0, force: !!body.force, design: body.design !== false })
    return ok ? sendJson(res, { ok: true }) : sendJson(res, { error: "un run est déjà en cours" }, 409)
  }
  // état d'un run en cours (ré-hydratation d'un client qui ouvre la page pendant un run)
  if (path === "/api/run") return sendJson(res, currentRun ? { active: true, startedAt: currentRun.startedAt, rows: Object.values(currentRun.rows) } : { active: false })

  // ---- FILE D'ATTENTE des batchs (cloud) : le cockpit empile, le WORKER (box) dépile ----
  // En conteneur Coolify, le cockpit ne peut pas générer lui-même (pas de Claude Code/Playwright) :
  // « lancer un batch » écrit une demande dans Supabase ; le worker natif sur la box la prend.
  if (path === "/api/batch" && req.method === "POST") {
    const body = (await parseBody(req)) || {}
    const mode: BatchMode = body.mode === "template-fill" ? "template-fill" : "composer"
    const lim = Number(body.limit) || null
    try {
      const row = await enqueueBatch({
        mode,
        industry: typeof body.industry === "string" && body.industry.trim() ? body.industry.trim() : null,
        seed: typeof body.seed === "string" && body.seed.trim() ? body.seed.trim() : null,
        lim,
        force: !!body.force,
        requestedBy: AUTH_USER, // l'opérateur authentifié (Basic Auth) ; sinon "lws"
        note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
        ids: Array.isArray(body.ids) ? body.ids.filter(validProspectId).slice(0, 200) : null, // RERUN par sélection (couleur) ; ids invalides écartés dès l'entrée
      })
      broadcast({ type: "batches" }); kickEngine()
      return sendJson(res, { ok: true, id: row.id })
    } catch (e) {
      // sans base, la file n'existe pas : 503 et la marche à suivre (comme /api/crm/split), pas un 500 opaque
      if (!tryDb()) return sendJson(res, { error: "pas de DB : la file des batchs vit en base (DATABASE_URL + npm run db:init), ou lance `npm run batch -- composer` en local" }, 503)
      return sendJson(res, { error: String((e as Error).message) }, 500)
    }
  }
  // la file (N derniers batchs) — pour le panneau « batchs » du cockpit
  if (path === "/api/batches") {
    try { return sendJson(res, { batches: await listBatches(30) }) }
    catch (e) { return sendJson(res, { batches: [], error: String((e as Error).message) }) }
  }

  // état du scheduling (cron/systemd) : dernier run + statut + installé ? + prochains runs (best-effort)
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

  // ---- brain : le cerveau (skills .claude/ + idées skillstash), funnel idées → test → actifs ----
  if (path === "/api/brain") return sendJson(res, { skills: await readSkills(), stash: await readStash() })

  // demande de changement sur un skill (boucle « commentaire » des skills, comme control.md)
  if (path === "/api/skill-feedback" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const { name, text } = body as { name: string; text: string }
    const dir = skillDir(name)
    if (!dir) return sendJson(res, { error: "unknown skill" }, 404)
    const fb = join(dir, "feedback.md")
    const clean = (text ?? "").trim()
    if (clean) await writeFile(fb, clean + "\n")
    else await rm(fb, { force: true }) // commentaire vidé → pas de feedback.md fantôme (0 octet)
    return sendJson(res, { ok: true })
  }

  // mettre une idée à l'épreuve / drafter à la main → brouillon de skill en MODE TEST
  if (path === "/api/skill-draft" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const slug = String((body.name ?? "")).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    if (!slug) return sendJson(res, { error: "bad name" }, 400)
    const dir = safeUnder(SKILLS_DIR, slug)
    if (!dir) return sendJson(res, { error: "bad name" }, 400)
    if (existsSync(dir)) return sendJson(res, { error: "skill existe déjà" }, 409)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, "SKILL.md"), draftScaffold(slug, String(body.brief ?? ""), String(body.signal ?? "")))
    return sendJson(res, { ok: true, slug })
  }

  // promouvoir un skill en test → actif (retire status: test + l'avertissement)
  if (path === "/api/skill-promote" && req.method === "POST") {
    const body = await parseBody(req)
    if (!body) return sendJson(res, { error: "bad json" }, 400)
    const dir = skillDir(String(body.name ?? ""))
    if (!dir) return sendJson(res, { error: "unknown skill" }, 404)
    const file = existsSync(join(dir, "SKILL.md")) ? join(dir, "SKILL.md") : join(dir, "prompt.md")
    if (!existsSync(file)) return sendJson(res, { error: "no skill file" }, 404)
    let txt = await readFile(file, "utf8")
    txt = txt.replace(/^status:\s*test\s*$\n?/im, "") // retire la ligne frontmatter
      .replace(/^>.*mode test[\s\S]*?(?:\n\n|\n(?=#))/im, "") // retire l'avertissement ⚠
    await writeFile(file, txt)
    return sendJson(res, { ok: true })
  }

  // notes du lab par template (gitignoré sous output/lab/)
  if (path === "/api/notes") {
    const slug = (url.searchParams.get("slug") || "").replace(/[^a-z0-9._-]/gi, "").replace(/^\.+/, "") // jamais « ....x.md »
    if (!slug) return sendJson(res, { error: "bad slug" }, 400)
    const file = join(LAB_NOTES, slug + ".md")
    if (req.method === "POST") {
      const body = await parseBody(req)
      if (!body) return sendJson(res, { error: "bad json" }, 400)
      const { text } = body as { text: unknown }
      if (text != null && typeof text !== "string") return sendJson(res, { error: "text doit être une chaîne" }, 400)
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
    // replay des évènements manqués pendant une coupure (gap recovery natif via Last-Event-ID)
    const last = Number(req.headers["last-event-id"] || 0)
    if (last) for (const e of ring) if (e.id > last) { try { res.write(e.line) } catch { /* parti */ } }
    clients.add(res)
    // heartbeat = vrai évènement (hors ring) : signale aussi la SANTÉ DU WATCHER (pas que du socket)
    const beat = setInterval(() => {
      try { res.write(`data: ${JSON.stringify({ type: "heartbeat", watch: watchOk })}\n\n`) } catch { clearInterval(beat) }
    }, 30000)
    req.on("close", () => { clearInterval(beat); clients.delete(res) })
    return
  }

  // ---- frontend statique ----
  const rel = path === "/" ? "index.html" : path.slice(1)
  const target = safeUnder(PUBLIC, rel)
  return target ? sendFile(res, target) : sendJson(res, { error: "bad path" }, 400)
}

// ---- fs.watch → SSE (fichier → UI) ----
function startWatch(dir: string, kind: "sites" | "templates" | "skills" | "assets"): void {
  if (!existsSync(dir)) return
  let timer: ReturnType<typeof setTimeout> | null = null
  // control.md changés (pour le broadcast 'control') ET dossiers touchés (pour le reindex, TOUT changement)
  const pendingControl = new Map<string, { id: string; date: string }>()
  const touched = new Set<string>() // "id/slug" (sites) ou "id" (assets)
  try {
    watch(dir, { recursive: true }, (_e, filename) => {
      const name = filename ? filename.toString() : ""
      const parts = name.split(sep)
      if (kind === "sites" && parts.length >= 2 && parts[0] && parts[1]) {
        touched.add(`${parts[0]}/${parts[1]}`) // index.html, assets, control.md… tout compte
        if (name.endsWith("control.md")) pendingControl.set(`${parts[0]}/${parts[1]}`, { id: parts[0], date: parts[1] })
      } else if (kind === "assets" && parts[0]) {
        touched.add(parts[0])
      }
      if (timer) clearTimeout(timer)
      timer = setTimeout(async () => {
        // le watcher fait un VRAI travail : il met la DB à jour AVANT de prévenir l'UI (qui relira la DB)
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
    watchOk = false // le heartbeat le signalera à l'UI (pastille « stale »), et le poller prend le relais
    console.warn(`⚠ watch récursif indisponible sur ${dir} — bascule sur le poller, pastille live « stale ».`)
  }
}

// ---- poller de secours : fs.watch récursif peut rater des events / saturer inotify (ENOSPC) sur Linux.
// On stat une signature légère (mtime des dossiers + des control.md) ; si elle bouge → reindex + 'sites'.
// C'est le PLANCHER qui garantit une cohérence éventuelle même si le watcher est mort.
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
    // les fiches prospect (édition manuelle / hors API) — le poller les rattrape (data/prospects non watché)
    for (const f of readdirSync(PROSPECTS)) {
      if (!f.endsWith(".json")) continue
      try { sig += `p:${f}:${Math.round(statSync(join(PROSPECTS, f)).mtimeMs)};` } catch { /* */ }
    }
  } catch { /* */ }
  return sig
}
let lastSig = ""
// garde anti-empilement : un reindexAll (lourd à 100+ sites, ~min) ne doit pas se relancer s'il tourne déjà.
let reindexing = false
async function safeReindexAll(): Promise<{ prospects: number; generations: number; ms: number } | null> {
  if (reindexing) return null
  reindexing = true
  try { return await reindexAll() } catch { return null } finally { reindexing = false }
}
function startPoller(): void {
  setInterval(async () => {
    if (reindexing) return // un reindex est en cours → on n'empile pas
    const sig = sitesSignature()
    if (sig !== lastSig) { lastSig = sig; await safeReindexAll(); broadcast({ type: "sites" }) }
  }, 8000)
}

// ---- findOpenPort (cf. impeccable/live-server.mjs), borné pour échouer clairement ----
function findOpenPort(start: number, ceiling = start + 100): Promise<number> {
  return new Promise((res, rej) => {
    if (start > ceiling || start > 65535) {
      return rej(new Error(`aucun port libre entre ${ceiling - 100} et ${Math.min(ceiling, 65535)}`))
    }
    const srv = netServer()
    srv.listen(start, HOST, () => { const p = (srv.address() as { port: number }).port; srv.close(() => res(p)) })
    srv.on("error", () => res(findOpenPort(start + 1, ceiling)))
  })
}

const PREFERRED = parseInt(process.env.BACKOFFICE_PORT || "4000", 10)
const port = await findOpenPort(PREFERRED)

// migration idempotente : colonne `love` (0-3, le cœur de tri) — additive, ne touche pas db.ts (fichier de Naly)
try { await getDb().prepare("ALTER TABLE generations ADD COLUMN IF NOT EXISTS love INTEGER DEFAULT 0").run() } catch { /* pas de DB en local → repli FS, pas de love */ }
// migration idempotente : colonne `scores_json` (notation 0-100 par axe + « pourquoi ») — additive, alimente learning/
try { await getDb().prepare("ALTER TABLE generations ADD COLUMN IF NOT EXISTS scores_json TEXT").run() } catch { /* pas de DB en local → repli FS, pas de notation */ }
// table CRM (2 pipelines : hot lead → closing) — idempotente, additive, ne touche pas db.ts (fichier de Naly).
// pipeline 'hot' : call0→relance1→relance2→relance3→nurturing · pipeline 'closing' : demo→propal→nego→signature.
// notes_json = [{at, outcome:'reach'|'unreach'|'rdv'|'note', text}]. Un approuvé sans ligne entre en hot/call0 (cf /api/crm).
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
  // additifs (tables déjà créées) : script d'appel + brief de recherche (skill /account-research)
  await getDb().prepare("ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS call_script TEXT").run()
  await getDb().prepare("ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS research_json TEXT").run()
  // attribution opérateur (naly=bleu / yann=rouge) : qui appelle ce prospect. NULL = non attribué.
  await getDb().prepare("ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS assigned_to TEXT").run()
  // tag tél : 1 = a répondu (vert) · 0 = pas de réponse (rouge) · NULL = jamais appelé. Découplé de l'étape.
  await getDb().prepare("ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS answered INTEGER").run()
} catch { /* pas de DB en local → pas de CRM (la plateforme l'indique) */ }

// ⚡ DÉMARRER LE SERVEUR D'ABORD — sinon, avec 100+ sites, le reindex de boot (~2 min) bloque AVANT
// que le serveur n'écoute → traefik renvoie « 502 Bad Gateway » pendant tout ce temps. Le cockpit
// répond tout de suite (il lit le Supabase déjà indexé) ; le reindex se fait EN ARRIÈRE-PLAN.
createServer((req, res) => {
  handle(req, res).catch((e) => {
    try { sendJson(res, { error: String(e?.message || e) }, 500) } catch { /* noop */ }
  })
}).listen(port, HOST, () => {
  console.log(`✓ station de contrôle → http://${HOST}:${port}`)
  console.log(`  sites: ${SITES}/  ·  templates: ${TEMPLATES}/  ·  Ctrl-C pour arrêter`)
  if (ALLOWED_HOST) {
    console.log(`  partage tunnel : host autorisé « ${ALLOWED_HOST} » · auth ${AUTH_PASS ? "ON ✓" : "OFF"}`)
    if (!AUTH_PASS) console.warn(`  ⚠ DANGER : host externe autorisé SANS mot de passe — pose BACKOFFICE_PASSWORD avant d'exposer le tunnel !`)
  }
})

// index DB au boot, NON BLOQUANT (best-effort) — le cockpit servait déjà avant que ça finisse.
lastSig = sitesSignature() // baseline pour le poller (évite un faux positif au 1er tick)
safeReindexAll().then((r) => {
  if (r) console.log(`✓ index DB → ${r.prospects} prospects · ${r.generations} générations · ${r.ms}ms`)
  else console.warn(`⚠ index DB indisponible — lecture FS directe.`)
})
startWatch(SITES, "sites")
startWatch(TEMPLATES, "templates")
startWatch(SKILLS_DIR, "skills")
startWatch(DATA_ASSETS, "assets")
startPoller()
