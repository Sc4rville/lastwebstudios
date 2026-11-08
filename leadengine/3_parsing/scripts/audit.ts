/**
 * audit.ts — a RIGOROUS AUDIT PROTOCOL for a prospect's site (the FOUNDATION of the complaints: diagnose + personas).
 *
 * Surface metrics are not enough: we really INTERACT (Playwright) to know in detail
 * what happens on the site.
 *  1. FUNCTIONAL   — we CLICK the buttons/CTAs (does the URL/DOM change? otherwise = VERIFIED dead), we test the
 *                    contact form, we check every internal link (HEAD 404), broken images, JS errors.
 *  2. VISUAL       — overlaps (a button over text) desktop+mobile, horizontal overflow at 390/768/1280.
 *  3. PERF         — a real Google PageSpeed Insights score (`PAGESPEED_KEY`; best-effort, never blocks the build).
 *  4. SEO          — title/meta/H1 + canonical + JSON-LD + Open Graph.
 *  5. TRUST        — social proof (videos/reviews/booking) + copyright year (a neglected site?).
 *  6. MULTI-PAGE   — replays the key checks on /contact and a past-work/portfolio page.
 *
 * Writes `fiche.audit` + `issues` (ALL the complaints, for diagnose) AND `clientIssues` (complaints a customer
 * can EXPERIENCE, for the personas; invisible SEO is EXCLUDED). Honesty: we tell the verified FACT
 * ("X clicked buttons do nothing") from the HEURISTIC (phrased "to check").
 * The complaint texts stay French on purpose: they speak to a French prospect (emails, personas, call scripts).
 *
 * CLI: npm run audit -- <id>
 */
import { chromium, type Page } from "playwright"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"

const PROSPECTS = "data/prospects"
// SAFETY: the form test SUBMITS NOTHING by default (submitting = spamming the prospect in a batch).
// The explicit `--submit-form` flag really tests sending (never on real prospects in bulk).
const SUBMIT_FORM = process.argv.includes("--submit-form")

type Overlap = { count: number; examples: string[] }
type DeadButton = { label: string; href: string }
type PageCheck = {
  url: string
  kind: "contact" | "portfolio"
  reachable: boolean
  overflow: { at390: number; at768: number; at1280: number }
  overlapDesktop: Overlap
  overlapMobile: Overlap
  brokenImages: string[]
}

type Audit = {
  date: string
  url: string
  finalUrl: string
  reachable: boolean
  https: boolean
  loadMs: number | null
  mobile: { overflowPx: number; brokenMobile: boolean; hasViewportMeta: boolean; overflow768: number; overflow1280: number }
  contact: { hasForm: boolean; hasTel: boolean; hasMailto: boolean; hasPhoneText: boolean; hasEmailText: boolean; hasContactLink: boolean }
  seo: { title: string; titleLen: number; hasMetaDesc: boolean; h1Count: number; imgCount: number; imgNoAlt: number; hasCanonical: boolean; jsonLdCount: number; hasOgTitle: boolean; hasOgImage: boolean }
  strengths: { videos: number; hasBooking: boolean; hasReviews: boolean; googleRating: string | null; reviewCount: number | null; copyrightYear: number | null; stale: boolean }
  buttons: { tested: number; dead: DeadButton[] } // dead = real content CTAs (cookies/consent & unlabelled excluded)
  form: { present: boolean; status: string } // none | success | error | submitted | no-feedback | présent (non soumis) (= present, not submitted)
  overlap: { desktop: Overlap; mobile: Overlap }
  perf: { available: boolean; score: number | null; lcpMs: number | null; cls: number | null; source: string }
  pages: PageCheck[]
  screenshots: { desktop: string | null; mobile: string | null }
  links: { checked: number; broken: string[] }
  functional: { jsErrors: number; jsErrorMessages: string[]; deadLinks: number; brokenImages: number; brokenImageUrls: string[] }
  issues: string[]
  clientIssues: string[]
}

// --- module-level helpers (the __name trap only concerns code injected into page.evaluate) ---

// horizontal overflow at a given width
async function overflowAt(page: Page, w: number): Promise<number> {
  await page.setViewportSize({ width: w, height: 900 }).catch(() => {})
  await page.waitForTimeout(300)
  return await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth)).catch(() => 0)
}

// broken images (naturalWidth=0) at the current viewport → exact URLs
async function brokenImageUrls(page: Page): Promise<string[]> {
  return await page
    .evaluate(() => Array.from(document.images).filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src || i.getAttribute("src") || "").filter((s) => s))
    .catch(() => [] as string[])
}

