/**
 * rescore.ts — GUÉRISON du portefeuille : re-score OFFLINE de toutes les fiches (data/prospects/*.json).
 *
 * Pourquoi : l'audit du 2026-07-02 a montré un portefeuille malade — 3 taxonomies divergentes (36 % des
 * fiches scorées sur des baselines génériques), 5 scores PLACEHOLDER codés en dur (« 80/hot, clé .env à
 * sec »), la moitié des fiches sans axes, expectedValue présent sur 2/94, et le signal AUDIT jamais
 * réinjecté dans le besoin (cas réel d'un charpentier : cold « site moderne » malgré 5,9 s + 22 images mortes).
 *
 * Ce script répare tout ça SANS LLM ni Playwright :
 *   1. normalise `industry` (normalizeIndustry — vocabulaire canonique d'industries.ts) et l'écrit
 *   2. besoin = max(besoin technique existant, besoin AUDIT (besoinFromAudit), techProbe frais si rien)
 *   3. rebâtit les 5 axes + expectedValue + tier avec TOUTES les gates (mort, plancher ROI, joignabilité)
 *   4. remplace les scores placeholder (jamais l'inverse : un vrai score n'est jamais écrasé par du vide)
 *   Les sociétés RADIÉES (score 0 « RADIÉE ») sont préservées telles quelles.
 *
 * Usage : npm run rescore            → tout le portefeuille
 *         npm run rescore -- <id..>  → fiches ciblées
 *         RESCORE_PROBE=0            → interdit le techProbe réseau (100 % offline)
 * Après : npm run reindex (pousse industry + score guéris vers la DB partagée).
 */
