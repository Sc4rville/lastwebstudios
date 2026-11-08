/**
 * emails.ts — the REACHABILITY link: finding + verifying an email on the prospect sheets.
 *
 * Why (audit 2026-07-02): an email on 26 % of the sheets, verified on 2 — incompatible with the
 * cold email machine (priority #1). `harvest.ts` only read home + /contact with a simple regex.
 *
 * What this link does, per sheet without a verified email:
 *   1. fetches a SPREAD of pages (home, contact, legal notice, about…) — the legal email often lives
 *      in the legal notice, not on the home page.
 *   2. BROAD extraction: mailto:, raw text, decoded HTML entities, "x [at] y [dot] fr" obfuscations,
 *      Cloudflare protection (data-cfemail, XOR), JSON-LD email fields.
 *   3. sorted by AFFINITY: an email on the site's domain > a generic one (gmail/orange); noreply/webmaster excluded.
 *   4. MX check (DNS): a domain without a mail server = candidate dropped.
 *   5. LAST resort: a guessed pattern (contact@ / info@ / firstname@) on a domain with a valid MX —
 *      written with emailVerified:false + emailSource:"pattern" (never presented as certain).
 *
 * Writes to the sheet: identity.email · identity.emailVerified (true = seen on THEIR site) ·
 * identity.emailSource (mailto|cfemail|text|jsonld|pattern). Afterwards: npm run reindex.
 *
 * Usage: npm run emails            → every sheet without a verified email
 *        npm run emails -- <id..>  → targeted
 */
import { readFile, writeFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveMx } from "node:dns/promises"
import { domainOf, readHtml, sleep } from "./util.ts"
import { agency } from "../../../packages/shared/agency.mjs"

const DIR = "data/prospects"
const UA = { "user-agent": agency().http.crawlerUserAgent } // agency.config.json
const PAGES = ["", "/contact", "/contactez-nous", "/nous-contacter", "/mentions-legales", "/mentions_legales", "/a-propos", "/qui-sommes-nous"]
const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}/gi
// technical/generic inboxes that don't reach the decision maker → last choice or excluded
const BLACKLIST = /noreply|no-reply|nepasrepondre|webmaster|postmaster|abuse|privacy|rgpd|dpo@|example\.|sentry|wixpress|@(w3\.org|schema\.org|sentry\.io)/i
const GENERIC_LOCAL = /^(contact|info|infos|bonjour|hello|accueil|commercial|contact-)/i

type Found = { email: string; source: "mailto" | "cfemail" | "jsonld" | "text" | "pattern" }

/** decodes Cloudflare's email protection: hex XOR (1st byte = key). */
function decodeCfEmail(hex: string): string {
  try {
    const key = parseInt(hex.slice(0, 2), 16)
    let out = ""
    for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key)
    return out
  } catch { return "" }
}
const deentity = (h: string) => h.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCharCode(parseInt(x, 16))).replace(/&(amp|commat);/gi, (m) => (m === "&amp;" ? "&" : "@"))
/** "x [at] y [dot] fr", "x (at) y point fr" → x@y.fr */
const deobfuscate = (t: string) => t
  .replace(/\s*[[(]\s*(at|arobase)\s*[\])]\s*/gi, "@")
  .replace(/\s+(at|arobase)\s+/gi, "@")
  .replace(/\s*[[(]\s*(dot|point)\s*[\])]\s*/gi, ".")
  .replace(/(@[a-z0-9-]+(?:\.[a-z0-9-]+)*)\s+(dot|point)\s+([a-z]{2,})/gi, "$1.$3")

