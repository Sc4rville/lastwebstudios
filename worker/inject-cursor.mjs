#!/usr/bin/env node
/**
 * inject-cursor.mjs — puts the custom "Awwwards" cursor on a composed site, DETERMINISTICALLY
 * (never depends on the LLM → it is there EVERY TIME). Copies cursor.js/css into the site's folder and
 * inserts the tags into index.html (idempotent: never doubles). Accent taken from the site when found.
 *
 *   node worker/inject-cursor.mjs <site-folder>         # e.g. output/sites/x/2026-06-20-composer
 *   node worker/inject-cursor.mjs --all                 # every composed site (backfill)
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync, statSync, rmSync } from "node:fs"
import { join, dirname, basename } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, "..", "design", "components", "cursor")

// the prospect's trade → cursor theme (+ halo). Default = slate (sober premium).
const THEME_BY_INDUSTRY = {
  pisciniste: "ocean", piscine: "ocean", piscines: "ocean",
  "lieu-reception": "gold", "lieu-de-reception": "gold", reception: "gold", evenementiel: "gold",
  paysagiste: "forest", jardin: "forest", jardinier: "forest",
  charpente: "wood", charpentier: "wood", menuisier: "wood", menuiserie: "wood", ebeniste: "wood", artisan: "wood",
  cuisiniste: "slate", cuisine: "slate",
}
function themeFor(dir) {
  try {
    const id = basename(dirname(dir))
    const p = JSON.parse(readFileSync(join("data", "prospects", `${id}.json`), "utf8"))
    return THEME_BY_INDUSTRY[(p.industry || "").toLowerCase()] || "slate"
  } catch { return "slate" }
}

function injectOne(dir) {
  const idx = join(dir, "index.html")
  if (!existsSync(idx)) return "no-index"
  let html = readFileSync(idx, "utf8")
  if (html.includes("cursor.js")) return "already"              // idempotent
  copyFileSync(join(SRC, "cursor.js"), join(dir, "cursor.js"))
  copyFileSync(join(SRC, "cursor.css"), join(dir, "cursor.css"))
  // the site's accent: takes --accent / --aqua-deep when defined, otherwise white (blend-difference = inverse, works on anything)
  const m = html.match(/--(?:accent|aqua-deep|brand|primary)\s*:\s*(#[0-9a-fA-F]{3,8}|rgb[^;]+)/)
  const accentRule = m ? `<style>:root{--cz-accent:${m[1]}}</style>` : `<style>:root{--cz-accent:#ffffff}</style>`
  const head = `${accentRule}<link rel="stylesheet" href="cursor.css">`
  const foot = `<script src="cursor.js" defer></script>`
  // trade theme → sets data-cz-theme on <html> (drives the sharp cursor + the halo)
  const theme = themeFor(dir)
  if (!/data-cz-theme=/i.test(html)) html = html.replace(/<html(\s|>)/i, `<html data-cz-theme="${theme}"$1`)
  html = html.includes("</head>") ? html.replace("</head>", head + "</head>") : head + html
  html = html.includes("</body>") ? html.replace("</body>", foot + "</body>") : html + foot
  writeFileSync(idx, html)
  return "✓ injected"
}

// --uninject: REMOVES the cursor (strips the tags + deletes cursor.js/css). Reversible, idempotent.
function uninjectOne(dir) {
  const idx = join(dir, "index.html")
  if (!existsSync(idx)) return "no-index"
  let html = readFileSync(idx, "utf8")
  if (!html.includes("cursor.js")) return "absent"
  html = html
    .replace(/<style>:root\{--cz-accent:[^}]*\}<\/style>/g, "")
    .replace(/<link rel="stylesheet" href="cursor\.css">/g, "")
    .replace(/<script src="cursor\.js" defer><\/script>/g, "")
    .replace(/\s*data-cz-theme="[^"]*"/gi, "")
  writeFileSync(idx, html)
  for (const f of ["cursor.js", "cursor.css"]) { try { rmSync(join(dir, f), { force: true }) } catch { /* */ } }
  return "✓ removed"
}

const UNINJECT = process.argv.includes("--uninject")
const fn = UNINJECT ? uninjectOne : injectOne
const ok = UNINJECT ? "✓ removed" : "✓ injected"
const verb = UNINJECT ? "removed from" : "injected on"

if (process.argv.includes("--all")) {
  const base = "output/sites"
  let n = 0
  for (const id of (existsSync(base) ? readdirSync(base) : [])) {
    for (const d of readdirSync(join(base, id))) {
      const dir = join(base, id, d)
      try { if (statSync(dir).isDirectory() && /-composer$/.test(d)) { if (fn(dir) === ok) n++ } } catch { /* */ }
    }
  }
  console.log(`cursor ${verb} ${n} site(s)`)
} else {
  const dir = process.argv.slice(2).find((a) => !a.startsWith("--"))
  if (!dir) { console.error("usage: node worker/inject-cursor.mjs [--uninject] <site-folder> | [--uninject] --all"); process.exit(1) }
  console.log(fn(dir), dir)
}
