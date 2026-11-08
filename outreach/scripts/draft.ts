/**
 * Outreach · PREPARE: turns one or more prospects into draft RECORDS ready to
 * become Gmail drafts (through the `outreach-mail` skill, the only one holding the Gmail/MCP connector).
 *
 * For each targeted prospect:
 *   1. reads the record `data/prospects/<id>.json`
 *   2. CHECKS the real contact by opening the site (Playwright, `contacts.ts`) · the scraped email wins
 *      over the record's email; nothing found = we guess NOTHING (record not ready, reason given)
 *   3. resolves the new site's LINK (latest `output/sites/<id>/*-composer/` + `OUTREACH_SITE_BASE`)
 *   4. composes a short, personal draft (in the agency's language, no em dash, name + hook + before/after)
 *   5. writes the record `data/outreach/<id>.json` (+ saves the verified contact into the prospect's record)
 *
 * Mechanical: zero LLM, zero sending, zero Gmail call. Idempotent (rewrites the record).
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
// NB: `tryDb` (db.ts → the `postgres` dependency) is imported DYNAMICALLY in resolveTargets,
// so the explicit-id / `all` paths run locally even without `postgres` or DATABASE_URL.

try { process.loadEnvFile() } catch { /* no .env: read the environment */ }

const PROSPECTS = join("data", "prospects")
const SITES = join("output", "sites")
const OUTREACH = join("data", "outreach")

export type OutreachRecord = {
  id: string
  name: string
  industry: string
  to: string                 // the email to use (real, verified) or "" if none was found
  emailSource: ContactSource | "fiche" | ""
  emailConfidence: Confidence
  emailTier: number          // 0 prospect's domain · 1 free mail · 2 third-party domain (webmaster) · -1 none
  emailVerified: boolean     // found on the site AND a trusted domain (tier<2) → draftable
  note: string               // the resolver's note (e.g. "third-party domain, to check")
  phone: string
  phoneSource: ContactSource | "fiche" | ""
  oldUrl: string
  siteLink: string           // public link of the new site, or "" (placeholder in the body)
  siteLinkReady: boolean
  genDir?: string            // latest build used (e.g. 2026-06-19-composer) → freshness check against the draft
  htmlBody?: string          // HTML body (CLEAN demo link ▶ Watch the demo) → THIS is what goes into the Gmail draft
  competitor?: { name: string; url: string; city: string } | null  // a competitor (another town, real URL)
  seoIssue?: string          // one precise SEO problem of the current site
  subject: string
  body: string
  ready: boolean             // verified, non-empty email → the skill can create the draft
  skipReason: string
  pagesVisited: string[]
  preparedAt: string
  // filled in AFTERWARDS by the skill (when it creates the Gmail draft):
  gmailDraftId?: string
  status?: "prepared" | "drafted" | "sent"
}

// typographic dashes (U+2012 figure · U+2013 en dash · U+2014 em dash · U+2015 bar) → "-".
// Unicode ESCAPES, never the literal characters: a "zero dash" filter run over the repo had
// rewritten the class as `[‒-·]` (reversed range U+2012 → U+00B7) and the module threw on import (P0 of 2026-10-24).
export const stripDash = (s: string) => s.replace(/[\u2012-\u2015]/g, "-").replace(/\s-\s/g, " - ")

/** The public link of the latest composed site, or "" if there is no build / no public base configured. */
async function resolveSiteLink(id: string): Promise<{ link: string; ready: boolean; note: string }> {
  const dir = join(SITES, id)
  if (!existsSync(dir)) return { link: "", ready: false, note: "no build" }
  const builds = (await readdir(dir)).filter((d) => d.endsWith("-composer")).sort()
  const withIndex = [...builds].reverse().find((d) => existsSync(join(dir, d, "index.html")))
  if (!withIndex) return { link: "", ready: false, note: "composer build without index.html" }
  const base = (process.env.OUTREACH_SITE_BASE || "").replace(/\/$/, "")
  if (!base) return { link: "", ready: false, note: "OUTREACH_SITE_BASE not set (.env) · link to fill in" }
  return { link: `${base}/preview/${encodeURIComponent(id)}/${encodeURIComponent(withIndex)}/index.html`, ready: true, note: "" }
}

