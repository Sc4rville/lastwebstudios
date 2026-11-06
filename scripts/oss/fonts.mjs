#!/usr/bin/env node
/**
 * scripts/oss/fonts.mjs · LA BIBLIOTHÈQUE DE POLICES LIBRES (SIL OFL 1.1) de LWS, de provenance vérifiable.
 *
 * Pourquoi : le catalogue `design/fonts/` a été récolté sur des sites tiers (`npm run harvest:fonts`) et contient
 * surtout des polices commerciales, non redistribuables. Un site publiable sans licence, et l'édition open source,
 * n'utilisent QUE cette bibliothèque : chaque fichier vient du paquet npm Fontsource officiel (miroir des fichiers
 * Google Fonts), sa version est figée, son empreinte sha256 est notée dans `design/fonts/oss.lock.json`, et le texte
 * de licence `OFL.txt` (celui du paquet) est posé dans le dossier de la famille.
 *
 *   node scripts/oss/fonts.mjs            vérifie (hors ligne) : verrou ↔ fichiers ↔ paires, OFL partout, rien de
 *                                         la blacklist ; exit 1 au moindre écart (utilisé par les tests)
 *   node scripts/oss/fonts.mjs --fetch    (ré)télécharge depuis Fontsource (jsDelivr), réécrit le verrou
 *   node scripts/oss/fonts.mjs --json     le rapport de vérification en JSON
 *
 * Fichiers : `design/fonts/<slug>/<slug>-var.woff2` (variable, axe wght, sous-ensemble latin : français compris,
 * Œ œ € inclus) ; `<slug>-var-italic.woff2` pour les serifs éditoriales ; statiques `<slug>-<graisse>[-italic].woff2`
 * quand la famille n'existe pas en variable, ou pour l'UI du cockpit (mêmes noms que ses polices actuelles).
 */
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
export const FONTS_DIR = join("design", "fonts")
export const LOCK = join(FONTS_DIR, "oss.lock.json")
export const PAIRINGS = join(FONTS_DIR, "pairings.oss.json")
export const BLACKLIST = join(FONTS_DIR, "blacklist.txt")

/**
 * Les familles. `vf` : fichier variable ; `italic` : + l'italique variable ; `statics` : graisses statiques
 * (normal) ; `staticItalics` : graisses statiques en italique. Toutes OFL-1.1 (vérifié contre l'API Fontsource).
 */
export const FAMILIES = [
  // display / sans de caractère
  { id: "host-grotesk", family: "Host Grotesk", vf: true, statics: [300, 400, 600] },
  { id: "bricolage-grotesque", family: "Bricolage Grotesque", vf: true },
  { id: "archivo", family: "Archivo", vf: true },
  { id: "syne", family: "Syne", vf: true },
  { id: "unbounded", family: "Unbounded", vf: true },
  { id: "space-grotesk", family: "Space Grotesk", vf: true, statics: [400, 500, 600, 700] },
  { id: "familjen-grotesk", family: "Familjen Grotesk", vf: true },
  // display / serif
  { id: "fraunces", family: "Fraunces", vf: true, italic: true },
  { id: "cormorant-garamond", family: "Cormorant Garamond", vf: true, italic: true },
  { id: "newsreader", family: "Newsreader", vf: true, italic: true },
  { id: "bodoni-moda", family: "Bodoni Moda", vf: true, italic: true },
  { id: "source-serif-4", family: "Source Serif 4", vf: true, italic: true },
  { id: "instrument-serif", family: "Instrument Serif", statics: [400], staticItalics: [400] },
  { id: "dm-serif-display", family: "DM Serif Display", statics: [400], staticItalics: [400] },
  { id: "young-serif", family: "Young Serif", statics: [400] },
  // texte
  { id: "geist", family: "Geist", vf: true, statics: [300, 400] },
  { id: "instrument-sans", family: "Instrument Sans", vf: true },
  { id: "manrope", family: "Manrope", vf: true },
  { id: "figtree", family: "Figtree", vf: true },
  { id: "work-sans", family: "Work Sans", vf: true },
  { id: "ibm-plex-sans", family: "IBM Plex Sans", vf: true },
  { id: "dm-sans", family: "DM Sans", vf: true },
  { id: "schibsted-grotesk", family: "Schibsted Grotesk", vf: true },
  { id: "onest", family: "Onest", vf: true },
  { id: "plus-jakarta-sans", family: "Plus Jakarta Sans", vf: true },
  // mono
  { id: "jetbrains-mono", family: "JetBrains Mono", vf: true, statics: [400, 500, 700] },
  { id: "chivo-mono", family: "Chivo Mono", vf: true },
  { id: "geist-mono", family: "Geist Mono", vf: true },
  { id: "ibm-plex-mono", family: "IBM Plex Mono", statics: [400, 500] },
  { id: "dm-mono", family: "DM Mono", statics: [400, 500] },
  { id: "space-mono", family: "Space Mono", statics: [400, 700] },
]

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex")

