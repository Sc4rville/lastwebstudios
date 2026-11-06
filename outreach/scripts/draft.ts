/**
 * Outreach · PREPARE : transforme un (ou des) prospect(s) en ENREGISTREMENTS de brouillon prêts à
 * devenir des drafts Gmail (par le skill `outreach-mail`, qui seul tient le connecteur Gmail/MCP).
 *
 * Pour chaque prospect ciblé :
 *   1. lit la fiche `data/prospects/<id>.json`
 *   2. VÉRIFIE le contact réel en ouvrant le site (Playwright, `contacts.ts`) · l'email scrapé prime
 *      sur l'email de fiche ; rien trouvé = on ne devine RIEN (record non-prêt, raison expliquée)
 *   3. résout le LIEN du nouveau site (dernier `output/sites/<id>/*-composer/` + `OUTREACH_SITE_BASE`)
 *   4. compose un brouillon court et personnalisé (FR, sans em-dash, nom + accroche + avant/après)
 *   5. écrit le record `data/outreach/<id>.json` (+ persiste le contact vérifié dans la fiche)
 *
 * Mécanique, zéro LLM, zéro envoi, zéro appel Gmail. Idempotent (réécrit le record).
 *
 * CLI : npm run outreach -- <id | ♥N | loved | all | id1,id2,…> [--limit N] [--conc N]
 *                            [--no-verify] [--no-write-fiche]
 */
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveContacts, type ContactSource, type Confidence } from "./contacts.ts"
import { agency } from "../../packages/shared/agency.mjs"
// NB : `tryDb` (db.ts → dépendance `postgres`) est importé DYNAMIQUEMENT dans resolveTargets,
// pour que les chemins id-explicite / `all` tournent même sans `postgres` ni DATABASE_URL en local.

try { process.loadEnvFile() } catch { /* pas de .env : on lira l'environnement */ }

const PROSPECTS = join("data", "prospects")
const SITES = join("output", "sites")
const OUTREACH = join("data", "outreach")

export type OutreachRecord = {
  id: string
  name: string
  industry: string
  to: string                 // l'email à utiliser (réel, vérifié) ou "" si introuvable
  emailSource: ContactSource | "fiche" | ""
  emailConfidence: Confidence
  emailTier: number          // 0 domaine prospect · 1 mail gratuit · 2 domaine tiers (webmaster) · -1 aucun
  emailVerified: boolean     // trouvé sur le site ET domaine de confiance (tier<2) → draftable
  note: string               // note du résolveur (ex. « domaine tiers à vérifier »)
  phone: string
  phoneSource: ContactSource | "fiche" | ""
  oldUrl: string
  siteLink: string           // lien public du nouveau site, ou "" (placeholder dans le corps)
  siteLinkReady: boolean
  genDir?: string            // dernière génération utilisée (ex 2026-06-19-composer) → check fraîcheur vs draft
  htmlBody?: string          // corps HTML (lien démo PROPRE ▶ Voir la démo) → c'est CE qu'on met dans le draft Gmail
  competitor?: { name: string; url: string; city: string } | null  // concurrent (autre ville, vraie URL)
  seoIssue?: string          // 1 problème SEO précis du site actuel
  subject: string
  body: string
  ready: boolean             // email vérifié non vide → le skill peut créer le draft
  skipReason: string
  pagesVisited: string[]
  preparedAt: string
  // rempli APRÈS coup par le skill (création du draft Gmail) :
  gmailDraftId?: string
  status?: "prepared" | "drafted" | "sent"
}

// tirets typographiques (U+2012 figure · U+2013 demi-cadratin · U+2014 cadratin · U+2015 barre) → "-".
// ÉCHAPPEMENTS Unicode, jamais les caractères en dur : un filtre « zéro tiret » passé sur le dépôt avait
// réécrit la classe en `[‒-·]` (plage inversée U+2012 → U+00B7) et le module levait à l'import (P0 du 2026-10-24).
export const stripDash = (s: string) => s.replace(/[\u2012-\u2015]/g, "-").replace(/\s-\s/g, " - ")

