/**
 * Learning — POIDS DESIGN : agrège les NOTATIONS humaines (jauges 0-100 du cockpit) en signaux
 * « ce qui marche » → `data/learning/weights.json`. C'est le pendant DESIGN de learn.ts (qui, lui,
 * apprend du terrain commercial won/lost). Ici la source est le JUGEMENT de l'opérateur sur chaque
 * site généré, axe par axe (global, typo, layout, animation, couleurs, contenu).
 *
 *   npm run learn:weights   # lit generations.scores_json → écrit data/learning/weights.json
 *
 * PHILOSOPHIE — un MIROIR, pas un décideur :
 *  • On AGRÈGE (moyennes + n), on ne pondère ni ne shrink : c'est un tableau de bord brut que le
 *    composer (ou un humain) lira pour orienter ses choix. La décision reste en aval.
 *  • Dégradation propre : pas de DB / aucune gen notée → fichier avec count:0, jamais d'erreur.
 *
 * SORTIE — `data/learning/weights.json` (data/ est gitignoré, rebuildable) :
 *  { generatedAt, count, byAxis, byTemplate, byIndustry, byFont(*) } — voir l'en-tête écrit dans le JSON.
 */
import { writeFile, mkdir } from "node:fs/promises"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { tryDb } from "../../packages/shared/db.ts"

// CLI standalone : charger .env (DATABASE_URL) — sans ça tryDb() renvoie null et on n'agrège rien.
try { process.loadEnvFile() } catch { /* pas de .env → DB indispo, dégradation propre (count:0) */ }

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..")
const OUT_DIR = join(ROOT, "data", "learning")
const OUT_PATH = join(OUT_DIR, "weights.json")

// les axes notés dans le cockpit (cf. SCORE_AXES de app.js). `global` = la note d'ensemble.
const AXES = ["global", "typo", "layout", "animation", "couleurs", "contenu"] as const

type ScoredGen = {
  id: string
  template: string | null
  industry: string | null
  font: string | null // POINT D'EXTENSION : la fonte utilisée par la gen (null tant que non tracée — voir plus bas)
  dims: Record<string, number>
}

// accumulateur moyenne+n générique
type Agg = { sum: number; n: number }
const addAgg = (m: Record<string, Agg>, key: string, v: number) => {
  const a = m[key] || (m[key] = { sum: 0, n: 0 })
  a.sum += v; a.n++
}
const finalize = (m: Record<string, Agg>) =>
  Object.fromEntries(Object.entries(m).map(([k, a]) => [k, { avg: a.n ? Math.round(a.sum / a.n) : 0, n: a.n }]))

// charge les générations NOTÉES depuis la DB partagée + leurs métadonnées (template, industrie via JOIN).
async function loadScored(): Promise<ScoredGen[]> {
  const db = tryDb()
  if (!db) return []
  let rows: any[] = []
  try {
    rows = await db.prepare(`
      SELECT g.prospect_id AS id, g.template AS template, g.scores_json AS scores,
             p.industry AS industry
      FROM generations g LEFT JOIN prospects p ON p.id = g.prospect_id
      WHERE g.scores_json IS NOT NULL AND g.present = 1
    `).all()
  } catch { return [] }
  const out: ScoredGen[] = []
  for (const r of rows) {
    let parsed: any = null
    try { parsed = JSON.parse(r.scores) } catch { continue }
    const dims = (parsed && parsed.dims && typeof parsed.dims === "object") ? parsed.dims : null
    if (!dims) continue
    out.push({
      id: r.id, template: r.template || null, industry: r.industry || null,
      // POINT D'EXTENSION (poids par fonte) : la fonte utilisée par une gen n'est pas encore persistée en
      // DB. Quand elle le sera (colonne generations.font_pair ou champ dans scores_json), la lire ici —
      // ex. `font: r.font_pair || parsed.font || null` — alimentera byFont sans rien changer d'autre.
      font: null,
      dims,
    })
  }
  return out
}

// agrège : par axe (global), par template (note `global`), par industrie (note `global`).
function aggregate(gens: ScoredGen[]) {
  const byAxis: Record<string, Agg> = {}
  const byTemplate: Record<string, Agg> = {}
  const byIndustry: Record<string, Agg> = {}
  const byFont: Record<string, Agg> = {} // rempli quand `font` sera disponible (voir loadScored)
  for (const g of gens) {
    for (const ax of AXES) {
      const v = Number(g.dims[ax])
      if (Number.isFinite(v)) addAgg(byAxis, ax, v)
    }
    // sections dynamiques "section-1".."section-N" : on les agrège aussi par axe (préfixées)
    for (const [k, v] of Object.entries(g.dims)) {
      if (/^section-\d+$/.test(k) && Number.isFinite(Number(v))) addAgg(byAxis, k, Number(v))
    }
    const overall = Number(g.dims.global)
    if (Number.isFinite(overall)) {
      if (g.template) addAgg(byTemplate, g.template, overall)
      if (g.industry) addAgg(byIndustry, g.industry, overall)
      if (g.font) addAgg(byFont, g.font, overall)
    }
  }
  return {
    byAxis: finalize(byAxis),
    byTemplate: finalize(byTemplate),
    byIndustry: finalize(byIndustry),
    byFont: finalize(byFont),
  }
}

async function main() {
  const gens = await loadScored()
  const agg = aggregate(gens)
  const out = {
    // ── CONTRAT (lu par le composer / un humain ; rebuildable, gitignoré) ──
    // count : nb de générations notées agrégées.
    // byAxis : note moyenne {avg,n} par axe de design (global,typo,layout,animation,couleurs,contenu,
    //          + "section-N" dynamiques) → où on est fort / faible globalement.
    // byTemplate / byIndustry : note `global` moyenne {avg,n} par template et par industrie → ce qui
    //          PLAÎT (haut) vs pas (bas), pour orienter le choix de template/angle.
    // byFont : VIDE pour l'instant — POINT D'EXTENSION. La fonte d'une gen n'est pas encore persistée ;
    //          dès qu'elle le sera (cf. learning/scripts/weights.ts → loadScored, commentaire « POINT
    //          D'EXTENSION »), byFont se remplira automatiquement et donnera le score moyen PAR FONTE.
    _contract: "Poids design agrégés depuis les notations cockpit (jauges 0-100). Miroir, pas décideur.",
    generatedAt: new Date().toISOString(),
    count: gens.length,
    ...agg,
  }
  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n")
  console.log(`✓ poids design → ${OUT_PATH}`)
  console.log(`  ${gens.length} génération(s) notée(s) · ${Object.keys(agg.byTemplate).length} template(s) · ${Object.keys(agg.byIndustry).length} industrie(s)`)
  if (!gens.length) console.log("  (aucune notation encore — note des sites dans le cockpit, section « notation »)")
}

main().catch((e) => { console.error("✗ learn:weights :", e?.message || e); process.exit(1) })
