#!/usr/bin/env node
/**
 * scripts/oss/scan.mjs · LE SCAN « RIEN DE RÉEL » d'un dossier (l'export open source, ou n'importe quel arbre).
 *
 *   node scripts/oss/scan.mjs <dossier> [--real <dépôt privé>] [--json <rapport.json>] [--quiet]
 *
 * Règles (une trouvaille = fichier:ligne + règle ; la valeur est MASQUÉE dans la sortie) :
 *   phone-fr      numéro français hors des plages ARCEP réservées à la fiction (01 99 00, 02 61 91, 03 53 01,
 *                 04 65 71, 05 36 49, 06 39 98, 09 77 40) et hors gabarits évidents (06 00 00 00 00, XX)
 *   email         adresse hors domaines réservés (RFC 2606 / 6761 : .example .test .invalid .localhost, example.com|net|org)
 *   ipv4          adresse publique (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 0.0.0.0, 255.x, docs 192.0.2|198.51.100|203.0.113 permis)
 *   home-path     chemin absolu /home/<utilisateur>/ (gabarits /home/<toi>, /home/user permis)
 *   supabase-ref  référence de projet Supabase (<ref 20>.supabase.co, utilisateur de pooler postgres.<ref>)
 *   private-repo  (avec --real) comptes et dépôts GitHub de l'équipe, adresses des auteurs, coordonnées de l'agence
 *                 du dépôt privé : lus dans le dépôt privé (remotes, git log, agency.config.json), rien en dur ici
 *   real-entity   (avec --real) nom, slug, domaine, téléphone ou e-mail d'un VRAI prospect/client, lus dans les
 *                 données du dépôt privé (data/prospects, data/raw/*.csv, registre, output/sites, closing)
 * + inventaire des polices : chaque fichier de police doit figurer (sha256) dans design/fonts/oss.lock.json (OFL) ;
 *   famille lue par fc-scan quand il est installé.
 *
 * Exit 0 si 0 trouvaille et 0 police hors verrou, 1 sinon.
 */
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { extname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const TEXT_EXT = new Set([".ts", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json", ".md", ".html", ".htm", ".css", ".svg", ".txt", ".sh", ".service", ".timer", ".yml", ".yaml", ".toml", ".sql", ".py", ".csv", ".jsonl", ".xml", ".example", ".gitignore", ".dockerignore", "", ".env", ".d.mts", ".eml", ".ini", ".conf"])
const FONT_EXT = new Set([".woff2", ".woff", ".ttf", ".otf"])
const SKIP_DIRS = new Set(["node_modules", ".git"])

// ── règles ────────────────────────────────────────────────────────────────────
const FICTION_PREFIXES = ["0199 00", "02 61 91", "03 53 01", "04 65 71", "05 36 49", "06 39 98", "09 77 40"].map((p) => p.replace(/\s/g, ""))
const PHONE_RE = /(?<![\w.\/+-])(?:\+33[\s.]?(?:\(0\)[\s.]?)?|0)[1-9](?:[\s.-]?\d{2}){4}(?![\w])/g
function phoneOk(m) {
  const d = m.replace(/\D/g, "").replace(/^33/, "0").replace(/^0?(\d{9})$/, "0$1")
  if (FICTION_PREFIXES.some((p) => d.startsWith(p))) return true
  if (/^0[1-9](00){4}$/.test(d) || /^0[1-9]0{8}$/.test(d)) return true // gabarit « 06 00 00 00 00 »
  return false
}
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g
const FILE_TLD = /\.(png|jpe?g|webp|gif|svg|avif|woff2?|ttf|otf|js|mjs|ts|css|json|html?|mp4|webm|md|txt)$/i
function emailOk(m) {
  const [local, domRaw] = m.split("@")
  const dom = domRaw.toLowerCase()
  if (/^(mailer-daemon|postmaster|noreply|no-reply)$/i.test(local) && !/\.(fr|be|ch)$/.test(dom)) return true // adresses techniques des fournisseurs
  if (/^[A-Z][A-Z0-9_]+$/.test(local)) return true // gabarit (MOT_DE_PASSE@hôte, USER@…)
  if (/^[a-z]@[a-z]\.[a-z]{2,3}$/.test(m)) return true // gabarit d'une lettre (« x@y.fr »)
  if (FILE_TLD.test(m)) return true // logo@2x.png, chunk@1.2.js…
  if (/(^|\.)(example|test|invalid|localhost)$/.test(dom)) return true
  if (/^example\.(com|net|org)$/.test(dom) || /\.example\.(com|net|org)$/.test(dom)) return true
  if (/^(127\.\d+\.\d+\.\d+|localhost)$/.test(dom)) return true
  if (/^\d+(\.\d+)+$/.test(dom)) return true // version (pkg@1.2.3) : l'IPv4 éventuelle est jugée par sa règle
  if (/^users\.noreply\.github\.com$/.test(dom)) return true
  return false
}
const IPV4_RE = /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.])/g
function ipOk(a, b, c, d) {
  const n = [a, b, c, d].map(Number)
  if (n.some((x) => x > 255)) return true // pas une IP (version, OID…)
  const [x, y, z] = n
  if (x === 127 || x === 10 || x === 0 || x === 255) return true
  if (x === 172 && y >= 16 && y <= 31) return true
  if (x === 192 && y === 168) return true
  if (x === 169 && y === 254) return true
  if (x === 192 && y === 0 && z === 2) return true
  if (x === 198 && y === 51 && z === 100) return true
  if (x === 203 && y === 0 && z === 113) return true
  return false
}
const HOME_RE = /\/home\/(?!<|user\/|user\b|you\/|toi\/|\$|\{|%)[A-Za-z0-9._-]+/g
const SUPABASE_RE = /\b[a-z0-9]{20}\.supabase\.(co|in)\b|postgres\.[a-z0-9]{20}\b/g
// dépôt privé, comptes de l'équipe, adresses des auteurs : AUCUNE valeur en dur ici (ce fichier est publié) ; avec
// --real, privateIdentity() les lit dans le dépôt privé lui-même (remotes git, auteurs des commits, agency.config.json)

// ── entités réelles (depuis le dépôt privé) ──────────────────────────────────
const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
function csvRows(text) {
  const lines = text.split(/\r?\n/).filter(Boolean)
  const head = (lines.shift() || "").split(",")
  return lines.map((l) => {
    const out = []; let cur = "", q = false
    for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { out.push(cur); cur = "" } else cur += ch }
    out.push(cur)
    return Object.fromEntries(head.map((h, i) => [h.trim(), (out[i] || "").trim()]))
  })
}
const hostOf = (u) => { try { return new URL(/^https?:/.test(u) ? u : `http://${u}`).hostname.replace(/^www\./, "").toLowerCase() } catch { return "" } }

/** Mots qui, seuls, ne font pas un nom d'entreprise (une raison sociale faite de ces mots ne déclenche rien). */
const GENERIC = new Set(("a au aux d de des du en et l la le les ma mon mes nos notre nous sa son ses sur ta ton tes un une vos votre " +
  "atelier ateliers maison maisons fait premier plan essentiel cuisine cuisines bain bains piscine piscines spa jardin jardins " +
  "menuiserie menuisier charpente toiture couverture couvreur bois metal fer verre pierre italienne francaise quincaillerie " +
  "travaux renovation construction batiment habitat decoration design style concept creation creations services service " +
  "pro plus home house studio deco interieur exterieur paysage paysagiste espace espaces art arts claude ideal idee idees " +
  "group groupe sarl sas eurl entreprise societe france centre grand petit nouveau nouvelle vie ville bon bonne belle beau").split(" "))
const distinctive = (n) => n.split(" ").some((w) => w.length >= 2 && !GENERIC.has(w))

/** Identité PRIVÉE de l'équipe, lue dans le dépôt privé (rien en dur) : comptes et dépôts GitHub des remotes, adresses
 *  des auteurs de commits, coordonnées de l'agence (agency.config.json : téléphone, domaines). */
export function privateIdentity(root) {
  const tokens = new Set(), phones = new Set()
  const rem = spawnSync("git", ["remote", "-v"], { cwd: root, encoding: "utf8" }).stdout || ""
  for (const m of rem.matchAll(/github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\s/g)) { tokens.add(`${m[1]}/`.toLowerCase()); tokens.add(m[1].toLowerCase()); if (m[2] !== "lastwebstudios") tokens.add(m[2].toLowerCase()) }
  const au = spawnSync("git", ["log", "--format=%ae%n%ce", "-n", "2000"], { cwd: root, encoding: "utf8", maxBuffer: 16 << 20 }).stdout || ""
  for (const e of new Set(au.split("\n").filter((x) => x.includes("@")))) { const [l, d] = e.toLowerCase().split("@"); if (!/noreply/.test(d)) { tokens.add(e.toLowerCase()); if (l.length >= 6) tokens.add(l) } }
  try {
    const a = JSON.parse(readFileSync(join(root, "agency.config.json"), "utf8"))
    if (a.calendarUrl) tokens.add(String(a.calendarUrl).replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase().split("/").slice(0, 2).join("/"))
    for (const u of [a.website, a.contactEmail, a.mail?.heloDomain]) { const h = String(u || "").replace(/^.*@/, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase(); if (h.includes(".")) tokens.add(h) }
    if (a.phone) phones.add(String(a.phone).replace(/\D/g, "").slice(-9))
  } catch { /* pas d'agence */ }
  tokens.delete("lastwebstudios") // le nom du produit n'est pas privé
  return { tokens: [...tokens].filter((t) => t.length >= 5), phones }
}

export function loadRealEntities(root) {
  const names = new Set(), slugs = new Set(), domains = new Set(), phones = new Set(), emails = new Set()
  const add = (o) => {
    if (o.name) { const n = norm(o.name); if (n.split(" ").length >= 2 && n.length >= 10 && distinctive(n)) names.add(n) }
    if (o.slug && o.slug.length >= 8) slugs.add(o.slug.toLowerCase())
    if (o.url) { const h = hostOf(o.url); if (h.includes(".") && h.length >= 6 && !/^(facebook|instagram|google|pagesjaunes|linkedin|youtube|wix|jimdo)\./.test(h)) domains.add(h) }
    if (o.phone) { const d = o.phone.replace(/\D/g, "").replace(/^33/, "0"); if (d.length >= 9) phones.add(d.slice(-9)) }
    if (o.email && o.email.includes("@")) emails.add(o.email.toLowerCase())
  }
  const P = join(root, "data", "prospects")
  if (existsSync(P)) for (const f of readdirSync(P).filter((f) => f.endsWith(".json"))) {
    try { const j = JSON.parse(readFileSync(join(P, f), "utf8")); add({ name: j.identity?.name, slug: j.id || f.replace(/\.json$/, ""), url: j.existing?.url, phone: j.identity?.phone, email: j.identity?.email }); if (j.identity?.owner) add({ name: j.identity.owner }) } catch { /* fiche illisible */ }
  }
  const R = join(root, "data", "raw")
  if (existsSync(R)) for (const f of readdirSync(R).filter((f) => f.endsWith(".csv"))) for (const r of csvRows(readFileSync(join(R, f), "utf8"))) add({ name: r.name, url: r.website, phone: r.phone, email: r.email })
  try { for (const d of JSON.parse(readFileSync(join(R, "prospects.registry.json"), "utf8")).domains || []) add({ url: typeof d === "string" ? d : d.domain }) } catch { /* pas de registre */ }
  for (const d of ["output/sites", "closing", "data/assets"]) {
    const p = join(root, d)
    if (existsSync(p)) for (const e of readdirSync(p, { withFileTypes: true })) if (e.isDirectory()) add({ slug: e.name })
  }
  const priv = privateIdentity(root)
  for (const p of priv.phones) phones.add(p)
  return { names, slugs, domains, phones, emails, privateTokens: priv.tokens }
}

// ── parcours ──────────────────────────────────────────────────────────────────
function walk(dir, base = dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, base, out)
    else if (e.isFile()) out.push(relative(base, p).split("\\").join("/"))
  }
  return out
}
const REVEAL = process.argv.includes("--reveal") // triage LOCAL seulement : jamais dans un fichier
const mask = (s) => (REVEAL ? s : s.length <= 4 ? "****" : `${s.slice(0, 3)}…(${s.length})`)

