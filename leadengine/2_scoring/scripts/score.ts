/**
 * Scoring (2_scoring) — LA PORTE, modèle complet à 5 axes (cf. 2_scoring/README.md).
 *
 * Entonnoir, le coûteux en dernier :
 *   1. techProbe(url)  — gratuit, ZÉRO LLM : besoin technique + faisabilité depuis le HTML brut.
 *   2. visual gate     — LLM, SEULEMENT si le besoin technique est faible (site « correct » mais peut
 *                        être moche) : screenshots → besoin visuel. besoin = max(tech, visuel).
 *   3. modèle          — 5 axes pondérés (besoin/levier/valeur/closabilité/expansion) → value + tier.
 *
 * Le LEVIER/VALEUR/EXPANSION viennent de la config métier ; la CLOSABILITÉ du tél/email récupérés.
 * VISUAL=0 coupe l'étage LLM.
 *
 * Export : scoreProspect(id, url, meta) · scoreSite(url)   CLI : npm run score -- <id> <url> [industry]
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
  expectedValue?: number // proxy € pour TRIER la file (valeur × besoin × closabilité) — voir model.ts
  signals?: Signals // signaux gratuits du HTML, persistés pour que la boucle learning calcule leur lift
  accroche?: string
  feasible?: boolean
}

type Probe = { reachable: boolean; besoin: number; feasible: boolean; reasons: string[]; signals: Signals; contact?: SiteContact }

const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|avif|ico)$/i
/** Les moyens de contact visibles dans le HTML (gratuit) : lien tel:, numéro (tous pays, cf. phone.ts), mailto/e-mail, formulaire. */
export function readContact(html: string): SiteContact {
  const tel = /href\s*=\s*["']tel:([^"']{6,})["']/i.exec(html)?.[1]
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
  const frPhone = findPhone(text)
  const mailto = /href\s*=\s*["']mailto:([^"'?\s]+@[^"'?\s]+)/i.exec(html)?.[1]
  const email = mailto || [...text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)].map((m) => m[0]).find((e) => !IMG_EXT.test(e))
  const form = /<form\b[\s\S]*?<(?:input|textarea)\b/i.test(html)
  return { phone: (tel || frPhone || "").trim() || undefined, email: email || undefined, form }
}

// signaux gratuits lus dans le HTML (différencient levier/valeur/expansion par prospect)
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

/** Sonde technique gratuite : besoin (faiblesse technique 0-100) + faisabilité, depuis le HTML brut. */
export async function techProbe(url: string): Promise<Probe> {
  let html = ""
  let finalUrl = url
  try {
    const res = await fetch(url, {
      headers: { "user-agent": agency().http.crawlerUserAgent },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000), // tolérant aux sites lents (sinon faux « injoignable »)
    })
    if (!res.ok) return { reachable: false, besoin: 85, feasible: false, reasons: [`site en erreur (HTTP ${res.status})`], signals: {} }
    finalUrl = res.url || url // après redirections (http→https résolu)
    html = await readHtml(res) // jeu de caractères du site (vieux sites en ISO-8859-1), pas toujours UTF-8
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

  // FAISABILITÉ : assez de matière pour bâtir une démo ? (contenu + au moins quelques images)
  const imgs = (html.match(/<img\b/gi) ?? []).length
  const feasible = html.length >= 3000 && imgs >= 2

  return { reachable: true, besoin: Math.min(100, besoin), feasible, reasons, signals: readSignals(html), contact: readContact(html) }
}

/** Compat : la sonde technique seule, format Score (besoin → value/tier). */
export async function scoreSite(url: string): Promise<Score> {
  const p = await techProbe(url)
  return { value: p.besoin, tier: tierOf(p.besoin), reasons: p.reasons.length ? p.reasons : ["site moderne → faible besoin"], feasible: p.feasible }
}

