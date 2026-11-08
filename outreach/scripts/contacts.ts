/**
 * Outreach · resolver of REAL CONTACTS (email + phone) through Playwright.
 *
 * The DISTRIBUTION step must NEVER write to a guessed address. This module opens the prospect's REAL
 * site (Playwright = the rendered DOM, not a raw fetch) and EXTRACTS the real contact from it:
 *   1. `mailto:` / `tel:` in the rendered DOM (the most reliable)
 *   2. Cloudflare email protection (`[data-cfemail]`, `/cdn-cgi/l/email-protection#<hex>`) · decoded
 *   3. JSON-LD (`<script type="application/ld+json">` → `email` / `telephone`)
 *   4. regex fallback on the visible text (reuses `extractContacts` from the scraping harvest)
 * Then it follows the contact / legal notice page if the email or the phone is still missing.
 *
 * It returns the SOURCE and the CONFIDENCE of each finding → the caller knows whether to trust it.
 * Nothing invented: not found = empty field (never a `contact@<domain>` made up at random).
 *
 * Mechanical, zero LLM. Reused by `draft.ts` (prepare) and the `outreach-mail` skill.
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
  emailTier: number      // 0 = the prospect's domain · 1 = free mail · 2 = third-party domain (webmaster) · -1 = none
  phone: string
  phoneSource: ContactSource
  confidence: Confidence // confidence in the EMAIL (outreach's main target)
  pagesVisited: string[]
  note: string
}

// links to follow when the contact is missing from the home page (FR/BE/CH words)
const CONTACT_HINT = /contact|mentions?-?l[eé]gales?|nous-?contacter|coordonn[eé]es|infos?-?pratiques|impressum|legal/i
// a DOM/structured source (mailto/tel/cfemail/json-ld) is "high", the text fallback is "medium"
const HIGH: ContactSource[] = ["mailto", "tel", "cfemail", "json-ld"]

const normTel = (s: string) => s.replace(/[^\d+]/g, "").replace(/^00/, "+")
const telOk = (s: string) => s.replace(/\D/g, "").length >= 9

/** Cloudflare email-protection decoding: first byte = XOR key, the rest = XORed characters. */
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

/** Brings back from the rendered DOM: mailto/tel hrefs, Cloudflare hex, JSON-LD emails/phones, the HTML, the internal links. */
async function harvestPage(page: Page): Promise<Harvest> {
  return await page.evaluate(() => {
    // tsx/esbuild "keepNames" emits `__name(fn,…)` calls in the code shipped to the page;
    // that helper does not exist in the browser → shim it BEFORE any named function.
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
        // internal link: origin EQUALITY (≠ startsWith → 'x.fr'.startsWith would be fooled by 'x.fr.evil.com')
        try { const u = new URL(href, location.href); if (u.origin === location.origin) links.push(u.href) } catch { /* href non navigable */ }
      }
    }
    // Cloudflare : <span class="__cf_email__" data-cfemail="HEX">
    for (const el of Array.from(document.querySelectorAll("[data-cfemail]"))) {
      const h = el.getAttribute("data-cfemail"); if (h) cfHex.push(h)
    }
    // JSON-LD: collect email/telephone recursively
    const jsonldEmails: string[] = []
    const jsonldTels: string[] = []
    const walk = (o: any) => {
      if (!o || typeof o !== "object") return
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === "string") {
          if (/^email$/i.test(k)) jsonldEmails.push(v.replace(/^mailto:/i, "").trim())
          if (/^telephone$/i.test(k)) jsonldTels.push(v)
        } else if (Array.isArray(v)) {
          // valid JSON-LD: email/telephone may be ARRAYS → collect the strings
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
      try { walk(JSON.parse(s.textContent || "{}")) } catch { /* broken JSON-LD: ignored */ }
    }
    return { mailtos, tels, cfHex, jsonldEmails, jsonldTels, html: document.documentElement.outerHTML, links }
  })
}

/** Merges one page's harvest into the candidates accumulator (by source). */
type Cands = { email: Record<ContactSource, string[]>; phone: Record<ContactSource, string[]> }
function ingest(acc: Cands, h: Harvest) {
  acc.email.mailto.push(...h.mailtos)
  acc.email.cfemail.push(...h.cfHex.map(cfDecode).filter(Boolean))
  acc.email["json-ld"].push(...h.jsonldEmails)
  acc.phone.tel.push(...h.tels.map(normTel).filter(telOk))
  acc.phone["json-ld"].push(...h.jsonldTels.map(normTel).filter(telOk))
  // text fallback (the same engine as the scraping) on the rendered HTML
  const t = extractContacts(h.html)
  if (t.email) acc.email.text.push(t.email)
  if (t.phone && telOk(normTel(t.phone))) acc.phone.text.push(normTel(t.phone))
}

const emptyCands = (): Cands => ({
  email: { mailto: [], cfemail: [], "json-ld": [], text: [], tel: [], "": [] },
  phone: { tel: [], "json-ld": [], text: [], mailto: [], cfemail: [], "": [] },
})

// free mail providers: a small business often has ITS work address there (≠ the site's domain)
const FREE_MAIL = /@(gmail|googlemail|orange|wanadoo|free|laposte|outlook|hotmail|live|msn|yahoo|ymail|sfr|neuf|numericable|bbox|gmx|protonmail|proton|icloud|aol)\./i
const HUMAN_PREFIX = /^(contact|info|infos|bonjour|hello|commercial|accueil|devis|reservations?)@/i
const NOREPLY = /^(no-?reply|ne-pas-repondre|donotreply)@/i
const SRC_RANK: Record<string, number> = { mailto: 0, cfemail: 1, "json-ld": 2, text: 3 }

