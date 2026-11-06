#!/usr/bin/env node
/**
 * lint.mjs — le filet DÉTERMINISTE post-composition (zéro LLM).
 *
 * Principe (cf. audit composer 2026-06-17) : on ne SUPPLIE plus un modèle de respecter une mécanique
 * (« ZÉRO em-dash », « copie les assets »…) — on la GARANTIT en code. Le prompt s'allège, le défaut disparaît.
 *
 * Vérifie sur le HTML statique (ce que verify.cjs ne voit pas sans navigateur) :
 *   1. EM-DASH (—) / EN-DASH (–) dans la copie  → tell IA. `--fix` les réécrit (virgule / trait).
 *   2. ASSETS en chemin DISQUE (../../../../data/…, /home/…, /data/assets absolu) → 404 une fois servi.
 *   3. @font-face dont le woff2 est ABSENT du dossier du site → le navigateur retombe sur la font
 *      SYSTÈME générique (« la typo Claude ») alors que ton _after.png paraissait OK. Faute grave.
 *
 * Usage : node design/scripts/lint.mjs <index.html> [--fix]
 *   --fix : réécrit les em/en-dash EN PLACE (hors <style>/<script>). Le reste = rapporté (exit 1).
 * Sortie JSON. Exit 0 propre · 1 problème(s) · 2 fichier introuvable.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

const file = process.argv[2]
const FIX = process.argv.includes("--fix")
if (!file || !existsSync(file)) { console.log(JSON.stringify({ skipped: true, reason: "index.html introuvable" })); process.exit(2) }

let html = readFileSync(file, "utf8")
const dir = dirname(file)

// 1 ── EM-DASH / EN-DASH PARTOUT (copie, CSS `content`, commentaires) — c'est un tell IA, zéro tolérance
const dashCount = (html.match(/[—–]/g) || []).length
if (FIX && dashCount) {
  html = html
    .replace(/(\d)\s*[–—]\s*(\d)/g, "$1-$2")               // plage de chiffres (12–14) → trait
    .replace(/\s*[—–]\s*/g, ", ")                          // le reste (incise/rupture/déco) → virgule
    .replace(/ ,/g, ",").replace(/,\s*,/g, ",")            // nettoyage
  writeFileSync(file, html)
}

// 2 ── ASSETS en chemin disque (cassés une fois servis en HTTP)
const diskAssets = []
for (const m of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
  const ref = (m[1] || m[2] || "").trim()
  if (/^(\.\.\/){2,}/.test(ref) || /^\/(home|data\/assets|Users)\//.test(ref) || ref.startsWith("file://"))
    diskAssets.push(ref)
}

// 3 ── @font-face : le woff2 référencé existe-t-il VRAIMENT dans le dossier du site ?
const missingFonts = []
const faceBlocks = html.match(/@font-face\s*{[^}]*}/gi) || []
for (const block of faceBlocks) {
  for (const u of block.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    let ref = u[1].split("?")[0].replace(/^\.?\//, "")
    if (/^(https?:|data:)/.test(ref)) continue              // CDN / inline base64 = OK
    if (!existsSync(resolve(dir, ref))) missingFonts.push(ref)
  }
}

// 4 ── EYEBROW À TIRET (le tell IA VISUEL) : pseudo-élément ::before/::after = fine ligne déco devant un kicker.
//      Le motif « —— LABEL » crie « généré par IA », qu'il soit un vrai em-dash OU une ligne CSS. Banni.
const eyebrowRule = []
for (const m of html.matchAll(/::(?:before|after)\s*\{([^}]*)\}/gi)) {
  const d = m[1]
  if (/content\s*:\s*["']\s*["']/.test(d) && /height\s*:\s*[12](?:\.\d+)?px/.test(d) && /width\s*:\s*[\d.]+\s*(?:rem|em|px)/.test(d) && /background/.test(d))
    eyebrowRule.push(m[0].replace(/\s+/g, " ").slice(0, 70))
}

const problems = []
if (!FIX && dashCount) problems.push(`${dashCount} em/en-dash (relance avec --fix)`)
if (diskAssets.length) problems.push(`${diskAssets.length} asset(s) en chemin DISQUE → 404 servi : ${[...new Set(diskAssets)].slice(0, 4).join(" · ")}`)
if (missingFonts.length) problems.push(`${missingFonts.length} font(s) @font-face ABSENTE(S) → fallback système : ${[...new Set(missingFonts)].slice(0, 4).join(" · ")}`)
if (eyebrowRule.length) problems.push(`${eyebrowRule.length} kicker/eyebrow à TIRET décoratif (tell IA) → retire la ligne ::before/::after (ex. ${eyebrowRule[0]})`)

const clean = problems.length === 0
console.log(JSON.stringify({ clean, dashCount, fixed: FIX ? dashCount : 0, diskAssets: [...new Set(diskAssets)], missingFonts: [...new Set(missingFonts)], eyebrowRule, problems }, null, 2))
process.exit(clean ? 0 : 1)