/** Le lien public du dernier site composé, ou "" si pas de build / pas de base publique configurée. */
async function resolveSiteLink(id: string): Promise<{ link: string; ready: boolean; note: string }> {
  const dir = join(SITES, id)
  if (!existsSync(dir)) return { link: "", ready: false, note: "aucun build" }
  const builds = (await readdir(dir)).filter((d) => d.endsWith("-composer")).sort()
  const withIndex = [...builds].reverse().find((d) => existsSync(join(dir, d, "index.html")))
  if (!withIndex) return { link: "", ready: false, note: "build composer sans index.html" }
  const base = (process.env.OUTREACH_SITE_BASE || "").replace(/\/$/, "")
  if (!base) return { link: "", ready: false, note: "OUTREACH_SITE_BASE non défini (.env) · lien à compléter" }
  return { link: `${base}/preview/${encodeURIComponent(id)}/${encodeURIComponent(withIndex)}/index.html`, ready: true, note: "" }
}

const RAW_CSV = join("data", "raw", "prospects.scraped.csv")
const cityKey = (c: string) => (c || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "")

/** Maillon RECHERCHE CONCURRENT (rapide, gratuit) : un VRAI concurrent du même métier, AUTRE ville, vraie
 *  URL, pioché dans le vivier scrapé. Le résultat chiffré est inventé côté copy (crédible, non vérifiable). */
const indStem = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/(iste|erie|eur|euse|age|s)$/, "").slice(0, 5)
async function findCompetitor(industry: string, city: string): Promise<{ name: string; url: string; city: string } | null> {
  let csv = ""
  try { csv = await readFile(RAW_CSV, "utf8") } catch { return null }
  const mine = cityKey(city), myStem = indStem(industry)
  const cands: { name: string; url: string; city: string }[] = []
  for (const line of csv.split("\n").slice(1)) {
    const [name, c, website, , ind] = line.split(",")
    if (!name || !website) continue
    if (!/^https?:\/\//.test(website) || /solocal|pagesjaunes|facebook|google|\.business\.site/i.test(website)) continue
    if (myStem && indStem(ind) !== myStem) continue          // MÊME métier (par racine : piscine≈pisciniste)
    if (mine && c && cityKey(c) === mine) continue            // AUTRE ville (si connue) · jamais le rival local direct
    cands.push({ name: name.trim(), url: website.trim(), city: (c || "").trim() })
  }
  if (!cands.length) return null
  // préfère un concurrent dont on connaît la VILLE (copy « à <ville> » plus crédible) ; sinon n'importe lequel
  const withCity = cands.filter((x) => x.city)
  const pool = withCity.length ? withCity : cands
  let h = 0; for (const ch of (mine || industry)) h = (h * 31 + ch.charCodeAt(0)) >>> 0 // pioche stable (pas de random en pipeline)
  return pool[h % pool.length]
}

/** SEO express : UN problème PRÉCIS du site (title/H1/schema LocalBusiness/meta). Précision = crédibilité. */
async function seoIssue(url: string): Promise<string> {
  if (!url) return ""
  let html = ""
  try {
    const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(12000), headers: { "user-agent": "Mozilla/5.0 (compatible)" } })
    html = (await r.text()).slice(0, 400000)
  } catch { return "" }
  const h = html.toLowerCase()
  if (!/<title[^>]*>\s*\S/.test(h)) return "votre page n'a pas de balise title propre (Google met un titre au hasard dans ses résultats)"
  if (!/<h1[\s>]/.test(h)) return "il n'y a pas de H1 sur votre accueil (Google ne sait pas sur quel mot vous positionner)"
  if (!/(localbusiness|professionalservice)/i.test(html)) return "votre site n'a aucun balisage LocalBusiness (schema.org) donc vous ne remontez pas dans le pack local Google"
  if (!/<meta[^>]+name=["']description/i.test(h)) return "pas de meta description, Google improvise le texte affiché sous votre lien"
  return ""
}

/** Compose une BASELINE de brouillon (sujet + corps texte + corps HTML à lien PROPRE). Positionnement
 *  « développeur web commercial » + 1 SEO précis + preuve concurrent (autre ville). Le skill /out l'ADAPTE. */
/** HTML du brouillon : texte échappé (un nom « Dupont & Fils <SARL> » ou une URL scrapée à guillemets cassaient le
 *  balisage, test blitz du 24/10), liens seulement en http(s). */
const escHtml = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string))
const safeHref = (u: string) => { try { const x = new URL(u); return x.protocol === "http:" || x.protocol === "https:" ? escHtml(x.href) : "" } catch { return "" } }
const link = (u: string, label: string) => { const h = safeHref(u); return h ? `<a href="${h}">${escHtml(label)}</a>` : escHtml(label) }