// overlaps: an interactive element whose box covers >=40% of a TEXT element (a leaf, neither ancestor nor descendant)
async function overlapScan(page: Page): Promise<Overlap> {
  const res: string[] = await page
    .evaluate(() => {
      const inter = Array.from(document.querySelectorAll('a,button,[role="button"]')).slice(0, 120)
      const txts = Array.from(document.querySelectorAll("h1,h2,h3,h4,p,li,strong,em,span")).slice(0, 400)
      const hits: string[] = []
      for (const it of inter) {
        // we ignore the header/nav (menus, dropdowns, language switch): a classic source of false positives
        if (it.closest("header,nav")) continue
        const r1 = (it as HTMLElement).getBoundingClientRect()
        if (r1.width < 6 || r1.height < 6) continue
        for (const tx of txts) {
          if (it === tx || it.contains(tx) || tx.contains(it)) continue
          // the text side must hold a REAL text node (not a mere layout wrapper)
          let leaf = false
          for (const n of Array.from(tx.childNodes)) { if (n.nodeType === 3 && (n.textContent || "").trim().length > 1) { leaf = true; break } }
          if (!leaf) continue
          const r2 = (tx as HTMLElement).getBoundingClientRect()
          if (r2.width < 6 || r2.height < 6) continue
          const ox = Math.max(0, Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left))
          const oy = Math.max(0, Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top))
          const ov = ox * oy
          if (ov <= 0) continue
          const minA = Math.min(r1.width * r1.height, r2.width * r2.height)
          if (minA <= 0 || ov / minA < 0.4) continue
          const a = (it.textContent || "").trim().slice(0, 22) || "[bouton]"
          const b = (tx.textContent || "").trim().slice(0, 22)
          hits.push(a + " ⨯ " + b)
        }
      }
      return Array.from(new Set(hits))
    })
    .catch(() => [] as string[])
  return { count: res.length, examples: res.slice(0, 4) }
}

// key checks of a sub-page (contact / portfolio)
async function checkPage(page: Page, url: string, kind: "contact" | "portfolio"): Promise<PageCheck> {
  const pc: PageCheck = { url, kind, reachable: false, overflow: { at390: 0, at768: 0, at1280: 0 }, overlapDesktop: { count: 0, examples: [] }, overlapMobile: { count: 0, examples: [] }, brokenImages: [] }
  const resp = await page.goto(url, { waitUntil: "load", timeout: 25000 }).catch(() => null)
  pc.reachable = !!resp && resp.status() < 400
  if (!pc.reachable) return pc
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 800) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)) } window.scrollTo(0, 0) }).catch(() => {})
  await page.setViewportSize({ width: 1280, height: 900 }).catch(() => {})
  await page.waitForTimeout(250)
  pc.overlapDesktop = await overlapScan(page)
  pc.brokenImages = await brokenImageUrls(page)
  pc.overflow.at1280 = await overflowAt(page, 1280)
  pc.overflow.at768 = await overflowAt(page, 768)
  pc.overflow.at390 = await overflowAt(page, 390)
  pc.overlapMobile = await overlapScan(page)
  return pc
}