async function get(url, kind = "buffer") {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "lws-oss-fonts/1 (+https://fontsource.org)" } })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return kind === "json" ? await r.json() : Buffer.from(await r.arrayBuffer())
    } catch (e) {
      if (i === 2) throw new Error(`${url} : ${e.message}`)
      await new Promise((res) => setTimeout(res, 800 * (i + 1)))
    }
  }
}

/** Télécharge toute la bibliothèque et écrit le verrou. Séquentiel (petit, poli envers le CDN). */
async function fetchAll() {
  const lock = { _comment: "Polices LIBRES de LWS : provenance Fontsource (paquets npm @fontsource/*, @fontsource-variable/*, servis par jsDelivr), version figée, sha256 de chaque fichier. Généré par `node scripts/oss/fonts.mjs --fetch` ; vérifié par `node scripts/oss/fonts.mjs` (et par npm test). Ne pas éditer à la main.", generated: new Date().toISOString().slice(0, 10), source: "https://fontsource.org", families: [] }
  for (const f of FAMILIES) {
    const meta = await get(`https://api.fontsource.org/v1/fonts/${f.id}`, "json")
    if (meta.license !== "OFL-1.1") throw new Error(`${f.id} : licence ${meta.license}, OFL-1.1 attendue`)
    const v = meta.npmVersion
    const dir = join(ROOT, FONTS_DIR, f.id)
    mkdirSync(dir, { recursive: true })
    const files = []
    const put = async (file, url, weight, style, variable) => {
      const buf = await get(url)
      if (buf.subarray(0, 4).toString("latin1") !== "wOF2") throw new Error(`${url} : pas un woff2`)
      writeFileSync(join(dir, file), buf)
      files.push({ file: `${f.id}/${file}`, weight: String(weight), style, variable, bytes: buf.length, sha256: sha256(buf), url })
    }
    if (f.vf) {
      const [lo, hi] = [Math.min(...meta.weights), Math.max(...meta.weights)]
      await put(`${f.id}-var.woff2`, `https://cdn.jsdelivr.net/fontsource/fonts/${f.id}:vf@${v}/latin-wght-normal.woff2`, `${lo}-${hi}`, "normal", true)
      if (f.italic) {
        if (!meta.styles.includes("italic")) throw new Error(`${f.id} : pas d'italique`)
        await put(`${f.id}-var-italic.woff2`, `https://cdn.jsdelivr.net/fontsource/fonts/${f.id}:vf@${v}/latin-wght-italic.woff2`, `${lo}-${hi}`, "italic", true)
      }
    }
    for (const w of f.statics ?? []) await put(`${f.id}-${w}.woff2`, `https://cdn.jsdelivr.net/fontsource/fonts/${f.id}@${v}/latin-${w}-normal.woff2`, w, "normal", false)
    for (const w of f.staticItalics ?? []) await put(`${f.id}-${w}-italic.woff2`, `https://cdn.jsdelivr.net/fontsource/fonts/${f.id}@${v}/latin-${w}-italic.woff2`, w, "italic", false)
    const licUrl = `https://cdn.jsdelivr.net/npm/@fontsource/${f.id}@${v}/LICENSE`
    const lic = await get(licUrl)
    if (!/SIL OPEN FONT LICENSE/i.test(lic.toString("utf8"))) throw new Error(`${licUrl} : texte OFL introuvable`)
    writeFileSync(join(dir, "OFL.txt"), lic)
    lock.families.push({
      family: meta.family, slug: f.id, category: meta.category, license: "OFL-1.1", version: v, upstream: meta.source,
      licenseFile: { file: `${f.id}/OFL.txt`, sha256: sha256(lic), url: licUrl }, files,
    })
    process.stdout.write(`✓ ${meta.family} ${v} · ${files.length} fichier(s)\n`)
  }
  writeFileSync(join(ROOT, LOCK), JSON.stringify(lock, null, 2) + "\n")
  return lock
}