/** Ce que le brouillon peut dire d'un concurrent NOMMÉ : `agency.config.json › outreach.competitorClaims` (ou `o.claims`).
 *  Vide (défaut, agence d'exemple) : AUCUNE ligne « concurrent », même si un concurrent est trouvé. Une affirmation sur
 *  un tiers identifiable doit être vraie et vérifiable (Code de la consommation L121-2). */
export function compose(o: { name: string; oldUrl: string; demoUrl: string; seo: string; competitor: { name: string; url: string; city: string } | null; claims?: string[] }): { subject: string; body: string; htmlBody: string } {
  const from = process.env.OUTREACH_FROM_NAME || (agency().language.startsWith("en") ? "[Your first name]" : "[Votre prénom]")
  const claims = (o.claims ?? agency().outreach.competitorClaims ?? []).filter((c) => typeof c === "string" && c.trim())
  let ch = 0; for (const c of o.name) ch = (ch * 31 + c.charCodeAt(0)) >>> 0
  const claim = claims.length ? claims[ch % claims.length] : ""
  const en = agency().language.startsWith("en")
  const subject = en ? `${o.name}: a website that wins you more work` : `${o.name} : votre site peut faire signer plus`
  const intro = en ? "I build websites for local businesses, the kind that bring in enquiries, not just the kind that look nice." : "Je suis developpeur web commercial : je refais des sites qui font signer des clients, pas juste des sites jolis."
  const seoLine = o.seo ? (en ? `One concrete thing about your current site: ${o.seo}.` : `Un point concret sur votre site actuel : ${o.seo}.`) : ""
  const where = o.competitor?.city ? (en ? ` in ${o.competitor.city}` : ` a ${o.competitor.city}`) : ""
  const compTxt = o.competitor && claim ? (en ? `A competitor${where}, ${o.competitor.name}, ${claim}. You can do better.` : `Un concurrent${where}, ${o.competitor.name}, ${claim}. Vous pouvez avoir mieux.`) : ""
  const compHtml = o.competitor && claim ? (en ? `A competitor${escHtml(where)}, ${link(o.competitor.url, o.competitor.name)}, ${escHtml(claim)}. You can do better.` : `Un concurrent${escHtml(where)}, ${link(o.competitor.url, o.competitor.name)}, ${escHtml(claim)}. Vous pouvez avoir mieux.`) : ""
  const made = en ? `So I rebuilt ${o.name}'s site, free, just to show you.` : `Du coup j'ai refait celui de ${o.name}, gratuitement, juste pour vous montrer.`
  const close = en ? ["If that speaks to you, I will set it up for you. Five minutes to talk it through?", "", `${from} - ${agency().mail.signature}`] : ["Si ca vous parle, je vous l'installe. On en parle 5 min ?", "", `${from} - ${agency().mail.signature}`]
  const hello = en ? "Hello," : "Bonjour,"
  const demoTxt = en ? "The 30-second demo: " : "La demo en 30s : "
  const demoBtn = en ? "▶ Watch the demo (30 s)" : "▶ Voir la demo (30 s)"
  const current = en ? "your current site: " : "votre site actuel : "
  const txt = [hello, "", intro, "", seoLine, compTxt, made, o.demoUrl ? `${demoTxt}${o.demoUrl}` : "", o.oldUrl ? `(${current}${o.oldUrl})` : "", "", ...close]
  const htm = [hello, "", escHtml(intro), "", escHtml(seoLine), compHtml, escHtml(made), o.demoUrl && safeHref(o.demoUrl) ? link(o.demoUrl, demoBtn) : "", o.oldUrl ? `(${escHtml(current)}${link(o.oldUrl, o.oldUrl)})` : "", "", ...close.map(escHtml)]
  const body = stripDash(txt.filter((l) => l !== "").join("\n\n"))
  const htmlBody = `<div style="font-family:system-ui,-apple-system,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">${stripDash(htm.filter((l) => l !== "").join("<br><br>"))}</div>`
  return { subject: stripDash(subject), body, htmlBody }
}

