/**
 * Visual gate (2_scoring) — l'axe BESOIN du scoring. Screenshot + LLM, coût moyen.
 *
 * Capture le site (Playwright : haut de page + milieu de page) puis fait juger
 * la qualité visuelle par le skill `visual-scoring-gate` → besoin /100 + raisons.
 * Appelé par score.ts UNIQUEMENT sur les prospects que la porte gratuite recale :
 * un site techniquement correct peut rester moche — c'est lui qu'on rattrape ici.
 *
 * Export : visualGate(id, url)     Usage CLI : npm run gate -- <id> <url>
 */
import { chromium } from "playwright"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { runSkill } from "../../../packages/utils/run-skill.ts"

export type VisualVerdict = { besoin: number; reasons: string[]; shots: string[] }

// Budget de sortie du juge : les modèles 5.5 réfléchissent (réflexion adaptative, jetons comptés dans
// max_tokens). À 1024 le JSON pouvait être tronqué → parseJson levait et le prospect tombait. 8192 laisse la
// place à la réflexion ET au verdict (quelques dizaines de jetons), sans coût tant que le modèle ne s'en sert pas.
export const GATE_MAX_TOKENS = 8192

// ferme les bandeaux/modales cookies (sinon ils masquent tout et le juge devine au lieu de voir)
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
    await page.waitForTimeout(patient ? 6000 : 2500) // laisse retomber preloaders/animations d'entrée
    await dismissOverlays(page)
    if (patient) {
      // certains sites n'affichent rien avant un premier scroll (reveals JS)
      await page.evaluate(() => window.scrollBy(0, 400))
      await page.waitForTimeout(1500)
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(800)
    }

    const top = join(dir, "gate-top.png")
    await page.screenshot({ path: top })
    shots.push(top)

    // un 2e regard au milieu de la page (le héros seul peut mentir)
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

  // captures inexploitables (cookie wall, preloader, page blanche) → on RE-CAPTURE patiemment
  if (out.unusable) {
    shots = await capture(id, url, true)
    out = await runSkill(".claude/skills/visual-scoring-gate", { url }, "judge", GATE_MAX_TOKENS, shots)
  }
  // toujours rien de jugeable → on garde le prospect en warm : un humain tranchera,
  // mieux vaut un parse pour rien qu'un vrai prospect jeté sur une capture mensongère
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
  console.log(`besoin visuel ${id} : ${v.besoin}/100`)
  for (const r of v.reasons) console.log("  - " + r)
}
