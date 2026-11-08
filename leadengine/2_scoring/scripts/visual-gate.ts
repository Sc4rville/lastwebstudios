/**
 * Visual gate (2_scoring) — scoring's NEED axis. Screenshot + LLM, medium cost.
 *
 * Captures the site (Playwright: top of the page + middle of the page), then has the
 * `visual-scoring-gate` skill judge its visual quality → need /100 + reasons.
 * Called by score.ts ONLY on the prospects the free gate turns down:
 * a technically fine site can still be ugly — that's the one we catch here.
 *
 * Export: visualGate(id, url)     CLI usage: npm run gate -- <id> <url>
 */
import { chromium } from "playwright"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { runSkill } from "../../../packages/utils/run-skill.ts"

export type VisualVerdict = { besoin: number; reasons: string[]; shots: string[] }

// The judge's output budget: the 5.5 models think (adaptive thinking, tokens counted in
// max_tokens). At 1024 the JSON could be truncated → parseJson threw and the prospect was lost. 8192 leaves
// room for the thinking AND the verdict (a few dozen tokens), at no cost as long as the model doesn't use it.
export const GATE_MAX_TOKENS = 8192

// closes cookie banners/modals (otherwise they hide everything and the judge guesses instead of seeing)
async function dismissOverlays(page: import("playwright").Page) {
  const known = [
    "#onetrust-accept-btn-handler", ".cky-btn-accept", "#didomi-notice-agree-button",
    "#axeptio_btn_acceptAll", ".cc-allow", "#tarteaucitronPersonalize2", ".fc-cta-consent",
  ]
  for (const sel of known) {
    if (await page.locator(sel).first().click({ timeout: 400 }).then(() => true, () => false)) break
  }
  await page.evaluate(() => {
    const rx = /^(tout accepter|accepter( les cookies| et fermer| tout)?|j'?accepte|d'accord|accept( all| cookies)?(\s|$)|allow all|i agree|agree|ok(ay)?|got it|compris)\s*!?$/i
    const els = Array.from(document.querySelectorAll("button,[role=button],a")) as HTMLElement[]
    els.find((e) => rx.test((e.innerText || "").trim()) && e.offsetParent !== null)?.click()
  }).catch(() => {})
  await page.waitForTimeout(800)
}

async function capture(id: string, url: string, patient: boolean): Promise<string[]> {
  const dir = join("data", "assets", id)
  await mkdir(dir, { recursive: true })
  const shots: string[] = []

  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(url, { waitUntil: patient ? "networkidle" : "domcontentloaded", timeout: 60_000 })
    await page.waitForTimeout(patient ? 6000 : 2500) // lets preloaders/entrance animations settle
    await dismissOverlays(page)
    if (patient) {
      // some sites show nothing before a first scroll (JS reveals)
      await page.evaluate(() => window.scrollBy(0, 400))
      await page.waitForTimeout(1500)
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(800)
    }

    const top = join(dir, "gate-top.png")
    await page.screenshot({ path: top })
    shots.push(top)

    // a 2nd look in the middle of the page (the hero alone can lie)
    const height = await page.evaluate(() => document.body.scrollHeight)
    if (height > 1800) {
      await page.evaluate((h) => window.scrollTo(0, h / 2), height)
      await page.waitForTimeout(1200)
      const mid = join(dir, "gate-mid.png")
      await page.screenshot({ path: mid })
      shots.push(mid)
    }
  } finally {
    await browser.close()
  }
  return shots
}

export async function visualGate(id: string, url: string): Promise<VisualVerdict> {
  let shots = await capture(id, url, false)
  let out = await runSkill(".claude/skills/visual-scoring-gate", { url }, "judge", GATE_MAX_TOKENS, shots)

  // unusable captures (cookie wall, preloader, blank page) → RE-CAPTURE patiently
  if (out.unusable) {
    shots = await capture(id, url, true)
    out = await runSkill(".claude/skills/visual-scoring-gate", { url }, "judge", GATE_MAX_TOKENS, shots)
  }
  // still nothing to judge → keep the prospect warm: a human will decide;
  // better a parse for nothing than a real prospect dropped on a misleading capture
  if (out.unusable) {
    return { besoin: 30, reasons: ["captures inexploitables (cookie wall / preloader) — à juger à la main"], shots }
  }

  const besoin = Math.max(0, Math.min(100, Math.round(Number(out.besoin) || 0)))
  const reasons: string[] = Array.isArray(out.reasons) ? out.reasons.map(String) : []
  return { besoin, reasons, shots }
}

// --- CLI ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [id, url] = process.argv.slice(2)
  if (!id || !url) {
    console.error("usage: npm run gate -- <id> <url>")
    process.exit(1)
  }
  const v = await visualGate(id, url)
  console.log(`visual need ${id}: ${v.besoin}/100`)
  for (const r of v.reasons) console.log("  - " + r)
}
