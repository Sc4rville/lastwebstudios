#!/usr/bin/env node
// worker/coach.mjs — le GARDE qualité post-composition.
// À chaque site composer fini : sert le site en HTTP FIDÈLE (comme le cockpit : racine + /data/assets),
// capture le rendu SERVI (desktop + mobile), un coach LLM (Opus) juge contre une checklist (worker/coach.md),
// et renvoie ses correctifs AU composer → passe d'édition → re-juge. Boucle (cap). Filet : marque le site
// 'a-revoir' en base si les blockers ne sont pas résolus (jamais de faux PASS livré en silence).
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
// modèle du coach : COACH_MODEL (posé par le worker depuis packages/llm/models.ts → rôle smart), sinon
// LWS_MODEL_SMART / LWS_MODEL, sinon l'alias Claude Code « opus » (suit la version de la CLI installée)
const MODEL = process.env.COACH_MODEL || process.env.LWS_MODEL_SMART || process.env.LWS_MODEL || "opus"
const CLAUDE_BIN = process.env.WORKER_CLAUDE_BIN || process.env.CLAUDE_BIN || "claude"

if (!ID || !DATE) { console.error("usage: node worker/coach.mjs <id> <date> [--cap 3] [--no-fix] [--industry x]"); process.exit(2) }
const SITE = join(ROOT, "output", "sites", ID, DATE)
if (!existsSync(join(SITE, "index.html"))) { console.error("coach: pas d'index.html → " + SITE); process.exit(2) }

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".avif": "image/avif", ".gif": "image/gif", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".mp4": "video/mp4", ".webm": "video/webm", ".ico": "image/x-icon" }

// sert le site EXACTEMENT comme le cockpit : fichiers du site à la racine + /data/assets/ depuis le repo.
// → le rendu capturé est le VRAI rendu servi (c'est ce qui aurait attrapé les images cassées / voids).
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
    // CONTENU MASQUÉ par une anim de révélation NON déclenchée (clip-reveal/fade-up qui restent cachés
    // après un scroll normal) → l'utilisateur voit un VOID alors que la capture fullPage le révélerait.
    // C'est LE piège qui a fait passer un site à galerie vide. On le mesure ici, en viewport réel.
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
    // IMAGES BASSE-DÉF affichées en GRAND (floues) : résolution native << taille rendue. Capteur OBJECTIF
    // (l'œil du coach rate le flou). ratio = naturalWidth / largeur affichée ; < 0.8 = étirée → molle/floue.
    const lowResEx = []
    for (const i of document.images) {
      if (!(i.complete && i.naturalWidth > 0)) continue
      const r = i.getBoundingClientRect()
      if (r.width < 220 || r.height < 140) continue // ignore vignettes/icônes
      const ratio = i.naturalWidth / r.width
      if (ratio < 0.8) lowResEx.push({ src: (i.currentSrc || i.src).split("/").pop(), nat: i.naturalWidth + "x" + i.naturalHeight, disp: Math.round(r.width) + "x" + Math.round(r.height), ratio: +ratio.toFixed(2) })
    }
    // VRAIES PHOTOS affichées (hors logo/icônes) : un site de métier VISUEL sans photos = creux (« facile de
    // ne pas avoir de flou si on ne met pas d'image »). On le mesure pour que le coach exige un minimum.
    let contentImages = 0
    for (const i of document.images) {
      if (!(i.complete && i.naturalWidth > 0)) continue
      const r = i.getBoundingClientRect()
      const src = (i.currentSrc || i.src).toLowerCase()
      if (r.width >= 140 && r.height >= 100 && !/logo|icon|favicon|sprite|placeholder/.test(src) && !/logo/.test((i.alt || "").toLowerCase())) contentImages++
    }
    // NAVBAR AU REPOS (avant scroll) : les liens du menu sont-ils LISIBLES sur le fond derrière la nav ?
    // Défaut récurrent = héros clair + liens clairs = blanc-sur-blanc invisible. Capteur DÉTERMINISTE
    // (l'œil du coach le rate) : ratio de contraste WCAG entre la couleur du lien et le fond effectif.
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

