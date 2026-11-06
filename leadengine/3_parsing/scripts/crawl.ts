/**
 * Crawl (3_parsing) — mécanique, pas de LLM. Aspiration PROFONDE d'un site entier.
 *
 * Là où `parse.ts` ne lit QUE la page d'entrée (la home), `crawl.ts` suit les liens
 * internes (réalisations / produits / matériaux / galeries…) et ramasse TOUT le contenu
 * texte + TOUTES les photos du site, dé-dupées (les variantes responsives WordPress
 * `-1024x768` sont fusionnées → on garde la plus grande de chaque photo).
 *
 * Sortie dans un dossier libre (≠ data/, c'est un livrable autonome) :
 *   <outDir>/photos/            toutes les photos téléchargées
 *   <outDir>/<slug>-photos.zip  les mêmes photos zippées (livrable)
 *   <outDir>/content.md         tout le texte, page par page (lisible)
 *   <outDir>/manifest.json      pages visitées + photos (src/alt/dims/page d'origine)
 *
 * Export : crawlSite(startUrl, outDir, opts)   CLI : npm run crawl -- <url> [outDir]
 */
import { chromium, type Page } from "playwright"
import { mkdir, writeFile, readFile } from "node:fs/promises"
import { join, basename } from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"
import { readHtml } from "../../1_scraping/scripts/util.ts"

const MIN_PX = 200 // ignore les images plus petites (icônes, puces…) quand la taille est connue
const MAX_PAGES = 80 // garde-fou : on ne crawle pas un site infini

// Pages qui valent le détour sur un site d'artisan/cuisiniste (priorité de file)
const PRIORITY =
  /(r[eé]alisation|cuisine|produit|mat[eé]riau|gamme|mod[eè]le|collection|am[eé]nagement|dressing|[eé]lectrom[eé]nager|galerie|gallery|projet|r[eé]f[eé]rence|catalogue|nos-|portfolio|salle-de-bain|rangement|plan-de-travail|showroom|inspiration)/i
// Liens à ne jamais suivre (bruit WordPress + non-contenu)
const SKIP =
  /(wp-admin|wp-login|\/feed|\/tag\/|\/author\/|\/category\/page|\/panier|\/cart|\/mon-compte|\/checkout|\/wp-json|wp-content\/(plugins|themes|uploads)|[?&]p=\d|#|\.(pdf|zip|docx?|xlsx?|mp4|webm|mov|css|js|json|xml|woff2?|ttf|eot)(\?|$))/i

const PAGE_DELAY = 700 // pause entre deux pages : on reste poli (sinon le serveur répond 429)
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** goto avec retry sur 429 (back-off) — le serveur throttle vite si on tape trop. */
async function gotoRetry(page: Page, url: string) {
  for (let i = 0; i < 4; i++) {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => null)
    if (resp?.status() !== 429) return resp
    await sleep(2000 * (i + 1))
  }
  return null
}

/** fetch du HTML serveur avec retry sur 429. */
async function fetchHtml(u: string): Promise<string> {
  for (let i = 0; i < 4; i++) {
    const res = await fetch(u).catch(() => null)
    if (res && res.status === 429) { await sleep(2000 * (i + 1)); continue }
    return res ? await readHtml(res) : ""
  }
  return ""
}

/** download d'un binaire avec retry sur 429. */
async function fetchBin(u: string): Promise<ArrayBuffer | null> {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(u).catch(() => null)
    if (res && res.status === 429) { await sleep(1500 * (i + 1)); continue }
    if (!res || !res.ok) return null
    return await res.arrayBuffer()
  }
  return null
}

type MediaPhoto = { file: string; src: string; alt: string; w: number; h: number; page: string; logo: boolean }

/**
 * BIBLIOTHÈQUE MÉDIA WORDPRESS — la source COMPLÈTE des photos. Le crawl de pages ne voit que les
 * images POSÉES sur les pages visitées ; l'API REST WP (`/wp-json/wp/v2/media`) liste TOUTE la
 * médiathèque (originaux pleine résolution), bien au-delà. On range par mois d'upload (`YYYY-MM/`).
 * Renvoie null si le site n'est pas WordPress / l'API est fermée → on retombe sur le crawl de pages.
 */
