/**
 * Learning — RECALCULE les règles depuis les retours terrain (`data/outcomes.jsonl`) → `learning/rules/rules.json`
 * (+ un rapport lisible `learning/analysis/report.md`). Puis le prochain scoring les applique. La boucle est fermée.
 *
 *   npm run learn          # lit les retours → écrit règles + rapport
 *
 * Sources : `data/outcomes.jsonl` + (si DATABASE_URL) le miroir `outreach_events` de type `outcome` écrit par le
 * CRM du cockpit, qui tourne souvent sur une autre machine que ce script (timer de nuit lws-learn sur la box).
 * Fusion dédoublonnée (prospect + issue + horodatage).
 *
 * PHILOSOPHIE — la boucle AFFINE, elle ne décide pas :
 *  • Shrinkage anti-petit-N : un delta est multiplié par la confiance n/(n+prior). 2 retours ≈ 0 ; il faut
 *    du volume pour bouger une baseline. C'est le garde-fou contre le sur-apprentissage sur une anecdote.
 *  • Bornes serrées : |delta value| ≤ 15, multiplicateur de signal ∈ [0.5, 1.5]. La règle humaine reste le socle.
 *  • Deux choses apprises : (1) quels MÉTIERS convertissent vraiment → nuance leur valeur-ticket ;
 *    (2) quels SIGNAUX gratuits prédisent la vente → ajuste leur bonus.
 */
import { writeFile, mkdir } from "node:fs/promises"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { OUTCOME_WEIGHT, type Outcome, type RulesFile } from "./types.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..")
const OUTCOMES_PATH = join(ROOT, "data", "outcomes.jsonl")
const RULES_PATH = join(HERE, "..", "rules", "rules.json")
const REPORT_PATH = join(HERE, "..", "analysis", "report.md")

// — constantes de calibration (la prudence est volontaire) —
const VALUE_SCALE = 30 // points de delta `value` par unité de lift de conversion (lift 0.3 → +9 avant shrinkage)
const IND_PRIOR = 8 // force du prior métier : n de retours pour atteindre 50 % de confiance
const IND_CAP = 15 // |delta value| max par métier
const SIG_SCALE = 1.0 // amplitude du multiplicateur de signal
const SIG_PRIOR = 5 // prior des signaux (sur min(nWith, nWithout))
const SIG_MIN = 0.5
const SIG_MAX = 1.5

const SIGNAL_KEYS = ["gallery", "quoteCta", "social", "premium", "multiSite", "ecommerce", "booking", "blog"] as const

const clampN = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const succ = (o: Outcome) => OUTCOME_WEIGHT[o.outcome] ?? 0

type IndEvidence = { industry: string; n: number; rate: number; conf: number; valueDelta: number }
type SigEvidence = { signal: string; nWith: number; nWithout: number; lift: number; conf: number; mult: number }

/** Rang dans le funnel : une issue TERMINALE (won/lost) l'emporte sur un RDV, un RDV sur une réponse, une réponse sur « sent ». */
const STAGE: Record<string, number> = { sent: 0, reply: 1, meeting: 2, won: 3, lost: 3 }

/**
 * UN essai par prospect : son ÉTAT FINAL. Un prospect laisse plusieurs lignes au fil du funnel (sent → reply →
 * meeting → won, ou … → lost) ; les compter comme autant d'essais faisait d'un RDV perdu un « demi-succès » (0,3 en
 * moyenne) et pesait trois fois chaque vente (test blitz du 24/10). L'état final = l'étape la plus AVANCÉE du funnel
 * (les horodatages ne départagent qu'à étape égale, won contre lost par exemple) : le séquenceur (la box) et le CRM
 * (le cockpit) n'ont pas la même horloge, un « reply » horodaté plus tard qu'un « won » ne doit pas l'effacer.
 */
