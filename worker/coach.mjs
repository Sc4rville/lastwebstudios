#!/usr/bin/env node
// worker/coach.mjs — the post-composition quality GUARD.
// For each finished composer site: serves the site over FAITHFUL HTTP (like the cockpit: root + /data/assets),
// captures the SERVED render (desktop + mobile), an LLM coach (Opus) judges it against a checklist (worker/coach.md),
// and sends its fixes back TO the composer → an edit pass → judges again. Loops (--cap). Safety net: marks the site
// 'a-revoir' in the database if the blockers are not solved (never a fake PASS delivered silently).
//
// Usage : node worker/coach.mjs <id> <date> [--cap 3] [--no-fix] [--industry <x>]
import http from "node:http"
import { readFile } from "node:fs/promises"
import { existsSync, createReadStream, statSync } from "node:fs"
import { join, extname } from "node:path"
import { spawn } from "node:child_process"
import { chromium } from "playwright"
import { agency } from "../packages/shared/agency.mjs"
import { textCollector } from "../packages/shared/lines.mjs"

const ROOT = process.cwd()
const argv = process.argv.slice(2)
const ID = argv[0], DATE = argv[1]
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const CAP = parseInt(flag("--cap", "3"), 10)
const NO_FIX = argv.includes("--no-fix")
const INDUSTRY = flag("--industry", "")
// the coach's model: COACH_MODEL (set by the worker from packages/llm/models.ts → smart role), otherwise
// LWS_MODEL_SMART / LWS_MODEL, otherwise the Claude Code alias "opus" (follows the installed CLI's version)
const MODEL = process.env.COACH_MODEL || process.env.LWS_MODEL_SMART || process.env.LWS_MODEL || "opus"
const CLAUDE_BIN = process.env.WORKER_CLAUDE_BIN || process.env.CLAUDE_BIN || "claude"

if (!ID || !DATE) { console.error("usage: node worker/coach.mjs <id> <date> [--cap 3] [--no-fix] [--industry x]"); process.exit(2) }
const SITE = join(ROOT, "output", "sites", ID, DATE)
if (!existsSync(join(SITE, "index.html"))) { console.error("coach: no index.html → " + SITE); process.exit(2) }

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".avif": "image/avif", ".gif": "image/gif", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".mp4": "video/mp4", ".webm": "video/webm", ".ico": "image/x-icon" }

// serves the site EXACTLY like the cockpit: the site's files at the root + /data/assets/ from the repo.
// → the captured render is the REAL served render (that is what would have caught the broken images / voids).
function serveSite() {
  return new Promise((res) => {
    const srv = http.createServer((req, rep) => {
      let p = decodeURIComponent((req.url || "/").split("?")[0])
      let file
      if (p.startsWith("/data/assets/")) file = join(ROOT, "data", "assets", p.slice("/data/assets/".length))
      else { if (p === "/") p = "/index.html"; file = join(SITE, p) }
      if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) { rep.writeHead(404); return rep.end("404") }
      rep.writeHead(200, { "content-type": MIME[extname(file).toLowerCase()] || "application/octet-stream" })
      createReadStream(file).pipe(rep)
    })
    srv.listen(0, "127.0.0.1", () => res(srv))
  })
}

