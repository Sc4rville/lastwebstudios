/**
 * Learning — ENREGISTRE un retour terrain (le carburant de la boucle).
 *
 *   npm run learn:record -- <id> <sent|reply|meeting|won|lost> [industry]
 *
 * Récupère les features au moment du scoring (axes + signaux) depuis la fiche du prospect, et les couple
 * à l'issue → une ligne append-only dans `data/outcomes.jsonl`. C'est ce couplage features↔issue qui
 * permet à `learn` de mesurer ce qui prédit vraiment une vente.
 *
 * AUTOMATIQUE depuis la nuit du 2026-10-24 (`recordOutcome`, importable) : le CRM enregistre lui-même
 * `meeting` (RDV calé), `won` (carte posée en Signature) et `lost` (« perdu » dans le cockpit d'appel), le
 * séquenceur enregistre `reply` (le lecteur de réponses). `dedupe` : une même issue n'est comptée qu'UNE fois
 * par prospect (re-glisser une carte en Signature ne gonfle pas le taux). Miroir dans la base partagée
 * (`outreach_events`, type `outcome`) : le cockpit (conteneur) et `npm run learn` (la box, timer de nuit) ne
 * partagent pas de disque ; `learn` fusionne les deux sources.
 */
import { readFile, appendFile, mkdir } from "node:fs/promises"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { OUTCOMES, type Outcome, type OutcomeKind } from "./types.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
export const OUTCOMES_FILE = join(ROOT, "data", "outcomes.jsonl")

/** La fiche enrichie (`prospects/<id>.json`, bloc `.score`), complétée par le score brut (`raw/<id>.score.json`)
 *  pour ce qui manque à la fiche (axes, signaux) ; le score brut seul si la fiche n'existe pas. */
async function readScored(id: string): Promise<any | null> {
  const read = async (p: string) => { try { return JSON.parse(await readFile(p, "utf8")) } catch { return null } }
  const sheet = await read(join(ROOT, "data", "prospects", `${id}.json`))
  const raw = await read(join(ROOT, "data", "raw", `${id}.score.json`))
  if (!sheet) return raw
  if (raw) sheet.score = { ...raw, ...(sheet.score || {}), axes: sheet.score?.axes ?? raw.axes, signals: sheet.score?.signals ?? raw.signals }
  return sheet
}

/** Les retours du fichier (lignes cassées ignorées). */
export async function readOutcomesFile(file = OUTCOMES_FILE): Promise<Outcome[]> {
  try {
    return (await readFile(file, "utf8")).split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l) as Outcome } catch { return null } })
      .filter((o): o is Outcome => !!o && typeof o.id === "string" && OUTCOMES.includes(o.outcome))
  } catch { return [] }
}

export type RecordResult = { recorded: boolean; outcome: Outcome; reason?: string; mirrored?: boolean }

/**
 * Enregistre une issue pour un prospect. `dedupe` (défaut : true) : ne fait rien si cette issue est déjà
 * enregistrée pour ce prospect. Ne lève jamais pour un souci d'écriture du miroir base.
 */
export async function recordOutcome(id: string, kind: OutcomeKind, o: { industry?: string; dedupe?: boolean; source?: string; at?: string } = {}): Promise<RecordResult> {
  if (!OUTCOMES.includes(kind)) throw new Error(`issue inconnue : ${kind} (attendu : ${OUTCOMES.join("|")})`)
  const rec = await readScored(id)
  const score = rec?.score ?? rec // prospects/<id>.json porte `.score` ; raw/<id>.score.json EST le score
  const outcome: Outcome = {
    id,
    industry: o.industry ?? rec?.industry ?? "?",
    value: score?.value,
    tier: score?.tier,
    axes: score?.axes,
    signals: score?.signals ?? {},
    outcome: kind,
    ts: o.at ?? new Date().toISOString(),
  }
  if (o.dedupe !== false && (await readOutcomesFile()).some((x) => x.id === id && x.outcome === kind)) {
    return { recorded: false, outcome, reason: "déjà enregistré" }
  }
  await mkdir(dirname(OUTCOMES_FILE), { recursive: true })
  await appendFile(OUTCOMES_FILE, JSON.stringify(outcome) + "\n")
  let mirrored = false
  if (process.env.DATABASE_URL) {
    try {
      const { recordEvent, stableId } = await import("../../outreach/tracking/events.ts")
      const r = await recordEvent({ id: stableId(`outcome\n${id}\n${kind}\n${outcome.ts}`), type: "outcome", source: "crm", prospectId: id, at: outcome.ts, data: { ...outcome, by: o.source ?? null } })
      mirrored = r.stored === "db"
    } catch { /* la ligne de fichier fait foi */ }
  }
  return { recorded: true, outcome, mirrored, ...(rec ? {} : { reason: "sans fiche : features vides" }) }
}

// --- CLI ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile() } catch { /* pas de .env : fichier seul */ }
  const [id, outcome, industryArg] = process.argv.slice(2)
  if (!id || !outcome || !OUTCOMES.includes(outcome as OutcomeKind)) {
    console.error(`usage: npm run learn:record -- <id> <${OUTCOMES.join("|")}> [industry]`)
    process.exit(1)
  }
  // la CLI garde son comportement d'origine : chaque appel = une ligne (pas de dédoublonnage)
  const r = await recordOutcome(id, outcome as OutcomeKind, { industry: industryArg, dedupe: false, source: "cli" })
  if (r.reason === "sans fiche : features vides") console.warn(`⚠ aucune fiche/score trouvé pour « ${id} » — retour enregistré sans features (axes/signaux vides).`)
  console.log(`✓ retour enregistré : ${id} → ${outcome} (${r.outcome.industry}). Recalcule les règles avec : npm run learn`)
  const { closeDb } = await import("../../packages/shared/db.ts"); closeDb()
}