async function harvestWpMedia(base: string, photosDir: string): Promise<MediaPhoto[] | null> {
  const probe = await fetch(`${base}/wp-json/wp/v2/media?media_type=image&per_page=1`).catch(() => null)
  if (!probe || !probe.ok) return null
  const total = parseInt(probe.headers.get("x-wp-total") || "0", 10)
  if (!total) return null

  // RÉSUMABLE : on relit le manifest existant → on saute ce qui est déjà téléchargé, on ne tire que le
  // manquant (un re-run `media` comble les trous laissés par un 429 sans tout re-télécharger).
  const out: MediaPhoto[] = []
  const have = new Set<string>()
  const perDir = new Map<string, number>()
  const madeDirs = new Set<string>()
  try {
    const prev = JSON.parse(await readFile(join(photosDir, "..", "manifest.json"), "utf8"))
    for (const p of prev.photos || []) {
      if (p.page !== "wp-media-library") continue
      out.push(p); have.add(p.src)
      const s = String(p.file).split("/")[0]
      perDir.set(s, (perDir.get(s) || 0) + 1); madeDirs.add(s)
    }
  } catch { /* pas de manifest préalable : run neuf */ }
  console.log(`  → médiathèque WordPress : ${total} images (${have.size} déjà là, on tire le manquant)`)

  const per = 100
  const pages = Math.ceil(total / per)
  for (let pg = 1; pg <= pages; pg++) {
    let arr: any[] = []
    for (let i = 0; i < 4; i++) {
      const res = await fetch(`${base}/wp-json/wp/v2/media?media_type=image&per_page=${per}&page=${pg}&_fields=source_url,alt_text,media_details`).catch(() => null)
      if (res && res.status === 429) { await sleep(2000 * (i + 1)); continue }
      if (res && res.ok) { arr = await res.json().catch(() => []) }
      break
    }
    for (const m of arr) {
      const src: string = m?.source_url
      if (!src || /\.(svg)(\?|$)/i.test(src) || have.has(src)) continue
      have.add(src)
      const dm = src.match(/\/uploads\/(\d{4})\/(\d{2})\//)
      const slug = dm ? `${dm[1]}-${dm[2]}` : "autres"
      const ext = (src.split(".").pop() || "jpg").split("?")[0].slice(0, 4).toLowerCase()
      const safeExt = /^(jpg|jpeg|png|webp|gif|avif)$/.test(ext) ? ext : "jpg"
      const buf = await fetchBin(src)
      if (!buf) continue
      if (!madeDirs.has(slug)) { await mkdir(join(photosDir, slug), { recursive: true }); madeDirs.add(slug) }
      const n = (perDir.get(slug) || 0) + 1; perDir.set(slug, n)
      const file = `${slug}/photo-${String(n).padStart(4, "0")}.${safeExt}`
      await writeFile(join(photosDir, file), Buffer.from(buf))
      const d = m?.media_details || {}
      out.push({ file, src, alt: m?.alt_text || "", w: d.width || 0, h: d.height || 0, page: "wp-media-library", logo: /logo/i.test(src) })
      await sleep(40) // poli : on ne veut pas se faire 429 et RATER des photos
    }
    console.log(`  média ${out.length}/${total}`)
    await sleep(120)
  }
  return out
}

// scrolle toute la page pour déclencher les images en lazy-load
async function autoScroll(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let total = 0
      const timer = setInterval(() => {
        window.scrollBy(0, 500)
        total += 500
        if (total >= document.body.scrollHeight) {
          clearInterval(timer)
          resolve()
        }
      }, 80)
    })
    window.scrollTo(0, 0)
  })
}

type Img = { src: string; w: number; h: number; alt: string; page: string }
type PageContent = { url: string; title: string; text: string }