const RAW_CSV = join("data", "raw", "prospects.scraped.csv")
const cityKey = (c: string) => (c || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "")

/** COMPETITOR SEARCH step (fast, free): a REAL competitor in the same trade, ANOTHER town, real
 *  URL, picked from the scraped pool. What the email may claim about it comes from competitorClaims (see compose). */
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
    if (myStem && indStem(ind) !== myStem) continue          // SAME trade (by stem: piscine≈pisciniste)
    if (mine && c && cityKey(c) === mine) continue            // ANOTHER town (when known) · never the direct local rival
    cands.push({ name: name.trim(), url: website.trim(), city: (c || "").trim() })
  }
  if (!cands.length) return null
  // prefer a competitor whose TOWN we know ("in <town>" reads more credibly); otherwise any of them
  const withCity = cands.filter((x) => x.city)
  const pool = withCity.length ? withCity : cands
  let h = 0; for (const ch of (mine || industry)) h = (h * 31 + ch.charCodeAt(0)) >>> 0 // stable pick (no randomness in the pipeline)
  return pool[h % pool.length]
}

/** Quick SEO check: ONE PRECISE problem of the site (title/H1/LocalBusiness schema/meta). Precision = credibility.
 *  The sentences are part of the French email body, so they stay in French. */
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

/** Composes a BASELINE draft (subject + text body + HTML body with a CLEAN link). Positioning:
 *  "a web developer who brings in clients" + one precise SEO point + competitor proof (another town). The /out skill ADAPTS it. */
/** The draft's HTML: escaped text (a name like « Dupont & Fils <SARL> » or a scraped URL with quotes used to break the
 *  markup, blitz test of 10/24), links in http(s) only. */
const escHtml = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string))
const safeHref = (u: string) => { try { const x = new URL(u); return x.protocol === "http:" || x.protocol === "https:" ? escHtml(x.href) : "" } catch { return "" } }
const link = (u: string, label: string) => { const h = safeHref(u); return h ? `<a href="${h}">${escHtml(label)}</a>` : escHtml(label) }

/** What the draft may say about a NAMED competitor: `agency.config.json › outreach.competitorClaims` (or `o.claims`).
 *  Empty (the default, the example agency): NO competitor line, even when a competitor is found. A claim about
 *  an identifiable third party must be true and verifiable (French Consumer Code L121-2). */
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

/** Saves the VERIFIED contact into the prospect's record (additive, reversible). Never downgrades a value. */
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