/** Persiste le contact VÉRIFIÉ dans la fiche (additif, réversible). Ne dégrade jamais une valeur. */
async function writeFiche(id: string, fiche: any, email: string, emailSrc: string, phone: string, phoneSrc: string) {
  const ident = fiche.identity ?? (fiche.identity = {})
  let changed = false
  if (email && ident.email !== email) {
    if (ident.email && ident.email !== email) ident._emailPrev = ident.email
    ident.email = email; ident.emailVerified = true; ident.emailSource = emailSrc; changed = true
  } else if (email && ident.email === email) { ident.emailVerified = true; ident.emailSource = emailSrc; changed = true }
  if (phone && !ident.phone) { ident.phone = phone; ident.phoneSource = phoneSrc; changed = true }
  if (changed) {
    ident.contactVerifiedAt = new Date().toISOString().slice(0, 10)
    await writeFile(join(PROSPECTS, `${id}.json`), JSON.stringify(fiche, null, 2))
  }
}

// charge la fiche : le FICHIER d'abord, puis REPLI DB (prospects.sheet_json) · sur la box, beaucoup de
// fiches ne sont pas sur le disque mais vivent dans la DB partagée (que le cockpit lit déjà). Sans ce repli,
// `npm run outreach -- <id>` répond « aucune cible » alors que le prospect existe (bug « Préparer »).
async function loadFiche(id: string): Promise<any | null> {
  const p = join(PROSPECTS, `${id}.json`)
  if (existsSync(p)) { try { return JSON.parse(await readFile(p, "utf8")) } catch { /* fichier corrompu → repli DB */ } }
  try {
    const { tryDb } = await import("../../packages/shared/db.ts")
    const db = tryDb()
    if (db) { const r = await db.prepare("SELECT sheet_json FROM prospects WHERE id=?").get(id) as any; if (r?.sheet_json) return JSON.parse(r.sheet_json) }
  } catch { /* pas de DB → null */ }
  return null
}