/** Ramène d'UNE page : titre, texte propre, images (img+srcset+bg), liens internes same-host. */
async function scrapePage(page: Page, url: string, host: string) {
  const resp = await gotoRetry(page, url)
  const status = resp?.status() ?? 0
  await autoScroll(page)
  await page.waitForTimeout(1200)
  const title = await page.title()
  const text = await page.evaluate(() => {
    document.querySelectorAll("script,style,noscript,svg").forEach((el) => el.remove())
    const main = document.querySelector("main") || document.body
    return (main as HTMLElement).innerText.replace(/\n{3,}/g, "\n\n").trim()
  })
  const { imgs, links } = await page.evaluate(() => {
    // NB : pas de fonction nommée ici (esbuild/tsx injecterait `__name`, absent du navigateur).
    const IMG_EXT = /\.(jpe?g|png|webp|gif|svg|avif)(\?|$)/i
    const raw: { src: string; w: number; h: number; alt: string }[] = []
    // 1) <img> — currentSrc/src ET les attributs LAZY (WP Rocket & co planquent l'URL réelle ici)
    for (const img of Array.from(document.querySelectorAll("img"))) {
      const cands = [
        img.currentSrc, img.src,
        img.getAttribute("data-src"), img.getAttribute("data-lazy-src"),
        img.getAttribute("data-lazy"), img.getAttribute("data-original"),
      ]
      for (const c of cands) {
        if (!c) continue
        try { raw.push({ src: new URL(c, location.href).href, w: img.naturalWidth, h: img.naturalHeight, alt: img.alt || "" }) } catch { /* src illisible */ }
      }
    }
    // 2) srcset + data-srcset (picture/source + img) — la plus grande source listée
    for (const s of Array.from(document.querySelectorAll("picture source[srcset], source[data-srcset], img[srcset], img[data-srcset]"))) {
      const ss = s.getAttribute("srcset") || s.getAttribute("data-srcset") || ""
      const cand = ss.split(",").map((x) => x.trim().split(/\s+/)[0]).filter(Boolean)
      if (!cand.length) continue
      try { raw.push({ src: new URL(cand[cand.length - 1], location.href).href, w: 0, h: 0, alt: "" }) } catch { /* srcset illisible */ }
    }
    // 3) background-image CSS + data-bg/data-background (héros, galeries, sliders lazy)
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const r = el.getBoundingClientRect()
      const bg = getComputedStyle(el).backgroundImage
      const dataBg = el.getAttribute("data-bg") || el.getAttribute("data-background") || el.getAttribute("data-background-image") || ""
      const blobs = [bg, dataBg].filter((x) => x && x !== "none")
      for (const blob of blobs) {
        const matches = blob.includes("url(") ? (blob.match(/url\((['"]?)(.*?)\1\)/g) || []) : [blob]
        for (const u of matches) {
          let src = u.replace(/^url\((['"]?)/, "").replace(/(['"]?)\)$/, "")
          try { src = new URL(src, location.href).href } catch { src = "" }
          raw.push({ src, w: Math.round(r.width), h: Math.round(r.height), alt: el.getAttribute("aria-label") || "" })
        }
      }
    }
    // 4) liens internes : ceux qui pointent une IMAGE = asset plein format (lightbox/attachment),
    //    les autres = pages à crawler
    const links: string[] = []
    for (const a of Array.from(document.querySelectorAll("a[href]"))) {
      try {
        const u = new URL(a.getAttribute("href") || "", location.href)
        if (u.origin !== location.origin) continue
        const clean = u.href.split("#")[0]
        if (IMG_EXT.test(u.pathname)) raw.push({ src: clean, w: 0, h: 0, alt: (a.textContent || "").trim() })
        else links.push(clean)
      } catch { /* href non navigable */ }
    }
    // dé-dup par URL + drop des data:
    const seen = new Set<string>()
    const imgs: { src: string; w: number; h: number; alt: string }[] = []
    for (const c of raw) {
      if (c.src && !c.src.startsWith("data:") && !seen.has(c.src)) { seen.add(c.src); imgs.push(c) }
    }
    return { imgs, links }
  })

  // FILET HTML BRUT : les galeries WordPress planquent les vraies photos dans <noscript> (inerte quand
  // le JS tourne) ou les injectent/retirent en JS → le DOM rendu est instable (le scroll lazy efface
  // même les <noscript>). On regrep donc le HTML SERVEUR via un fetch direct (déterministe, contient
  // tout), pour toute image du MÊME host, en excluant le chrome thème/plugin. Le dé-dup -WxH garde l'originale.
  const fromHtml: Img[] = []
  const fromHtmlLinks: string[] = []
  try {
    const html = await fetchHtml(url)
    const exclude = /\/(themes|plugins|wp-includes|wp-admin|cdn-cgi)\/|favicon|sprite|emoji|\/icons?\//i
    const IMG_EXT = /\.(jpe?g|png|webp|gif|svg|avif)(\?|$)/i
    // images du HTML serveur (galeries noscript/inline)
    const matches = html.match(/(?:https?:)?\/\/[^"'()\s]+?\.(?:jpe?g|png|webp|avif)|\/[^"'()\s]+?\.(?:jpe?g|png|webp|avif)/gi) || []
    const seen = new Set<string>()
    for (const m of matches) {
      let abs = ""
      try { abs = new URL(m, url).href } catch { continue }
      let h = ""; try { h = new URL(abs).host } catch { continue }
      if (h !== host || exclude.test(abs) || seen.has(abs)) continue
      seen.add(abs)
      fromHtml.push({ src: abs, w: 0, h: 0, alt: "", page: url })
    }
    // liens de PAGE du HTML serveur (découverte déterministe : la nav/blog charge ses liens en JS,
    // le DOM rendu en rate ; le HTML serveur les a tous). Le BFS dé-duplique et applique SKIP.
    for (const m of html.match(/href=["']([^"'#]+)["']/gi) || []) {
      const href = m.replace(/^href=["']/i, "").replace(/["']$/, "")
      try {
        const u = new URL(href, url)
        if (u.host === host && !IMG_EXT.test(u.pathname)) fromHtmlLinks.push(u.href.split("#")[0])
      } catch { /* href non navigable */ }
    }
  } catch { /* fetch serveur indispo : on garde le DOM seul */ }

  return {
    title,
    text,
    status,
    imgs: [...imgs.map((i) => ({ ...i, page: url })), ...fromHtml] as Img[],
    links: [...links, ...fromHtmlLinks].filter((l) => { try { return new URL(l).host === host } catch { return false } }),
  }
}

/** Variantes responsives WordPress : `photo-1024x768.jpg` → clé `photo.jpg` (on garde la plus grande). */
function baseKey(src: string): string {
  try {
    const u = new URL(src)
    return (u.origin + u.pathname).replace(/-\d+x\d+(?=\.\w+$)/i, "")
  } catch {
    return src
  }
}

/** Nom de sous-dossier "bien rangé" depuis la page source : dernier segment d'URL (home si racine). */
function pageSlug(u: string): string {
  try {
    const p = new URL(u).pathname.replace(/\/+$/, "")
    const seg = p.split("/").filter(Boolean).pop() || "home"
    return seg.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "home"
  } catch {
    return "home"
  }
}

export async function crawlSite(startUrl: string, outDir: string, opts: { maxPages?: number; mediaOnly?: boolean } = {}) {
  const maxPages = opts.maxPages ?? MAX_PAGES
  const host = new URL(startUrl).host
  const base = new URL(startUrl).origin
  const photosDir = join(outDir, "photos")
  await mkdir(photosDir, { recursive: true })

  const visited: PageContent[] = []
  const allImgs: Img[] = []

  // 1) CONTENU : crawl des pages (texte + images posées). Sauté en mode mediaOnly.
  if (!opts.mediaOnly) {
    const browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const queued = new Set<string>([startUrl.split("#")[0]])
    const queue: string[] = [startUrl.split("#")[0]]
    let attempts = 0
    while (queue.length && visited.length < maxPages && attempts < maxPages * 2) {
      attempts++
      // priorise les pages "contenu" (réalisations/produits/galeries) avant le reste
      queue.sort((a, b) => Number(PRIORITY.test(b)) - Number(PRIORITY.test(a)))
      const url = queue.shift()!
      try {
        const { title, text, status, imgs, links } = await scrapePage(page, url, host)
        // page throttlée/en erreur (429/5xx) : on ne compte pas son texte d'erreur comme contenu,
        // mais le HTML serveur (fetchHtml, retried) a pu ramener images + liens → on les garde.
        const errored = status === 429 || status >= 400 || /^HTTP \d/.test(title)
        if (!errored) { visited.push({ url, title, text }); }
        allImgs.push(...imgs)
        console.log(`  ${errored ? "⚠" : "✓"} ${visited.length}/${maxPages} ${url}  (${imgs.length} img)${errored ? ` [${status || "err"}]` : ""}`)
        for (const l of links) {
          if (queued.has(l) || SKIP.test(l)) continue
          queued.add(l)
          queue.push(l)
        }
      } catch (e) {
        console.log(`  ✗ ${url}  (${(e as Error).message.split("\n")[0]})`)
      }
      await sleep(PAGE_DELAY)
    }
    await browser.close()
  }

  // 2) PHOTOS : la médiathèque WordPress (COMPLÈTE) si dispo ; sinon les images posées sur les pages.
  const isLogo = (i: Img) => /logo/i.test(i.src) || /logo/i.test(i.alt)
  let manifestPhotos: MediaPhoto[] = []
  const wp = await harvestWpMedia(base, photosDir)
  if (wp && wp.length) {
    manifestPhotos = wp
  } else {
    // dé-dup des photos de pages : une entrée par photo réelle, on garde la plus grande variante connue
    const best = new Map<string, Img>()
    for (const im of allImgs) {
      const k = baseKey(im.src)
      const cur = best.get(k)
      if (!cur) { best.set(k, im); continue }
      const area = im.w * im.h, curArea = cur.w * cur.h
      if (area > curArea || (curArea === 0 && !/-\d+x\d+\.\w+$/i.test(im.src))) best.set(k, im)
    }
    const keep = [...best.values()].filter((i) => (i.w === 0 && i.h === 0) || (i.w >= MIN_PX && i.h >= MIN_PX))
    // BIEN RANGÉ : un sous-dossier par page source (réalisations / kappa / cuisines…), compteur par dossier.
    const perDir = new Map<string, number>()
    const madeDirs = new Set<string>()
    for (const im of keep) {
      try {
        const buf = await fetchBin(im.src)
        if (!buf) continue
        const ext = (new URL(im.src).pathname.split(".").pop() || "jpg").split("?")[0].slice(0, 4).toLowerCase()
        const safeExt = /^(jpg|jpeg|png|webp|gif|svg|avif)$/.test(ext) ? ext : "jpg"
        const slug = isLogo(im) ? "_logos" : pageSlug(im.page)
        if (!madeDirs.has(slug)) { await mkdir(join(photosDir, slug), { recursive: true }); madeDirs.add(slug) }
        const n = (perDir.get(slug) || 0) + 1; perDir.set(slug, n)
        const file = `${slug}/${isLogo(im) ? "logo" : "photo"}-${String(n).padStart(3, "0")}.${safeExt}`
        await writeFile(join(photosDir, file), Buffer.from(buf))
        manifestPhotos.push({ file, src: im.src, alt: im.alt, w: im.w, h: im.h, page: im.page, logo: isLogo(im) })
      } catch { /* download échoué : on saute */ }
    }
  }

  // 3) content.md/json (sauf mediaOnly où on préserve l'existant) + manifest.json
  if (!opts.mediaOnly) {
    const md =
      `# ${host} — contenu complet (${visited.length} pages)\n\n` +
      visited.map((p) => `## ${p.title || "(sans titre)"}\n${p.url}\n\n${p.text}\n`).join("\n---\n\n")
    await writeFile(join(outDir, "content.md"), md)
    await writeFile(join(outDir, "content.json"), JSON.stringify({ start: startUrl, host, pages: visited }, null, 2))
  }
  await writeFile(
    join(outDir, "manifest.json"),
    JSON.stringify({ start: startUrl, host, pagesVisited: visited.length, photos: manifestPhotos }, null, 2),
  )

  // zip des photos (livrable) — on PRÉSERVE l'arborescence par page (photos/<slug>/…)
  const slug = host.replace(/^www\./, "").replace(/\./g, "-")
  const zipPath = join(outDir, `${slug}-photos.zip`)
  try {
    execSync(`zip -q -r "${slug}-photos.zip" photos`, { cwd: outDir, stdio: "ignore" })
  } catch {
    console.log("  ⚠ zip indisponible — photos en clair seulement")
  }

  return { pages: visited.length, photos: manifestPhotos.length, outDir, zip: basename(zipPath) }
}

// --- CLI ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const mediaOnly = argv.includes("media") || argv.includes("--media")
  const [url, outDir] = argv.filter((a) => a !== "media" && a !== "--media")
  if (!url) {
    console.error("usage: npm run crawl -- <url> [outDir] [media]   (media = médiathèque WP seule, sans re-crawler les pages)")
    process.exit(1)
  }
  const host = (() => { try { return new URL(url).host.replace(/^www\./, "").replace(/\./g, "-") } catch { return "site" } })()
  const out = outDir || join("closing", host)
  console.log(`→ ${mediaOnly ? "MÉDIATHÈQUE WP" : "crawl PROFOND"} ${url} → ${out}`)
  const r = await crawlSite(url, out, { mediaOnly })
  console.log(`✓ ${r.pages} pages · ${r.photos} photos → ${r.outDir}/  (+ ${r.zip})`)
}