/** La porte complète : sonde tech → besoin visuel si besoin → 5 axes pondérés (affinés par les règles apprises). */
export async function scoreProspect(id: string, url: string, meta: Meta): Promise<Score> {
  const rules = await loadRules() // règles apprises (maillon learning) ; {} si aucune → baselines pures

  // TAXONOMIE : normalisation systématique (piscine→pisciniste…) ; hors-table = signalé, jamais silencieux
  meta = { ...meta, industry: normalizeIndustry(meta.industry) }
  if (meta.industry && !isKnownIndustry(meta.industry))
    console.warn(`⚠ ${id} : métier "${meta.industry}" inconnu de INDUSTRIES → baselines génériques (à câbler dans industries.ts)`)

  // QUALIFICATION ENTREPRISE (API gouv, gratuite) — on vérifie qu'on démarche un VRAI prospect AVANT de
  // payer la sonde du site/le juge visuel. Auto-qualifie si pas déjà fait (meta.active indéfini + nom connu).
  if (meta.active === undefined && (meta.name || id)) {
    try {
      const c = await lookupCompany(meta.name || id.replace(/-/g, " "), { city: meta.city })
      meta = { ...meta, active: c.status === "inconnu" ? null : c.active, ca: meta.ca ?? c.ca, effectif: meta.effectif ?? c.employees }
    } catch { /* API indispo → on ne bloque pas, active reste indéfini */ }
  }
  // GATE DUR : société RADIÉE/cessée → on ne va même pas regarder son site (zéro, hors-cible).
  if (isDeadCompany(meta)) {
    return { value: 0, tier: "cold", feasible: false, axes: undefined,
      reasons: ["société RADIÉE / cessée (registre INSEE) — ne pas démarcher"] }
  }

  const probe = await techProbe(url)

  // PORTE DE JOIGNABILITÉ : ni contact connu (fiche/CSV) ni contact sur le site → jeté (on ne peut pas le démarcher)
  if (isUnreachable(meta, probe.contact)) {
    const axes = buildAxes(probe.besoin, meta, probe.signals, rules)
    return { value: Math.min(weighted(axes), 30), tier: "cold", axes, expectedValue: 0, signals: probe.signals, feasible: probe.feasible,
      reasons: ["injoignable : ni téléphone ni e-mail (fiche) et aucun contact sur le site (tél, e-mail, formulaire) → ne pas démarcher", ...probe.reasons.slice(0, 2)] }
  }
  // un contact visible sur le site rend le prospect joignable (closabilité) même si la source n'en avait pas
  if (probe.contact) meta = { ...meta, phone: meta.phone || probe.contact.phone, email: meta.email || probe.contact.email }

  // site mort : besoin maximal mais on ne peut RIEN cloner → faisabilité KO, plafonné à warm (build manuel)
  if (!probe.reachable) {
    const axes = buildAxes(probe.besoin, meta, probe.signals, rules)
    const value = Math.min(weighted(axes), 59)
    return { value, tier: tierOf(value), axes, expectedValue: expectedValue(axes), signals: probe.signals,
      feasible: false, accroche: accroche(probe.reasons, meta.industry),
      reasons: [...probe.reasons, "→ refonte depuis zéro (rien à parser)"] }
  }

  // besoin : tech d'abord ; si le site est techniquement correct (besoin bas), le juge visuel tranche la beauté
  let besoin = probe.besoin
  let besoinReasons = [...probe.reasons]
  if (besoin < 60 && process.env.VISUAL !== "0") {
    const { visualGate } = await import("./visual-gate.ts")
    const v = await visualGate(id, url)
    if (v.besoin > besoin) { besoin = v.besoin; besoinReasons = v.reasons.map((r) => `visuel : ${r}`) }
  }

  const axes = buildAxes(besoin, meta, probe.signals, rules)
  const ev = expectedValue(axes)

  // BESOIN = la raison d'être : un site déjà soigné n'a guère d'opportunité de refonte. MAIS le plancher
  // est ROI-aware : un gros ticket (valeur haute) justifie de poursuivre un besoin plus modéré. Sinon le
  // besoin GATE le score (sinon levier/valeur/closab. le masquent).
  const floor = besoinFloor(axes.valeur)
  if (besoin < floor) {
    return { value: Math.min(weighted(axes), 30), tier: "cold", axes, expectedValue: ev, signals: probe.signals,
      feasible: probe.feasible,
      reasons: [`site déjà soigné — besoin de refonte faible (${besoin}/100 < plancher ${floor})`, ...besoinReasons.slice(0, 2)] }
  }

  const value = weighted(axes)
  let tier = tierOf(value)
  const reasons = [...besoinReasons]
  if (!probe.feasible) { // peu de matière → garder mais ne pas envoyer en prod auto
    tier = tier === "hot" ? "warm" : tier
    reasons.push("faisabilité limitée (peu de contenu/photos)")
  }
  tier = capUnreachable(tier, meta, reasons) // injoignable (ni mail ni tél) → jamais hot
  reasons.push(`axes — besoin ${axes.besoin} · levier ${axes.levier} · valeur ${axes.valeur} · closab. ${axes.closabilite} · expansion ${axes.expansion} → € espéré ${ev}`)

  return { value, tier, axes, expectedValue: ev, signals: probe.signals, feasible: probe.feasible,
    accroche: accroche(besoinReasons, meta.industry), reasons }
}

// --- CLI ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // métier optionnel : sans lui, baselines génériques et accroche neutre (jamais un « cuisiniste » inventé)
  const [id, url, industry = ""] = process.argv.slice(2)
  if (!id || !url) {
    console.error("usage: npm run score -- <id> <url> [industry]")
    process.exit(1)
  }
  const result = await scoreProspect(id, url, { industry })
  await mkdir(join("data", "raw"), { recursive: true })
  await writeFile(join("data", "raw", `${id}.score.json`), JSON.stringify(result, null, 2))
  console.log(`score ${id} : ${result.value}/100 (${result.tier})  ·  € espéré ${result.expectedValue ?? "?"}/100 (tri de la file)`)
  for (const r of result.reasons) console.log("  - " + r)
  if (result.accroche) console.log(`  accroche : ${result.accroche}`)
  console.log(result.tier === "cold" ? "→ JETÉ (pas une cible)" : "→ RETENU (passe au parsing)")
}
