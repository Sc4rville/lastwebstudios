/**
 * Scoring — LE MODÈLE (les 5 axes pondérés du README). Pur, sans I/O, testable.
 *
 * Score = Σ (axe/100 × poids), 0 si une gate échoue. Paliers : hot ≥ 60 · warm ≥ 35 · cold < 35.
 *   BESOIN 30  son site est-il faible ? (tech + juge visuel — calculé en amont, passé ici)
 *   LEVIER 25  un beau site change-t-il la donne pour ce métier ? (baseline métier)
 *   VALEUR 20  les € qu'il peut nous rapporter — valeur-ticket du métier (pisciniste ≫ cuisiniste) ± taille
 *   CLOSAB 15  joignable + TPE (décideur unique) (tél/email récupérés + effectif)
 *   EXPANS 10  potentiel futur (réservation/e-commerce/récurrent) (baseline métier)
 */
import { INDUSTRIES, normalizeIndustry } from "../../1_scraping/scripts/industries.ts"

// TOUT lookup métier passe par la normalisation (piscine→pisciniste, ferronnerie→ferronnier…) :
// avant, une clé legacy tombait silencieusement sur les fallbacks génériques (value 50) — le bug systémique.
const ind = (key: string) => INDUSTRIES[normalizeIndustry(key)]

export const WEIGHTS = { besoin: 30, levier: 25, valeur: 20, closabilite: 15, expansion: 10 } as const
export type Axes = { besoin: number; levier: number; valeur: number; closabilite: number; expansion: number }
export type Tier = "hot" | "warm" | "cold"

// ce que le scoring connaît du prospect AVANT de payer le parsing (vient du CSV scrapé + qualif API gouv)
//   active : true=actif · false=RADIÉ/cessé (gate dur) · null=inconnu (on ne tranche pas) · undefined=pas encore qualifié
//   ca     : chiffre d'affaires réel (€) si comptes déposés — le signal de TAILLE le plus fort (prime sur effectif)
//   name/city : pour l'auto-qualification (lookupCompany) quand active n'est pas déjà fourni
export type Meta = { industry: string; phone?: string; email?: string; effectif?: number | null; active?: boolean | null; ca?: number | null; name?: string; city?: string }

// signaux GRATUITS lus dans le HTML (même fetch que la sonde tech) → différencient les axes par prospect
export type Signals = {
  gallery?: boolean // galerie / portfolio / réalisations → le visuel vend pour lui
  quoteCta?: boolean // CTA devis / contact → le site sert à générer des leads
  social?: boolean // réseaux sociaux liés → présence digitale active
  premium?: boolean // sur-mesure / haut de gamme / showroom → ticket élevé
  multiSite?: boolean // plusieurs magasins/agences → structure qui peut payer
  ecommerce?: boolean // boutique en ligne → appétit digital
  booking?: boolean // réservation / RDV en ligne → appétit digital
  blog?: boolean // blog / actus → investit dans le contenu
}

/**
 * Règles APPRISES (maillon `learning/`) — des deltas BORNÉS appliqués SUR les baselines humaines.
 * Le scoring les LIT, ne les écrit jamais (cf. ARCHITECTURE § dépendances). Absentes → {} → comportement
 * STRICTEMENT identique aux baselines : la boucle affine, elle ne remplace pas le prior humain.
 *   industries[métier] = deltas /100 (la conversion réelle du métier nuance sa baseline)
 *   signals[nom]       = multiplicateur de bonus (un signal qui prédit la vente voit son poids monter)
 */
export type LearnedRules = {
  industries?: Record<string, Partial<Record<"lever" | "value" | "expansion", number>>>
  signals?: Record<string, number>
}
const NO_RULES: LearnedRules = {}
const idelta = (r: LearnedRules, ind: string, axis: "lever" | "value" | "expansion") => r.industries?.[ind]?.[axis] ?? 0
const smul = (r: LearnedRules, name: string) => r.signals?.[name] ?? 1

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