// loads the record: the FILE first, then the DB FALLBACK (prospects.sheet_json) · on the box, many
// records are not on disk but live in the shared DB (which the cockpit already reads). Without this fallback,
// `npm run outreach -- <id>` answers "no target" although the prospect exists (the "Prepare" bug).
async function loadFiche(id: string): Promise<any | null> {
  const p = join(PROSPECTS, `${id}.json`)
  if (existsSync(p)) { try { return JSON.parse(await readFile(p, "utf8")) } catch { /* corrupt file → DB fallback */ } }
  try {
    const { tryDb } = await import("../../packages/shared/db.ts")
    const db = tryDb()
    if (db) { const r = await db.prepare("SELECT sheet_json FROM prospects WHERE id=?").get(id) as any; if (r?.sheet_json) return JSON.parse(r.sheet_json) }
  } catch { /* no DB → null */ }
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

  // 1) real contact: scrape the site (except with --no-verify, which settles for the record)
  let to = "", emailSource: OutreachRecord["emailSource"] = "", emailConfidence: Confidence = "none", emailTier = -1, emailVerified = false, note = ""
  let phone = fichePhone, phoneSource: OutreachRecord["phoneSource"] = fichePhone ? "fiche" : "", pagesVisited: string[] = []
  if (opts.verify && oldUrl) {
    const c = await resolveContacts(oldUrl, { wantEmail: true, wantPhone: !fichePhone })
    pagesVisited = c.pagesVisited; note = c.note
    if (c.email) {
      to = c.email; emailSource = c.emailSource; emailConfidence = c.confidence; emailTier = c.emailTier
      // tier 2 (third-party domain / webmaster): SHOWN as a lead but NOT treated as verified → HELD
      emailVerified = c.emailTier >= 0 && c.emailTier < 2
    }
    if (c.phone && !fichePhone) { phone = c.phone; phoneSource = c.phoneSource }
  }
  // no trusted email → we do NOT GUESS and we do not draft. We flag the lead.
  let skipReason = ""
  if (!to) {
    if (ficheEmail) { to = ficheEmail; emailSource = "fiche"; emailConfidence = "none"; emailVerified = false; skipReason = "the record's email is NOT confirmed on the site - check it before sending" }
    else skipReason = oldUrl ? "no email found on the site" : "neither an email nor a site URL"
  } else if (!emailVerified) {
    skipReason = note || "email on a third-party domain (webmaster?) - check it before sending"
  }

  // 2) the new site's link
  const { link, ready: linkReady, note: linkNote } = await resolveSiteLink(id)

  // 2.5) DEMO VIDEO (hovering cursor + smooth scroll) → Supabase bucket → DIRECT link in the email.
  // Best effort; OUTREACH_DEMO=0 turns it off. The link goes in ONLY if the video is hosted (bucket).
  let demoUrl = "", genDir = ""
  {
    const sdir = join(SITES, id)
    const builds = existsSync(sdir) ? (await readdir(sdir)).filter((d) => d.endsWith("-composer") && existsSync(join(sdir, d, "index.html"))).sort() : []
    genDir = builds[builds.length - 1] || "" // the LATEST build (used for the draft + the freshness check)
  }
  if (genDir && process.env.OUTREACH_DEMO !== "0") {
    try {
      const { recordDemo } = await import("../../design/scripts/demo-video.ts")
      const r = await recordDemo(id, genDir)
      if (r.url) demoUrl = r.url // hosted (bucket) only · a local mp4 does not go into an email
    } catch { /* best-effort demo: no video → the email just keeps the interactive link */ }
  }

  // 2.7) FACTS for SMART copy: a competitor (real, ANOTHER town, real URL) + one precise SEO point
  const competitor = await findCompetitor(industry, fiche?.identity?.city || "")
  const seo = oldUrl ? await seoIssue(oldUrl) : ""

  // 3) compose · a strong baseline (positioning + competitor + SEO + demo as a CLEAN HTML link). /out adapts it.
  const { subject, body, htmlBody } = compose({ name, oldUrl, demoUrl, seo, competitor })

  // OPT-OUT: a prospect who unsubscribed, complained or whose address bounces NEVER gets a ready draft (/out skips it)
  const { optOuts, blockedReason } = await import("./lib/optout.ts")
  const blocked = blockedReason((await optOuts()).get(id), to)
  const ready = emailVerified && !!to && !blocked
  if (blocked) skipReason = `⛔ ${blocked}`
  else if (ready && !linkReady) skipReason = `ready but the link is to fill in (${linkNote})`

  // 4) save the verified contact into the prospect's record
  if (opts.writeFiche && emailVerified) {
    try { await writeFiche(id, fiche, to, String(emailSource), phone, String(phoneSource)) } catch { /* record not rewritten */ }
  }

  const rec: OutreachRecord = {
    id, name, industry, to, emailSource, emailConfidence, emailTier, emailVerified, note,
    phone, phoneSource, oldUrl, siteLink: link, siteLinkReady: linkReady, genDir,
    subject, body, htmlBody, competitor, seoIssue: seo, ready, skipReason, pagesVisited,
    preparedAt: new Date().toISOString(), status: "prepared",
  }
  await mkdir(OUTREACH, { recursive: true })
  // keep the previous draft's state → the /out skill compares (refresh if the site was rebuilt since)
  let prior: any = {}
  try { prior = JSON.parse(await readFile(join(OUTREACH, `${id}.json`), "utf8")) } catch { /* first pass */ }
  const merged: any = { ...rec, gmailDraftId: prior.gmailDraftId, draftedAt: prior.draftedAt, draftedGenDir: prior.draftedGenDir, status: prior.gmailDraftId ? (prior.status || "drafted") : "prepared" }
  await writeFile(join(OUTREACH, `${id}.json`), JSON.stringify(merged, null, 2))
  return merged
}

const VALID_ID = /^[\w-]+$/ // no path separator nor `..` → never a directory traversal

