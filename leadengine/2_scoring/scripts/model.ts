/**
 * Scoring — THE MODEL (the README's 5 weighted axes). Pure, no I/O, testable.
 *
 * Score = Σ (axis/100 × weight), 0 if a gate fails. Tiers: hot ≥ 60 · warm ≥ 35 · cold < 35.
 *   NEED      30  is their site weak? (tech + visual judge — computed upstream, passed in here)
 *   LEVERAGE  25  does a beautiful site change the game for this trade? (trade baseline)
 *   VALUE     20  the € they can bring us — the trade's ticket value (pool builder ≫ kitchen designer) ± size
 *   CLOSAB.   15  reachable + very small business (single decision maker) (phone/email collected + headcount)
 *   EXPANSION 10  future potential (booking/e-commerce/recurring) (trade baseline)
 * The axis keys (besoin, levier, valeur, closabilite) are stored data: they stay as they are.
 * The `reasons` strings stay French on purpose: they are stored codes that the cockpit turns into English
 * sentences (backoffice/reviewpipe/insights.ts). `accroche` is the French email hook sent to a French prospect.
 */
import { INDUSTRIES, normalizeIndustry } from "../../1_scraping/scripts/industries.ts"

// EVERY trade lookup goes through normalisation (piscine→pisciniste, ferronnerie→ferronnier…):
// before, a legacy key silently fell back on the generic defaults (value 50) — the systemic bug.
const ind = (key: string) => INDUSTRIES[normalizeIndustry(key)]

export const WEIGHTS = { besoin: 30, levier: 25, valeur: 20, closabilite: 15, expansion: 10 } as const
export type Axes = { besoin: number; levier: number; valeur: number; closabilite: number; expansion: number }
export type Tier = "hot" | "warm" | "cold"

// what scoring knows about the prospect BEFORE paying for parsing (from the scraped CSV + the government API check)
//   active: true=active · false=STRUCK OFF/closed (hard gate) · null=unknown (we don't decide) · undefined=not qualified yet
//   ca    : real revenue (€) if accounts were filed — the strongest SIZE signal (wins over headcount)
//   name/city: for self-qualification (lookupCompany) when active isn't given already
export type Meta = { industry: string; phone?: string; email?: string; effectif?: number | null; active?: boolean | null; ca?: number | null; name?: string; city?: string }

// FREE signals read in the HTML (the same fetch as the tech probe) → make the axes differ per prospect
export type Signals = {
  gallery?: boolean // gallery / portfolio / past work → the visuals sell for them
  quoteCta?: boolean // quote / contact CTA → the site is used to generate leads
  social?: boolean // linked social networks → an active digital presence
  premium?: boolean // bespoke / high-end / showroom → high ticket
  multiSite?: boolean // several shops/branches → a structure that can pay
  ecommerce?: boolean // online shop → digital appetite
  booking?: boolean // online booking / appointments → digital appetite
  blog?: boolean // blog / news → invests in content
}

/**
 * LEARNED rules (the `learning/` link) — BOUNDED deltas applied ON TOP of the human baselines.
 * Scoring READS them, never writes them (see ARCHITECTURE § dependencies). Missing → {} → behaviour
 * STRICTLY identical to the baselines: the loop refines, it doesn't replace the human prior.
 *   industries[trade] = deltas /100 (the trade's real conversion nuances its baseline)
 *   signals[name]     = bonus multiplier (a signal that predicts the sale sees its weight go up)
 */
export type LearnedRules = {
  industries?: Record<string, Partial<Record<"lever" | "value" | "expansion", number>>>
  signals?: Record<string, number>
}
const NO_RULES: LearnedRules = {}
const idelta = (r: LearnedRules, ind: string, axis: "lever" | "value" | "expansion") => r.industries?.[ind]?.[axis] ?? 0
const smul = (r: LearnedRules, name: string) => r.signals?.[name] ?? 1

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

/** CLOSABILITY: reachable + single decision maker. phone = the essential, email = bonus, very small business = decision maker. */
export function closability(meta: Meta): number {
  let v = 0
  if (meta.phone) v += 65
  if (meta.email) v += 20
  // very small / small business = a single decision maker (ideal). A big company (high headcount) = a long decision cycle.
  const small = meta.effectif == null ? true : meta.effectif <= 20
  if (small) v += 15
  return clamp(v)
}

/** VALUE: the trade's ticket value (€ it can bring us) ± REAL SIZE ± premium/multi-site signals.
 *  Size: the filed revenue (government API) is the most reliable signal → it WINS over headcount when it exists. */
