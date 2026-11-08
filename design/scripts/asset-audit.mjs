#!/usr/bin/env node
/**
 * asset-audit.mjs — the DETERMINISTIC image analysis upstream of the asset-boost step (Higgsfield).
 *
 * Reads a prospect's real photos (data/assets/<id>/) and decides, without an LLM, what MUST be boosted:
 *   · native resolution (parses the PNG/JPEG/WebP header, zero dependencies) → HD or not
 *   · ratio / orientation → fit for full-bleed (borderless) or not
 *   · mechanical action: `upscale+relight` (not HD), `crop-ok` (HD), `thumbnail` (too small)
 *   · hero candidate: the biggest sharp landscape photo
 *
 * RULE (Scarville's request): a photo that is NOT HD ALWAYS goes through resize + relight; we aim for sharp
 * BORDERLESS photos for heroes. The audit FLAGS, the asset-boost agent CARRIES OUT (Higgsfield).
 *
 * Usage: node design/scripts/asset-audit.mjs <prospectId>
 * Writes data/assets/<id>/_audit.json and prints the summary. Exit 0.
 */
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const HD_MIN = 1600          // minimum native width for clean use
const BORDERLESS_MIN = 1920  // minimum width for a sharp full-bleed hero
const TINY = 700             // below = thumbnail, upscale required or small use

const id = process.argv[2]
if (!id) { console.error("usage: node design/scripts/asset-audit.mjs <prospectId>"); process.exit(1) }
const dir = join("data", "assets", id)
if (!existsSync(dir)) { console.error(`✗ ${dir} not found`); process.exit(1) }

// ---- dimensions from the binary header (PNG / JPEG / WebP) — no dependency ----
function dimensions(buf) {
  // PNG: signature + IHDR
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
  // GIF
  if (buf.length > 10 && buf[0] === 0x47 && buf[1] === 0x49) return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) }
  // WebP (RIFF…WEBP)
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const fmt = buf.toString("ascii", 12, 16)
    if (fmt === "VP8 ") return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff }
    if (fmt === "VP8L") { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 } }
    if (fmt === "VP8X") return { w: ((buf[24] | (buf[25] << 8) | (buf[26] << 16)) & 0xffffff) + 1, h: ((buf[27] | (buf[28] << 8) | (buf[29] << 16)) & 0xffffff) + 1 }
  }
  // JPEG: look for a SOF marker
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2
    while (o < buf.length - 9) {
      if (buf[o] !== 0xff) { o++; continue }
      const marker = buf[o + 1]
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) }
      o += 2 + buf.readUInt16BE(o + 2)
    }
  }
  return null
}

const isImg = (f) => /\.(png|jpe?g|webp|gif)$/i.test(f)
const isLogo = (f) => /logo|avant\.png|_audit|_boost/i.test(f)
const files = readdirSync(dir).filter((f) => isImg(f) && !isLogo(f))

const assets = []
for (const f of files) {
  let dim = null
  try { dim = dimensions(readFileSync(join(dir, f))) } catch {}
  if (!dim || !dim.w) { assets.push({ file: f, readable: false }); continue }
  const ratio = +(dim.w / dim.h).toFixed(2)
  const orient = ratio > 1.25 ? "landscape" : ratio < 0.8 ? "portrait" : "square"
  const hd = dim.w >= HD_MIN
  const action = dim.w < TINY ? "thumbnail (upscale required, or use it small/sharp)"
    : !hd ? "upscale+relight"                  // not HD → ALWAYS resize + relight
    : "crop-ok"                                // HD → free cropping (the design leads)
  assets.push({ file: f, w: dim.w, h: dim.h, ratio, orient, hd, borderlessReady: dim.w >= BORDERLESS_MIN && orient === "landscape", action })
}

const usable = assets.filter((a) => a.w)
const hero = usable.filter((a) => a.orient === "landscape").sort((a, b) => b.w * b.h - a.w * a.h)[0] || null
const summary = {
  total: usable.length,
  hd: usable.filter((a) => a.hd).length,
  needBoost: usable.filter((a) => a.action !== "crop-ok").map((a) => a.file),
  borderlessReady: usable.filter((a) => a.borderlessReady).length,
  heroCandidate: hero ? hero.file : null,
  heroBorderless: hero ? hero.borderlessReady : false,
}
writeFileSync(join(dir, "_audit.json"), JSON.stringify({ id, generated: new Date().toISOString().slice(0, 10), summary, assets }, null, 2))

console.log(`asset-audit ${id}: ${summary.total} photo(s), ${summary.hd} HD, ${summary.needBoost.length} to boost${summary.heroCandidate ? `, hero=${summary.heroCandidate}${summary.heroBorderless ? " (borderless OK)" : " (to widen/upscale for full-bleed)"}` : ", NO photo (editorial composition)"}`)
if (summary.needBoost.length) console.log(`  → resize+relight: ${summary.needBoost.slice(0, 6).join(", ")}`)
