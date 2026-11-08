/**
 * Scraping — collects the CONTACTS (phone + email) from the prospect's site. Free.
 *
 * We already have the URL; we read the home page (+ /contact if needed) and extract `tel:`/`mailto:` + FR/BE/CH
 * regexes. This fills the `phone`/`email` columns → feeds SCORING (closability) and
 * DISTRIBUTION (whom to write to). Mechanical, zero LLM, bounded concurrency.
 */
import { readHtml, sleep, type Found } from "./util.ts"
import { findPhones } from "./phone.ts"

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"

// FR (0X…), BE (+32/0…), CH (+41/0…) phones — formats tolerant of separators
const TEL_HREF = /href=["']tel:([+0-9 ().-]{8,})["']/gi
const MAILTO = /href=["']mailto:([^"'?]+)/gi
const EMAIL_TXT = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi
export const EMAIL_JUNK = /\.(png|jpe?g|gif|svg|webp|css|js)$|@(?:sentry|wix|example|domain|email|2x|3x|godaddy)|^[a-f0-9]{16,}@/i

const normTel = (s: string) => s.replace(/[^\d+]/g, "").replace(/^00/, "+")

export function pickEmail(cands: string[]): string {
  const ok = cands
    .map((e) => e.toLowerCase().replace(/^mailto:/, "").split(/[?#]/)[0].trim())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && !EMAIL_JUNK.test(e))
  if (!ok.length) return ""
  // prefer a "human" contact address over noreply
  return ok.find((e) => /^(contact|info|bonjour|hello|commercial|accueil|devis)@/.test(e)) ?? ok.find((e) => !/^(no-?reply|ne-pas-repondre)@/.test(e)) ?? ok[0]
}

export function extractContacts(html: string): { phone: string; email: string } {
  const tels = [...html.matchAll(TEL_HREF)].map((m) => normTel(m[1]))
  if (!tels.length) tels.push(...findPhones(html.replace(/<[^>]+>/g, " ")).map(normTel))
  const phone = tels.find((t) => t.replace(/\D/g, "").length >= 9) ?? ""

  const mails = [...html.matchAll(MAILTO)].map((m) => decodeURIComponent(m[1]))
  if (!mails.length) mails.push(...(html.match(EMAIL_TXT) ?? []))
  return { phone, email: pickEmail(mails) }
}

async function fetchText(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(12_000) })
    return res.ok ? (await readHtml(res)).slice(0, 120_000) : ""
  } catch { return "" }
}

// home, then the contact + LEGAL NOTICE pages (in France the law requires a contact email there
// → a big gain in email coverage; and an email on a maintained page = an inbox someone really reads).
export async function harvestUrl(url: string, need: { phone: boolean; email: boolean }): Promise<{ phone: string; email: string }> {
  try {
    const home = await fetchText(url)
    let { phone, email } = extractContacts(home)
    const missing = () => (need.phone && !phone) || (need.email && !email)
    if (missing()) {
      const base = new URL(url) // may throw on a malformed URL → everything is inside the try
      // the site's links to contact / legal notice + standard paths as a fallback
      const links = [...home.matchAll(/href=["']([^"']*(?:contact|mentions|legal)[^"']*)["']/gi)].map((m) => m[1])
      const paths = ["/contact", "/mentions-legales", "/contactez-nous", "/nous-contacter"]
      const pages = [...new Set([...links, ...paths].map((h) => { try { return new URL(h, base).href } catch { return "" } }).filter(Boolean))].slice(0, 3)
      for (const p of pages) {
        if (!missing()) break
        const c = extractContacts(await fetchText(p))
        phone = phone || c.phone
        email = email || c.email
      }
    }
    return { phone, email }
  } catch {
    return { phone: "", email: "" }
  }
}

/** fills missing phone/email on rows WITH A SITE. Bounded concurrency (HARVEST_CONC, default 8). */
export async function harvestContacts(rows: Found[], log: (s: string) => void): Promise<{ phones: number; emails: number }> {
  const targets = rows.filter((r) => r.website && (!r.phone || !r.email))
  if (!targets.length) return { phones: 0, emails: 0 }
  const conc = Number(process.env.HARVEST_CONC) || 8
  let phones = 0, emails = 0, done = 0, i = 0
  async function worker() {
    while (i < targets.length) {
      const r = targets[i++]
      try {
        const c = await harvestUrl(r.website, { phone: !r.phone, email: !r.email })
        if (!r.phone && c.phone) { r.phone = c.phone; phones++ }
        if (!r.email && c.email) { r.email = c.email; emails++ }
      } catch { /* one row must never kill the batch */ }
      if (++done % 25 === 0) log(`  harvest ${done}/${targets.length} · ${phones} phones / ${emails} emails`)
      await sleep(40)
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, targets.length) }, worker))
  return { phones, emails }
}