export function readLock(root = ROOT) { return JSON.parse(readFileSync(join(root, LOCK), "utf8")) }
export function readPairings(root = ROOT) { const d = JSON.parse(readFileSync(join(root, PAIRINGS), "utf8")); return Array.isArray(d) ? d : d.pairings }
export function readBlacklist(root = ROOT) {
  try { return new Set(readFileSync(join(root, BLACKLIST), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))) } catch { return new Set() }
}

/** Tous les fichiers (polices + OFL.txt) du verrou, chemins relatifs à design/fonts/. */
export function lockedFiles(lock) {
  return lock.families.flatMap((fam) => [...fam.files.map((x) => ({ ...x, family: fam.family, license: fam.license })), { ...fam.licenseFile, family: fam.family, license: fam.license, isLicense: true }])
}

/** Index (format de design/fonts/index.json) réduit à la bibliothèque libre : pour l'export et le lab du cockpit. */
export function ossIndex(lock) {
  const families = {}
  for (const fam of lock.families) families[fam.family] = { slug: fam.slug, license: fam.license, from: [`fontsource@${fam.version}`], faces: fam.files.map((x) => ({ weight: x.weight, style: x.style, file: x.file, bytes: x.bytes })) }
  return { generated: lock.generated, count: lock.families.length, license: "OFL-1.1 (chaque famille : <slug>/OFL.txt)", families }
}

/** Vérification hors ligne. Renvoie { ok, problems[], families, pairings, files, bytes }. */
export function verify(root = ROOT) {
  const problems = []
  let lock
  try { lock = readLock(root) } catch (e) { return { ok: false, problems: [`${LOCK} illisible : ${e.message}`], families: 0, pairings: 0, files: 0, bytes: 0 } }
  let bytes = 0, files = 0
  for (const x of lockedFiles(lock)) {
    if (x.license !== "OFL-1.1") problems.push(`${x.file} : licence ${x.license}`)
    const p = join(root, FONTS_DIR, x.file)
    if (!existsSync(p)) { problems.push(`${x.file} : absent`); continue }
    const buf = readFileSync(p)
    if (sha256(buf) !== x.sha256) problems.push(`${x.file} : sha256 différent du verrou`)
    if (x.isLicense && !/SIL OPEN FONT LICENSE/i.test(buf.toString("utf8"))) problems.push(`${x.file} : pas un texte OFL`)
    bytes += buf.length; files++
  }
  const slugs = new Set(lock.families.map((f) => f.slug))
  const black = readBlacklist(root)
  let pairings = []
  try { pairings = readPairings(root) } catch (e) { problems.push(`${PAIRINGS} illisible : ${e.message}`) }
  const seen = new Set()
  pairings.forEach((p, i) => {
    for (const k of ["display", "body", "mono"]) {
      const s = p[`${k}_slug`]
      if (s == null) { if (k !== "mono") problems.push(`paire ${i} : ${k}_slug manquant`); continue }
      if (!slugs.has(s)) problems.push(`paire ${i} : ${s} hors de la bibliothèque libre`)
      if (black.has(s)) problems.push(`paire ${i} : ${s} est dans blacklist.txt`)
      const fam = lock.families.find((f) => f.slug === s)
      if (fam && p[k] !== fam.family) problems.push(`paire ${i} : « ${p[k]} » ≠ famille « ${fam.family} » du slug ${s}`)
    }
    if (p.license !== "OFL-1.1") problems.push(`paire ${i} : license ${p.license}`)
    const key = `${p.display_slug}|${p.body_slug}`
    if (seen.has(key)) problems.push(`paire ${i} : doublon ${key}`)
    seen.add(key)
  })
  const displays = new Set(pairings.map((p) => p.display_slug))
  if (displays.size !== pairings.length) problems.push(`les paires doivent avoir des polices de titre DISTINCTES (${displays.size}/${pairings.length})`)
  return { ok: problems.length === 0, problems, families: lock.families.length, pairings: pairings.length, files, bytes }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.includes("--fetch")) {
    const lock = await fetchAll()
    console.log(`✓ verrou écrit : ${LOCK} (${lock.families.length} familles)`)
  }
  const r = verify()
  if (args.includes("--json")) console.log(JSON.stringify(r, null, 2))
  else {
    console.log(`${r.ok ? "✓" : "✗"} polices libres : ${r.families} familles OFL-1.1, ${r.files} fichiers (${Math.round(r.bytes / 1024)} Ko), ${r.pairings} paires`)
    for (const p of r.problems) console.log(`  ✗ ${p}`)
  }
  process.exit(r.ok ? 0 : 1)
}
