/**
 * emails.ts — le maillon CONTACTABILITÉ : découverte + vérification d'email sur les fiches.
 *
 * Pourquoi (audit 2026-07-02) : email présent sur 26 % des fiches, vérifié sur 2 — incompatible avec la
 * machine à cold email (priorité #1). `harvest.ts` ne lisait que home+/contact en regex simple.
 *
 * Ce que fait ce maillon, par fiche sans email vérifié :
 *   1. fetch d'un ÉVENTAIL de pages (home, contact, mentions légales, à-propos…) — l'email légal vit
 *      souvent dans les mentions, pas en home.
 *   2. extraction LARGE : mailto:, texte brut, entités HTML décodées, obfuscations « x [at] y [dot] fr »,
 *      protection Cloudflare (data-cfemail, XOR), champs email des JSON-LD.
 *   3. tri par AFFINITÉ : email du domaine du site > générique (gmail/orange) ; noreply/webmaster exclus.
 *   4. vérification MX (DNS) : un domaine sans serveur mail = candidat jeté.
 *   5. DERNIER recours : pattern deviné (contact@ / info@ / prénom@) sur domaine à MX valide —
 *      écrit avec emailVerified:false + emailSource:"pattern" (jamais présenté comme sûr).
 *
 * Écrit dans la fiche : identity.email · identity.emailVerified (true = vu sur LEUR site) ·
 * identity.emailSource (mailto|cfemail|text|jsonld|pattern). Après : npm run reindex.
 *
 * Usage : npm run emails            → toutes les fiches sans email vérifié
 *         npm run emails -- <id..>  → ciblé
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
// boîtes techniques/génériques qui ne mènent pas au décideur → dernier choix ou exclues
const BLACKLIST = /noreply|no-reply|nepasrepondre|webmaster|postmaster|abuse|privacy|rgpd|dpo@|example\.|sentry|wixpress|@(w3\.org|schema\.org|sentry\.io)/i
const GENERIC_LOCAL = /^(contact|info|infos|bonjour|hello|accueil|commercial|contact-)/i

type Found = { email: string; source: "mailto" | "cfemail" | "jsonld" | "text" | "pattern" }

/** décode la protection e-mail Cloudflare : hex XOR (1er octet = clé). */
function decodeCfEmail(hex: string): string {
  try {
    const key = parseInt(hex.slice(0, 2), 16)
    let out = ""
    for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key)
    return out
  } catch { return "" }
}
const deentity = (h: string) => h.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCharCode(parseInt(x, 16))).replace(/&(amp|commat);/gi, (m) => (m === "&amp;" ? "&" : "@"))
/** « x [at] y [dot] fr », « x (at) y point fr » → x@y.fr */
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

/** Cherche le meilleur email pour un site. Renvoie null si rien de vérifiable. */
export async function findEmail(siteUrl: string, contactName?: string): Promise<(Found & { verified: boolean }) | null> {
  const site = domainOf(siteUrl)
  if (!site) return null
  const base = siteUrl.replace(/\/+$/, "")
  const all: Found[] = []
  for (const p of PAGES) {
    const html = await fetchPage(base + p)
    if (html) all.push(...extract(html))
    if (all.some((f) => f.source === "mailto" || f.source === "cfemail")) break // signal fort trouvé → stop
    await sleep(300)
  }
  // tri : source forte (mailto/cfemail > jsonld > text) puis affinité domaine puis local-part non générique
  const rank = (f: Found) => (f.source === "mailto" || f.source === "cfemail" ? 0 : f.source === "jsonld" ? 1 : 2)
  const uniq = [...new Map(all.map((f) => [f.email, f])).values()]
  uniq.sort((a, b) => rank(a) - rank(b)
    || Number(domainOf("https://" + b.email.split("@")[1]) === site) - Number(domainOf("https://" + a.email.split("@")[1]) === site)
    || Number(GENERIC_LOCAL.test(a.email)) - Number(GENERIC_LOCAL.test(b.email)))
  for (const f of uniq) {
    if (await hasMx(f.email.split("@")[1])) return { ...f, verified: true } // vu sur LEUR site + MX
  }
  // DERNIER recours : patterns devinés sur le domaine du site (si MX) — marqués non vérifiés
  if (await hasMx(site)) {
    const first = contactName?.split(/\s+/)[0]?.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "")
    const guesses = [...(first ? [`${first}@${site}`] : []), `contact@${site}`, `info@${site}`]
    return { email: guesses[0], source: "pattern", verified: false }
  }
  return null
}

// --- CLI : sweep des fiches ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // un site pourri qui ferme son socket HTTP/2 en pleine lecture émet une erreur HORS promesse
  // (ClientHttp2Stream) — inattrapable par try/catch. Le sweep ne meurt JAMAIS pour ça.
  process.on("uncaughtException", (e) => console.warn(`  ⚠ erreur réseau ignorée : ${e?.message ?? e}`))
  process.on("unhandledRejection", (e: any) => console.warn(`  ⚠ rejet réseau ignoré : ${e?.message ?? e}`))
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith("-"))
  const ids = wanted.length ? wanted : (await readdir(DIR)).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""))
  let had = 0, found = 0, guessed = 0, none = 0
  for (const id of ids) {
    const path = join(DIR, `${id}.json`)
    let fiche: any
    try { fiche = JSON.parse(await readFile(path, "utf8")) } catch { continue }
    if (fiche.identity?.email && fiche.identity?.emailVerified) { had++; continue }
    const url = fiche.existing?.url
    if (!url) { none++; console.log(`  ${id} : pas d'URL — impossible`); continue }
    const r = await findEmail(url, fiche.identity?.contact)
    if (!r) { none++; console.log(`  ${id} : aucun email trouvable (pas de MX)`); continue }
    fiche.identity = { ...fiche.identity, email: r.email, emailVerified: r.verified, emailSource: r.source }
    await writeFile(path, JSON.stringify(fiche, null, 2))
    if (r.verified) { found++; console.log(`  ✓ ${id} : ${r.email} (${r.source})`) }
    else { guessed++; console.log(`  ~ ${id} : ${r.email} (deviné — à confirmer avant envoi)`) }
  }
  console.log(`✓ sweep : ${had} déjà vérifiés · ${found} trouvés · ${guessed} devinés (pattern) · ${none} introuvables — npm run reindex pour pousser en DB.`)
}
