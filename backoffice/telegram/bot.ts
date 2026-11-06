/**
 * bot.ts — Bot Telegram : notifie les NOUVELLES GÉNÉRATIONS (screenshot + lien public) et permet de
 * RÉPONDRE pour laisser un commentaire (prompt-back → control.md → review:batch). SCRIPT, pas de LLM.
 *
 * Sécurité : on NE tunnelise PAS le backoffice complet (il a des API d'écriture). On expose un serveur
 * d'aperçu EN LECTURE SEULE (output/sites, GET /preview/* uniquement) via un tunnel cloudflared.
 * Le bot est FERMÉ PAR DÉFAUT (F-1) : seuls les chats de TELEGRAM_ALLOWED_CHAT_IDS sont servis (notifiés,
 * /batch, commentaires). Un inconnu est ignoré et journalisé. Traitement des updates : ./handler.ts.
 *
 * Setup : @BotFather → /newbot → token → .env (TELEGRAM_BOT_TOKEN=…) → `npm run telegram` → envoyer un
 * message au bot : il journalise ton chat id (refusé) → ajoute-le à TELEGRAM_ALLOWED_CHAT_IDS dans .env →
 * relance. Sans cloudflared : screenshot-only (pas de lien public).
 *
 * Usage : npm run telegram
 */
import { createServer } from "node:http"
import { chromium, type Browser } from "playwright"
import { existsSync, statSync, readFileSync, writeFileSync, readdirSync, watch } from "node:fs"
import { join, resolve, extname, sep } from "node:path"
import { spawn } from "node:child_process"
import { readControl } from "../../packages/shared/control.ts"
import { enqueueBatch, enqueueEdit } from "../../packages/shared/batch.ts"
import { tryDb } from "../../packages/shared/db.ts"
import { reindexSite } from "../../packages/shared/reindex.ts"
import { handleUpdate, parseAllowlist, type TgState } from "./handler.ts"
import { lineSplitter } from "../../packages/shared/lines.mjs"

try { process.loadEnvFile() } catch { /* env direct */ }

const TOKEN = process.env.TELEGRAM_BOT_TOKEN
if (!TOKEN) {
  console.error(`✗ TELEGRAM_BOT_TOKEN manquant. Setup (2 min) :
  1. Telegram → @BotFather → /newbot → copie le token
  2. Ajoute à .env :  TELEGRAM_BOT_TOKEN=123456:ABC-...
  3. Relance : npm run telegram, puis envoie un message au bot.`)
  process.exit(1)
}

// liste blanche (F-1) : vide = personne n'est servi (le bot démarre, journalise les chats qui lui écrivent)
const { ids: ALLOWED, invalid: badIds } = parseAllowlist(process.env.TELEGRAM_ALLOWED_CHAT_IDS)
if (badIds.length) console.warn(`⚠ TELEGRAM_ALLOWED_CHAT_IDS : entrées ignorées (pas des ids numériques) : ${badIds.join(", ")}`)

const API = `${(process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/$/, "")}/bot${TOKEN}`
const SITES = "output/sites"
const STATE = "output/.telegram.json" // gitignoré (output/)
const PREVIEW_PORT = parseInt(process.env.PREVIEW_PORT || "4100", 10)
const HOSTHDR = `127.0.0.1:${PREVIEW_PORT}`
const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!))

// ---- état persistant ----
type State = TgState
function loadState(): State {
  try { return { chats: [], seen: {}, offset: 0, msgMap: {}, ...JSON.parse(readFileSync(STATE, "utf8")) } }
  catch { return { chats: [], seen: {}, offset: 0, msgMap: {} } }
}
const state = loadState()
function save() { try { writeFileSync(STATE, JSON.stringify(state)) } catch { /* noop */ } }
// chats enrôlés AVANT la liste blanche (l'ancien bot enrôlait tout le monde) : ceux hors liste sont retirés
{
  const dropped = state.chats.filter((c) => !ALLOWED.has(c))
  if (dropped.length) {
    console.warn(`⚠ ${dropped.length} chat(s) connu(s) hors TELEGRAM_ALLOWED_CHAT_IDS retiré(s) des notifications : ${dropped.join(", ")}`)
    state.chats = state.chats.filter((c) => ALLOWED.has(c))
    save()
  }
}