import { readFile, writeFile, readdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { buildAxes, weighted, tierOf, accroche, expectedValue, besoinFloor, besoinFromAudit, capUnreachable, type Meta, type Tier } from "./model.ts"
import { techProbe } from "./score.ts"
import { loadRules } from "../../../learning/scripts/rules.ts"
import { normalizeIndustry, isKnownIndustry } from "../../1_scraping/scripts/industries.ts"

const DIR = "data/prospects"
const isPlaceholder = (score: any): boolean =>
  !!score && !score.axes && (/fiche minimale|clé \.env|scoring non lancé/i.test((score.reasons ?? []).join(" ")) || score.reasons == null)
const isDead = (score: any): boolean => /RADIÉE|radiée|cessée/i.test((score?.reasons ?? []).join(" "))

async function rescoreFiche(id: string, rules: any): Promise<string | null> {
  const path = join(DIR, `${id}.json`)
  let fiche: any
  try { fiche = JSON.parse(await readFile(path, "utf8")) } catch { return `${id} : fiche illisible — sautée` }

  const before = { industry: fiche.industry, value: fiche.score?.value, tier: fiche.score?.tier, ev: fiche.score?.expectedValue }

  // 1. taxonomie — la clé canonique, écrite dans la fiche
  const industry = normalizeIndustry(fiche.industry)
  const industryChanged = industry !== fiche.industry
  fiche.industry = industry
  const unknownIndustry = industry && !isKnownIndustry(industry)

  // société radiée : verdict préservé (la gate a déjà parlé), on ne guérit que la taxonomie
  if (isDead(fiche.score)) {
    if (industryChanged) await writeFile(path, JSON.stringify(fiche, null, 2))
    return industryChanged ? `${id} : industry ${before.industry}→${industry} (score RADIÉE préservé)` : null
  }

  const meta: Meta = {
    industry,
    phone: fiche.identity?.phone || "",
    email: fiche.identity?.email || "",
    effectif: fiche.company?.employees ?? null,
    ca: fiche.company?.ca ?? null,
  }

  // 2. le BESOIN le plus honnête disponible : axes existants (tech+visuel) ∨ audit ∨ techProbe frais
  const audit = besoinFromAudit(fiche.audit)
  let besoinTech: number | null = typeof fiche.score?.axes?.besoin === "number" ? fiche.score.axes.besoin : null
  let techReasons: string[] = (fiche.score?.reasons ?? []).filter((r: string) => !/^axes —|^site déjà soigné|^audit : |plafonné|faisabilité|injoignable \(ni|placeholder|fiche minimale|clé \.env/i.test(r))
  let signals = fiche.score?.signals ?? {}
  if (besoinTech == null && !audit.besoin && fiche.existing?.url && process.env.RESCORE_PROBE !== "0") {
    try {
      const p = await techProbe(fiche.existing.url)
      besoinTech = p.besoin; techReasons = p.reasons; signals = p.signals
    } catch { /* réseau KO → on score avec ce qu'on a */ }
  }
  const besoin = Math.max(besoinTech ?? 0, audit.besoin)
  const besoinReasons = audit.besoin >= (besoinTech ?? 0) && audit.reasons.length ? [...audit.reasons, ...techReasons.slice(0, 2)] : [...techReasons, ...audit.reasons.slice(0, 2)]

  // 3. axes + gates — le MÊME modèle que la porte (score.ts), appliqué au portefeuille existant
  const axes = buildAxes(besoin, meta, signals, rules)
  const ev = expectedValue(axes)
  const feasible = (fiche.assets?.photos?.length ?? 0) >= 2 && !!(fiche.content?.services?.length || fiche.content?.about)
  const floor = besoinFloor(axes.valeur)

  let value: number, tier: Tier, reasons: string[]
  if (besoin < floor) {
    value = Math.min(weighted(axes), 30); tier = "cold"
    reasons = [`site déjà soigné — besoin de refonte faible (${besoin}/100 < plancher ${floor})`, ...besoinReasons.slice(0, 2)]
  } else {
    value = weighted(axes); tier = tierOf(value)
    reasons = [...besoinReasons]
    if (!feasible) { if (tier === "hot") tier = "warm"; reasons.push("faisabilité limitée (peu de contenu/photos)") }
    tier = capUnreachable(tier, meta, reasons)
  }
  if (unknownIndustry) reasons.push(`⚠ métier "${industry}" hors table INDUSTRIES → baselines génériques (à câbler)`)
  reasons.push(`axes — besoin ${axes.besoin} · levier ${axes.levier} · valeur ${axes.valeur} · closab. ${axes.closabilite} · expansion ${axes.expansion} → € espéré ${ev}`)

  const wasPlaceholder = isPlaceholder(fiche.score)
  fiche.score = { value, tier, reasons, axes, expectedValue: ev, signals, feasible, accroche: accroche(besoinReasons, industry) }
  await writeFile(path, JSON.stringify(fiche, null, 2))

  const delta = `${before.value ?? "∅"}/${before.tier ?? "∅"}→${value}/${tier} · €${before.ev ?? "∅"}→${ev}`
  const tags = [industryChanged ? `industry ${before.industry}→${industry}` : "", wasPlaceholder ? "PLACEHOLDER remplacé" : "", audit.besoin > (besoinTech ?? 0) ? `audit→besoin ${audit.besoin}` : ""].filter(Boolean).join(" · ")
  return `${id} : ${delta}${tags ? `  [${tags}]` : ""}`
}

// --- CLI ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith("-"))
  if (!wanted.length && !existsSync(DIR)) { console.log(`(aucune fiche : ${DIR}/ n'existe pas encore · usage : npm run rescore [-- <id> …])`); process.exit(0) }
  const ids = wanted.length ? wanted : (await readdir(DIR)).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""))
  const rules = await loadRules()
  console.log(`→ re-score de ${ids.length} fiche(s)…`)
  let changed = 0
  for (const id of ids) {
    const line = await rescoreFiche(id, rules)
    if (line) { changed++; console.log("  " + line) }
  }
  console.log(`✓ ${changed}/${ids.length} fiches mises à jour — lance \`npm run reindex\` pour pousser vers la DB.`)
}