export function valueAxis(meta: Meta, sig: Signals = {}, rules: LearnedRules = NO_RULES): number {
  let v = (ind(meta.industry)?.value ?? 50) + idelta(rules, normalizeIndustry(meta.industry), "value")
  if (meta.ca != null) {
    // real revenue: a company doing volume can pay for a beautiful site (and a big ticket). Soft bounds.
    v += meta.ca >= 2_000_000 ? 18 : meta.ca >= 1_000_000 ? 14 : meta.ca >= 500_000 ? 8 : meta.ca >= 250_000 ? 2 : meta.ca < 120_000 ? -8 : 0
  } else if (meta.effectif != null) {
    v += meta.effectif >= 50 ? 15 : meta.effectif <= 2 ? -10 : 0
  }
  if (sig.premium) v += 12 * smul(rules, "premium") // high-end positioning → higher ticket
  if (sig.multiSite) v += 8 * smul(rules, "multiSite") // several outlets → a structure that can pay
  return clamp(v)
}

/** Company GATE: a STRUCK OFF/closed company is unusable (we don't pitch a dead business) → score 0.
 *  `null`/`undefined` (unknown / not qualified) does NOT gate (we never invent a status). */
export const isDeadCompany = (meta: Meta): boolean => meta.active === false

/** LEVERAGE: does the web matter for THIS prospect? trade baseline ± real use of the site. */
export function leverAxis(meta: Meta, sig: Signals = {}, rules: LearnedRules = NO_RULES): number {
  let v = (ind(meta.industry)?.lever ?? 50) + idelta(rules, normalizeIndustry(meta.industry), "lever")
  if (sig.gallery) v += 8 * smul(rules, "gallery") // the visuals/portfolio sell for them
  if (sig.quoteCta) v += 6 * smul(rules, "quoteCta") // the site generates leads (quote/contact)
  if (sig.social) v += 4 * smul(rules, "social")
  if (!sig.gallery && !sig.quoteCta) v -= 10 // inert brochure site → the web weighs less
  return clamp(v)
}

/** EXPANSION: digital appetite/potential, trade baseline ± growth signals. */
export function expansionAxis(meta: Meta, sig: Signals = {}, rules: LearnedRules = NO_RULES): number {
  let v = (ind(meta.industry)?.expansion ?? 30) + idelta(rules, normalizeIndustry(meta.industry), "expansion")
  if (sig.ecommerce) v += 15 * smul(rules, "ecommerce")
  if (sig.booking) v += 10 * smul(rules, "booking")
  if (sig.blog) v += 5 * smul(rules, "blog")
  return clamp(v)
}

/** Assembles the 5 axes. `besoin` (need) computed upstream (tech + visual); `sig` = free HTML signals; `rules` = learned. */
export function buildAxes(besoin: number, meta: Meta, sig: Signals = {}, rules: LearnedRules = NO_RULES): Axes {
  return {
    besoin: clamp(besoin),
    levier: leverAxis(meta, sig, rules),
    valeur: valueAxis(meta, sig, rules),
    closabilite: closability(meta),
    expansion: expansionAxis(meta, sig, rules),
  }
}

export function weighted(a: Axes): number {
  const total = a.besoin * WEIGHTS.besoin + a.levier * WEIGHTS.levier + a.valeur * WEIGHTS.valeur +
    a.closabilite * WEIGHTS.closabilite + a.expansion * WEIGHTS.expansion
  return Math.round(total / 100)
}

/**
 * EXPECTED value — a proxy for the € a prospect can bring us, to SORT the queue (≠ tier/quality).
 * ≈ ticket (value) × P(we win), where P ≈ need (a real gap) × closability (reachable). 0-100.
 * This is what makes "sort by €" real: two "hot" prospects don't weigh the same figure.
 */
export function expectedValue(a: Axes): number {
  return Math.round(a.valeur * (a.besoin / 100) * (a.closabilite / 100))
}

export const tierOf = (value: number): Tier => (value >= 60 ? "hot" : value >= 35 ? "warm" : "cold")

/** The ways of contact the prospect's page reveals (read by the tech probe, free). */
export type SiteContact = { phone?: string; email?: string; form?: boolean }

/**
 * REACHABILITY GATE (hard): no known phone nor email (sheet/CSV) AND nothing on the site (no phone, no
 * email, no form) → we literally can't pitch them: DROPPED, not "kept". Before, an empty page
 * without a contact came out "warm / KEPT" and went on to parsing (the example.com case of the 2026-10-24 audit).
 * Without `site` (dead site, not read): only the sheet counts.
 */
export function isUnreachable(meta: Meta, site?: SiteContact): boolean {
  return !meta.phone && !meta.email && !site?.phone && !site?.email && !site?.form
}

/** REACHABILITY GATE: a prospect with neither email NOR phone can't be "hot" — we literally can't
 *  pitch them. Capped at warm (the contact can still be found), with the reason. */
export function capUnreachable(tier: Tier, meta: Meta, reasons: string[]): Tier {
  if (!meta.phone && !meta.email && tier === "hot") {
    reasons.push("⚠ injoignable (ni email ni téléphone) → plafonné warm — trouver un contact avant outreach")
    return "warm"
  }
  return tier
}