/** CLOSABILITÉ : joignable + décideur unique. tél = l'essentiel, email = bonus, TPE = décideur. */
export function closability(meta: Meta): number {
  let v = 0
  if (meta.phone) v += 65
  if (meta.email) v += 20
  // TPE/PME = un seul décideur (idéal). Grande boîte (effectif élevé) = cycle de décision long.
  const small = meta.effectif == null ? true : meta.effectif <= 20
  if (small) v += 15
  return clamp(v)
}

/** VALEUR : valeur-ticket du métier (€ qu'il peut nous rapporter) ± TAILLE RÉELLE ± signaux premium/multi-sites.
 *  Taille : le CA déposé (API gouv) est le signal le plus fiable → il PRIME sur l'effectif quand il existe. */
export function valueAxis(meta: Meta, sig: Signals = {}, rules: LearnedRules = NO_RULES): number {
  let v = (ind(meta.industry)?.value ?? 50) + idelta(rules, normalizeIndustry(meta.industry), "value")
  if (meta.ca != null) {
    // CA réel : une boîte qui fait du volume peut payer un beau site (et un gros ticket). Bornes douces.
    v += meta.ca >= 2_000_000 ? 18 : meta.ca >= 1_000_000 ? 14 : meta.ca >= 500_000 ? 8 : meta.ca >= 250_000 ? 2 : meta.ca < 120_000 ? -8 : 0
  } else if (meta.effectif != null) {
    v += meta.effectif >= 50 ? 15 : meta.effectif <= 2 ? -10 : 0
  }
  if (sig.premium) v += 12 * smul(rules, "premium") // positionnement haut de gamme → ticket plus élevé
  if (sig.multiSite) v += 8 * smul(rules, "multiSite") // plusieurs points de vente → structure qui peut payer
  return clamp(v)
}

/** GATE entreprise : une société RADIÉE/cessée est inexploitable (on ne démarche pas un mort) → score 0.
 *  `null`/`undefined` (inconnu / non qualifié) NE gate PAS (on n'invente pas un état). */
export const isDeadCompany = (meta: Meta): boolean => meta.active === false

/** LEVIER : le web compte-t-il pour CE prospect ? baseline métier ± usage réel du site. */
export function leverAxis(meta: Meta, sig: Signals = {}, rules: LearnedRules = NO_RULES): number {
  let v = (ind(meta.industry)?.lever ?? 50) + idelta(rules, normalizeIndustry(meta.industry), "lever")
  if (sig.gallery) v += 8 * smul(rules, "gallery") // le visuel/portfolio vend pour lui
  if (sig.quoteCta) v += 6 * smul(rules, "quoteCta") // le site génère des leads (devis/contact)
  if (sig.social) v += 4 * smul(rules, "social")
  if (!sig.gallery && !sig.quoteCta) v -= 10 // site vitrine inerte → le web pèse moins
  return clamp(v)
}

/** EXPANSION : appétit/potentiel digital, baseline métier ± signaux de croissance. */
export function expansionAxis(meta: Meta, sig: Signals = {}, rules: LearnedRules = NO_RULES): number {
  let v = (ind(meta.industry)?.expansion ?? 30) + idelta(rules, normalizeIndustry(meta.industry), "expansion")
  if (sig.ecommerce) v += 15 * smul(rules, "ecommerce")
  if (sig.booking) v += 10 * smul(rules, "booking")
  if (sig.blog) v += 5 * smul(rules, "blog")
  return clamp(v)
}

/** Assemble les 5 axes. `besoin` calculé en amont (tech + visuel) ; `sig` = signaux gratuits du HTML ; `rules` = appris. */
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
 * Valeur ESPÉRÉE — proxy des € qu'un prospect peut nous rapporter, pour TRIER la file (≠ tier/qualité).
 * ≈ ticket (valeur) × P(on gagne), où P ≈ besoin (vrai manque) × closabilité (joignable). 0-100.
 * C'est elle qui opérationnalise « trier par € » : deux prospects « hot » ne pèsent pas le même chiffre.
 */
export function expectedValue(a: Axes): number {
  return Math.round(a.valeur * (a.besoin / 100) * (a.closabilite / 100))
}

export const tierOf = (value: number): Tier => (value >= 60 ? "hot" : value >= 35 ? "warm" : "cold")

