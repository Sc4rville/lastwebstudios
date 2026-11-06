#!/usr/bin/env node
/**
 * inject-cursor.mjs — pose le curseur custom « Awwwards » sur un site composé, de façon DÉTERMINISTE
 * (jamais dépendant du LLM → il y est À CHAQUE FOIS). Copie cursor.js/css dans le dossier du site et
 * insère les balises dans index.html (idempotent : ne double jamais). Accent repris du site si trouvé.
 *
 *   node worker/inject-cursor.mjs <dossier-du-site>     # ex: output/sites/x/2026-06-20-composer
 *   node worker/inject-cursor.mjs --all                 # tous les sites composés (backfill)
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync, statSync, rmSync } from "node:fs"
import { join, dirname, basename } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, "..", "design", "components", "cursor")

// industrie du prospect → thème de curseur (+ halo). Défaut = slate (sobre premium).
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
  if (html.includes("cursor.js")) return "déjà"                 // idempotent
  copyFileSync(join(SRC, "cursor.js"), join(dir, "cursor.js"))
  copyFileSync(join(SRC, "cursor.css"), join(dir, "cursor.css"))
  // accent du site : reprend --accent / --aqua-deep si défini, sinon blanc (blend-difference = inverse, marche sur tout)
  const m = html.match(/--(?:accent|aqua-deep|brand|primary)\s*:\s*(#[0-9a-fA-F]{3,8}|rgb[^;]+)/)
  const accentRule = m ? `<style>:root{--cz-accent:${m[1]}}</style>` : `<style>:root{--cz-accent:#ffffff}</style>`
  const head = `${accentRule}<link rel="stylesheet" href="cursor.css">`
  const foot = `<script src="cursor.js" defer></script>`
  // thème métier → pose data-cz-theme sur <html> (pilote le curseur net + le halo)
  const theme = themeFor(dir)
  if (!/data-cz-theme=/i.test(html)) html = html.replace(/<html(\s|>)/i, `<html data-cz-theme="${theme}"$1`)
  html = html.includes("</head>") ? html.replace("</head>", head + "</head>") : head + html
  html = html.includes("</body>") ? html.replace("</body>", foot + "</body>") : html + foot
  writeFileSync(idx, html)
  return "✓ injecté"
}

// --uninject : RETIRE le curseur (strip les balises + supprime cursor.js/css). Réversible, idempotent.
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
  return "✓ retiré"
}

const UNINJECT = process.argv.includes("--uninject")
const fn = UNINJECT ? uninjectOne : injectOne
const ok = UNINJECT ? "✓ retiré" : "✓ injecté"
const verb = UNINJECT ? "retiré de" : "injecté sur"

if (process.argv.includes("--all")) {
  const base = "output/sites"
  let n = 0
  for (const id of (existsSync(base) ? readdirSync(base) : [])) {
    for (const d of readdirSync(join(base, id))) {
      const dir = join(base, id, d)
      try { if (statSync(dir).isDirectory() && /-composer$/.test(d)) { if (fn(dir) === ok) n++ } } catch { /* */ }
    }
  }
  console.log(`curseur ${verb} ${n} site(s)`)
} else {
  const dir = process.argv.slice(2).find((a) => !a.startsWith("--"))
  if (!dir) { console.error("usage: node worker/inject-cursor.mjs [--uninject] <dossier-site> | [--uninject] --all"); process.exit(1) }
  console.log(fn(dir), dir)
}