export async function prepareOne(id: string, opts: { verify: boolean; writeFiche: boolean }): Promise<OutreachRecord> {
  const fiche = (await loadFiche(id)) || {}
  const name: string = fiche?.identity?.name || id
  const industry: string = fiche?.industry || ""
  const oldUrl: string = fiche?.existing?.url || ""
  const accroche: string = fiche?.score?.accroche || ""
  const ficheEmail: string = fiche?.identity?.email || ""
  const fichePhone: string = fiche?.identity?.phone || ""

  // 1) contact réel : on scrape le site (sauf --no-verify, qui se contente de la fiche)
  let to = "", emailSource: OutreachRecord["emailSource"] = "", emailConfidence: Confidence = "none", emailTier = -1, emailVerified = false, note = ""
  let phone = fichePhone, phoneSource: OutreachRecord["phoneSource"] = fichePhone ? "fiche" : "", pagesVisited: string[] = []
  if (opts.verify && oldUrl) {
    const c = await resolveContacts(oldUrl, { wantEmail: true, wantPhone: !fichePhone })
    pagesVisited = c.pagesVisited; note = c.note
    if (c.email) {
      to = c.email; emailSource = c.emailSource; emailConfidence = c.confidence; emailTier = c.emailTier
      // tier 2 (domaine tiers / webmaster) : on l'EXPOSE comme piste mais on ne le tient PAS pour vérifié → HELD
      emailVerified = c.emailTier >= 0 && c.emailTier < 2
    }
    if (c.phone && !fichePhone) { phone = c.phone; phoneSource = c.phoneSource }
  }
  // pas d'email de confiance → on NE DEVINE PAS et on ne drafte pas. On signale la piste.
  let skipReason = ""
  if (!to) {
    if (ficheEmail) { to = ficheEmail; emailSource = "fiche"; emailConfidence = "none"; emailVerified = false; skipReason = "email de fiche NON confirmé sur le site - à vérifier avant envoi" }
    else skipReason = oldUrl ? "aucun email trouvé sur le site" : "ni email ni URL de site"
  } else if (!emailVerified) {
    skipReason = note || "email d'un domaine tiers (webmaster ?) - à vérifier avant envoi"
  }

  // 2) lien du nouveau site
  const { link, ready: linkReady, note: linkNote } = await resolveSiteLink(id)

  // 2.5) VIDÉO DÉMO (curseur qui hover + scroll fluide) → bucket Supabase → lien DIRECT dans le mail.
  // Best-effort ; OUTREACH_DEMO=0 pour couper. Le lien n'est mis QUE si la vidéo est hébergée (bucket).
  let demoUrl = "", genDir = ""
  {
    const sdir = join(SITES, id)
    const builds = existsSync(sdir) ? (await readdir(sdir)).filter((d) => d.endsWith("-composer") && existsSync(join(sdir, d, "index.html"))).sort() : []
    genDir = builds[builds.length - 1] || "" // la DERNIÈRE génération (sert au draft + au check de fraîcheur)
  }
  if (genDir && process.env.OUTREACH_DEMO !== "0") {
    try {
      const { recordDemo } = await import("../../design/scripts/demo-video.ts")
      const r = await recordDemo(id, genDir)
      if (r.url) demoUrl = r.url // hébergée (bucket) seulement · un mp4 local ne va pas dans un mail
    } catch { /* démo best-effort : pas de vidéo → le mail garde juste le lien interactif */ }
  }

  // 2.7) FAITS pour une copy INTELLIGENTE : concurrent (vrai, AUTRE ville, vraie URL) + 1 SEO précis
  const competitor = await findCompetitor(industry, fiche?.identity?.city || "")
  const seo = oldUrl ? await seoIssue(oldUrl) : ""

  // 3) compose · baseline forte (positionnement + concurrent + SEO + démo en lien PROPRE HTML). /out l'adapte.
  const { subject, body, htmlBody } = compose({ name, oldUrl, demoUrl, seo, competitor })

  // OPPOSITION : un prospect désinscrit, en plainte ou dont l'adresse rebondit n'a JAMAIS de brouillon prêt (/out le saute)
  const { optOuts, blockedReason } = await import("./lib/optout.ts")
  const blocked = blockedReason((await optOuts()).get(id), to)
  const ready = emailVerified && !!to && !blocked
  if (blocked) skipReason = `⛔ ${blocked}`
  else if (ready && !linkReady) skipReason = `prêt mais lien à compléter (${linkNote})`

  // 4) persiste le contact vérifié dans la fiche
  if (opts.writeFiche && emailVerified) {
    try { await writeFiche(id, fiche, to, String(emailSource), phone, String(phoneSource)) } catch { /* fiche non réécrite */ }
  }

  const rec: OutreachRecord = {
    id, name, industry, to, emailSource, emailConfidence, emailTier, emailVerified, note,
    phone, phoneSource, oldUrl, siteLink: link, siteLinkReady: linkReady, genDir,
    subject, body, htmlBody, competitor, seoIssue: seo, ready, skipReason, pagesVisited,
    preparedAt: new Date().toISOString(), status: "prepared",
  }
  await mkdir(OUTREACH, { recursive: true })
  // préserve l'état du draft précédent → le skill /out compare (refresh si le site a été régénéré depuis)
  let prior: any = {}
  try { prior = JSON.parse(await readFile(join(OUTREACH, `${id}.json`), "utf8")) } catch { /* 1er passage */ }
  const merged: any = { ...rec, gmailDraftId: prior.gmailDraftId, draftedAt: prior.draftedAt, draftedGenDir: prior.draftedGenDir, status: prior.gmailDraftId ? (prior.status || "drafted") : "prepared" }
  await writeFile(join(OUTREACH, `${id}.json`), JSON.stringify(merged, null, 2))
  return merged
}

const VALID_ID = /^[\w-]+$/ // pas de séparateur de chemin ni `..` → jamais de traversée de répertoire