// ---- serveur d'aperçu READ-ONLY (jamais d'API d'écriture) ----
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf", ".ico": "image/x-icon",
}
function safeUnder(base: string, rel: string): string | null {
  const baseAbs = resolve(base)
  let clean: string
  try { clean = decodeURIComponent(rel).replace(/^\/+/, "") } catch { return null }
  const target = resolve(baseAbs, clean)
  if (target !== baseAbs && !target.startsWith(baseAbs + sep)) return null
  return target
}
function previewServer() {
  createServer((req, res) => {
    if (req.method !== "GET" || !req.url?.startsWith("/preview/")) { res.writeHead(404); res.end("not found"); return }
    const target = safeUnder(SITES, req.url.slice("/preview/".length).split("?")[0])
    if (!target) { res.writeHead(400); res.end("bad path"); return }
    try {
      let p = target
      if (statSync(p).isDirectory()) p = join(p, "index.html")
      res.writeHead(200, { "Content-Type": MIME[extname(p).toLowerCase()] || "application/octet-stream" })
      res.end(readFileSync(p))
    } catch { res.writeHead(404); res.end("not found") }
  }).listen(PREVIEW_PORT, "127.0.0.1", () => console.log(`  aperçu read-only → http://127.0.0.1:${PREVIEW_PORT}`))
}

// ---- tunnel cloudflared (lien public). Absent → screenshot-only. ----
let publicUrl: string | null = null
function startTunnel() {
  const local = `${process.env.HOME}/.local/bin/cloudflared`
  const bin = existsSync(local) ? local : "cloudflared"
  const child = spawn(bin, ["tunnel", "--url", `http://127.0.0.1:${PREVIEW_PORT}`, "--http-host-header", HOSTHDR, "--no-autoupdate"], { env: process.env })
  // ligne à ligne : l'URL du tunnel coupée entre deux lectures du tube n'était jamais reconnue (bot sans lien public)
  const onLine = (line: string) => {
    const m = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
    if (m && !publicUrl) { publicUrl = m[0]; console.log(`  tunnel public → ${publicUrl}`) }
  }
  const out = lineSplitter(onLine), errLines = lineSplitter(onLine)
  child.stdout?.on("data", (b: Buffer) => out.push(b)); child.stderr?.on("data", (b: Buffer) => errLines.push(b))
  child.on("error", () => console.warn("  ⚠ cloudflared introuvable → screenshot-only (lien public off)"))
}