async function shoot(port, browser) {
  const url = `http://127.0.0.1:${port}/index.html`
  // DESKTOP
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(url, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {})
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 160)) } window.scrollTo(0, 0) })
  await page.waitForTimeout(1200)
  const signals = await page.evaluate(() => {
    const imgs = [...document.images].filter(i => i.currentSrc || i.src)
    const broken = imgs.filter(i => !(i.complete && i.naturalWidth > 0))
    const header = document.querySelector("header, nav")
    // CONTENT HIDDEN by a reveal animation that does NOT fire (clip-reveal/fade-up staying hidden
    // after a normal scroll) → the user sees a VOID while the fullPage capture would reveal it.
    // It is THE trap that let a site with an empty gallery through. Measured here, in a real viewport.
    const sel = '[class*="reveal"],[class*="fade"],[class*="appear"],.gallery-cell,[data-reveal],[data-scroll]'
    let hiddenContent = 0
    const hiddenEx = []
    for (const el of document.querySelectorAll(sel)) {
      const cs = getComputedStyle(el)
      const clipped = /inset\(\s*(?:[5-9]\d|100)/.test(cs.clipPath || "") || cs.clipPath.includes("circle(0")
      const invisible = parseFloat(cs.opacity || "1") < 0.1 || cs.visibility === "hidden" || clipped
      const hasContent = el.querySelector("img") || (el.textContent || "").trim().length > 20
      if (invisible && hasContent) { hiddenContent++; if (hiddenEx.length < 5) hiddenEx.push((el.className || "").toString().slice(0, 40)) }
    }
    // LOW-RES IMAGES shown LARGE (blurry): native resolution << rendered size. An OBJECTIVE sensor
    // (the coach's eye misses the blur). ratio = naturalWidth / displayed width; < 0.8 = stretched → soft/blurry.
    const lowResEx = []
    for (const i of document.images) {
      if (!(i.complete && i.naturalWidth > 0)) continue
      const r = i.getBoundingClientRect()
      if (r.width < 220 || r.height < 140) continue // skip thumbnails/icons
      const ratio = i.naturalWidth / r.width
      if (ratio < 0.8) lowResEx.push({ src: (i.currentSrc || i.src).split("/").pop(), nat: i.naturalWidth + "x" + i.naturalHeight, disp: Math.round(r.width) + "x" + Math.round(r.height), ratio: +ratio.toFixed(2) })
    }
    // REAL PHOTOS shown (besides logo/icons): a VISUAL trade's site without photos = hollow ("easy to
    // have no blur when there is no image"). Measured so the coach can demand a minimum.
    let contentImages = 0
    for (const i of document.images) {
      if (!(i.complete && i.naturalWidth > 0)) continue
      const r = i.getBoundingClientRect()
      const src = (i.currentSrc || i.src).toLowerCase()
      if (r.width >= 140 && r.height >= 100 && !/logo|icon|favicon|sprite|placeholder/.test(src) && !/logo/.test((i.alt || "").toLowerCase())) contentImages++
    }
    // NAVBAR AT REST (before scrolling): are the menu links READABLE on the background behind the nav?
    // The recurring defect = a light hero + light links = invisible white on white. A DETERMINISTIC sensor
    // (the coach's eye misses it): the WCAG contrast ratio between the link's colour and the effective background.
    const lum = (c) => { const m = (c || "").match(/[\d.]+/g); if (!m || m.length < 3) return null; const [r, g, b] = m.slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
    const ratio = (c1, c2) => { const a = lum(c1), b = lum(c2); if (a == null || b == null) return null; return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }
    const bgBehind = (el) => { let n = el; while (n && n !== document.documentElement) { const cs = getComputedStyle(n); if (cs.backgroundImage && cs.backgroundImage !== "none") return { img: true }; const bg = cs.backgroundColor; if (bg && !/rgba?\(0,\s*0,\s*0,\s*0\)|transparent/.test(bg)) return { color: bg }; n = n.parentElement } return { color: getComputedStyle(document.body).backgroundColor } }
    let navLinks = 0, navLowContrast = 0; const navEx = []
    if (header) { for (const a of header.querySelectorAll("a,button,span")) { const t = (a.textContent || "").trim(); if (t.length < 2 || t.length > 32) continue; const r = a.getBoundingClientRect(); if (r.top > 140 || r.width < 8 || r.height < 6) continue; navLinks++; const col = getComputedStyle(a).color; const bg = bgBehind(a); if (bg.img) continue; const cr = ratio(col, bg.color); if (cr != null && cr < 2.2) { navLowContrast++; if (navEx.length < 4) navEx.push({ text: t.slice(0, 20), color: col, bg: bg.color, ratio: +cr.toFixed(2) }) } } }
    return {
      images: imgs.length,
      brokenImages: broken.length,
      brokenSrc: broken.map(i => (i.currentSrc || i.src).split("/").pop()).slice(0, 8),
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 2,
      headerHeight: header ? Math.round(header.getBoundingClientRect().height) : null,
      hiddenContent, hiddenEx,
      lowResImages: lowResEx.length, lowResEx: lowResEx.slice(0, 5),
      contentImages,
      navLinks, navLowContrast, navEx,
    }
  })
  const desktop = join(SITE, "_coach-desktop.png")
  await page.screenshot({ path: desktop, fullPage: true })
  await ctx.close()
  // MOBILE
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const mp = await mctx.newPage()
  await mp.goto(url, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {})
  await mp.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 140)) } window.scrollTo(0, 0) })
  await mp.waitForTimeout(1000)
  signals.mobileOverflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)
  const mobile = join(SITE, "_coach-mobile.png")
  await mp.screenshot({ path: mobile, fullPage: true })
  await mctx.close()
  return { desktop, mobile, signals }
}

// runs claude -p ON THE PLAN (OAuth token or claude.ai login), returns {ok, out}. ANTHROPIC_API_KEY is removed:
// in -p, Claude Code always uses an API key that is present before the plan (API billing, or a failure if the key is dead).
function claudeRun(prompt, allowedTools) {
  return new Promise((resolve) => {
    const a = ["-p", "--model", MODEL, "--allowedTools", ...allowedTools]
    const env = { ...process.env }; delete env.ANTHROPIC_API_KEY
    const child = spawn(CLAUDE_BIN, a, { cwd: ROOT, env, stdio: ["pipe", "pipe", "pipe"] })
    // bytes decoded ONCE (an « é » cut between two pipe reads does not become « �� » in the verdict)
    const out = textCollector(), err = textCollector(64_000)
    child.stdout.on("data", b => out.push(b))
    child.stderr.on("data", b => err.push(b))
    child.on("error", e => resolve({ ok: false, out: "", err: e.message }))
    child.on("close", code => resolve({ ok: code === 0, out: out.text(), err: err.text() }))
    child.stdin.write(prompt); child.stdin.end()
  })
}

