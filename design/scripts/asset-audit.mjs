#!/usr/bin/env node
/**
 * asset-audit.mjs — l'analyse d'image DÉTERMINISTE en amont du maillon asset-boost (Higgsfield).
 *
 * Lit les vraies photos d'un prospect (data/assets/<id>/) et tranche, sans LLM, ce qui DOIT être boosté :
 *   · résolution native (parse l'en-tête PNG/JPEG/WebP, zéro dépendance) → HD ou pas
 *   · ratio / orientation → apte au plein-bleed (borderless) ou pas
 *   · action mécanique : `upscale+relight` (pas HD), `crop-ok` (HD), `thumbnail` (trop petite)
 *   · héro candidat : la plus grande photo paysage nette
 *
 * RÈGLE (cf. demande Scarville) : une photo PAS HD passe TOUJOURS par resize + relight ; on vise des
 * photos BORDERLESS nettes pour les héros. L'audit FLAGUE, l'agent asset-boost EXÉCUTE (Higgsfield).
 *
 * Usage : node design/scripts/asset-audit.mjs <prospectId>
 * Écrit data/assets/<id>/_audit.json et imprime le résumé. Exit 0.
 */
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const HD_MIN = 1600          // largeur native mini pour un usage propre
const BORDERLESS_MIN = 1920  // largeur mini pour un héro plein-bleed net
const TINY = 700             // en-dessous = vignette, upscale obligatoire ou usage petit

const id = process.argv[2]
if (!id) { console.error("usage: node design/scripts/asset-audit.mjs <prospectId>"); process.exit(1) }
const dir = join("data", "assets", id)
if (!existsSync(dir)) { console.error(`✗ ${dir} introuvable`); process.exit(1) }

// ---- dimensions depuis l'en-tête binaire (PNG / JPEG / WebP) — aucune dépendance ----
function dimensions(buf) {
  // PNG : signature + IHDR
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
  // JPEG : on cherche un marqueur SOF
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
  const action = dim.w < TINY ? "thumbnail (upscale obligatoire ou usage petit/net)"
    : !hd ? "upscale+relight"                  // pas HD → TOUJOURS resize + relight
    : "crop-ok"                                // HD → recadrage libre (le design commande)
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

console.log(`asset-audit ${id} : ${summary.total} photo(s), ${summary.hd} HD, ${summary.needBoost.length} à booster${summary.heroCandidate ? `, héro=${summary.heroCandidate}${summary.heroBorderless ? " (borderless OK)" : " (à élargir/upscale pour plein-bleed)"}` : ", AUCUNE photo (compo éditoriale)"}`)
if (summary.needBoost.length) console.log(`  → resize+relight : ${summary.needBoost.slice(0, 6).join(", ")}`)