/** Resolves the target into a list of ids. */
export async function resolveTargets(spec: string): Promise<string[]> {
  const all = async () => (await readdir(PROSPECTS)).filter((f) => f.endsWith(".json") && !f.endsWith(".example.json")).map((f) => f.slice(0, -5))
  if (spec === "all") return all()
  const heart = spec.match(/^(?:♥|love)\s*([1-3])$/) || (spec === "loved" ? ["", "1"] : null)
  if (heart) {
    if (!process.env.DATABASE_URL) { console.warn(`⚠ targeting by ♥ unavailable (no DATABASE_URL) · pass explicit ids or 'all'`); return [] }
    let tryDb: () => any | null
    try { ({ tryDb } = await import("../../packages/shared/db.ts")) }
    catch (e) { console.warn(`⚠ database layer unavailable (${(e as Error).message.split("\n")[0]}) · pass explicit ids or 'all'`); return [] }
    const db = tryDb()
    if (!db) { console.warn(`⚠ targeting by ♥ unavailable (no DATABASE_URL) · pass explicit ids or 'all'`); return [] }
    try {
      const rows = await db.prepare("SELECT prospect_id FROM generations WHERE COALESCE(love,0) >= ? GROUP BY prospect_id").all(Number(heart[1]))
      return rows.map((r: any) => r.prospect_id).filter((id: string) => VALID_ID.test(id) && existsSync(join(PROSPECTS, `${id}.json`)))
    } catch (e) { console.warn(`⚠ ♥ query failed: ${(e as Error).message}`); return [] }
  }
  // a list of ids (separated by , or spaces) or a single id: accepted if the record exists (file) OR if
  // the DB knows the prospect (on the box the records often live in the DB, not on disk).
  const ids = spec.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean).filter((id) => VALID_ID.test(id))
  let db: any = null
  try { const m = await import("../../packages/shared/db.ts"); db = m.tryDb() } catch { /* no DB */ }
  const out: string[] = []
  for (const id of ids) {
    if (existsSync(join(PROSPECTS, `${id}.json`))) { out.push(id); continue }
    if (db) { try { if (await db.prepare("SELECT 1 AS ok FROM prospects WHERE id=?").get(id)) { out.push(id); continue } } catch { /* */ } }
    console.warn(`⚠ skipped "${id}": neither a record (data/prospects) nor a DB row`)
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
  const conc = Math.max(1, opt("conc", 4)) // never 0 (otherwise mapBounded starts no worker = a silent no-op)
  let ids = await resolveTargets(spec)
  if (!ids.length) { console.error(`✗ no target for "${spec}"`); process.exit(1) }
  const limit = Math.max(0, opt("limit", 0))
  if (limit > 0) ids = ids.slice(0, limit)

  console.log(`→ outreach: ${ids.length} prospect(s)${verify ? " · checking contacts (Playwright)" : " · no check"}\n`)
  const recs = await mapBounded(ids, conc, async (id) => {
    try { return await prepareOne(id, { verify, writeFiche: writeFicheOpt }) }
    catch (e) { console.error(`  ✗ ${id} : ${(e as Error).message}`); return null }
  })

  const ok = recs.filter((r): r is OutreachRecord => !!r)
  const readyIds: string[] = []
  for (const r of ok) {
    const tag = r.ready ? "✓ READY" : "•      "
    const conf = r.to ? ` [${r.emailSource}${r.emailVerified ? "/verified" : ""}, ${r.emailConfidence}]` : ""
    console.log(`${tag} ${r.id}`)
    console.log(`        email : ${r.to || "∅"}${conf}`)
    console.log(`        phone : ${r.phone || "∅"}${r.phone ? ` [${r.phoneSource}]` : ""}`)
    console.log(`        link  : ${r.siteLinkReady ? r.siteLink : "(to fill in · " + (process.env.OUTREACH_SITE_BASE ? "no build" : "no OUTREACH_SITE_BASE") + ")"}`)
    if (r.skipReason) console.log(`        note  : ${r.skipReason}`)
    console.log("")
    if (r.ready) readyIds.push(r.id)
  }
  console.log(`Records written to data/outreach/ · ${readyIds.length}/${ok.length} ready to draft.`)
  if (readyIds.length) console.log(`READY_TO_DRAFT: ${readyIds.join(",")}`)
  const held = ok.filter((r) => !r.ready)
  if (held.length) console.log(`TO CHECK (not drafted automatically): ${held.map((r) => r.id).join(", ")}`)
}
