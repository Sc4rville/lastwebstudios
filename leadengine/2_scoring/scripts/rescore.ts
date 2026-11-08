/**
 * rescore.ts — HEALING the portfolio: an OFFLINE re-score of every prospect sheet (data/prospects/*.json).
 *
 * Why: the 2026-07-02 audit showed a sick portfolio — 3 diverging taxonomies (36 % of the
 * sheets scored on generic baselines), 5 hard-coded PLACEHOLDER scores ("80/hot, .env key
 * empty"), half the sheets without axes, expectedValue present on 2/94, and the AUDIT signal never
 * fed back into the need (a real framer's case: cold "modern site" despite 5.9 s + 22 dead images).
 *
 * This script fixes all of that WITHOUT an LLM or Playwright:
 *   1. normalises `industry` (normalizeIndustry — the canonical vocabulary of industries.ts) and writes it
 *   2. need = max(existing technical need, AUDIT need (besoinFromAudit), a fresh techProbe if nothing)
 *   3. rebuilds the 5 axes + expectedValue + tier with ALL the gates (dead, ROI floor, reachability)
 *   4. replaces placeholder scores (never the other way round: a real score is never overwritten by nothing)
 *   STRUCK OFF companies (score 0 "RADIÉE") are kept as they are.
 * The `reasons` it writes stay French codes on purpose (see model.ts); its own log lines are English.
 *
 * Usage: npm run rescore            → the whole portfolio
 *        npm run rescore -- <id..>  → targeted sheets
 *        RESCORE_PROBE=0            → forbids the network techProbe (100 % offline)
 * Afterwards: npm run reindex (pushes the healed industry + score to the shared DB).
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
  try { fiche = JSON.parse(await readFile(path, "utf8")) } catch { return `${id}: unreadable sheet — skipped` }

  const before = { industry: fiche.industry, value: fiche.score?.value, tier: fiche.score?.tier, ev: fiche.score?.expectedValue }

  // 1. taxonomy — the canonical key, written to the sheet
  const industry = normalizeIndustry(fiche.industry)
  const industryChanged = industry !== fiche.industry
  fiche.industry = industry
  const unknownIndustry = industry && !isKnownIndustry(industry)

  // struck-off company: verdict kept (the gate has spoken), only the taxonomy is healed
  if (isDead(fiche.score)) {
    if (industryChanged) await writeFile(path, JSON.stringify(fiche, null, 2))
    return industryChanged ? `${id}: industry ${before.industry}→${industry} (struck-off score kept)` : null
  }

  const meta: Meta = {
    industry,
    phone: fiche.identity?.phone || "",
    email: fiche.identity?.email || "",
    effectif: fiche.company?.employees ?? null,
    ca: fiche.company?.ca ?? null,
  }

  // 2. the most honest NEED available: existing axes (tech+visual) ∨ audit ∨ a fresh techProbe
  const audit = besoinFromAudit(fiche.audit)
  let besoinTech: number | null = typeof fiche.score?.axes?.besoin === "number" ? fiche.score.axes.besoin : null
  let techReasons: string[] = (fiche.score?.reasons ?? []).filter((r: string) => !/^axes —|^site déjà soigné|^audit : |plafonné|faisabilité|injoignable \(ni|placeholder|fiche minimale|clé \.env/i.test(r))
  let signals = fiche.score?.signals ?? {}
  if (besoinTech == null && !audit.besoin && fiche.existing?.url && process.env.RESCORE_PROBE !== "0") {
    try {
      const p = await techProbe(fiche.existing.url)
      besoinTech = p.besoin; techReasons = p.reasons; signals = p.signals
    } catch { /* network down → score with what we have */ }
  }
  const besoin = Math.max(besoinTech ?? 0, audit.besoin)
  const besoinReasons = audit.besoin >= (besoinTech ?? 0) && audit.reasons.length ? [...audit.reasons, ...techReasons.slice(0, 2)] : [...techReasons, ...audit.reasons.slice(0, 2)]

  // 3. axes + gates — the SAME model as the gate (score.ts), applied to the existing portfolio
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
  const tags = [industryChanged ? `industry ${before.industry}→${industry}` : "", wasPlaceholder ? "PLACEHOLDER replaced" : "", audit.besoin > (besoinTech ?? 0) ? `audit→need ${audit.besoin}` : ""].filter(Boolean).join(" · ")
  return `${id}: ${delta}${tags ? `  [${tags}]` : ""}`
}

// --- CLI ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith("-"))
  if (!wanted.length && !existsSync(DIR)) { console.log(`(no prospect sheet: ${DIR}/ doesn't exist yet · usage: npm run rescore [-- <id> …])`); process.exit(0) }
  const ids = wanted.length ? wanted : (await readdir(DIR)).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""))
  const rules = await loadRules()
  console.log(`→ re-scoring ${ids.length} sheet(s)…`)
  let changed = 0
  for (const id of ids) {
    const line = await rescoreFiche(id, rules)
    if (line) { changed++; console.log("  " + line) }
  }
  console.log(`✓ ${changed}/${ids.length} sheets updated — run \`npm run reindex\` to push them to the DB.`)
}
