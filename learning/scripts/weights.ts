/**
 * Learning — DESIGN WEIGHTS: aggregates the human RATINGS (the cockpit's 0-100 gauges) into "what works"
 * signals → `data/learning/weights.json`. It is the DESIGN counterpart of learn.ts (which learns from
 * sales won/lost). Here the source is the operator's JUDGEMENT on each
 * generated site, axis by axis (global, typo, layout, animation, couleurs = colours, contenu = content).
 *
 *   npm run learn:weights   # reads generations.scores_json → writes data/learning/weights.json
 *
 * PHILOSOPHY — a MIRROR, not a decision maker:
 *  • We AGGREGATE (averages + n), we neither weight nor shrink: it is a raw dashboard the
 *    composer (or a human) will read to steer its choices. The decision stays downstream.
 *  • Clean degradation: no DB / no rated generation → a file with count:0, never an error.
 *
 * OUTPUT — `data/learning/weights.json` (data/ is gitignored, rebuildable):
 *  { generatedAt, count, byAxis, byTemplate, byIndustry, byFont(*) } — see the header written into the JSON.
 */
import { writeFile, mkdir } from "node:fs/promises"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { tryDb } from "../../packages/shared/db.ts"

// Standalone CLI: load .env (DATABASE_URL) — without it tryDb() returns null and nothing is aggregated.
try { process.loadEnvFile() } catch { /* no .env → no DB, clean degradation (count:0) */ }

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..")
const OUT_DIR = join(ROOT, "data", "learning")
const OUT_PATH = join(OUT_DIR, "weights.json")

// the axes rated in the cockpit (see SCORE_AXES in app.js). `global` = the overall rating. The keys are stored data.
const AXES = ["global", "typo", "layout", "animation", "couleurs", "contenu"] as const

type ScoredGen = {
  id: string
  template: string | null
  industry: string | null
  font: string | null // EXTENSION POINT: the font the generation used (null until tracked — see below)
  dims: Record<string, number>
}

// generic average+n accumulator
type Agg = { sum: number; n: number }
const addAgg = (m: Record<string, Agg>, key: string, v: number) => {
  const a = m[key] || (m[key] = { sum: 0, n: 0 })
  a.sum += v; a.n++
}
const finalize = (m: Record<string, Agg>) =>
  Object.fromEntries(Object.entries(m).map(([k, a]) => [k, { avg: a.n ? Math.round(a.sum / a.n) : 0, n: a.n }]))

// loads the RATED generations from the shared DB + their metadata (template, industry through a JOIN).
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
      // EXTENSION POINT (weights per font): the font a generation used is not persisted in the
      // DB yet. When it is (a generations.font_pair column or a field in scores_json), read it here —
      // e.g. `font: r.font_pair || parsed.font || null` — it will feed byFont without changing anything else.
      font: null,
      dims,
    })
  }
  return out
}

// aggregates: per axis (global), per template (`global` rating), per industry (`global` rating).
function aggregate(gens: ScoredGen[]) {
  const byAxis: Record<string, Agg> = {}
  const byTemplate: Record<string, Agg> = {}
  const byIndustry: Record<string, Agg> = {}
  const byFont: Record<string, Agg> = {} // filled once `font` is available (see loadScored)
  for (const g of gens) {
    for (const ax of AXES) {
      const v = Number(g.dims[ax])
      if (Number.isFinite(v)) addAgg(byAxis, ax, v)
    }
    // dynamic sections "section-1".."section-N": aggregated per axis too (prefixed)
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
    // ── CONTRACT (read by the composer / a human; rebuildable, gitignored) ──
    // count: number of rated generations aggregated.
    // byAxis: average rating {avg,n} per design axis (global,typo,layout,animation,couleurs,contenu,
    //          + dynamic "section-N") → where we are strong / weak overall.
    // byTemplate / byIndustry: average `global` rating {avg,n} per template and per industry → what
    //          PLEASES (high) vs not (low), to steer the choice of template/angle.
    // byFont: EMPTY for now — EXTENSION POINT. A generation's font is not persisted yet;
    //          as soon as it is (see learning/scripts/weights.ts → loadScored, the "EXTENSION POINT"
    //          comment), byFont fills itself and gives the average score PER FONT.
    _contract: "Design weights aggregated from the cockpit ratings (0-100 gauges). A mirror, not a decision maker.",
    generatedAt: new Date().toISOString(),
    count: gens.length,
    ...agg,
  }
  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n")
  console.log(`✓ design weights → ${OUT_PATH}`)
  console.log(`  ${gens.length} rated generation(s) · ${Object.keys(agg.byTemplate).length} template(s) · ${Object.keys(agg.byIndustry).length} industr(y/ies)`)
  if (!gens.length) console.log("  (no ratings yet — rate sites in the cockpit)")
}

main().catch((e) => { console.error("✗ learn:weights :", e?.message || e); process.exit(1) })