// robust: strips markdown fences, finds the LAST balanced JSON object containing "verdict"
// (Opus may put reasoning before the JSON). Avoids an "unreadable verdict" on a chatty output.
function parseVerdict(text) {
  if (!text) return null
  let t = String(text).trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i); if (fence) t = fence[1].trim()
  const objs = []
  let depth = 0, start = -1
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (ch === "{") { if (depth === 0) start = i; depth++ }
    else if (ch === "}") { if (depth > 0) { depth--; if (depth === 0 && start >= 0) { objs.push(t.slice(start, i + 1)); start = -1 } } }
  }
  for (const c of objs.reverse()) { try { const v = JSON.parse(c); if (v && v.verdict) return v } catch { /* suivant */ } }
  return null
}

async function judge(shot, tpl) {
  const base = tpl
    .replaceAll("{{DESKTOP}}", shot.desktop)
    .replaceAll("{{MOBILE}}", shot.mobile)
    .replaceAll("{{SIGNALS}}", JSON.stringify(shot.signals))
    .replaceAll("{{INDUSTRY}}", INDUSTRY || "unknown")
  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt = base + (attempt > 1 ? "\n\n⚠ REMINDER: answer ONLY the JSON {verdict,...}, NO text around it." : "")
    const r = await claudeRun(prompt, ["Read"])
    const v = parseVerdict(r.out)
    if (v) return v
    console.log(`coach: unreadable verdict (try ${attempt}/2) — raw: ${(r.out || r.err || "(empty)").slice(0, 280).replace(/\s+/g, " ")}`)
  }
  return null
}

async function applyFixes(blockers) {
  const list = blockers.map((b, i) => `${i + 1}. [${b.where}] ${b.problem} → ${b.fix}`).join("\n")
  const prompt = `You are the front-end engineer of the ${agency().name} studio. A design coach found BLOCKING DEFECTS on a composer site that is already built. Fix them DIRECTLY in the files, without breaking the rest or changing the site's visual identity.

Site folder: ${SITE}  (index.html + CSS/JS). The site must be SELF-CONTAINED: images on LOCAL relative paths (assets/… in the site's folder). If an image is referenced through ../../../../data/assets/, COPY it into ${SITE}/assets/ and fix the src. NEVER a void: any empty image area gets a real photo (look at data/assets/${ID}/ for the available photos) or falls back cleanly (a colour/gradient background, or the area shrinks).

DEFECTS TO FIX:
${list}

Edit the files (Read then Edit/Write). Answer only "FIXED" at the end.`
  return claudeRun(prompt, ["Read", "Write", "Edit", "Glob", "Grep", "Bash"])
}

async function setStatus(status) {
  try {
    if (!process.env.DATABASE_URL) return
    const { default: postgres } = await import("postgres")
    const { pgSsl, onPgNotice, pgPoolMax } = await import("../packages/shared/pg-options.mjs")
    const sql = postgres(process.env.DATABASE_URL, { ssl: pgSsl(process.env.DATABASE_URL), onnotice: onPgNotice, prepare: false, max: pgPoolMax(10) })
    await sql`update generations set status=${status} where prospect_id=${ID} and dir_slug=${DATE}`
    await sql.end()
  } catch (e) { console.error("coach: status update failed — " + e.message) }
}

async function main() {
  const tpl = await readFile(join(ROOT, "worker", "coach.md"), "utf8")
  const browser = await chromium.launch()
  const srv = await serveSite()
  const port = srv.address().port
  let verdict = null
  try {
    for (let attempt = 1; attempt <= CAP; attempt++) {
      const shot = await shoot(port, browser)
      console.log(`coach[${attempt}/${CAP}] signals ${JSON.stringify(shot.signals)}`)
      verdict = await judge(shot, tpl)
      if (!verdict) { console.log("coach: unreadable verdict → stop (no fake pass)"); break }
      console.log(`coach[${attempt}] verdict=${verdict.verdict} · ${verdict.summary || ""}`)
      ;(verdict.blockers || []).forEach(b => console.log(`   ⛔ [${b.where}] ${b.problem} → ${b.fix}`))
      if (verdict.verdict === "pass") break
      if (NO_FIX || attempt === CAP) break
      console.log(`coach: ${(verdict.blockers || []).length} blocker(s) → composer edit pass…`)
      await applyFixes(verdict.blockers || [])
    }
  } finally { srv.close(); await browser.close() }
  const passed = !!(verdict && verdict.verdict === "pass")
  if (!passed) await setStatus("a-revoir") // safety net: 'a-revoir' visible in the cockpit when unsolved (on PASS the status is left alone)
  console.log(passed ? "✅ coach: PASS" : "⚠ coach: marked 'a-revoir' (blockers not solved)")
  console.log("COACH_RESULT=" + JSON.stringify({ id: ID, date: DATE, passed, verdict }))
  process.exit(0)
}
main().catch(e => { console.error("coach ERR " + e.message); process.exit(1) })
