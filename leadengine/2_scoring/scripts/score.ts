/**
 * Scoring (2_scoring) — THE GATE, the full 5-axis model (see 2_scoring/README.md).
 *
 * A funnel, the expensive last:
 *   1. techProbe(url)  — free, ZERO LLM: technical need + feasibility from the raw HTML.
 *   2. visual gate     — LLM, ONLY if the technical need is low (a "decent" site that may still
 *                        be ugly): screenshots → visual need. need = max(tech, visual).
 *   3. model           — 5 weighted axes (need/leverage/value/closability/expansion) → value + tier.
 *
 * LEVERAGE/VALUE/EXPANSION come from the trade config; CLOSABILITY from the collected phone/email.
 * VISUAL=0 turns the LLM stage off. The `reasons` stay French codes on purpose (see model.ts).
 *
 * Export: scoreProspect(id, url, meta) · scoreSite(url)   CLI: npm run score -- <id> <url> [industry]
 */
import { writeFile, mkdir } from "node:fs/promises"
import { findPhone } from "../../1_scraping/scripts/phone.ts"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { buildAxes, weighted, tierOf, accroche, expectedValue, besoinFloor, isDeadCompany, capUnreachable, isUnreachable, type Axes, type Meta, type Signals, type SiteContact, type Tier } from "./model.ts"
import { loadRules } from "../../../learning/scripts/rules.ts"
import { lookupCompany } from "../../1_scraping/scripts/company.ts"
import { normalizeIndustry, isKnownIndustry } from "../../1_scraping/scripts/industries.ts"
import { agency } from "../../../packages/shared/agency.mjs"
import { readHtml } from "../../1_scraping/scripts/util.ts"

export type Score = {
  value: number
  tier: Tier
  reasons: string[]
  axes?: Axes
  expectedValue?: number // € proxy to SORT the queue (value × need × closability) — see model.ts
  signals?: Signals // free HTML signals, persisted so the learning loop can compute their lift
  accroche?: string
  feasible?: boolean
}

type Probe = { reachable: boolean; besoin: number; feasible: boolean; reasons: string[]; signals: Signals; contact?: SiteContact }

const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|avif|ico)$/i
/** The ways of contact visible in the HTML (free): tel: link, number (every country, see phone.ts), mailto/email, form. */
export function readContact(html: string): SiteContact {
  const tel = /href\s*=\s*["']tel:([^"']{6,})["']/i.exec(html)?.[1]
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
  const frPhone = findPhone(text)
  const mailto = /href\s*=\s*["']mailto:([^"'?\s]+@[^"'?\s]+)/i.exec(html)?.[1]
  const email = mailto || [...text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)].map((m) => m[0]).find((e) => !IMG_EXT.test(e))
  const form = /<form\b[\s\S]*?<(?:input|textarea)\b/i.test(html)
  return { phone: (tel || frPhone || "").trim() || undefined, email: email || undefined, form }
}

// free signals read in the HTML (make leverage/value/expansion differ per prospect)
function readSignals(html: string): Signals {
  return {
    gallery: /galerie|portfolio|r[ée]alisations|nos projets|nos chantiers|réalisations/i.test(html),
    quoteCta: /devis|prendre rendez-vous|contactez|nous contacter|demande de contact/i.test(html),
    social: /facebook\.com|instagram\.com|linkedin\.com|pinterest\.|youtube\.com/i.test(html),
    premium: /sur[ -]?mesure|haut de gamme|premium|prestige|luxe|d['e ]exception|architecte d['e ]int[ée]rieur|showroom/i.test(html),
    multiSite: /nos magasins|nos agences|points? de vente|nos showrooms|plusieurs agences/i.test(html),
    ecommerce: /ajouter au panier|boutique en ligne|woocommerce|shopify|prestashop|add to cart/i.test(html),
    booking: /r[ée]server en ligne|prendre rendez-vous|calendly|rdv en ligne|réservation en ligne/i.test(html),
    blog: /\/blog|nos actualit[ée]s|nos articles|le blog/i.test(html),
  }
}