// Real PERF through the PageSpeed Insights API WITH a key (`PAGESPEED_KEY` in .env → no more 429).
// Best-effort: ~25s timeout; if it fails (no key, quota, network) → available:false (NEVER blocks the audit).
async function pageSpeed(url: string): Promise<Audit["perf"]> {
  const out: Audit["perf"] = { available: false, score: null, lcpMs: null, cls: null, source: "psi" }
  const key = process.env.PAGESPEED_KEY
  if (!key) return out
  try {
    const ctrl = new AbortController()
    const to = setTimeout(() => ctrl.abort(), 25000)
    const api = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?strategy=mobile&category=performance&url=${encodeURIComponent(url)}&key=${key}`
    const res = await fetch(api, { signal: ctrl.signal }).catch(() => null)
    clearTimeout(to)
    if (!res || !res.ok) return out
    const j: any = await res.json().catch(() => null)
    const lh = j?.lighthouseResult
    if (!lh) return out
    const s = lh.categories?.performance?.score
    out.score = typeof s === "number" ? Math.round(s * 100) : null
    const lcp = lh.audits?.["largest-contentful-paint"]?.numericValue
    const cls = lh.audits?.["cumulative-layout-shift"]?.numericValue
    out.lcpMs = typeof lcp === "number" ? Math.round(lcp) : null
    out.cls = typeof cls === "number" ? Number(cls.toFixed(3)) : null
    out.available = out.score !== null
  } catch {}
  return out
}

async function auditSite(url: string, id: string, currentYear: number): Promise<Audit> {
  const date = new Date().toISOString().slice(0, 10)
  // PageSpeed PERF IN PARALLEL with the Playwright run (saves time)
  const perfP = pageSpeed(url)

  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, userAgent: "Mozilla/5.0 (lws-audit)" })
  const page = await ctx.newPage()
  const jsErrors: string[] = []
  page.on("pageerror", (e) => jsErrors.push(String(e).slice(0, 140)))
  page.on("console", (m) => { if (m.type() === "error") jsErrors.push(m.text().slice(0, 140)) })

  const a: Audit = {
    date, url, finalUrl: url, reachable: false, https: url.startsWith("https"),
    loadMs: null,
    mobile: { overflowPx: 0, brokenMobile: false, hasViewportMeta: false, overflow768: 0, overflow1280: 0 },
    contact: { hasForm: false, hasTel: false, hasMailto: false, hasPhoneText: false, hasEmailText: false, hasContactLink: false },
    seo: { title: "", titleLen: 0, hasMetaDesc: false, h1Count: 0, imgCount: 0, imgNoAlt: 0, hasCanonical: false, jsonLdCount: 0, hasOgTitle: false, hasOgImage: false },
    strengths: { videos: 0, hasBooking: false, hasReviews: false, googleRating: null, reviewCount: null, copyrightYear: null, stale: false },
    buttons: { tested: 0, dead: [] },
    form: { present: false, status: "none" },
    overlap: { desktop: { count: 0, examples: [] }, mobile: { count: 0, examples: [] } },
    perf: { available: false, score: null, lcpMs: null, cls: null, source: "psi" },
    pages: [],
    screenshots: { desktop: null, mobile: null },
    links: { checked: 0, broken: [] },
    functional: { jsErrors: 0, jsErrorMessages: [], deadLinks: 0, brokenImages: 0, brokenImageUrls: [] },
    issues: [],
    clientIssues: [],
  }

  try {
    const t0 = Date.now()
    const resp = await page.goto(url, { waitUntil: "load", timeout: 30000 }).catch(() => null)
    a.reachable = !!resp
    a.loadMs = Date.now() - t0
    a.finalUrl = page.url()
    a.https = a.finalUrl.startsWith("https")

    if (a.reachable) {
      // triggers lazy-loading (testimonial videos / review widgets are often below the fold)
      await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 800) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 90)) } window.scrollTo(0, 0) }).catch(() => {})
      await page.waitForTimeout(300)

      // closes any cookie banner: otherwise it covers the CTAs (skewed clicks) and pollutes captures/overlaps
      await page.evaluate(() => {
        for (const s of ["#onetrust-accept-btn-handler", ".cc-allow", ".cookie-accept", ".js-accept-cookies", '[aria-label*="accept" i]']) { const el = document.querySelector(s) as HTMLElement | null; if (el) { el.click(); return } }
        const re = /^(tout accepter|j'accepte|accepter|accept all|ok, accept all|i accept|got it|d'accord|autoriser|accepter et fermer)$/i
        for (const b of Array.from(document.querySelectorAll("button,a"))) { const t = (b.textContent || "").trim(); if (t.length < 40 && re.test(t)) { (b as HTMLElement).click(); return } }
      }).catch(() => {})
      await page.waitForTimeout(500)

      // ---- SEO + contact + social proof + copyright + sub-pages (a single DOM pass) ----
      const dom = await page.evaluate(() => {
        const imgs = Array.from(document.images)
        const iframes = Array.from(document.querySelectorAll("iframe")).map((f) => (f as HTMLIFrameElement).src || "")
        const alinks = Array.from(document.querySelectorAll("a")).map((el) => ((el as HTMLAnchorElement).href || "") + " " + (el.textContent || ""))
        let hasReviews = /avis (google|clients|vérifiés|vérifiées)|google reviews|note de \d/i.test(document.body.innerText || "")
        let googleRating: string | null = null, reviewCount: number | null = null
        for (const s of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
          try {
            const j = JSON.parse(s.textContent || "null")
            for (const o of (Array.isArray(j) ? j : [j])) { const ar = o && o.aggregateRating; if (ar) { hasReviews = true; googleRating = String(ar.ratingValue ?? ""); reviewCount = Number(ar.reviewCount ?? ar.ratingCount ?? 0) || null } }
          } catch {}
        }
        // copyright year (footer first, else body)
        const footer = document.querySelector("footer")
        const src = (footer ? (footer as HTMLElement).innerText : document.body.innerText) || ""
        let copyrightYear: number | null = null
        const re = /(?:©|copyright|\(c\))\D{0,14}(20\d{2})/gi
        let m: RegExpExecArray | null
        while ((m = re.exec(src))) { const y = parseInt(m[1], 10); if (!copyrightYear || y > copyrightYear) copyrightYear = y }
        // candidate sub-pages (contact + past work/portfolio)
        let contactUrl = "", portfolioUrl = ""
        for (const el of Array.from(document.querySelectorAll("a[href]"))) {
          const href = (el as HTMLAnchorElement).href
          if (!href || !href.startsWith("http")) continue
          const t = ((el.textContent || "") + " " + href).toLowerCase()
          if (!contactUrl && /contact|nous-joindre|nous joindre|devis/.test(t)) contactUrl = href
          if (!portfolioUrl && /réalisation|realisation|portfolio|galerie|gallery|nos-chantiers|chantiers|nos-projets|references|référence/.test(t)) portfolioUrl = href
        }
        return {
          title: document.title || "",
          hasMetaDesc: !!document.querySelector('meta[name="description"]'),
          hasViewportMeta: !!document.querySelector('meta[name="viewport"]'),
          hasCanonical: !!document.querySelector('link[rel="canonical"]'),
          jsonLdCount: document.querySelectorAll('script[type="application/ld+json"]').length,
          hasOgTitle: !!document.querySelector('meta[property="og:title"]'),
          hasOgImage: !!document.querySelector('meta[property="og:image"]'),
          h1Count: document.querySelectorAll("h1").length,
          imgCount: imgs.length,
          imgNoAlt: imgs.filter((i) => !i.getAttribute("alt")).length,
          hasForm: !!document.querySelector("form"),
          hasTel: !!document.querySelector('a[href^="tel:"]'),
          hasMailto: !!document.querySelector('a[href^="mailto:"]'),
          hasPhoneText: /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{2,4}/.test((document.body.innerText || "").replace(/\d{4}-\d{2}-\d{2}/g, "")) && /(?:\+\d{1,3}|\b0[1-9]|\(?[2-9]\d{2}\)?[\s.-]?[2-9]\d{2}[\s.-]?\d{4})/.test(document.body.innerText || ""),
          hasEmailText: /[\w.+-]+@[\w-]+\.\w{2,}/.test(document.body.innerText || ""),
          hasContactLink: Array.from(document.querySelectorAll("a")).some((el) => /contact|devis|rendez|rdv/i.test((el.textContent || "") + " " + (el.getAttribute("href") || ""))),
          videos: iframes.filter((s) => /youtube|vimeo/i.test(s)).length + alinks.filter((s) => /youtube\.com\/watch|youtu\.be|vimeo\.com/i.test(s)).length,
          hasBooking: alinks.some((s) => /calendly|cal\.com|rendez-vous|rendezvous|réserver|reserver|prendre rdv|booking|doctolib|planity/i.test(s)),
          hasReviews, googleRating, reviewCount, copyrightYear, contactUrl, portfolioUrl,
          deadLinks: Array.from(document.querySelectorAll("a")).filter((el) => { const h = el.getAttribute("href"); return !h || !h.trim() || h === "#" || h.startsWith("javascript:") }).length,
          brokenImageUrls: Array.from(document.images).filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src || i.getAttribute("src") || "").filter((s) => s),
          links: Array.from(document.querySelectorAll("a[href]")).map((el) => (el as HTMLAnchorElement).href).filter((h) => h.startsWith("http")),
        }
      })
      a.seo = { title: dom.title, titleLen: dom.title.length, hasMetaDesc: dom.hasMetaDesc, h1Count: dom.h1Count, imgCount: dom.imgCount, imgNoAlt: dom.imgNoAlt, hasCanonical: dom.hasCanonical, jsonLdCount: dom.jsonLdCount, hasOgTitle: dom.hasOgTitle, hasOgImage: dom.hasOgImage }
      a.contact = { hasForm: dom.hasForm, hasTel: dom.hasTel, hasMailto: dom.hasMailto, hasPhoneText: dom.hasPhoneText, hasEmailText: dom.hasEmailText, hasContactLink: dom.hasContactLink }
      a.mobile.hasViewportMeta = dom.hasViewportMeta
      a.strengths = { videos: dom.videos, hasBooking: dom.hasBooking, hasReviews: dom.hasReviews, googleRating: dom.googleRating, reviewCount: dom.reviewCount, copyrightYear: dom.copyrightYear, stale: dom.copyrightYear != null && dom.copyrightYear < currentYear - 1 }
      const jsMsgs = [...new Set(jsErrors)].slice(0, 15)
      a.functional = { jsErrors: jsErrors.length, jsErrorMessages: jsMsgs, deadLinks: dom.deadLinks, brokenImages: dom.brokenImageUrls.length, brokenImageUrls: dom.brokenImageUrls }

      // ---- captures + deterministic VISUAL (before the interactions that mutate the page) ----
      const dir = `data/assets/${id}`
      await mkdir(dir, { recursive: true })
      await page.screenshot({ path: `${dir}/_audit-desktop.png`, fullPage: true }).catch(() => {})
      a.screenshots.desktop = `${dir}/_audit-desktop.png`

      // mobile 390: overflow + capture + mobile overlaps
      await page.setViewportSize({ width: 390, height: 844 })
      await page.waitForTimeout(400)
      a.mobile.overflowPx = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth)).catch(() => 0)
      a.mobile.brokenMobile = a.mobile.overflowPx > 50
      await page.screenshot({ path: `${dir}/_audit-mobile.png`, fullPage: false }).catch(() => {})
      a.screenshots.mobile = `${dir}/_audit-mobile.png`
      a.overlap.mobile = await overlapScan(page)
      // overflow at 768 and 1280 (on top of 390)
      a.mobile.overflow768 = await overflowAt(page, 768)
      a.mobile.overflow1280 = await overflowAt(page, 1280)
      // desktop overlaps (viewport back to 1280 through overflowAt)
      a.overlap.desktop = await overlapScan(page)

      const mainUrl = page.url()

      // ---- FUNCTIONAL: CLICK-CHECKING the buttons/CTAs ----
      // 1) lists the candidates (buttons/CTAs), with the metadata to SKIP (tel/mailto/external/download/_blank/invisible)
      const cand: Array<{ idx: number; txt: string; href: string; skip: boolean }> = await page
        .evaluate(() => {
          const acts = /voir|devis|contact|en savoir plus|découvrir|decouvrir|demander|réserver|reserver|nous joindre|prendre rdv|rendez|obtenir|commander|configurer|télécharger/i
          const els = Array.from(document.querySelectorAll("a,button"))
          const out: Array<{ idx: number; txt: string; href: string; skip: boolean }> = []
          let idx = -1
          for (const el of els) {
            const tag = el.tagName
            const cls = el.getAttribute("class") || ""
            const raw = (el.textContent || "").replace(/[^{}]*\{[^}]*\}/g, " ").replace(/\s+/g, " ").trim()
            const looks = tag === "BUTTON" || /btn|button|cta/i.test(cls) || (acts.test(raw) && raw.length < 40)
            if (!looks) continue
            idx++
            const label = ((el.getAttribute("aria-label") || el.getAttribute("title") || raw) || "").trim()
            const href = tag === "A" ? (el as HTMLAnchorElement).getAttribute("href") || "" : ""
            const target = el.getAttribute("target") || ""
            const download = el.hasAttribute("download")
            let external = false
            try { if (href && /^https?:/i.test(href)) external = new URL(href, location.href).origin !== location.origin } catch {}
            const st = getComputedStyle(el as HTMLElement)
            const visible = (el as HTMLElement).offsetParent !== null && st.visibility !== "hidden" && st.display !== "none"
            // we test (and blame) ONLY real content CTAs: no unlabelled button, no cookies/consent/GDPR
            const noLabel = label.length === 0
            const cookie = /cookie|consent|rgpd|gdpr|accepter|refuser|tout accepter|tout refuser|param[ée]tr|pr[ée]f[ée]rence|privacy|confidentialit/i.test(label)
            const skip = /^(tel:|mailto:|javascript:)/i.test(href) || download || target === "_blank" || external || !visible || noLabel || cookie
            out.push({ idx, txt: label.slice(0, 40), href, skip })
          }
          return out
        })
        .catch(() => [] as Array<{ idx: number; txt: string; href: string; skip: boolean }>)

      const testable = cand.filter((c) => !c.skip).slice(0, 12)
      for (const c of testable) {
        // back to the main page if a previous click navigated away
        if (page.url() !== mainUrl) { await page.goto(mainUrl, { waitUntil: "load", timeout: 25000 }).catch(() => null); await page.waitForTimeout(300) }
        // finds the idx-th candidate again (same filter), tags it, and takes a BEFORE signature
        const info = await page
          .evaluate((wantIdx: number) => {
            const acts = /voir|devis|contact|en savoir plus|découvrir|decouvrir|demander|réserver|reserver|nous joindre|prendre rdv|rendez|obtenir|commander|configurer|télécharger/i
            const els = Array.from(document.querySelectorAll("a,button"))
            let idx = -1
            let el: Element | null = null
            for (const e of els) {
              const tag = e.tagName
              const cls = e.getAttribute("class") || ""
              const raw = (e.textContent || "").replace(/[^{}]*\{[^}]*\}/g, " ").replace(/\s+/g, " ").trim()
              const looks = tag === "BUTTON" || /btn|button|cta/i.test(cls) || (acts.test(raw) && raw.length < 40)
              if (!looks) continue
              idx++
              if (idx === wantIdx) { el = e; break }
            }
            if (!el) return null
            document.querySelectorAll("[data-lws-t]").forEach((x) => x.removeAttribute("data-lws-t"))
            el.setAttribute("data-lws-t", "1")
            ;(el as HTMLElement).scrollIntoView({ block: "center" })
            const dialogs = document.querySelectorAll('[role="dialog"],[aria-modal="true"],.modal,.popup,.lightbox,.mfp-content').length
            return { sigLen: document.body.innerHTML.length, sigEl: document.querySelectorAll("*").length, dialogs, y: window.scrollY }
          }, c.idx)
          .catch(() => null)
        if (!info) continue
        const beforeUrl = page.url()
        // a click that FAILS (element covered/not clickable) is INCONCLUSIVE — we don't call it dead
        const clicked = await page.click('[data-lws-t="1"]', { timeout: 4000 }).then(() => true).catch(() => false)
        if (!clicked) continue
        a.buttons.tested++
        await page.waitForTimeout(900)
        const afterUrl = page.url()
        let changed = afterUrl !== beforeUrl
        if (!changed) {
          const post = await page
            .evaluate(() => ({ sigLen: document.body.innerHTML.length, sigEl: document.querySelectorAll("*").length, dialogs: document.querySelectorAll('[role="dialog"],[aria-modal="true"],.modal,.popup,.lightbox,.mfp-content').length, y: window.scrollY }))
            .catch(() => null)
          if (!post) changed = true // couldn't measure → don't blame
          else {
            const elDelta = Math.abs(post.sigEl - info.sigEl)
            const lenRatio = info.sigLen ? Math.abs(post.sigLen - info.sigLen) / info.sigLen : 0
            const modalOpened = post.dialogs > info.dialogs
            const scrolled = Math.abs(post.y - info.y) > 40
            changed = modalOpened || elDelta >= 4 || lenRatio > 0.03 || scrolled
          }
        }
        if (!changed) a.buttons.dead.push({ label: c.txt, href: c.href || "(no href)" })
      }

      // ---- FUNCTIONAL: testing the contact FORM (best-effort; CAREFUL: sends a real submission) ----
      if (page.url() !== mainUrl) { await page.goto(mainUrl, { waitUntil: "load", timeout: 25000 }).catch(() => null); await page.waitForTimeout(300) }
      const formInfo = await page
        .evaluate(() => {
          const forms = Array.from(document.querySelectorAll("form"))
          let target: HTMLFormElement | null = null
          for (const f of forms) { if (f.querySelector('textarea, input[type="email"], input[name*="mail" i], input[name*="message" i]')) { target = f as HTMLFormElement; break } }
          if (!target && forms.length) target = forms[0] as HTMLFormElement
          if (!target) return { found: false, filled: 0 }
          target.setAttribute("data-lws-form", "1")
          let filled = 0
          for (const el of Array.from(target.querySelectorAll("input, textarea, select"))) {
            const type = (el.getAttribute("type") || "").toLowerCase()
            if (["hidden", "submit", "button", "file", "checkbox", "radio", "image"].includes(type)) continue
            const key = ((el.getAttribute("name") || "") + " " + (el.getAttribute("id") || "") + " " + (el.getAttribute("placeholder") || "")).toLowerCase()
            if (el.tagName === "SELECT") { const opts = (el as HTMLSelectElement).querySelectorAll("option"); if (opts.length > 1) (el as HTMLSelectElement).selectedIndex = 1; filled++; continue }
            let val = "Test"
            if (type === "email" || /mail/.test(key)) val = "test@example.com"
            else if (type === "tel" || /phone|tel|téléphone|telephone|portable/.test(key)) val = "0600000000"
            else if (el.tagName === "TEXTAREA" || /message|projet|demande|détail|detail/.test(key)) val = "Bonjour, test de contact."
            else if (/nom|name|prénom|prenom/.test(key)) val = "Test"
            ;(el as HTMLInputElement).value = val
            el.dispatchEvent(new Event("input", { bubbles: true }))
            el.dispatchEvent(new Event("change", { bubbles: true }))
            filled++
          }
          return { found: true, filled }
        })
        .catch(() => ({ found: false, filled: 0 }))

      a.form.present = formInfo.found
      if (formInfo.found && !SUBMIT_FORM) {
        // DEFAULT: we do NOT submit (it would spam the prospect) → we only note its presence + the filling.
        a.form.status = formInfo.filled >= 2 ? "présent (non soumis)" : "présent, peu de champs (non soumis)"
      } else if (formInfo.found) {
        const beforeUrlF = page.url()
        const beforeTxt = ((await page.evaluate(() => document.body.innerText || "").catch(() => "")) as string).toLowerCase()
        const submit = page.locator('[data-lws-form="1"]').locator('button[type="submit"], input[type="submit"], button:not([type])').first()
        const hasSubmit = await submit.count().catch(() => 0)
        if (hasSubmit > 0) await submit.click({ timeout: 5000 }).catch(() => null)
        else await page.evaluate(() => { const f = document.querySelector('[data-lws-form="1"]') as HTMLFormElement | null; if (f) { if (f.requestSubmit) f.requestSubmit(); else f.submit() } }).catch(() => null)
        await page.waitForTimeout(2800)
        const afterUrlF = page.url()
        const afterTxt = ((await page.evaluate(() => document.body.innerText || "").catch(() => "")) as string).toLowerCase()
        if (afterUrlF !== beforeUrlF) a.form.status = "submitted"
        else if (/merci|envoyé|envoye|bien reçu|bien recu|nous vous recontact|message a (bien )?été|thank you|success|succès|reçu votre|recu votre/i.test(afterTxt) && !/merci|envoyé|thank you/i.test(beforeTxt)) a.form.status = "success"
        else if (/(erreur|invalide|obligatoire|requis|required|veuillez remplir|veuillez saisir)/i.test(afterTxt) && !/(erreur|invalide|obligatoire|requis|required)/i.test(beforeTxt)) a.form.status = "error"
        else a.form.status = "no-feedback"
      }

      // ---- FUNCTIONAL: ALL internal links (deduplicated, capped at 40) with HEAD → real 404s ----
      const origin = new URL(a.finalUrl).origin
      const internal = [...new Set(dom.links)].filter((h) => { try { return new URL(h).origin === origin } catch { return false } }).slice(0, 40)
      for (const href of internal) {
        let r = await ctx.request.head(href, { timeout: 12000, maxRedirects: 5 }).catch(() => null)
        if (r && (r.status() === 405 || r.status() === 501)) r = await ctx.request.get(href, { timeout: 12000, maxRedirects: 5 }).catch(() => null)
        a.links.checked++
        if (!r || r.status() >= 400) a.links.broken.push(href)
      }

      // ---- MULTI-PAGE: key checks on /contact + a past-work/portfolio page ----
      const subs: Array<{ url: string; kind: "contact" | "portfolio" }> = []
      if (dom.contactUrl && dom.contactUrl !== mainUrl) { try { if (new URL(dom.contactUrl).origin === origin) subs.push({ url: dom.contactUrl, kind: "contact" }) } catch {} }
      if (dom.portfolioUrl && dom.portfolioUrl !== mainUrl && dom.portfolioUrl !== dom.contactUrl) { try { if (new URL(dom.portfolioUrl).origin === origin) subs.push({ url: dom.portfolioUrl, kind: "portfolio" }) } catch {} }
      for (const s of subs.slice(0, 2)) { a.pages.push(await checkPage(page, s.url, s.kind)) }
    }
  } finally {
    await browser.close()
  }

  a.perf = await perfP.catch(() => a.perf)

  // ---- COMPLAINTS (French copy for the prospect) ----
  // `client` = a complaint a real visitor EXPERIENCES (usable in a complaint email); otherwise = invisible SEO
  // (H1/meta/title/canonical/JSON-LD/OG), useful to diagnose/composer but NEVER for a complaint (rings false).
  const push = (msg: string, client: boolean) => { a.issues.push(msg); if (client) a.clientIssues.push(msg) }

  if (!a.reachable) push("Le site ne répond pas / est inaccessible.", true)
  if (!a.https) push("Pas de HTTPS : le navigateur affiche « Non sécurisé », ça fait fuir et Google pénalise.", true)

  // verified FUNCTIONAL (FACT, not heuristic)
  if (a.buttons.tested > 0 && a.buttons.dead.length > 0)
    push(`${a.buttons.dead.length} bouton(s) sur ${a.buttons.tested} testé(s) ne déclenchent RIEN au clic (vérifié : ni changement de page, ni fenêtre, ni contenu) — ex : « ${a.buttons.dead[0].label} ».`, true)
  if (a.form.present) {
    if (a.form.status === "error") push("Le formulaire de contact renvoie une erreur à l'envoi (test effectué).", true)
    else if (a.form.status === "no-feedback") push("Le formulaire de contact ne donne aucune confirmation visible après l'envoi (à vérifier : le message part-il vraiment ?).", true)
  }
  // fallback: if no testable button was found, keep the old empty-href HEURISTIC (cautiously phrased)
  if (a.buttons.tested === 0 && a.functional.deadLinks >= 5) push("Plusieurs liens/boutons sans destination (href vide ou « # ») détectés — à confirmer en cliquant.", true)

  if (a.functional.brokenImages > 0) push(`${a.functional.brokenImages} image(s) ne se chargent pas (cassées) sur la page d'accueil.`, true)
  if (a.functional.jsErrors > 0) push(`${a.functional.jsErrors} erreur(s) JavaScript au chargement : des fonctions du site peuvent être cassées.`, true)

  // deterministic VISUAL
  if (a.overlap.desktop.count > 0 || a.overlap.mobile.count > 0) {
    const ex = a.overlap.desktop.examples[0] || a.overlap.mobile.examples[0] || ""
    push(`Des éléments se chevauchent (un bouton/lien recouvre du texte)${ex ? ` — ex : « ${ex} »` : ""} : rendu cassé, illisible par endroits.`, true)
  }
  if (a.mobile.brokenMobile) push(`Le site déborde horizontalement sur mobile (${a.mobile.overflowPx}px de scroll latéral à 390px) : pénible à lire au téléphone.`, true)
  if (a.mobile.overflow768 > 50) push(`Le site déborde aussi horizontalement sur tablette (${a.mobile.overflow768}px à 768px).`, true)
  if (a.mobile.overflow1280 > 50) push(`Le site déborde horizontalement même sur écran large (${a.mobile.overflow1280}px à 1280px) : mise en page cassée.`, true)
  if (!a.mobile.hasViewportMeta) push("Pas de balise viewport : le site n'est pas pensé pour le mobile (texte minuscule, zoom forcé).", true)

  // CONTACT
  const c = a.contact
  const anyDirect = c.hasTel || c.hasMailto || c.hasPhoneText || c.hasEmailText
  if (!anyDirect && !c.hasForm && !c.hasContactLink) push("Aucun moyen de contact visible (ni formulaire, ni téléphone, ni email, ni page contact) : le visiteur ne sait pas comment vous joindre.", true)
  else if (!anyDirect && !c.hasForm && c.hasContactLink) push("Pas de contact direct sur la page d'accueil : il faut aller chercher la page contact (friction).", true)
  else if (c.hasPhoneText && !c.hasTel) push("Le numéro de téléphone n'est pas cliquable : sur mobile, impossible d'appeler en un tap.", true)

  // TRUST
  if (a.strengths.stale && a.strengths.copyrightYear) push(`Le pied de page affiche « © ${a.strengths.copyrightYear} » : le site paraît à l'abandon / non mis à jour depuis ${currentYear - a.strengths.copyrightYear} an(s).`, true)

  // PERF (best-effort; only if PageSpeed answered)
  if (a.perf.available && a.perf.score !== null && a.perf.score < 50) push(`Score de performance mobile très bas (${a.perf.score}/100 selon Google PageSpeed) : le site est lent à charger sur téléphone.`, true)

  // invisible SEO (NEVER client)
  if (!a.seo.title || a.seo.titleLen < 10) push("Balise titre absente ou trop courte (mauvais pour le référencement Google).", false)
  if (!a.seo.hasMetaDesc) push("Pas de meta description : Google affiche un extrait au hasard sous votre lien.", false)
  if (a.seo.h1Count === 0) push("Aucun titre principal (H1) : Google ne comprend pas le sujet de la page.", false)
  if (!a.seo.hasCanonical) push("Pas d'URL canonique (balise canonical) : risque de contenu dupliqué aux yeux de Google.", false)
  if (a.seo.jsonLdCount === 0) push("Aucune donnée structurée (JSON-LD) : Google ne peut pas afficher d'infos enrichies (étoiles, horaires, adresse).", false)
  if (!a.seo.hasOgTitle || !a.seo.hasOgImage) push("Balises Open Graph incomplètes : les partages sur réseaux sociaux s'affichent sans aperçu propre.", false)

  // dead LINKS (real 404s, HEAD)
  if (a.links.broken.length) push(`${a.links.broken.length} lien(s) mort(s) (404) détecté(s) sur ${a.links.checked} lien(s) internes vérifiés (ex : ${a.links.broken[0]}).`, true)

  // MULTI-PAGE
  for (const pc of a.pages) {
    if (!pc.reachable) continue
    const label = pc.kind === "contact" ? "la page contact" : "la page réalisations/portfolio"
    if (pc.overlapDesktop.count > 0 || pc.overlapMobile.count > 0) push(`Sur ${label}, des éléments se chevauchent (rendu cassé).`, true)
    if (pc.overflow.at390 > 50) push(`Sur ${label}, débordement horizontal sur mobile (${pc.overflow.at390}px).`, true)
    if (pc.brokenImages.length > 0) push(`Sur ${label}, ${pc.brokenImages.length} image(s) ne se chargent pas.`, true)
  }

  return a
}

async function main() {
  try { process.loadEnvFile() } catch { /* .env missing or already loaded → perf best-effort */ }
  const id = process.argv.slice(2).find((x) => !x.startsWith("-"))
  if (!id) { console.error("usage: npm run audit -- <id>"); process.exit(1) }
  const fichePath = join(PROSPECTS, `${id}.json`)
  if (!existsSync(fichePath)) { console.error(`prospect sheet not found: ${fichePath}`); process.exit(1) }
  const fiche = JSON.parse(await readFile(fichePath, "utf8"))
  const url: string = fiche?.existing?.url
  if (!url) { console.error(`no URL (existing.url) in the prospect sheet ${id}`); process.exit(1) }

  console.log(`→ technical audit of ${url} …`)
  const t0 = Date.now()
  const audit = await auditSite(url, id, new Date().getFullYear())
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  fiche.audit = audit
  await writeFile(fichePath, JSON.stringify(fiche, null, 2))

  console.log(`✅ fiche.audit written (${fichePath}) — ${secs}s`)
  console.log(`   https ${audit.https} · dead buttons ${audit.buttons.dead.length}/${audit.buttons.tested} · form ${audit.form.status} · 404 links ${audit.links.broken.length}/${audit.links.checked}`)
  console.log(`   overlaps desktop ${audit.overlap.desktop.count} · mobile ${audit.overlap.mobile.count} · overflow 390/768/1280 ${audit.mobile.overflowPx}/${audit.mobile.overflow768}/${audit.mobile.overflow1280}px`)
  console.log(`   PageSpeed perf ${audit.perf.available ? `${audit.perf.score}/100 (LCP ${audit.perf.lcpMs}ms, CLS ${audit.perf.cls})` : "unavailable (best-effort)"} · copyright ${audit.strengths.copyrightYear ?? "?"}${audit.strengths.stale ? " (neglected)" : ""} · sub-pages ${audit.pages.length}`)
  console.log(`   strengths: ${audit.strengths.videos} video(s) · reviews ${audit.strengths.hasReviews}${audit.strengths.googleRating ? ` (${audit.strengths.googleRating}★)` : ""} · booking ${audit.strengths.hasBooking}`)

  // ---- PRECISE DETAIL (the real messages/URLs/labels, not just counters) ----
  if (audit.buttons.dead.length) {
    console.log(`\n   🖱️  DEAD BUTTONS (${audit.buttons.dead.length}/${audit.buttons.tested} tested) — clicked, no effect:`)
    for (const b of audit.buttons.dead) console.log(`      · "${b.label}"  →  ${b.href}`)
  }
  if (audit.functional.brokenImageUrls.length) {
    console.log(`\n   🖼️  BROKEN IMAGES (${audit.functional.brokenImageUrls.length}) on the home page:`)
    for (const u of audit.functional.brokenImageUrls) console.log(`      · ${u}`)
  }
  if (audit.functional.jsErrorMessages.length) {
    console.log(`\n   ⚠️  JAVASCRIPT ERRORS (${audit.functional.jsErrors}, ${audit.functional.jsErrorMessages.length} unique):`)
    for (const m of audit.functional.jsErrorMessages) console.log(`      · ${m}`)
  }
  if (audit.links.broken.length) {
    console.log(`\n   🔗  404 LINKS (${audit.links.broken.length}/${audit.links.checked} checked):`)
    for (const u of audit.links.broken) console.log(`      · ${u}`)
  }
  const ovAll = [...audit.overlap.desktop.examples.map((e) => "desktop: " + e), ...audit.overlap.mobile.examples.map((e) => "mobile: " + e)]
  if (ovAll.length) {
    console.log(`\n   🔲  OVERLAPS (desktop ${audit.overlap.desktop.count} · mobile ${audit.overlap.mobile.count}) — button ⨯ text pairs:`)
    for (const p of ovAll) console.log(`      · ${p}`)
  }
  for (const pc of audit.pages) {
    const bits: string[] = []
    if (pc.overlapDesktop.count || pc.overlapMobile.count) bits.push(`overlaps ${pc.overlapDesktop.count}/${pc.overlapMobile.count}`)
    if (pc.brokenImages.length) bits.push(`${pc.brokenImages.length} broken image(s)`)
    if (pc.overflow.at390 > 50) bits.push(`mobile overflow ${pc.overflow.at390}px`)
    if (bits.length) console.log(`\n   📄  ${pc.kind === "contact" ? "CONTACT PAGE" : "PAST-WORK PAGE"} (${pc.url}): ${bits.join(" · ")}`)
  }

  console.log(`\n   ${audit.issues.length} complaint(s) (${audit.clientIssues.length} a customer can see):`)
  for (const i of audit.issues) console.log("   · " + i)
}

main().catch((e) => { console.error(e); process.exit(1) })
