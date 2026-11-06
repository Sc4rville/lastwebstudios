/**
 * demo-video.ts — enregistre une VIDÉO DÉMO d'un site généré pour l'outreach.
 *
 * Playwright ouvre la page, injecte une barre de navigateur (mockup) + un CURSEUR synthétique, fait une
 * passe de HOVER rapide sur les éléments interactifs, puis SCROLLE doucement de haut en bas. → webm.
 * ffmpeg convertit en mp4 web. Upload dans le bucket Supabase → URL publique (à coller dans le mail).
 *
 * Usage : npx tsx design/scripts/demo-video.ts <id> <date> [target]
 *   target défaut : output/sites/<id>/<date>-composer/index.html (local), sinon l'URL bucket du site.
 * Sortie : output/sites/<id>/<date>-composer/demo.mp4  + (si storage) URL publique imprimée (DEMO_URL=…).
 */
import { chromium } from "playwright"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { resolve, join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { upload, urlFor, storageReady, exists as inBucket } from "../../packages/shared/storage.ts"

try { process.loadEnvFile() } catch { /* pas de .env → storage off, vidéo locale seulement */ }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const ff = (args: string[]) => new Promise<void>((res, rej) => {
  const p = spawn("ffmpeg", ["-y", ...args], { stdio: "ignore" })
  p.on("error", rej); p.on("close", (c) => (c === 0 ? res() : rej(new Error("ffmpeg " + c))))
})

export async function recordDemo(id: string, dateDir: string, target?: string): Promise<{ mp4: string; url: string | null }> {
  const siteDir = `output/sites/${id}/${dateDir}`
  const bucketKey = `sites/${id}/${dateDir}/demo.mp4`
  // déjà dans le bucket → réutilise (pas de ré-enregistrement à chaque outreach). DEMO_FORCE=1 régénère.
  if (storageReady() && process.env.DEMO_FORCE !== "1" && await inBucket(bucketKey)) return { mp4: join(siteDir, "demo.mp4"), url: urlFor(bucketKey) }
  const localIndex = join(siteDir, "index.html")
  const url = target
    || (existsSync(localIndex) ? "file://" + resolve(localIndex) : urlFor(`sites/${id}/${dateDir}/index.html`))
  const W = 1280, H = 800
  const vidDir = `/tmp/demo-${id}-${Date.now()}`
  mkdirSync(vidDir, { recursive: true })

  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] })
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: vidDir, size: { width: W, height: H } }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  await page.goto(url, { waitUntil: "load", timeout: 45000 }).catch(() => {})
  await page.waitForTimeout(1200)

  // mockup (barre navigateur) + curseur synthétique
  const host = (() => { try { return new URL(url.replace(/^file:.*/, "https://" + id)).host } catch { return id } })()
  await page.evaluate(({ host }) => {
    const bar = document.createElement("div")
    bar.style.cssText = "position:fixed;top:0;left:0;right:0;height:34px;z-index:2147483646;background:#1c1c20;display:flex;align-items:center;gap:8px;padding:0 12px;font:12px/1 ui-monospace,monospace;color:#a8a8b2;box-shadow:0 1px 0 rgba(255,255,255,.06)"
    bar.innerHTML = `<span style="display:flex;gap:6px"><i style="width:11px;height:11px;border-radius:50%;background:#ff5f57;display:inline-block"></i><i style="width:11px;height:11px;border-radius:50%;background:#febc2e;display:inline-block"></i><i style="width:11px;height:11px;border-radius:50%;background:#28c840;display:inline-block"></i></span><span style="flex:1;text-align:center;background:#0b0b0c;border-radius:7px;padding:5px 0;color:#c4c4cc">${host}</span>`
    document.documentElement.style.setProperty("scroll-behavior", "auto")
    document.body.style.paddingTop = "34px"
    document.body.appendChild(bar)
    const cur = document.createElement("div")
    cur.id = "__democursor"
    cur.style.cssText = "position:fixed;z-index:2147483647;width:22px;height:22px;left:0;top:0;pointer-events:none;transition:transform .35s cubic-bezier(.22,1,.36,1);will-change:transform"
    cur.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 3l5 16 2.5-6.5L19 10z" fill="#fff" stroke="#0b0b0c" stroke-width="1.5"/></svg>`
    document.body.appendChild(cur)
    ;(window as any).__cur = (x: number, y: number) => { cur.style.transform = `translate(${x}px,${y}px)` }
    ;(window as any).__cur(640, 300)
  }, { host }).catch(() => {})

  const moveCursor = async (x: number, y: number) => { await page.evaluate(([x, y]) => (window as any).__cur && (window as any).__cur(x, y), [x, y]); await page.mouse.move(x, y) }
  // smooth-scroll piloté côté Node (petits pas eased) → glissé FLUIDE, pas de saut, et pas de fonction
  // nommée envoyée au navigateur (évite le bug esbuild `__name is not defined`).
  const smoothScroll = async (to: number, dur = 1100) => {
    const from = await page.evaluate(() => window.scrollY)
    const steps = Math.max(14, Math.round(dur / 22))
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
      await page.evaluate((y) => window.scrollTo(0, y), Math.round(from + (to - from) * e))
      await page.waitForTimeout(Math.round(dur / steps))
    }
  }

  // 1) passe HOVER rapide sur quelques éléments interactifs (boutons, liens nav, cartes)
  const targets = await page.evaluate(() => {
    const els = [...document.querySelectorAll('a,button,[role="button"],.btn,.cta,nav a')] as HTMLElement[]
    const seen: { x: number; y: number }[] = []
    for (const el of els) {
      const r = el.getBoundingClientRect()
      if (r.width < 24 || r.height < 14 || r.top < 36 || r.top > window.innerHeight) continue
      seen.push({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) })
      if (seen.length >= 4) break
    }
    return seen
  }).catch(() => [])
  for (const t of targets) { await moveCursor(t.x, t.y); await page.waitForTimeout(650) }

  // 2) TOUR par SECTIONS : glisser (fluide, pas de saut) → s'arrêter → hover un élément → laisser LIRE
  const anchors = await page.evaluate(() => {
    const out: number[] = []
    const els = [...document.querySelectorAll('section, header, footer, [class*="section"], [class*="hero"], h2')] as HTMLElement[]
    for (const el of els) {
      const y = Math.round(el.getBoundingClientRect().top + window.scrollY)
      if (y > (out[out.length - 1] ?? -400) + 320) out.push(y)
    }
    return out.slice(0, 7)
  }).catch(() => [] as number[])

  for (const a of anchors) {
    await smoothScroll(Math.max(0, a - 70), 1100)        // glissé doux jusqu'à la section (fluide)
    await page.waitForTimeout(450)                       // se pose
    const hot = await page.evaluate(() => {              // un élément interactif visible dans la section
      const els = [...document.querySelectorAll('a,button,[role="button"],.btn,.cta,[class*="card"],nav a')] as HTMLElement[]
      for (const el of els) {
        const r = el.getBoundingClientRect()
        if (r.top > 70 && r.top < window.innerHeight - 70 && r.width > 36 && r.height > 18)
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
      }
      return null
    }).catch(() => null)
    if (hot) { await moveCursor(hot.x, hot.y); await page.waitForTimeout(800) } // hover : teste l'interaction
    await page.waitForTimeout(950)                        // laisser le temps de LIRE la section
  }
  await page.waitForTimeout(400)

  await ctx.close() // flush la vidéo
  const webm = await page.video()?.path()
  await browser.close()
  if (!webm) throw new Error("pas de vidéo enregistrée")

  const mp4 = join(siteDir, "demo.mp4")
  await ff(["-i", webm, "-vf", "scale=1280:-2,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-movflags", "+faststart", mp4])
  try { rmSync(vidDir, { recursive: true, force: true }) } catch { /* */ }

  let publicUrl: string | null = null
  if (storageReady()) publicUrl = await upload(mp4, `sites/${id}/${dateDir}/demo.mp4`)
  return { mp4, url: publicUrl }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , id, date, target] = process.argv
  if (!id || !date) { console.error("usage: npx tsx design/scripts/demo-video.ts <id> <dateDir ex 2026-06-17-composer> [target]"); process.exit(1) }
  recordDemo(id, date, target).then(({ mp4, url }) => {
    console.log(`✓ demo : ${mp4}`)
    if (url) console.log(`DEMO_URL=${url}`); else console.log("(storage off → vidéo locale seulement)")
  }).catch((e) => { console.error("✗ demo-video:", e.message); process.exit(1) })
}