// ---- Telegram ----
async function sendMsg(chat: number, text: string) {
  try { await fetch(`${API}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: false }) }) }
  catch { /* réseau */ }
}
async function sendPhoto(chat: number, buf: Buffer, caption: string): Promise<number | null> {
  try {
    const form = new FormData()
    form.append("chat_id", String(chat)); form.append("caption", caption); form.append("parse_mode", "HTML")
    form.append("photo", new Blob([new Uint8Array(buf)]), "shot.png")
    const r = await fetch(`${API}/sendPhoto`, { method: "POST", body: form })
    const j: any = await r.json()
    return j?.result?.message_id ?? null
  } catch { return null }
}

// ---- screenshot (playwright, file://) ----
let browser: Browser
async function shot(indexPath: string): Promise<Buffer | null> {
  try {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await p.goto("file://" + resolve(indexPath), { waitUntil: "domcontentloaded" })
    await p.waitForTimeout(1200)
    const buf = await p.screenshot()
    await p.close()
    return buf
  } catch { return null }
}

// ---- le « Tinder » : boutons inline ✅ approuver / ❌ écarter / 💬 commenter ----
const KB = { inline_keyboard: [[{ text: "✅ approuver", callback_data: "ok" }, { text: "❌ écarter", callback_data: "no" }], [{ text: "💬 commenter", callback_data: "cmt" }]] }
async function sendPhotoBtns(chat: number, buf: Buffer, caption: string): Promise<number | null> {
  try {
    const form = new FormData()
    form.append("chat_id", String(chat)); form.append("caption", caption); form.append("parse_mode", "HTML")
    form.append("reply_markup", JSON.stringify(KB))
    form.append("photo", new Blob([new Uint8Array(buf)]), "shot.png")
    const r = await fetch(`${API}/sendPhoto`, { method: "POST", body: form })
    const j: any = await r.json(); return j?.result?.message_id ?? null
  } catch { return null }
}
async function answerCb(cbId: string, text: string) {
  try { await fetch(`${API}/answerCallbackQuery`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ callback_query_id: cbId, text }) }) } catch { /* */ }
}
async function editCaption(chat: number, mid: number, caption: string) {
  try { await fetch(`${API}/editMessageCaption`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chat, message_id: mid, caption, parse_mode: "HTML", reply_markup: { inline_keyboard: [] } }) }) } catch { /* */ }
}
// applique un statut (approved/rejected) à une génération dans Supabase — comme le bouton du cockpit
async function setStatus(id: string, date: string, status: string): Promise<boolean> {
  const db = tryDb(); if (!db) return false
  try {
    await reindexSite(id, date) // garantit la ligne
    await db.prepare("UPDATE generations SET status=?, status_changed_at=? WHERE prospect_id=? AND dir_slug=?").run(status, Date.now(), id, date)
    return true
  } catch { return false }
}

// ---- notifier une génération (avec les boutons du swipe) ----
async function notify(id: string, date: string) {
  const dir = join(SITES, id, date)
  const idx = join(dir, "index.html")
  const chats = state.chats.filter((c) => ALLOWED.has(c))
  if (!existsSync(idx) || !chats.length) return
  const ctl = await readControl(join(dir, "control.md"))
  const link = publicUrl ? `${publicUrl}/preview/${encodeURIComponent(id)}/${encodeURIComponent(date)}/index.html` : null
  const caption =
    `🆕 <b>${esc(id)}</b> · ${esc(date)}\n${esc(ctl.template)} · ${esc(ctl.counts)}` +
    (link ? `\n\n🔗 ${link}` : "") +
    `\n\n👇 Swipe : approuver, écarter, ou commenter (réponds avec ton texte).`
  const buf = await shot(idx)
  for (const chat of chats) {
    if (buf) { const mid = await sendPhotoBtns(chat, buf, caption); if (mid) state.msgMap[`${chat}:${mid}`] = `${id}/${date}` }
    else await sendMsg(chat, caption)
  }
  save()
}

// ---- watcher : nouvelles générations (index.html plus récent) ----
function seedSeen() {
  if (!existsSync(SITES)) return
  for (const id of readdirSync(SITES)) {
    const idDir = join(SITES, id)
    try { if (!statSync(idDir).isDirectory()) continue } catch { continue }
    for (const date of readdirSync(idDir)) {
      const idx = join(idDir, date, "index.html")
      try { if (statSync(idx).isFile()) state.seen[`${id}/${date}`] ??= statSync(idx).mtimeMs } catch { /* skip */ }
    }
  }
  save()
}
function watchSites() {
  if (!existsSync(SITES)) return
  const dirty = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    watch(SITES, { recursive: true }, (_e, fn) => {
      const name = fn ? fn.toString() : ""
      if (!name.endsWith("index.html")) return
      const parts = name.split(sep)
      if (parts.length < 3) return
      dirty.add(`${parts[0]}/${parts[1]}`)
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, 1000)
    })
  } catch { console.warn("  ⚠ watch récursif indisponible — notifications off") }
  async function flush() {
    for (const key of [...dirty]) {
      dirty.delete(key)
      const [id, date] = key.split("/")
      const idx = join(SITES, id, date, "index.html")
      if (!existsSync(idx)) continue
      const m = statSync(idx).mtimeMs
      if (state.seen[key] && m <= state.seen[key]) continue
      state.seen[key] = m; save()
      await notify(id, date)
    }
  }
}

// ---- long-poll getUpdates : prompt-back (le traitement vit dans ./handler.ts, testé) ----
const deps = {
  state, allowed: ALLOWED, sitesDir: SITES,
  sendMsg, answerCb, editCaption, setStatus,
  enqueueBatch: (o: Parameters<typeof enqueueBatch>[0]) => enqueueBatch(o),
  enqueueEdit: (id: string, date: string, by: string) => enqueueEdit(id, date, by),
  hasDb: () => !!tryDb(),
  save,
  log: (line: string) => console.warn(line),
}
async function poll() {
  for (;;) {
    try {
      const r = await fetch(`${API}/getUpdates?timeout=30&offset=${state.offset}`)
      const j: any = await r.json()
      for (const u of j?.result ?? []) await handleUpdate(u, deps)
      save()
    } catch { await new Promise((r) => setTimeout(r, 3000)) }
  }
}

// ---- démarrage ----
browser = await chromium.launch()
seedSeen()
previewServer()
startTunnel()
watchSites()
if (!ALLOWED.size) console.warn("⚠ TELEGRAM_ALLOWED_CHAT_IDS vide : le bot ne sert PERSONNE. Écris-lui, récupère ton chat id dans ce journal, ajoute-le à .env, relance.")
console.log(`✓ bot telegram en marche · ${ALLOWED.size} chat(s) autorisé(s)${state.chats.length ? "" : ". Envoie un message au bot pour le connecter."}`)
poll()
