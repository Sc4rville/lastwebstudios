#!/usr/bin/env node
/**
 * scripts/oss/fonts.mjs · LWS's library of FREE FONTS (SIL OFL 1.1), with verifiable provenance.
 *
 * Why: the `design/fonts/` catalogue was harvested from third-party sites (`npm run harvest:fonts`) and holds
 * mostly commercial fonts that cannot be redistributed. A site published without a licence, and the open source edition,
 * use ONLY this library: each file comes from the official Fontsource npm package (a mirror of the Google Fonts
 * files), its version is pinned, its sha256 fingerprint is recorded in `design/fonts/oss.lock.json`, and the licence
 * text `OFL.txt` (the package's) is placed in the family's folder.
 *
 *   node scripts/oss/fonts.mjs            checks (offline): lock ↔ files ↔ pairs, OFL everywhere, nothing from
 *                                         the blacklist; exit 1 at the slightest gap (used by the tests)
 *   node scripts/oss/fonts.mjs --fetch    (re)downloads from Fontsource (jsDelivr), rewrites the lock
 *   node scripts/oss/fonts.mjs --json     the check report as JSON
 *
 * Files: `design/fonts/<slug>/<slug>-var.woff2` (variable, wght axis, Latin subset: accents,
 * Œ œ € included); `<slug>-var-italic.woff2` for the editorial serifs; statics `<slug>-<weight>[-italic].woff2`
 * when the family has no variable version, or for the cockpit's UI (same names as its current fonts).
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
 * The families. `vf`: variable file; `italic`: + the variable italic; `statics`: static weights
 * (normal); `staticItalics`: static italic weights. All OFL-1.1 (checked against the Fontsource API).
 */