export function finalOutcomes(outcomes: Outcome[]): Outcome[] {
  const best = new Map<string, Outcome>()
  const rank = (o: Outcome) => [STAGE[o.outcome] ?? 0, o.ts || "", succ(o)] as const
  const better = (a: Outcome, b: Outcome) => { const ra = rank(a), rb = rank(b); return ra[0] !== rb[0] ? ra[0] > rb[0] : ra[1] !== rb[1] ? ra[1] > rb[1] : ra[2] > rb[2] }
  for (const o of outcomes) {
    const cur = best.get(o.id)
    if (!cur) { best.set(o.id, o); continue }
    // l'état final, avec les features les plus complètes connues pour ce prospect
    const win = better(o, cur) ? o : cur, other = win === o ? cur : o
    best.set(o.id, { ...win, industry: win.industry && win.industry !== "?" ? win.industry : other.industry, signals: win.signals && Object.keys(win.signals).length ? win.signals : other.signals, axes: win.axes ?? other.axes })
  }
  return [...best.values()]
}

/**
 * Le calcul PUR (testable, sans I/O) : retours → règles bornées et shrinkées (un essai par prospect).
 * `now` injecté pour rester déterministe.
 */
export function buildRules(rows: Outcome[], now: string): RulesFile {
  const outcomes = finalOutcomes(rows)
  const file: RulesFile = { updatedAt: now, totalOutcomes: rows.length, prospects: outcomes.length, industries: {}, signals: {} }
  if (outcomes.length === 0) return file
  const globalRate = mean(outcomes.map(succ))

  // (1) MÉTIERS : taux de conversion réel vs moyenne → delta `value` (borné, shrinké)
  const byInd = new Map<string, Outcome[]>()
  for (const o of outcomes) {
    const arr = byInd.get(o.industry) ?? []
    arr.push(o)
    byInd.set(o.industry, arr)
  }
  const indEvidence: IndEvidence[] = []
  for (const [industry, os] of byInd) {
    const n = os.length
    const rate = mean(os.map(succ))
    const conf = n / (n + IND_PRIOR)
    const valueDelta = clampN(Math.round((rate - globalRate) * VALUE_SCALE * conf), -IND_CAP, IND_CAP)
    if (valueDelta !== 0) file.industries![industry] = { value: valueDelta }
    indEvidence.push({ industry, n, rate: +rate.toFixed(2), conf: +conf.toFixed(2), valueDelta })
  }

  // (2) SIGNAUX : lift (présent vs absent) → multiplicateur de bonus (borné, shrinké)
  const sigEvidence: SigEvidence[] = []
  for (const k of SIGNAL_KEYS) {
    const withS = outcomes.filter((o) => o.signals?.[k])
    const without = outcomes.filter((o) => !o.signals?.[k])
    if (!withS.length || !without.length) continue // pas de contraste → on ne peut rien dire
    const lift = mean(withS.map(succ)) - mean(without.map(succ))
    const nMin = Math.min(withS.length, without.length)
    const conf = nMin / (nMin + SIG_PRIOR)
    const mult = clampN(1 + lift * SIG_SCALE * conf, SIG_MIN, SIG_MAX)
    if (Math.abs(mult - 1) > 0.01) file.signals![k] = +mult.toFixed(2)
    sigEvidence.push({ signal: k, nWith: withS.length, nWithout: without.length, lift: +lift.toFixed(2), conf: +conf.toFixed(2), mult: +mult.toFixed(2) })
  }

  file.evidence = { globalRate: +globalRate.toFixed(2), industries: indEvidence, signals: sigEvidence }
  return file
}