function extract(html: string): Found[] {
  const found: Found[] = []
  const push = (email: string, source: Found["source"]) => {
    const e = email.toLowerCase().trim().replace(/^mailto:/, "").split("?")[0]
    if (EMAIL_RE.test(e) && !BLACKLIST.test(e) && !/\.(png|jpe?g|webp|svg|gif|css|js)$/.test(e)) found.push({ email: e, source })
    EMAIL_RE.lastIndex = 0
  }
  for (const m of html.matchAll(/mailto:([^"'>\s?]+)/gi)) push(m[1], "mailto")
  for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) { const d = decodeCfEmail(m[1]); if (d) push(d, "cfemail") }
  for (const m of html.matchAll(/"email"\s*:\s*"([^"]+)"/gi)) push(m[1], "jsonld")
  const text = deobfuscate(deentity(html))
  for (const m of text.matchAll(EMAIL_RE)) push(m[0], "text")
  return found
}

const mxCache = new Map<string, boolean>()
async function hasMx(domain: string): Promise<boolean> {
  if (mxCache.has(domain)) return mxCache.get(domain)!
  let ok = false
  try { ok = (await resolveMx(domain)).length > 0 } catch { ok = false }
  mxCache.set(domain, ok)
  return ok
}

async function fetchPage(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(12_000) })
    return res.ok ? await readHtml(res) : ""
  } catch { return "" }
}

/** Looks for the best email for a site. Returns null if nothing is verifiable. */
export async function findEmail(siteUrl: string, contactName?: string): Promise<(Found & { verified: boolean }) | null> {
  const site = domainOf(siteUrl)
  if (!site) return null
  const base = siteUrl.replace(/\/+$/, "")
  const all: Found[] = []
  for (const p of PAGES) {
    const html = await fetchPage(base + p)
    if (html) all.push(...extract(html))
    if (all.some((f) => f.source === "mailto" || f.source === "cfemail")) break // strong signal found → stop
    await sleep(300)
  }
  // sort: strong source (mailto/cfemail > jsonld > text), then domain affinity, then a non-generic local part
  const rank = (f: Found) => (f.source === "mailto" || f.source === "cfemail" ? 0 : f.source === "jsonld" ? 1 : 2)
  const uniq = [...new Map(all.map((f) => [f.email, f])).values()]
  uniq.sort((a, b) => rank(a) - rank(b)
    || Number(domainOf("https://" + b.email.split("@")[1]) === site) - Number(domainOf("https://" + a.email.split("@")[1]) === site)
    || Number(GENERIC_LOCAL.test(a.email)) - Number(GENERIC_LOCAL.test(b.email)))
  for (const f of uniq) {
    if (await hasMx(f.email.split("@")[1])) return { ...f, verified: true } // seen on THEIR site + MX
  }
  // LAST resort: patterns guessed on the site's domain (if MX) — marked unverified
  if (await hasMx(site)) {
    const first = contactName?.split(/\s+/)[0]?.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "")
    const guesses = [...(first ? [`${first}@${site}`] : []), `contact@${site}`, `info@${site}`]
    return { email: guesses[0], source: "pattern", verified: false }
  }
  return null
}

// --- CLI: sweep the sheets ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // a broken site that closes its HTTP/2 socket mid-read emits an error OUTSIDE any promise
  // (ClientHttp2Stream) — try/catch can't catch it. The sweep NEVER dies because of it.
  process.on("uncaughtException", (e) => console.warn(`  ⚠ network error ignored: ${e?.message ?? e}`))
  process.on("unhandledRejection", (e: any) => console.warn(`  ⚠ network rejection ignored: ${e?.message ?? e}`))
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith("-"))
  const ids = wanted.length ? wanted : (await readdir(DIR)).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""))
  let had = 0, found = 0, guessed = 0, none = 0
  for (const id of ids) {
    const path = join(DIR, `${id}.json`)
    let fiche: any
    try { fiche = JSON.parse(await readFile(path, "utf8")) } catch { continue }
    if (fiche.identity?.email && fiche.identity?.emailVerified) { had++; continue }
    const url = fiche.existing?.url
    if (!url) { none++; console.log(`  ${id}: no URL — impossible`); continue }
    const r = await findEmail(url, fiche.identity?.contact)
    if (!r) { none++; console.log(`  ${id}: no email to find (no MX)`); continue }
    fiche.identity = { ...fiche.identity, email: r.email, emailVerified: r.verified, emailSource: r.source }
    await writeFile(path, JSON.stringify(fiche, null, 2))
    if (r.verified) { found++; console.log(`  ✓ ${id}: ${r.email} (${r.source})`) }
    else { guessed++; console.log(`  ~ ${id}: ${r.email} (guessed — confirm before sending)`) }
  }
  console.log(`✓ sweep: ${had} already verified · ${found} found · ${guessed} guessed (pattern) · ${none} not found — npm run reindex to push them to the DB.`)
}
