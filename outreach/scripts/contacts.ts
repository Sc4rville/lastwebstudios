/**
 * Outreach · résolveur de CONTACTS RÉELS (email + téléphone) via Playwright.
 *
 * Le maillon DISTRIBUTION ne doit JAMAIS écrire à une adresse devinée. Ce module ouvre le VRAI site
 * du prospect (Playwright = DOM rendu, pas un fetch brut) et en EXTRAIT le contact réel :
 *   1. `mailto:` / `tel:` dans le DOM rendu (le plus fiable)
 *   2. Cloudflare email-protection (`[data-cfemail]`, `/cdn-cgi/l/email-protection#<hex>`) · décodé
 *   3. JSON-LD (`<script type="application/ld+json">` → `email` / `telephone`)
 *   4. repli regex sur le texte visible (réutilise `extractContacts` du harvest scraping)
 * Puis il suit la page contact / mentions-légales si l'email ou le tél manque encore.
 *
 * Il rend la SOURCE et la CONFIANCE de chaque trouvaille → l'appelant sait s'il peut faire confiance.
 * Rien d'inventé : pas trouvé = champ vide (jamais un `contact@<domaine>` posé au hasard).
 *
 * Mécanique, zéro LLM. Réutilisé par `draft.ts` (prepare) et le skill `outreach-mail`.
 *
 * CLI : npm run outreach:contacts -- <url>
 */
import { chromium, type Page } from "playwright"
import { fileURLToPath } from "node:url"
import { extractContacts, EMAIL_JUNK } from "../../leadengine/1_scraping/scripts/harvest.ts"

export type ContactSource = "mailto" | "tel" | "cfemail" | "json-ld" | "text" | ""
export type Confidence = "high" | "medium" | "none"

export type Contacts = {
  email: string
  emailSource: ContactSource
  emailTier: number      // 0 = domaine du prospect · 1 = mail gratuit · 2 = domaine tiers (webmaster) · -1 = aucun
  phone: string
  phoneSource: ContactSource
  confidence: Confidence // confiance de l'EMAIL (la cible principale de l'outreach)
  pagesVisited: string[]
  note: string
}

// liens à suivre quand le contact manque sur la home (FR/BE/CH)
const CONTACT_HINT = /contact|mentions?-?l[eé]gales?|nous-?contacter|coordonn[eé]es|infos?-?pratiques|impressum|legal/i
// une source DOM/structurée (mailto/tel/cfemail/json-ld) est "high", le repli texte est "medium"
const HIGH: ContactSource[] = ["mailto", "tel", "cfemail", "json-ld"]

const normTel = (s: string) => s.replace(/[^\d+]/g, "").replace(/^00/, "+")
const telOk = (s: string) => s.replace(/\D/g, "").length >= 9

/** Décodage Cloudflare email-protection : 1er octet = clé XOR, le reste = caractères XORés. */
function cfDecode(hex: string): string {
  try {
    const clean = hex.trim().replace(/[^0-9a-fA-F]/g, "")
    if (clean.length < 4 || clean.length % 2) return ""
    const key = parseInt(clean.slice(0, 2), 16)
    let out = ""
    for (let i = 2; i < clean.length; i += 2) out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16) ^ key)
    return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(out) ? out.toLowerCase() : ""
  } catch { return "" }
}

type Harvest = { mailtos: string[]; tels: string[]; cfHex: string[]; jsonldEmails: string[]; jsonldTels: string[]; html: string; links: string[] }