export const FAMILIES = [
  // display / sans with character
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
  // text
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

/** Downloads the whole library and writes the lock. Sequential (small, polite to the CDN). */
async function fetchAll() {
  const lock = { _comment: "LWS's FREE fonts: Fontsource provenance (npm packages @fontsource/*, @fontsource-variable/*, served by jsDelivr), pinned version, sha256 of each file. Generated by `node scripts/oss/fonts.mjs --fetch`; checked by `node scripts/oss/fonts.mjs` (and by npm test). Do not edit by hand.", generated: new Date().toISOString().slice(0, 10), source: "https://fontsource.org", families: [] }
  for (const f of FAMILIES) {
    const meta = await get(`https://api.fontsource.org/v1/fonts/${f.id}`, "json")
    if (meta.license !== "OFL-1.1") throw new Error(`${f.id}: licence ${meta.license}, OFL-1.1 expected`)
    const v = meta.npmVersion
    const dir = join(ROOT, FONTS_DIR, f.id)
    mkdirSync(dir, { recursive: true })
    const files = []
    const put = async (file, url, weight, style, variable) => {
      const buf = await get(url)
      if (buf.subarray(0, 4).toString("latin1") !== "wOF2") throw new Error(`${url}: not a woff2`)
      writeFileSync(join(dir, file), buf)
      files.push({ file: `${f.id}/${file}`, weight: String(weight), style, variable, bytes: buf.length, sha256: sha256(buf), url })
    }
    if (f.vf) {
      const [lo, hi] = [Math.min(...meta.weights), Math.max(...meta.weights)]
      await put(`${f.id}-var.woff2`, `https://cdn.jsdelivr.net/fontsource/fonts/${f.id}:vf@${v}/latin-wght-normal.woff2`, `${lo}-${hi}`, "normal", true)
      if (f.italic) {
        if (!meta.styles.includes("italic")) throw new Error(`${f.id}: no italic`)
        await put(`${f.id}-var-italic.woff2`, `https://cdn.jsdelivr.net/fontsource/fonts/${f.id}:vf@${v}/latin-wght-italic.woff2`, `${lo}-${hi}`, "italic", true)
      }
    }
    for (const w of f.statics ?? []) await put(`${f.id}-${w}.woff2`, `https://cdn.jsdelivr.net/fontsource/fonts/${f.id}@${v}/latin-${w}-normal.woff2`, w, "normal", false)
    for (const w of f.staticItalics ?? []) await put(`${f.id}-${w}-italic.woff2`, `https://cdn.jsdelivr.net/fontsource/fonts/${f.id}@${v}/latin-${w}-italic.woff2`, w, "italic", false)
    const licUrl = `https://cdn.jsdelivr.net/npm/@fontsource/${f.id}@${v}/LICENSE`
    const lic = await get(licUrl)
    if (!/SIL OPEN FONT LICENSE/i.test(lic.toString("utf8"))) throw new Error(`${licUrl}: OFL text not found`)
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

/** Every file (fonts + OFL.txt) of the lock, paths relative to design/fonts/. */
export function lockedFiles(lock) {
  return lock.families.flatMap((fam) => [...fam.files.map((x) => ({ ...x, family: fam.family, license: fam.license })), { ...fam.licenseFile, family: fam.family, license: fam.license, isLicense: true }])
}

/** Index (the design/fonts/index.json format) reduced to the free library: for the export and the cockpit's lab. */
export function ossIndex(lock) {
  const families = {}
  for (const fam of lock.families) families[fam.family] = { slug: fam.slug, license: fam.license, from: [`fontsource@${fam.version}`], faces: fam.files.map((x) => ({ weight: x.weight, style: x.style, file: x.file, bytes: x.bytes })) }
  return { generated: lock.generated, count: lock.families.length, license: "OFL-1.1 (chaque famille : <slug>/OFL.txt)", families }
}

/** Offline check. Returns { ok, problems[], families, pairings, files, bytes }. */
export function verify(root = ROOT) {
  const problems = []
  let lock
  try { lock = readLock(root) } catch (e) { return { ok: false, problems: [`${LOCK} illisible : ${e.message}`], families: 0, pairings: 0, files: 0, bytes: 0 } }
  let bytes = 0, files = 0
  for (const x of lockedFiles(lock)) {
    if (x.license !== "OFL-1.1") problems.push(`${x.file}: licence ${x.license}`)
    const p = join(root, FONTS_DIR, x.file)
    if (!existsSync(p)) { problems.push(`${x.file}: missing`); continue }
    const buf = readFileSync(p)
    if (sha256(buf) !== x.sha256) problems.push(`${x.file}: sha256 differs from the lock`)
    if (x.isLicense && !/SIL OPEN FONT LICENSE/i.test(buf.toString("utf8"))) problems.push(`${x.file}: not an OFL text`)
    bytes += buf.length; files++
  }
  const slugs = new Set(lock.families.map((f) => f.slug))
  const black = readBlacklist(root)
  let pairings = []
  try { pairings = readPairings(root) } catch (e) { problems.push(`${PAIRINGS} unreadable: ${e.message}`) }
  const seen = new Set()
  pairings.forEach((p, i) => {
    for (const k of ["display", "body", "mono"]) {
      const s = p[`${k}_slug`]
      if (s == null) { if (k !== "mono") problems.push(`pair ${i}: ${k}_slug missing`); continue }
      if (!slugs.has(s)) problems.push(`pair ${i}: ${s} outside the free library`)
      if (black.has(s)) problems.push(`pair ${i}: ${s} is in blacklist.txt`)
      const fam = lock.families.find((f) => f.slug === s)
      if (fam && p[k] !== fam.family) problems.push(`pair ${i}: "${p[k]}" ≠ family "${fam.family}" of the slug ${s}`)
    }
    if (p.license !== "OFL-1.1") problems.push(`pair ${i}: license ${p.license}`)
    const key = `${p.display_slug}|${p.body_slug}`
    if (seen.has(key)) problems.push(`pair ${i}: duplicate ${key}`)
    seen.add(key)
  })
  const displays = new Set(pairings.map((p) => p.display_slug))
  if (displays.size !== pairings.length) problems.push(`the pairs must have DISTINCT heading fonts (${displays.size}/${pairings.length})`)
  return { ok: problems.length === 0, problems, families: lock.families.length, pairings: pairings.length, files, bytes }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.includes("--fetch")) {
    const lock = await fetchAll()
    console.log(`✓ lock written: ${LOCK} (${lock.families.length} families)`)
  }
  const r = verify()
  if (args.includes("--json")) console.log(JSON.stringify(r, null, 2))
  else {
    console.log(`${r.ok ? "✓" : "✗"} free fonts: ${r.families} OFL-1.1 families, ${r.files} files (${Math.round(r.bytes / 1024)} KB), ${r.pairings} pairs`)
    for (const p of r.problems) console.log(`  ✗ ${p}`)
  }
  process.exit(r.ok ? 0 : 1)
}