/** Ce que la page du prospect révèle comme moyen de contact (lu par la sonde technique, gratuit). */
export type SiteContact = { phone?: string; email?: string; form?: boolean }

/**
 * PORTE DE JOIGNABILITÉ (dure) : ni téléphone ni e-mail connus (fiche/CSV) ET rien sur le site (ni tél, ni
 * e-mail, ni formulaire) → on ne peut littéralement pas le démarcher : JETÉ, pas « retenu ». Avant, une page
 * vide sans contact sortait « warm / RETENU » et partait au parsing (cas example.com de l'audit 2026-10-24).
 * Sans `site` (site mort, non lu) : seule la fiche compte.
 */
export function isUnreachable(meta: Meta, site?: SiteContact): boolean {
  return !meta.phone && !meta.email && !site?.phone && !site?.email && !site?.form
}

/** GATE de JOIGNABILITÉ : un prospect sans email NI téléphone ne peut pas être « hot » — on ne peut
 *  littéralement pas le démarcher. Plafonné à warm (le contact peut encore être trouvé), avec la raison. */
export function capUnreachable(tier: Tier, meta: Meta, reasons: string[]): Tier {
  if (!meta.phone && !meta.email && tier === "hot") {
    reasons.push("⚠ injoignable (ni email ni téléphone) → plafonné warm — trouver un contact avant outreach")
    return "warm"
  }
  return tier
}

/**
 * BESOIN vu par l'AUDIT (3_parsing/audit.ts) — le runtime que techProbe (HTML statique) ne voit pas :
 * lenteur réelle, chevauchements, images mortes, tél non cliquable, formulaires absents, liens 404.
 * Réinjecté dans le scoring : besoin = max(tech, visuel, audit). Sans ça, un site « moderne » dans son
 * HTML mais cassé à l'écran passait sous le plancher (cas réel d'un charpentier : cold malgré 5,9 s + 22 img mortes).
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
  // images mortes : home + pages secondaires auditées
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
 * Plancher de BESOIN ROI-aware : en dessous, le site est jugé « trop soigné → pas d'opportunité ».
 * Mais un GROS ticket justifie de poursuivre un besoin plus modéré (1 piscine de plus paie tout) →
 * plus la valeur-ticket est haute, plus le plancher descend. Pisciniste (valeur 95) ≈ 26 ; artisan (50) ≈ 35.
 */
export function besoinFloor(valeur: number): number {
  return Math.max(25, Math.min(40, Math.round(45 - valeur * 0.2)))
}

// règle maison « zéro tiret cadratin » (l'accroche part dans les mails et le script d'appel) : imposée en CODE
const noDash = (s: string) => s.replace(/\s*[\u2012-\u2015]\s*/g, ", ").replace(/,\s*,/g, ",").trim()

/**
 * L'angle d'outreach : la faiblesse n°1 du site → accroche du mail. Ne nomme le métier que s'il est CONNU
 * (jamais un « cuisiniste » par défaut), et ne contient aucun tiret cadratin / demi-cadratin.
 */
export function accroche(besoinReasons: string[], industry: string): string {
  const top = noDash(besoinReasons[0]?.replace(/^(visuel|audit) : /, "") ?? "")
  const label = industry ? ind(industry)?.label : undefined
  const votre = !label ? "Votre site" : /^[aeiouyhàâéèêîôû]/i.test(label) ? `Votre site d'${label}` : `Votre site de ${label}`
  if (!top) return noDash("On a refait votre site en mieux, un aperçu vous attend.")
  // site mort/cassé : angle différent (on ne dit pas "votre site : injoignable"). Raisons de la sonde :
  // « site injoignable / cassé », « site en erreur (HTTP 404) ». ⚠ pas /HTTP/ seul : « pas de HTTPS » n'est pas un site mort.
  if (/injoignable|cassé|en erreur|\(HTTP \d{3}\)/i.test(top)) {
    return noDash(`${votre} est inaccessible : on vous en a refait un, jetez-y un œil.`)
  }
  return noDash(`${votre} : ${top.toLowerCase()}. On vous a refait la page d'accueil, regardez.`)
}