/** Ramène du DOM rendu : hrefs mailto/tel, hex Cloudflare, emails/tél JSON-LD, le HTML, les liens internes. */
async function harvestPage(page: Page): Promise<Harvest> {
  return await page.evaluate(() => {
    // tsx/esbuild "keepNames" émet des appels `__name(fn,…)` dans le code expédié à la page ;
    // ce helper n'existe pas côté navigateur → on le shim AVANT toute fonction nommée.
    ;(globalThis as any).__name = (globalThis as any).__name || ((fn: any) => fn)
    const mailtos: string[] = []
    const tels: string[] = []
    const cfHex: string[] = []
    const links: string[] = []
    for (const a of Array.from(document.querySelectorAll("a[href]"))) {
      const href = a.getAttribute("href") || ""
      if (/^mailto:/i.test(href)) mailtos.push(href.replace(/^mailto:/i, "").split(/[?#]/)[0].trim())
      else if (/^tel:/i.test(href)) tels.push(href.replace(/^tel:/i, "").trim())
      else {
        // Cloudflare : <a href="/cdn-cgi/l/email-protection#HEX">
        const m = href.match(/email-protection#([0-9a-fA-F]+)/)
        if (m) cfHex.push(m[1])
        // lien interne : ÉGALITÉ d'origine (≠ startsWith → 'x.fr'.startsWith piégerait 'x.fr.evil.com')
        try { const u = new URL(href, location.href); if (u.origin === location.origin) links.push(u.href) } catch { /* href non navigable */ }
      }
    }
    // Cloudflare : <span class="__cf_email__" data-cfemail="HEX">
    for (const el of Array.from(document.querySelectorAll("[data-cfemail]"))) {
      const h = el.getAttribute("data-cfemail"); if (h) cfHex.push(h)
    }
    // JSON-LD : on récolte récursivement email/telephone
    const jsonldEmails: string[] = []
    const jsonldTels: string[] = []
    const walk = (o: any) => {
      if (!o || typeof o !== "object") return
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === "string") {
          if (/^email$/i.test(k)) jsonldEmails.push(v.replace(/^mailto:/i, "").trim())
          if (/^telephone$/i.test(k)) jsonldTels.push(v)
        } else if (Array.isArray(v)) {
          // JSON-LD valide : email/telephone peuvent être des TABLEAUX → on récolte les chaînes
          for (const el of v) {
            if (typeof el === "string") {
              if (/^email$/i.test(k)) jsonldEmails.push(el.replace(/^mailto:/i, "").trim())
              if (/^telephone$/i.test(k)) jsonldTels.push(el)
            } else walk(el)
          }
        } else if (v && typeof v === "object") walk(v)
      }
    }
    for (const s of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
      try { walk(JSON.parse(s.textContent || "{}")) } catch { /* JSON-LD cassé : on ignore */ }
    }
    return { mailtos, tels, cfHex, jsonldEmails, jsonldTels, html: document.documentElement.outerHTML, links }
  })
}

/** Fusionne une récolte de page dans l'accumulateur de candidats (par source). */
type Cands = { email: Record<ContactSource, string[]>; phone: Record<ContactSource, string[]> }
function ingest(acc: Cands, h: Harvest) {
  acc.email.mailto.push(...h.mailtos)
  acc.email.cfemail.push(...h.cfHex.map(cfDecode).filter(Boolean))
  acc.email["json-ld"].push(...h.jsonldEmails)
  acc.phone.tel.push(...h.tels.map(normTel).filter(telOk))
  acc.phone["json-ld"].push(...h.jsonldTels.map(normTel).filter(telOk))
  // repli texte (le même moteur que le scraping) sur le HTML rendu
  const t = extractContacts(h.html)
  if (t.email) acc.email.text.push(t.email)
  if (t.phone && telOk(normTel(t.phone))) acc.phone.text.push(normTel(t.phone))
}

const emptyCands = (): Cands => ({
  email: { mailto: [], cfemail: [], "json-ld": [], text: [], tel: [], "": [] },
  phone: { tel: [], "json-ld": [], text: [], mailto: [], cfemail: [], "": [] },
})

// fournisseurs de mail gratuits : un petit pro y a souvent SON adresse pro (≠ domaine du site)
const FREE_MAIL = /@(gmail|googlemail|orange|wanadoo|free|laposte|outlook|hotmail|live|msn|yahoo|ymail|sfr|neuf|numericable|bbox|gmx|protonmail|proton|icloud|aol)\./i
const HUMAN_PREFIX = /^(contact|info|infos|bonjour|hello|commercial|accueil|devis|reservations?)@/i
const NOREPLY = /^(no-?reply|ne-pas-repondre|donotreply)@/i
const SRC_RANK: Record<string, number> = { mailto: 0, cfemail: 1, "json-ld": 2, text: 3 }

// suffixes publics à DEUX niveaux : sans ça, registrable('x.co.uk')==='co.uk'==='y.co.uk' → faux match.
// (notre marché FR/BE/CH est mono-niveau, mais le fix évite de classer un webmaster en tier 0.)
const TWO_PART_TLD = new Set(["co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk", "net.uk", "sch.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "com.br", "co.za", "co.jp", "or.jp", "ne.jp", "com.mx", "com.ar", "co.in", "com.sg", "com.my", "com.tr", "co.kr"])
export const registrable = (host: string) => {
  const p = host.replace(/^www\./i, "").toLowerCase().split(".")
  if (p.length <= 2) return p.join(".")
  const last2 = p.slice(-2).join(".")
  return TWO_PART_TLD.has(last2) ? p.slice(-3).join(".") : last2
}
const cleanEmail = (raw: string) => { const e = raw.toLowerCase().replace(/^mailto:/, "").split(/[?#]/)[0].trim(); return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && !EMAIL_JUNK.test(e) ? e : "" }
// 0 = domaine du prospect (sûr) · 1 = mail gratuit (souvent SON adresse) · 2 = domaine tiers (webmaster/hébergeur)
export function emailTierOf(email: string, siteHost: string): number {
  const dom = email.split("@")[1] || ""
  if (siteHost && registrable(dom) === registrable(siteHost)) return 0
  if (FREE_MAIL.test(email)) return 1
  return 2
}

/**
 * Choisit le meilleur email : d'abord par AFFINITÉ DE DOMAINE (le bon email est sur le domaine du
 * prospect, ou un mail gratuit qui lui appartient · pas celui du webmaster), puis préfixe humain,
 * puis fiabilité de la source. Le tél suit la priorité de source.
 */
function best(cands: Cands, siteHost: string): { email: string; emailSource: ContactSource; emailTier: number; phone: string; phoneSource: ContactSource } {
  type C = { email: string; src: ContactSource; tier: number; sr: number; pr: number }
  const map = new Map<string, C>()
  for (const src of ["mailto", "cfemail", "json-ld", "text"] as ContactSource[]) {
    for (const raw of cands.email[src] || []) {
      const e = cleanEmail(raw); if (!e) continue
      const c: C = { email: e, src, tier: emailTierOf(e, siteHost), sr: SRC_RANK[src] ?? 9, pr: NOREPLY.test(e) ? 2 : HUMAN_PREFIX.test(e) ? 0 : 1 }
      const prev = map.get(e)
      if (!prev || c.sr < prev.sr) map.set(e, c) // même email vu via plusieurs sources → garde la plus fiable
    }
  }
  const top = [...map.values()].sort((a, b) => a.tier - b.tier || a.pr - b.pr || a.sr - b.sr)[0]
  let phone = "", phoneSource: ContactSource = ""
  for (const src of ["tel", "json-ld", "text"] as ContactSource[]) {
    const p = (cands.phone[src] || []).find(telOk)
    if (p) { phone = p; phoneSource = src; break }
  }
  return { email: top?.email ?? "", emailSource: (top?.src ?? "") as ContactSource, emailTier: top?.tier ?? -1, phone, phoneSource }
}

/**
 * Résout les contacts RÉELS d'un site. Ouvre la home (DOM rendu), puis suit la page contact /
 * mentions-légales si l'email ou le tél manque. Rien trouvé = vide (jamais inventé).
 */
export async function resolveContacts(
  url: string,
  opts: { wantEmail?: boolean; wantPhone?: boolean; maxPages?: number; timeoutMs?: number } = {},
): Promise<Contacts> {
  const wantEmail = opts.wantEmail ?? true
  const wantPhone = opts.wantPhone ?? true
  const maxPages = opts.maxPages ?? 3
  const timeoutMs = opts.timeoutMs ?? 25_000
  const acc = emptyCands()
  const pagesVisited: string[] = []
  let siteHost = ""; try { siteHost = new URL(url).host } catch { /* url malformée */ }

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
  try {
    browser = await chromium.launch()
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()

    const visit = async (target: string): Promise<string[]> => {
      try {
        await page.goto(target, { waitUntil: "domcontentloaded", timeout: timeoutMs })
        await page.waitForTimeout(900) // laisse le JS injecter (cfemail, widgets)
        const h = await harvestPage(page)
        ingest(acc, h)
        pagesVisited.push(target)
        return h.links
      } catch (e) { pagesVisited.push(target + ` (échec: ${(e as Error).message.split("\n")[0]})`); return [] }
    }

    const links = await visit(url)
    const missing = () => (wantEmail && !best(acc, siteHost).email) || (wantPhone && !best(acc, siteHost).phone)

    if (missing()) {
      const seen = new Set([url.replace(/\/$/, "")])
      const contactLinks = links
        .filter((l) => CONTACT_HINT.test(l))
        .filter((l) => !seen.has(l.replace(/\/$/, "")))
      // garantir un essai sur /contact même s'il n'est pas listé
      try { contactLinks.push(new URL("/contact", url).href) } catch { /* url malformée */ }
      const uniq = [...new Set(contactLinks.map((l) => l.replace(/\/$/, "")))]
      for (const l of uniq.slice(0, maxPages - 1)) {
        if (!missing()) break
        if (seen.has(l)) continue
        seen.add(l)
        await visit(l)
      }
    }
  } catch (e) {
    return { email: "", emailSource: "", emailTier: -1, phone: "", phoneSource: "", confidence: "none", pagesVisited, note: `échec navigation : ${(e as Error).message}` }
  } finally {
    try { await browser?.close() } catch { /* déjà fermé */ }
  }

  const { email, emailSource, emailTier, phone, phoneSource } = best(acc, siteHost)
  // domaine tiers (tier 2) = peut-être le webmaster → on ne le donne jamais en "high"
  const confidence: Confidence = !email ? "none" : (HIGH.includes(emailSource) && emailTier < 2) ? "high" : "medium"
  const note = !email && !phone ? "aucun contact trouvé sur le site"
    : !email ? "tél trouvé, pas d'email"
    : emailTier === 2 ? "email d'un domaine tiers (peut-être le webmaster) - à vérifier"
    : confidence === "medium" ? "email déduit du texte (à vérifier)"
    : ""
  return { email, emailSource, emailTier, phone, phoneSource, confidence, pagesVisited, note }
}

// --- CLI : npm run outreach:contacts -- <url> ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.argv[2]
  if (!url) { console.error("usage: npm run outreach:contacts -- <url>"); process.exit(1) }
  console.log(`→ résolution des contacts : ${url}`)
  const c = await resolveContacts(url)
  console.log(JSON.stringify(c, null, 2))
  console.log(`\n  email : ${c.email || "∅"}${c.email ? `  (${c.emailSource}, confiance ${c.confidence})` : ""}`)
  console.log(`  tél   : ${c.phone || "∅"}${c.phone ? `  (${c.phoneSource})` : ""}`)
  console.log(`  pages : ${c.pagesVisited.join(", ")}`)
  if (c.note) console.log(`  note  : ${c.note}`)
}