export function scan(dir, opts = {}) {
  const real = opts.real ? loadRealEntities(opts.real) : null
  // les auteurs CRÉDITÉS de l'édition (fichier AUTHORS de l'export) sont publics par décision : leurs comptes GitHub,
  // lus dans les remotes du dépôt privé, ne sont plus « identité privée »
  if (real && existsSync(join(dir, "AUTHORS"))) {
    const authors = readFileSync(join(dir, "AUTHORS"), "utf8").toLowerCase()
    real.privateTokens = [...real.privateTokens].filter((t) => !authors.includes(t.replace(/\/$/, "")))
  }
  const findings = []
  const fonts = []
  let files
  if (statSync(dir).isFile()) { files = [dir.split("/").pop()]; dir = dir.slice(0, dir.length - files[0].length - 1) || "." } // un seul fichier
  else files = walk(dir)
  const push = (file, line, rule, value) => findings.push({ file, line, rule, value: mask(value) })
  let lockHashes = new Map()
  try {
    const lock = JSON.parse(readFileSync(opts.lock || join(dir, "design", "fonts", "oss.lock.json"), "utf8"))
    for (const fam of lock.families) for (const x of fam.files) lockHashes.set(x.sha256, { family: fam.family, license: fam.license })
  } catch { /* pas de verrou : toute police sera hors verrou */ }
  const realNameRe = real && real.names.size ? new RegExp(`(?:^| )(${[...real.names].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?: |$)`) : null
  const realSlugRe = real && real.slugs.size ? new RegExp(`(?<![a-z0-9-])(${[...real.slugs].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![a-z0-9-])`, "i") : null
  let textFiles = 0
  for (const rel of files) {
    const ext = extname(rel).toLowerCase()
    const abs = join(dir, rel)
    if (FONT_EXT.has(ext)) {
      const buf = readFileSync(abs)
      const sha = createHash("sha256").update(buf).digest("hex")
      const inLock = lockHashes.get(sha)
      let family = inLock?.family || ""
      if (!family) { const r = spawnSync("fc-scan", ["--format", "%{family}\\n", abs], { encoding: "utf8" }); family = (r.stdout || "").split("\n")[0].split(",")[0] || "?" }
      fonts.push({ file: rel, family, license: inLock?.license || null, inLock: !!inLock })
      continue
    }
    const base = rel.split("/").pop()
    if (!TEXT_EXT.has(ext) && !/^(Dockerfile|LICENSE|NOTICE|AUTHORS|Makefile|\.env\.example)$/.test(base)) continue
    let text
    try { if (statSync(abs).size > 8 << 20) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (text.includes("\u0000")) continue
    textFiles++
    const lines = text.split("\n")
    lines.forEach((ln, i) => {
      const L = i + 1
      if (ln.length > 20000) ln = ln.slice(0, 20000)
      for (const m of ln.matchAll(PHONE_RE)) if (!phoneOk(m[0])) push(rel, L, "phone-fr", m[0])
      for (const m of ln.matchAll(EMAIL_RE)) if (!emailOk(m[0])) push(rel, L, "email", m[0])
      for (const m of ln.matchAll(IPV4_RE)) if (!ipOk(m[1], m[2], m[3], m[4])) push(rel, L, "ipv4", m[0])
      for (const m of ln.matchAll(HOME_RE)) push(rel, L, "home-path", m[0])
      for (const m of ln.matchAll(SUPABASE_RE)) push(rel, L, "supabase-ref", m[0])
      if (real) {
        const n = ` ${norm(ln)} `
        const nm = realNameRe && n.match(realNameRe)
        if (nm) push(rel, L, "real-entity:name", nm[1])
        const sm = realSlugRe && ln.match(realSlugRe)
        if (sm) push(rel, L, "real-entity:slug", sm[1])
        const low = ln.toLowerCase()
        for (const d of real.domains) if (low.includes(d)) { const at = low.indexOf(d); const before = low[at - 1] || " "; if (!/[a-z0-9-]/.test(before)) push(rel, L, "real-entity:domain", d) }
        for (const m of ln.matchAll(PHONE_RE)) { const d = m[0].replace(/\D/g, "").replace(/^33/, "0").slice(-9); if (real.phones.has(d)) push(rel, L, "real-entity:phone", m[0]) }
        for (const m of ln.matchAll(EMAIL_RE)) if (real.emails.has(m[0].toLowerCase())) push(rel, L, "real-entity:email", m[0])
        for (const t of real.privateTokens) if (low.includes(t)) push(rel, L, "private-repo", t)
      }
    })
  }
  const badFonts = fonts.filter((f) => !f.inLock)
  const families = [...new Set(fonts.map((f) => f.family))].sort()
  return { dir, files: files.length, textFiles, findings, fonts: { count: fonts.length, families, outsideLock: badFonts }, ok: findings.length === 0 && badFonts.length === 0, real: real ? { names: real.names.size, slugs: real.slugs.size, domains: real.domains.size, phones: real.phones.size, emails: real.emails.size, privateTokens: real.privateTokens.length } : null }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const val = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
  const dir = args.find((a, i) => !a.startsWith("--") && !["--real", "--json", "--lock"].includes(args[i - 1]))
  if (!dir || !existsSync(dir)) { console.error("usage : node scripts/oss/scan.mjs <dossier> [--real <dépôt privé>] [--json <rapport.json>] [--lock <oss.lock.json>]"); process.exit(2) }
  const r = scan(resolve(dir), { real: val("--real") && resolve(val("--real")), lock: val("--lock") && resolve(val("--lock")) })
  if (val("--json")) writeFileSync(val("--json"), JSON.stringify(r, null, 2))
  const byRule = {}
  for (const f of r.findings) byRule[f.rule] = (byRule[f.rule] || 0) + 1
  console.log(`${r.ok ? "✓" : "✗"} scan de ${r.files} fichiers (${r.textFiles} texte)${r.real ? ` · référentiel réel : ${r.real.names} noms, ${r.real.slugs} slugs, ${r.real.domains} domaines, ${r.real.phones} tél., ${r.real.emails} e-mails` : ""}`)
  console.log(`  trouvailles : ${r.findings.length}${r.findings.length ? " · " + Object.entries(byRule).map(([k, v]) => `${k} ${v}`).join(" · ") : ""}`)
  console.log(`  polices : ${r.fonts.count} fichiers, familles : ${r.fonts.families.join(", ") || "aucune"}${r.fonts.outsideLock.length ? ` · ✗ ${r.fonts.outsideLock.length} HORS verrou OFL` : " · toutes dans le verrou OFL"}`)
  if (!args.includes("--quiet")) {
    for (const f of r.findings.slice(0, 400)) console.log(`  ✗ ${f.file}:${f.line} ${f.rule} ${f.value}`)
    for (const f of r.fonts.outsideLock.slice(0, 100)) console.log(`  ✗ police hors verrou : ${f.file} (${f.family})`)
  }
  process.exit(r.ok ? 0 : 1)
}