/** Free technical probe: need (technical weakness 0-100) + feasibility, from the raw HTML. */
export async function techProbe(url: string): Promise<Probe> {
  let html = ""
  let finalUrl = url
  try {
    const res = await fetch(url, {
      headers: { "user-agent": agency().http.crawlerUserAgent },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000), // tolerant of slow sites (otherwise a false "unreachable")
    })
    if (!res.ok) return { reachable: false, besoin: 85, feasible: false, reasons: [`site en erreur (HTTP ${res.status})`], signals: {} }
    finalUrl = res.url || url // after redirects (http→https resolved)
    html = await readHtml(res) // the site's character set (old sites in ISO-8859-1), not always UTF-8
  } catch {
    return { reachable: false, besoin: 85, feasible: false, reasons: ["site injoignable / cassé"], signals: {} }
  }

  const reasons: string[] = []
  let besoin = 0
  const add = (cond: boolean, pts: number, why: string) => { if (cond) { besoin += pts; reasons.push(why) } }
  add(/wix\.com|jimdo|e-monsite|pagesjaunes|sitew|webnode|wordpress.*20(1\d|2[01])/i.test(html), 40, "plateforme datée / builder cheap")
  add(!/<meta[^>]+name=["']viewport["']/i.test(html), 35, "pas responsive (pas de viewport)")
  add(!/<meta[^>]+name=["']description["']/i.test(html) && !/property=["']og:/i.test(html), 15, "SEO pauvre (pas de description / OG)")
  add(!finalUrl.startsWith("https:"), 12, "pas de HTTPS (sécurité + SEO pénalisé)")
  add(!/application\/ld\+json|itemtype=["'][^"']*schema\.org/i.test(html), 8, "aucune donnée structurée (SEO local faible)")
  add(/jquery[.\-/]?1\.\d|jquery[.\-/]?2\.\d/i.test(html), 8, "vieux jQuery (socle technique daté)")
  add(html.length < 8000, 10, "page très pauvre (peu de contenu)")
  const years = [...html.matchAll(/©?\s*(20[0-2]\d)/g)].map((m) => +m[1])
  const newest = years.length ? Math.max(...years) : null
  add(newest !== null && newest <= 2021, 10, `dernière trace de maj : ${newest}`)

  // FEASIBILITY: enough material to build a demo? (content + at least a few images)
  const imgs = (html.match(/<img\b/gi) ?? []).length
  const feasible = html.length >= 3000 && imgs >= 2

  return { reachable: true, besoin: Math.min(100, besoin), feasible, reasons, signals: readSignals(html), contact: readContact(html) }
}

/** Compat: the tech probe alone, in Score format (need → value/tier). */
export async function scoreSite(url: string): Promise<Score> {
  const p = await techProbe(url)
  return { value: p.besoin, tier: tierOf(p.besoin), reasons: p.reasons.length ? p.reasons : ["site moderne → faible besoin"], feasible: p.feasible }
}

/** The full gate: tech probe → visual need if needed → 5 weighted axes (refined by the learned rules). */
export async function scoreProspect(id: string, url: string, meta: Meta): Promise<Score> {
  const rules = await loadRules() // learned rules (the learning link); {} if none → pure baselines

  // TAXONOMY: always normalised (piscine→pisciniste…); off-table = reported, never silent
  meta = { ...meta, industry: normalizeIndustry(meta.industry) }
  if (meta.industry && !isKnownIndustry(meta.industry))
    console.warn(`⚠ ${id}: trade "${meta.industry}" is not in INDUSTRIES → generic baselines (wire it in industries.ts)`)

  // COMPANY QUALIFICATION (government API, free) — we check we're pitching a REAL prospect BEFORE
  // paying for the site probe / the visual judge. Self-qualifies if not done yet (meta.active undefined + a known name).
  if (meta.active === undefined && (meta.name || id)) {
    try {
      const c = await lookupCompany(meta.name || id.replace(/-/g, " "), { city: meta.city })
      meta = { ...meta, active: c.status === "inconnu" ? null : c.active, ca: meta.ca ?? c.ca, effectif: meta.effectif ?? c.employees }
    } catch { /* API unavailable → we don't block, active stays undefined */ }
  }
  // HARD GATE: STRUCK OFF/closed company → we don't even look at its site (zero, off target).
  if (isDeadCompany(meta)) {
    return { value: 0, tier: "cold", feasible: false, axes: undefined,
      reasons: ["société RADIÉE / cessée (registre INSEE) — ne pas démarcher"] }
  }

  const probe = await techProbe(url)

  // REACHABILITY GATE: no known contact (sheet/CSV) and no contact on the site → dropped (we can't pitch them)
  if (isUnreachable(meta, probe.contact)) {
    const axes = buildAxes(probe.besoin, meta, probe.signals, rules)
    return { value: Math.min(weighted(axes), 30), tier: "cold", axes, expectedValue: 0, signals: probe.signals, feasible: probe.feasible,
      reasons: ["injoignable : ni téléphone ni e-mail (fiche) et aucun contact sur le site (tél, e-mail, formulaire) → ne pas démarcher", ...probe.reasons.slice(0, 2)] }
  }
  // a contact visible on the site makes the prospect reachable (closability) even if the source had none
  if (probe.contact) meta = { ...meta, phone: meta.phone || probe.contact.phone, email: meta.email || probe.contact.email }

  // dead site: maximum need but NOTHING to clone → feasibility fails, capped at warm (manual build)
  if (!probe.reachable) {
    const axes = buildAxes(probe.besoin, meta, probe.signals, rules)
    const value = Math.min(weighted(axes), 59)
    return { value, tier: tierOf(value), axes, expectedValue: expectedValue(axes), signals: probe.signals,
      feasible: false, accroche: accroche(probe.reasons, meta.industry),
      reasons: [...probe.reasons, "→ refonte depuis zéro (rien à parser)"] }
  }

  // need: tech first; if the site is technically fine (low need), the visual judge decides on its looks
  let besoin = probe.besoin
  let besoinReasons = [...probe.reasons]
  if (besoin < 60 && process.env.VISUAL !== "0") {
    const { visualGate } = await import("./visual-gate.ts")
    const v = await visualGate(id, url)
    if (v.besoin > besoin) { besoin = v.besoin; besoinReasons = v.reasons.map((r) => `visuel : ${r}`) }
  }

  const axes = buildAxes(besoin, meta, probe.signals, rules)
  const ev = expectedValue(axes)

  // NEED = the reason to exist: an already polished site has little redesign opportunity. BUT the floor
  // is ROI-aware: a big ticket (high value) justifies chasing a more moderate need. Otherwise the
  // need GATES the score (else leverage/value/closability would hide it).
  const floor = besoinFloor(axes.valeur)
  if (besoin < floor) {
    return { value: Math.min(weighted(axes), 30), tier: "cold", axes, expectedValue: ev, signals: probe.signals,
      feasible: probe.feasible,
      reasons: [`site déjà soigné — besoin de refonte faible (${besoin}/100 < plancher ${floor})`, ...besoinReasons.slice(0, 2)] }
  }

  const value = weighted(axes)
  let tier = tierOf(value)
  const reasons = [...besoinReasons]
  if (!probe.feasible) { // little material → keep, but don't send to automatic production
    tier = tier === "hot" ? "warm" : tier
    reasons.push("faisabilité limitée (peu de contenu/photos)")
  }
  tier = capUnreachable(tier, meta, reasons) // unreachable (no email nor phone) → never hot
  reasons.push(`axes — besoin ${axes.besoin} · levier ${axes.levier} · valeur ${axes.valeur} · closab. ${axes.closabilite} · expansion ${axes.expansion} → € espéré ${ev}`)

  return { value, tier, axes, expectedValue: ev, signals: probe.signals, feasible: probe.feasible,
    accroche: accroche(besoinReasons, meta.industry), reasons }
}

// --- CLI ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // the trade is optional: without it, generic baselines and a neutral hook (never an invented "cuisiniste")
  const [id, url, industry = ""] = process.argv.slice(2)
  if (!id || !url) {
    console.error("usage: npm run score -- <id> <url> [industry]")
    process.exit(1)
  }
  const result = await scoreProspect(id, url, { industry })
  await mkdir(join("data", "raw"), { recursive: true })
  await writeFile(join("data", "raw", `${id}.score.json`), JSON.stringify(result, null, 2))
  console.log(`score ${id}: ${result.value}/100 (${result.tier})  ·  expected € ${result.expectedValue ?? "?"}/100 (queue order)`)
  for (const r of result.reasons) console.log("  - " + r)
  if (result.accroche) console.log(`  hook: ${result.accroche}`)
  console.log(result.tier === "cold" ? "→ DROPPED (not a target)" : "→ KEPT (goes on to parsing)")
}
