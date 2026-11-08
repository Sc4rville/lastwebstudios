#!/usr/bin/env node
/**
 * lint.mjs — the DETERMINISTIC post-composition net (zero LLM).
 *
 * Principle (see the composer audit of 2026-06-17): we no longer BEG a model to respect a mechanical rule
 * ("ZERO em-dash", "copy the assets"…) — we GUARANTEE it in code. The prompt gets lighter, the defect disappears.
 *
 * Checks the static HTML (what verify.cjs can't see without a browser):
 *   1. EM-DASH (—) / EN-DASH (–) in the copy → an AI tell. `--fix` rewrites them (comma / hyphen).
 *   2. ASSETS on a DISK path (../../../../data/…, /home/…, absolute /data/assets) → 404 once served.
 *   3. @font-face whose woff2 is MISSING from the site's folder → the browser falls back to the generic SYSTEM
 *      font ("the Claude font") even though your _after.png looked fine. A serious fault.
 *   4. a DASHED EYEBROW (see below).
 *
 * Usage: node design/scripts/lint.mjs <index.html> [--fix]
 *   --fix: rewrites the em/en-dashes IN PLACE. The rest = reported (exit 1).
 * JSON output. Exit 0 clean · 1 problem(s) · 2 file not found.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

const file = process.argv[2]
const FIX = process.argv.includes("--fix")
if (!file || !existsSync(file)) { console.log(JSON.stringify({ skipped: true, reason: "index.html not found" })); process.exit(2) }

let html = readFileSync(file, "utf8")
const dir = dirname(file)

// 1 ── EM-DASH / EN-DASH EVERYWHERE (copy, CSS `content`, comments) — it is an AI tell, zero tolerance
const dashCount = (html.match(/[—–]/g) || []).length
if (FIX && dashCount) {
  html = html
    .replace(/(\d)\s*[–—]\s*(\d)/g, "$1-$2")               // a range of numbers (12–14) → hyphen
    .replace(/\s*[—–]\s*/g, ", ")                          // the rest (aside/break/decoration) → comma
    .replace(/ ,/g, ",").replace(/,\s*,/g, ",")            // clean-up
  writeFileSync(file, html)
}

// 2 ── ASSETS on a disk path (broken once served over HTTP)
const diskAssets = []
for (const m of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
  const ref = (m[1] || m[2] || "").trim()
  if (/^(\.\.\/){2,}/.test(ref) || /^\/(home|data\/assets|Users)\//.test(ref) || ref.startsWith("file://"))
    diskAssets.push(ref)
}

// 3 ── @font-face: does the referenced woff2 REALLY exist in the site's folder?
const missingFonts = []
const faceBlocks = html.match(/@font-face\s*{[^}]*}/gi) || []
for (const block of faceBlocks) {
  for (const u of block.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    let ref = u[1].split("?")[0].replace(/^\.?\//, "")
    if (/^(https?:|data:)/.test(ref)) continue              // CDN / inline base64 = OK
    if (!existsSync(resolve(dir, ref))) missingFonts.push(ref)
  }
}

// 4 ── DASHED EYEBROW (the VISUAL AI tell): a ::before/::after pseudo-element = a thin decorative line before a kicker.
//      The "—— LABEL" pattern screams "AI-generated", whether it is a real em-dash OR a CSS line. Banned.
const eyebrowRule = []
for (const m of html.matchAll(/::(?:before|after)\s*\{([^}]*)\}/gi)) {
  const d = m[1]
  if (/content\s*:\s*["']\s*["']/.test(d) && /height\s*:\s*[12](?:\.\d+)?px/.test(d) && /width\s*:\s*[\d.]+\s*(?:rem|em|px)/.test(d) && /background/.test(d))
    eyebrowRule.push(m[0].replace(/\s+/g, " ").slice(0, 70))
}

const problems = []
if (!FIX && dashCount) problems.push(`${dashCount} em/en-dash (run again with --fix)`)
if (diskAssets.length) problems.push(`${diskAssets.length} asset(s) on a DISK path → 404 when served: ${[...new Set(diskAssets)].slice(0, 4).join(" · ")}`)
if (missingFonts.length) problems.push(`${missingFonts.length} @font-face font(s) MISSING → system fallback: ${[...new Set(missingFonts)].slice(0, 4).join(" · ")}`)
if (eyebrowRule.length) problems.push(`${eyebrowRule.length} kicker/eyebrow with a decorative DASH (AI tell) → remove the ::before/::after line (e.g. ${eyebrowRule[0]})`)

const clean = problems.length === 0
console.log(JSON.stringify({ clean, dashCount, fixed: FIX ? dashCount : 0, diskAssets: [...new Set(diskAssets)], missingFonts: [...new Set(missingFonts)], eyebrowRule, problems }, null, 2))
process.exit(clean ? 0 : 1)