// TWO-level public suffixes: without them, registrable('x.co.uk')==='co.uk'==='y.co.uk' → a false match.
// (the FR/BE/CH market is single-level, but the fix avoids ranking a webmaster as tier 0.)
const TWO_PART_TLD = new Set(["co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk", "net.uk", "sch.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "com.br", "co.za", "co.jp", "or.jp", "ne.jp", "com.mx", "com.ar", "co.in", "com.sg", "com.my", "com.tr", "co.kr"])
export const registrable = (host: string) => {
  const p = host.replace(/^www\./i, "").toLowerCase().split(".")
  if (p.length <= 2) return p.join(".")
  const last2 = p.slice(-2).join(".")
  return TWO_PART_TLD.has(last2) ? p.slice(-3).join(".") : last2
}
const cleanEmail = (raw: string) => { const e = raw.toLowerCase().replace(/^mailto:/, "").split(/[?#]/)[0].trim(); return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && !EMAIL_JUNK.test(e) ? e : "" }
// 0 = the prospect's domain (safe) · 1 = free mail (often THEIR address) · 2 = third-party domain (webmaster/host)
export function emailTierOf(email: string, siteHost: string): number {
  const dom = email.split("@")[1] || ""
  if (siteHost && registrable(dom) === registrable(siteHost)) return 0
  if (FREE_MAIL.test(email)) return 1
  return 2
}

/**
 * Picks the best email: first by DOMAIN AFFINITY (the right email is on the prospect's domain, or a
 * free mail address that belongs to them · not the webmaster's), then a human prefix,
 * then the source's reliability. The phone follows the source priority.
 */
function best(cands: Cands, siteHost: string): { email: string; emailSource: ContactSource; emailTier: number; phone: string; phoneSource: ContactSource } {
  type C = { email: string; src: ContactSource; tier: number; sr: number; pr: number }
  const map = new Map<string, C>()
  for (const src of ["mailto", "cfemail", "json-ld", "text"] as ContactSource[]) {
    for (const raw of cands.email[src] || []) {
      const e = cleanEmail(raw); if (!e) continue
      const c: C = { email: e, src, tier: emailTierOf(e, siteHost), sr: SRC_RANK[src] ?? 9, pr: NOREPLY.test(e) ? 2 : HUMAN_PREFIX.test(e) ? 0 : 1 }
      const prev = map.get(e)
      if (!prev || c.sr < prev.sr) map.set(e, c) // same email seen through several sources → keep the most reliable
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
 * Resolves a site's REAL contacts. Opens the home page (rendered DOM), then follows the contact /
 * legal notice page if the email or the phone is missing. Nothing found = empty (never invented).
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
  let siteHost = ""; try { siteHost = new URL(url).host } catch { /* malformed url */ }

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
  try {
    browser = await chromium.launch()
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()

    const visit = async (target: string): Promise<string[]> => {
      try {
        await page.goto(target, { waitUntil: "domcontentloaded", timeout: timeoutMs })
        await page.waitForTimeout(900) // let the JS inject (cfemail, widgets)
        const h = await harvestPage(page)
        ingest(acc, h)
        pagesVisited.push(target)
        return h.links
      } catch (e) { pagesVisited.push(target + ` (failed: ${(e as Error).message.split("\n")[0]})`); return [] }
    }

    const links = await visit(url)
    const missing = () => (wantEmail && !best(acc, siteHost).email) || (wantPhone && !best(acc, siteHost).phone)

    if (missing()) {
      const seen = new Set([url.replace(/\/$/, "")])
      const contactLinks = links
        .filter((l) => CONTACT_HINT.test(l))
        .filter((l) => !seen.has(l.replace(/\/$/, "")))
      // always try /contact even when it is not linked
      try { contactLinks.push(new URL("/contact", url).href) } catch { /* malformed url */ }
      const uniq = [...new Set(contactLinks.map((l) => l.replace(/\/$/, "")))]
      for (const l of uniq.slice(0, maxPages - 1)) {
        if (!missing()) break
        if (seen.has(l)) continue
        seen.add(l)
        await visit(l)
      }
    }
  } catch (e) {
    return { email: "", emailSource: "", emailTier: -1, phone: "", phoneSource: "", confidence: "none", pagesVisited, note: `navigation failed: ${(e as Error).message}` }
  } finally {
    try { await browser?.close() } catch { /* already closed */ }
  }

  const { email, emailSource, emailTier, phone, phoneSource } = best(acc, siteHost)
  // third-party domain (tier 2) = maybe the webmaster → never given as "high"
  const confidence: Confidence = !email ? "none" : (HIGH.includes(emailSource) && emailTier < 2) ? "high" : "medium"
  const note = !email && !phone ? "no contact found on the site"
    : !email ? "phone found, no email"
    : emailTier === 2 ? "email on a third-party domain (maybe the webmaster) - to check"
    : confidence === "medium" ? "email inferred from the text (to check)"
    : ""
  return { email, emailSource, emailTier, phone, phoneSource, confidence, pagesVisited, note }
}

// --- CLI : npm run outreach:contacts -- <url> ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.argv[2]
  if (!url) { console.error("usage: npm run outreach:contacts -- <url>"); process.exit(1) }
  console.log(`→ resolving contacts: ${url}`)
  const c = await resolveContacts(url)
  console.log(JSON.stringify(c, null, 2))
  console.log(`\n  email : ${c.email || "∅"}${c.email ? `  (${c.emailSource}, confidence ${c.confidence})` : ""}`)
  console.log(`  phone : ${c.phone || "∅"}${c.phone ? `  (${c.phoneSource})` : ""}`)
  console.log(`  pages : ${c.pagesVisited.join(", ")}`)
  if (c.note) console.log(`  note  : ${c.note}`)
}