// lance claude -p SUR LE PLAN (token OAuth ou login claude.ai), renvoie {ok, out}. ANTHROPIC_API_KEY est retirée :
// en -p, Claude Code utilise toujours une clé API présente avant le plan (facturation API, ou échec si clé morte).
function claudeRun(prompt, allowedTools) {
  return new Promise((resolve) => {
    const a = ["-p", "--model", MODEL, "--allowedTools", ...allowedTools]
    const env = { ...process.env }; delete env.ANTHROPIC_API_KEY
    const child = spawn(CLAUDE_BIN, a, { cwd: ROOT, env, stdio: ["pipe", "pipe", "pipe"] })
    // octets décodés UNE fois (un « é » coupé entre deux lectures du tube ne devient pas « �� » dans le verdict)
    const out = textCollector(), err = textCollector(64_000)
    child.stdout.on("data", b => out.push(b))
    child.stderr.on("data", b => err.push(b))
    child.on("error", e => resolve({ ok: false, out: "", err: e.message }))
    child.on("close", code => resolve({ ok: code === 0, out: out.text(), err: err.text() }))
    child.stdin.write(prompt); child.stdin.end()
  })
}

// robuste : enlève les fences markdown, trouve le DERNIER objet JSON équilibré contenant "verdict"
// (Opus peut précéder le JSON de raisonnement). Évite le « verdict illisible » sur une sortie bavarde.
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
    .replaceAll("{{INDUSTRY}}", INDUSTRY || "inconnu")
  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt = base + (attempt > 1 ? "\n\n⚠ RAPPEL : réponds UNIQUEMENT le JSON {verdict,...}, AUCUN texte autour." : "")
    const r = await claudeRun(prompt, ["Read"])
    const v = parseVerdict(r.out)
    if (v) return v
    console.log(`coach: verdict illisible (essai ${attempt}/2) — brut: ${(r.out || r.err || "(vide)").slice(0, 280).replace(/\s+/g, " ")}`)
  }
  return null
}

async function applyFixes(blockers) {
  const list = blockers.map((b, i) => `${i + 1}. [${b.where}] ${b.problem} → ${b.fix}`).join("\n")
  const prompt = `Tu es l'ingénieur front du studio ${agency().name}. Un coach design a relevé des DÉFAUTS BLOQUANTS sur un site composer déjà construit. Corrige-les DIRECTEMENT dans les fichiers, sans casser le reste ni changer l'identité visuelle du site.

Dossier du site : ${SITE}  (index.html + CSS/JS). Le site doit être SELF-CONTAINED : les images en relatif LOCAL (assets/… dans le dossier du site). Si une image est référencée via ../../../../data/assets/, COPIE-la dans ${SITE}/assets/ et corrige le src. JAMAIS de void : toute zone d'image vide reçoit une vraie photo (regarde data/assets/${ID}/ pour les photos disponibles) ou se rabat proprement (fond couleur/gradient, ou la zone se réduit).

DÉFAUTS À CORRIGER :
${list}

Édite les fichiers (Read puis Edit/Write). Réponds seulement « FIXÉ » à la fin.`
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
  } catch (e) { console.error("coach: maj statut KO — " + e.message) }
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
      console.log(`coach[${attempt}/${CAP}] signaux ${JSON.stringify(shot.signals)}`)
      verdict = await judge(shot, tpl)
      if (!verdict) { console.log("coach: verdict illisible → arrêt (pas de faux pass)"); break }
      console.log(`coach[${attempt}] verdict=${verdict.verdict} · ${verdict.summary || ""}`)
      ;(verdict.blockers || []).forEach(b => console.log(`   ⛔ [${b.where}] ${b.problem} → ${b.fix}`))
      if (verdict.verdict === "pass") break
      if (NO_FIX || attempt === CAP) break
      console.log(`coach: ${(verdict.blockers || []).length} blocker(s) → passe d'édition du composer…`)
      await applyFixes(verdict.blockers || [])
    }
  } finally { srv.close(); await browser.close() }
  const passed = !!(verdict && verdict.verdict === "pass")
  if (!passed) await setStatus("a-revoir") // filet : 'a-revoir' visible au cockpit si non résolu (sur PASS on ne touche pas au statut)
  console.log(passed ? "✅ coach: PASS" : "⚠ coach: marqué 'a-revoir' (blockers non résolus)")
  console.log("COACH_RESULT=" + JSON.stringify({ id: ID, date: DATE, passed, verdict }))
  process.exit(0)
}
main().catch(e => { console.error("coach ERR " + e.message); process.exit(1) })