function renderReport(file: RulesFile): string {
  const ev = file.evidence as { globalRate: number; industries: IndEvidence[]; signals: SigEvidence[] } | undefined
  const L: string[] = []
  L.push("# Learning — rapport de calibration", "", `> Généré par \`npm run learn\` le ${file.updatedAt}. **Ne pas éditer à la main** (régénéré).`, "")
  L.push(`**Retours analysés : ${file.totalOutcomes}, soit ${file.prospects ?? file.totalOutcomes} prospect(s) (un essai par prospect : son état final).** ${(file.prospects ?? file.totalOutcomes) < 10 ? "⚠ Échantillon faible → deltas volontairement minuscules (shrinkage). Continue d'enregistrer des retours." : ""}`, "")
  if (!file.totalOutcomes) {
    L.push("Aucun retour pour l'instant. Le scoring tourne sur ses baselines humaines (comportement par défaut).", "", "Enregistre un retour : `npm run learn:record -- <id> <won|lost|reply|meeting|sent>`.")
    return L.join("\n") + "\n"
  }
  L.push(`Taux de succès global : **${ev?.globalRate}** (état final de chaque prospect : won=1 · meeting=.6 · reply=.3 · sent/lost=0).`, "")
  L.push("## Métiers — delta de valeur-ticket appris", "", "| métier | prospects | taux | confiance | Δ value |", "|---|---:|---:|---:|---:|")
  for (const r of ev?.industries ?? []) L.push(`| ${r.industry} | ${r.n} | ${r.rate} | ${r.conf} | ${r.valueDelta >= 0 ? "+" : ""}${r.valueDelta} |`)
  L.push("", "## Signaux gratuits — multiplicateur de bonus appris", "", "| signal | n avec | n sans | lift | confiance | ×mult |", "|---|---:|---:|---:|---:|---:|")
  for (const r of ev?.signals ?? []) L.push(`| ${r.signal} | ${r.nWith} | ${r.nWithout} | ${r.lift >= 0 ? "+" : ""}${r.lift} | ${r.conf} | ${r.mult} |`)
  L.push("", "_Les deltas/multipliers sont bornés (value ±15, mult 0.5–1.5) et atténués par la confiance : la boucle affine, elle ne remplace pas le jugement humain._")
  return L.join("\n") + "\n"
}

/** Les retours du fichier + ceux du miroir en base (CRM du cockpit), dédoublonnés. */
export async function loadOutcomes(): Promise<{ outcomes: Outcome[]; fromFile: number; fromDb: number }> {
  const { readOutcomesFile } = await import("./record.ts")
  const file = await readOutcomesFile(OUTCOMES_PATH)
  const key = (o: Outcome) => `${o.id}|${o.outcome}|${o.ts}`
  const seen = new Set(file.map(key))
  const all = [...file]
  let fromDb = 0
  if (process.env.DATABASE_URL) {
    try {
      const { readEvents } = await import("../../outreach/tracking/events.ts")
      for (const e of await readEvents({ types: ["outcome"] })) {
        const o = e.data as Outcome | undefined
        if (!o || typeof o.id !== "string" || typeof o.outcome !== "string" || seen.has(key(o))) continue
        seen.add(key(o)); all.push(o); fromDb++
      }
    } catch { /* base indisponible : le fichier seul */ }
  }
  return { outcomes: all, fromFile: file.length, fromDb }
}

// --- CLI ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile() } catch { /* pas de .env : fichier seul */ }
  const { outcomes, fromDb } = await loadOutcomes()
  if (fromDb) console.log(`  + ${fromDb} retour(s) lus dans la base (CRM du cockpit)`)

  const file = buildRules(outcomes, new Date().toISOString())
  await mkdir(dirname(RULES_PATH), { recursive: true })
  await mkdir(dirname(REPORT_PATH), { recursive: true })
  await writeFile(RULES_PATH, JSON.stringify(file, null, 2) + "\n")
  await writeFile(REPORT_PATH, renderReport(file))

  const nInd = Object.keys(file.industries ?? {}).length
  const nSig = Object.keys(file.signals ?? {}).length
  console.log(`✓ règles recalculées depuis ${outcomes.length} retour(s), ${file.prospects} prospect(s) → ${RULES_PATH}`)
  console.log(`  ${nInd} métier(s) ajusté(s), ${nSig} signal(aux) ajusté(s). Rapport : learning/analysis/report.md`)
  if ((file.prospects ?? 0) < 10) console.log("  ⚠ échantillon faible : deltas volontairement minuscules (shrinkage). Le scoring reste quasi sur ses baselines.")
  const { closeDb } = await import("../../packages/shared/db.ts"); closeDb()
}