/** Résout la cible en liste d'ids. */
export async function resolveTargets(spec: string): Promise<string[]> {
  const all = async () => (await readdir(PROSPECTS)).filter((f) => f.endsWith(".json") && !f.endsWith(".example.json")).map((f) => f.slice(0, -5))
  if (spec === "all") return all()
  const heart = spec.match(/^(?:♥|love)\s*([1-3])$/) || (spec === "loved" ? ["", "1"] : null)
  if (heart) {
    if (!process.env.DATABASE_URL) { console.warn(`⚠ ciblage par ♥ indisponible (DATABASE_URL absent) · passe des ids explicites ou 'all'`); return [] }
    let tryDb: () => any | null
    try { ({ tryDb } = await import("../../packages/shared/db.ts")) }
    catch (e) { console.warn(`⚠ couche DB indisponible (${(e as Error).message.split("\n")[0]}) · passe des ids explicites ou 'all'`); return [] }
    const db = tryDb()
    if (!db) { console.warn(`⚠ ciblage par ♥ indisponible (DATABASE_URL absent) · passe des ids explicites ou 'all'`); return [] }
    try {
      const rows = await db.prepare("SELECT prospect_id FROM generations WHERE COALESCE(love,0) >= ? GROUP BY prospect_id").all(Number(heart[1]))
      return rows.map((r: any) => r.prospect_id).filter((id: string) => VALID_ID.test(id) && existsSync(join(PROSPECTS, `${id}.json`)))
    } catch (e) { console.warn(`⚠ requête ♥ échouée : ${(e as Error).message}`); return [] }
  }
  // liste d'ids (séparés par , ou espace) ou un id unique : on accepte si la fiche existe (fichier) OU si
  // la DB connaît le prospect (sur la box les fiches sont souvent en DB, pas sur le disque).
  const ids = spec.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean).filter((id) => VALID_ID.test(id))
  let db: any = null
  try { const m = await import("../../packages/shared/db.ts"); db = m.tryDb() } catch { /* pas de DB */ }
  const out: string[] = []
  for (const id of ids) {
    if (existsSync(join(PROSPECTS, `${id}.json`))) { out.push(id); continue }
    if (db) { try { if (await db.prepare("SELECT 1 AS ok FROM prospects WHERE id=?").get(id)) { out.push(id); continue } } catch { /* */ } }
    console.warn(`⚠ ignoré « ${id} » : ni fiche (data/prospects) ni entrée DB`)
  }
  return out
}

async function mapBounded<T, R>(items: T[], conc: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  const worker = async () => { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]) } }
  await Promise.all(Array.from({ length: Math.min(conc, items.length || 1) }, worker))
  return out
}

// --- CLI ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const spec = args.find((a) => !a.startsWith("--")) || ""
  const flag = (n: string) => args.includes(`--${n}`)
  const opt = (n: string, d: number) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? Number(a.split("=")[1]) : (args.includes(`--${n}`) ? Number(args[args.indexOf(`--${n}`) + 1]) || d : d) }
  if (!spec) { console.error("usage: npm run outreach -- <id | ♥N | loved | all | id1,id2,…> [--limit N] [--conc N] [--no-verify] [--no-write-fiche]"); process.exit(1) }

  const verify = !flag("no-verify")
  const writeFicheOpt = !flag("no-write-fiche")
  const conc = Math.max(1, opt("conc", 4)) // jamais 0 (sinon mapBounded ne lance aucun worker = no-op silencieux)
  let ids = await resolveTargets(spec)
  if (!ids.length) { console.error(`✗ aucune cible pour « ${spec} »`); process.exit(1) }
  const limit = Math.max(0, opt("limit", 0))
  if (limit > 0) ids = ids.slice(0, limit)

  console.log(`→ outreach : ${ids.length} prospect(s)${verify ? " · vérification des contacts (Playwright)" : " · sans vérif"}\n`)
  const recs = await mapBounded(ids, conc, async (id) => {
    try { return await prepareOne(id, { verify, writeFiche: writeFicheOpt }) }
    catch (e) { console.error(`  ✗ ${id} : ${(e as Error).message}`); return null }
  })

  const ok = recs.filter((r): r is OutreachRecord => !!r)
  const readyIds: string[] = []
  for (const r of ok) {
    const tag = r.ready ? "✓ PRÊT" : "•      "
    const conf = r.to ? ` [${r.emailSource}${r.emailVerified ? "/vérifié" : ""}, ${r.emailConfidence}]` : ""
    console.log(`${tag} ${r.id}`)
    console.log(`        email : ${r.to || "∅"}${conf}`)
    console.log(`        tél   : ${r.phone || "∅"}${r.phone ? ` [${r.phoneSource}]` : ""}`)
    console.log(`        lien  : ${r.siteLinkReady ? r.siteLink : "(à compléter · " + (process.env.OUTREACH_SITE_BASE ? "pas de build" : "OUTREACH_SITE_BASE absent") + ")"}`)
    if (r.skipReason) console.log(`        note  : ${r.skipReason}`)
    console.log("")
    if (r.ready) readyIds.push(r.id)
  }
  console.log(`Records écrits dans data/outreach/ · ${readyIds.length}/${ok.length} prêt(s) à drafter.`)
  if (readyIds.length) console.log(`READY_TO_DRAFT: ${readyIds.join(",")}`)
  const held = ok.filter((r) => !r.ready)
  if (held.length) console.log(`À VÉRIFIER (non draftés auto): ${held.map((r) => r.id).join(", ")}`)
}
