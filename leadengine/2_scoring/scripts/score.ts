/**
 * Scoring (2_scoring) — THE GATE. A funnel: the cheap filter first, the expensive steps only on survivors.
 *
 *   1. techProbe(url) — free, ZERO LLM: technical need + feasibility from the raw HTML (a plain fetch).
 *   2. model          — five weighted axes (need / leverage / value / reachability / expansion) → value + tier,
 *                       refined by the rules the learning loop wrote.
 *
 * The private build inserts a visual judge between 1 and 2 (screenshots → LLM) for sites that are
 * technically fine but ugly. It only runs when the tech need is low, so it stays cheap.
 *
 * Export : scoreProspect(id, url, meta)     CLI : npm run score -- <id> <url> [industry]
 */
import { writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Score, Signals } from "../../../packages/shared/prospect.ts"
import { loadRules } from "../../../learning/scripts/rules.ts"
import { buildAxes, weighted, tierOf, expectedValue, needFloor, capUnreachable, type Meta } from "./model.ts"

type Probe = { reachable: boolean; need: number; feasible: boolean; reasons: string[]; signals: Signals }

/** Free signals in the HTML — they differentiate leverage / value / expansion per prospect. */
export function readSignals(html: string): Signals {
  return {
    gallery: /galerie|portfolio|r[ée]alisations|nos projets|nos chantiers|our work/i.test(html),
    quoteCta: /devis|prendre rendez-vous|contactez|nous contacter|get a quote|contact us/i.test(html),
    social: /facebook\.com|instagram\.com|linkedin\.com|pinterest\.|youtube\.com/i.test(html),
    premium: /sur[ -]?mesure|haut de gamme|premium|prestige|luxe|bespoke|showroom/i.test(html),
    multiSite: /nos magasins|nos agences|points? de vente|nos showrooms|our showrooms/i.test(html),
    ecommerce: /ajouter au panier|boutique en ligne|woocommerce|shopify|add to cart/i.test(html),
    booking: /r[ée]server en ligne|rdv en ligne|calendly|book online/i.test(html),
    blog: /\/blog|nos actualit[ée]s|nos articles/i.test(html),
  }
}

/** The pure judgement on HTML — no network, unit-tested. */
export function probeHtml(html: string, finalUrl: string): Omit<Probe, "reachable"> {
  const reasons: string[] = []
  let need = 0
  const add = (cond: boolean, pts: number, why: string) => {
    if (cond) {
      need += pts
      reasons.push(why)
    }
  }
  add(/wix\.com|jimdo|e-monsite|pagesjaunes|sitew|webnode/i.test(html), 40, "dated platform / cheap site builder")
  add(!/<meta[^>]+name=["']viewport["']/i.test(html), 35, "not responsive (no viewport)")
  add(!/<meta[^>]+name=["']description["']/i.test(html) && !/property=["']og:/i.test(html), 15, "poor SEO (no description, no Open Graph)")
  add(!finalUrl.startsWith("https:"), 12, "no HTTPS")
  add(!/application\/ld\+json|itemtype=["'][^"']*schema\.org/i.test(html), 8, "no structured data (weak local SEO)")
  add(/jquery[.\-/]?1\.\d|jquery[.\-/]?2\.\d/i.test(html), 8, "old jQuery (dated stack)")
  add(html.length < 8000, 10, "very thin page")
  const years = [...html.matchAll(/©?\s*(20[0-2]\d)/g)].map((m) => +m[1])
  const newest = years.length ? Math.max(...years) : null
  add(newest !== null && newest <= 2021, 10, `last sign of life: ${newest}`)

  // FEASIBILITY: is there enough material to build a demo FROM THEIR OWN CONTENT?
  const imgs = (html.match(/<img\b/gi) ?? []).length
  const feasible = html.length >= 3000 && imgs >= 2
  return { need: Math.min(100, need), feasible, reasons, signals: readSignals(html) }
}

export async function techProbe(url: string): Promise<Probe> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; lastwebstudios/1.0)" },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return { reachable: false, need: 85, feasible: false, reasons: [`site returns HTTP ${res.status}`], signals: {} }
    return { reachable: true, ...probeHtml(await res.text(), res.url || url) }
  } catch {
    return { reachable: false, need: 85, feasible: false, reasons: ["site unreachable / broken"], signals: {} }
  }
}

/** The full gate: tech probe → five axes (refined by learned rules) → value, tier, expected value. */
export async function scoreProspect(url: string, meta: Meta): Promise<Score> {
  const rules = await loadRules() // {} when nothing was learned yet → pure human baselines
  const probe = await techProbe(url)
  const axes = buildAxes(probe.need, meta, probe.signals, rules)
  const ev = expectedValue(axes)

  // a dead site: maximal need, but nothing to rebuild FROM → capped (manual build only)
  if (!probe.reachable) {
    const value = Math.min(weighted(axes), 59)
    return { value, tier: tierOf(value), axes, expectedValue: ev, signals: probe.signals, feasible: false, reasons: probe.reasons }
  }

  // NEED is the raison d'être: a polished site has little redesign opportunity, whatever else it scores.
  const floor = needFloor(axes.value)
  if (probe.need < floor) {
    return {
      value: Math.min(weighted(axes), 30), tier: "cold", axes, expectedValue: ev, signals: probe.signals, feasible: probe.feasible,
      reasons: [`site already polished — need ${probe.need}/100 < floor ${floor}`],
    }
  }

  const value = weighted(axes)
  const reasons = [...probe.reasons]
  let tier = tierOf(value)
  if (!probe.feasible) {
    tier = tier === "hot" ? "warm" : tier // not enough material: keep it, but never auto-build it
    reasons.push("limited feasibility (little content / few photos)")
  }
  tier = capUnreachable(tier, meta, reasons)
  return { value, tier, axes, expectedValue: ev, signals: probe.signals, feasible: probe.feasible, reasons }
}

// --- CLI ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [id, url, industry = "kitchen-designer"] = process.argv.slice(2)
  if (!id || !url) {
    console.error("usage: npm run score -- <id> <url> [industry]")
    process.exit(1)
  }
  const s = await scoreProspect(url, { industry })
  await mkdir(join("data", "raw"), { recursive: true })
  await writeFile(join("data", "raw", `${id}.score.json`), JSON.stringify(s, null, 2))
  console.log(`score ${id}: ${s.value}/100 (${s.tier}) · expected value ${s.expectedValue}`)
  for (const r of s.reasons) console.log("  - " + r)
  console.log(s.tier === "cold" ? "→ DROPPED (not a target)" : "→ KEPT (goes on to parsing)")
}