/**
 * NEED as seen by the AUDIT (3_parsing/audit.ts) — the runtime that techProbe (static HTML) can't see:
 * real slowness, overlaps, dead images, a phone that isn't clickable, missing forms, 404 links.
 * Fed back into scoring: need = max(tech, visual, audit). Without it, a site "modern" in its
 * HTML but broken on screen fell under the floor (a real framer's case: cold despite 5.9 s + 22 dead images).
 */
export function besoinFromAudit(audit: any): { besoin: number; reasons: string[] } {
  if (!audit || audit.reachable === false) return { besoin: 0, reasons: [] }
  let besoin = 0
  const reasons: string[] = []
  const add = (cond: boolean, pts: number, why: string) => { if (cond) { besoin += pts; reasons.push(`audit : ${why}`) } }
  const loadMs = Number(audit.loadMs) || 0
  add(loadMs >= 8000, 30, `chargement très lent (${(loadMs / 1000).toFixed(1)} s)`)
  add(loadMs >= 4000 && loadMs < 8000, 18, `chargement lent (${(loadMs / 1000).toFixed(1)} s)`)
  add(audit.https === false, 12, "pas de HTTPS")
  add(audit.mobile?.brokenMobile === true || (Number(audit.mobile?.overflowPx) || 0) > 40, 25, "cassé sur mobile (débordement)")
  const overlaps = (Number(audit.overlap?.desktop?.count) || 0) + (Number(audit.overlap?.mobile?.count) || 0)
  add(overlaps >= 20, 25, `${overlaps} chevauchements d'éléments (rendu cassé)`)
  add(overlaps >= 6 && overlaps < 20, 12, `${overlaps} chevauchements d'éléments`)
  // dead images: home + the audited secondary pages
  const brokenImgs = (Number(audit.brokenImages) || 0) + (audit.pages ?? []).reduce((n: number, p: any) => n + (Number(p.brokenImages) || 0), 0)
  add(brokenImgs >= 8, 22, `${brokenImgs} images cassées`)
  add(brokenImgs >= 2 && brokenImgs < 8, 10, `${brokenImgs} images cassées`)
  add(audit.contact && audit.contact.hasTel === false && audit.contact.hasForm === false && audit.contact.hasMailto === false, 15, "aucun moyen de contact fonctionnel (ni tel: ni formulaire ni mailto)")
  const deadBtns = Number(audit.buttons?.dead) || 0
  add(deadBtns >= 2, 15, `${deadBtns} boutons morts`)
  const deadLinks = Number(audit.deadLinks) || 0
  add(deadLinks >= 3, 10, `${deadLinks} liens 404`)
  add(audit.strengths?.stale === true, 8, "site à l'abandon (copyright ancien)")
  add(audit.seo && audit.seo.hasMetaDesc === false && (Number(audit.seo.h1Count) || 0) === 0, 8, "SEO à nu (ni description ni h1)")
  return { besoin: Math.min(100, besoin), reasons }
}

/**
 * ROI-aware NEED floor: below it, the site is judged "too polished → no opportunity".
 * But a BIG ticket justifies chasing a more moderate need (1 more pool pays for everything) →
 * the higher the ticket value, the lower the floor. Pool builder (value 95) ≈ 26; tradesperson (50) ≈ 35.
 */
export function besoinFloor(valeur: number): number {
  return Math.max(25, Math.min(40, Math.round(45 - valeur * 0.2)))
}

// house rule "no em dash" (the hook goes into the emails and the call script): enforced in CODE
const noDash = (s: string) => s.replace(/\s*[\u2012-\u2015]\s*/g, ", ").replace(/,\s*,/g, ",").trim()

/**
 * The outreach angle: the site's no. 1 weakness → the email's hook (French copy, for a French prospect). Names the
 * trade only if it is KNOWN (never a default "cuisiniste"), and holds no em dash / en dash.
 */
export function accroche(besoinReasons: string[], industry: string): string {
  const top = noDash(besoinReasons[0]?.replace(/^(visuel|audit) : /, "") ?? "")
  const label = industry ? ind(industry)?.label : undefined
  const votre = !label ? "Votre site" : /^[aeiouyhàâéèêîôû]/i.test(label) ? `Votre site d'${label}` : `Votre site de ${label}`
  if (!top) return noDash("On a refait votre site en mieux, un aperçu vous attend.")
  // dead/broken site: a different angle (we don't say "votre site : injoignable"). The probe's reasons:
  // "site injoignable / cassé", "site en erreur (HTTP 404)". ⚠ not /HTTP/ alone: "pas de HTTPS" is not a dead site.
  if (/injoignable|cassé|en erreur|\(HTTP \d{3}\)/i.test(top)) {
    return noDash(`${votre} est inaccessible : on vous en a refait un, jetez-y un œil.`)
  }
  return noDash(`${votre} : ${top.toLowerCase()}. On vous a refait la page d'accueil, regardez.`)
}
