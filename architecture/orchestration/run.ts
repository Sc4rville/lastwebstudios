/**
 * Orchestration — LE CHEF. Enchaîne tout le pipeline sur le seed, en entonnoir.
 *
 * ⚠⚠ VOIE TEMPLATE-FILL (SECONDAIRE) ⚠⚠
 * Ce script fait : score → parse → fiche → fill → polish → animate. Le `fill` verse la fiche dans
 * UN SEUL template par défaut (`poliform`) pour TOUS les prospects → rendus quasi identiques
 * ("clones"). C'est la voie cheap/prouvée, PAS le rendu premium.
 * Pour du SUR-MESURE (la voie principale) → le **composer** : `architecture/orchestration/compose-batch.md`
 * (orchestrateur d'agents diagnose→compose→beauty-gate). Le composer N'EST PAS ici (il tourne en agents).
 * Cf. docs/STATUS.md « DEUX voies de design » + docs/DESIGN-ENGINE.md.
 *
 * Pour chaque prospect :
 *   score (la porte) → si retenu : parse → structure → fill → polish → animate
 * Chronomètre chaque maillon. SEED=<chemin> cible un autre seed ; DESIGN=0 s'arrête à la fiche.
 *
 * Usage : npm run pipeline   (template-fill ; pour le sur-mesure voir compose-batch.md)
 */
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { scoreProspect } from "../../leadengine/2_scoring/scripts/score.ts"
import { parsePage } from "../../leadengine/3_parsing/scripts/parse.ts"
import { structureFiche } from "../../leadengine/3_parsing/scripts/structure.ts"

// design (voie template-fill) : chargée À LA DEMANDE. L'édition open source ne l'embarque pas (elle dépend de
// design/templates/, des sites tiers copiés) : le composer (`npm run first-site`, le worker) est sa seule voie de
// construction. Spécificateurs calculés pour que le typecheck passe sans ces fichiers.
type DesignSteps = { fillSite: (id: string) => Promise<unknown>; polishSite: (id: string) => Promise<unknown>; animateSite: (id: string) => Promise<unknown> }
async function loadDesignSteps(): Promise<DesignSteps> {
  const base = "../../design/scripts/"
  try {
    const [f, p, a] = await Promise.all([import(base + "fill.ts"), import(base + "polish.ts"), import(base + "animate.ts")])
    return { fillSite: f.fillSite, polishSite: p.polishSite, animateSite: a.animateSite }
  } catch (e) {
    throw new Error(`template-fill indisponible dans cette édition (design/scripts/fill.ts absent) : construis avec le composer (npm run first-site -- <url>, ou le worker). DESIGN=0 arrête le pipeline à la fiche. (${(e as Error).message})`)
  }
}

// charge .env soi-même (ne pas dépendre du cwd du scheduler) — cf. cron robustness
try { process.loadEnvFile() } catch { /* pas de .env : on lira l'environnement */ }

// DESIGN=0 → s'arrêter à la fiche (lead engine seul) ; sinon fiche → fill → polish (défaut : bout en bout)
const DESIGN = process.env.DESIGN !== "0"

// SEED=<chemin> cible un autre seed (défaut : cuisinistes). Ex : SEED=data/raw/prospects.seed.csv
const SEED = process.env.SEED || join("data", "raw", "cuisinistes.seed.csv")

const slug = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

const now = () => performance.now()
const ms = (t: number) => `${Math.round(performance.now() - t)}ms`

type Row = { name: string; city: string; website: string; phone?: string; industry: string; email?: string }

function parseCsv(text: string): Row[] {
  const [header, ...lines] = text.trim().split("\n")
  const cols = header.split(",").map((c) => c.trim())
  return lines.filter(Boolean).map((line) => {
    const cells = line.split(",")
    const row: Record<string, string> = {}
    cols.forEach((c, i) => (row[c] = (cells[i] ?? "").trim()))
    return {
      name: row.name,
      city: row.city,
      website: row.website,
      phone: row.phone,
      industry: row.industry || "cuisiniste",
      email: row.email,
    }
  })
}

const force = process.env.FORCE === "1" // ignore la porte (debug)

// GARDE-BARRIÈRE (opt-in via INDUSTRY=<métier>) : avant de tourner, on GARANTIT d'avoir LIMIT prospects
// FRAIS pour ce métier. S'il en manque (besoin 5, dispo 2), on scrape le DELTA (3) — sinon on se contente
// du SEED fixe (comportement historique). Les prospects restent répertoriés (registre + CSV du scraper).
let rows: Row[]
if (process.env.INDUSTRY) {
  const need = Number(process.env.LIMIT) || 5
  const { ensureProspects, freshProspects } = await import("../../leadengine/1_scraping/scripts/ensure.ts")
  await ensureProspects(process.env.INDUSTRY, process.env.ZONE || "fr", need)
  const { SCRAPED } = await import("../../leadengine/1_scraping/scripts/registry.ts")
  const byId = new Map(parseCsv(await readFile(SCRAPED, "utf8")).map((r) => [slug(`${r.name}-${r.city}`), r]))
  rows = (await freshProspects(process.env.INDUSTRY)).slice(0, need).map((p) => byId.get(p.id)).filter((r): r is Row => !!r)
} else {
  if (!existsSync(SEED)) {
    console.error(`✗ seed introuvable : ${SEED}\n  Pose SEED=<chemin d'un CSV name,city,website,phone,industry,email> (ex. un seed fictif : test/fixtures/seeds/orvane.seed.csv)`)
    process.exit(1)
  }
  const allRows = parseCsv(await readFile(SEED, "utf8"))
  rows = allRows.slice(0, Number(process.env.LIMIT) || allRows.length)
}

// PIPELINE_JSON=1 → émet un évènement JSON par ligne (flux machine-lisible) au lieu du joli affichage
const JSONMODE = process.env.PIPELINE_JSON === "1"
const ev = (e: Record<string, unknown>) => JSONMODE && console.log(JSON.stringify(e))

if (JSONMODE) ev({ type: "run-start", count: rows.length, force })
else console.log(`\n🏭 PIPELINE — ${rows.length} prospects${force ? " (FORCE: porte ignorée)" : ""}\n`)

const report: { id: string; verdict: string; time: string }[] = []
const tAll = now()

for (const row of rows) {
  const id = slug(`${row.name}-${row.city}`)
  const t0 = now()
  ev({ type: "prospect-start", id, name: row.name, city: row.city })
  if (!JSONMODE) process.stdout.write(`• ${id} … `)
  try {
    ev({ type: "step", id, step: "scoring" })
    const score = await scoreProspect(id, row.website, { industry: row.industry, phone: row.phone, email: row.email, name: row.name, city: row.city })
    if (!force && score.tier === "cold") {
      ev({ type: "prospect-done", id, verdict: "jete", score: score.value, tier: score.tier })
      if (!JSONMODE) console.log(`JETÉ (${score.value}/100) [${ms(t0)}]`)
      report.push({ id, verdict: `jeté (${score.value})`, time: ms(t0) })
      continue
    }
    ev({ type: "step", id, step: "parsing" })
    const tp = now()
    await parsePage(id, row.website)
    const parseT = Math.round(performance.now() - tp)
    ev({ type: "step", id, step: "structure" })
    const ts = now()
    await structureFiche(id, row.industry, { name: row.name, city: row.city, phone: row.phone }, score)
    const structT = Math.round(performance.now() - ts)
    if (!DESIGN) {
      ev({
        type: "prospect-done", id, verdict: "fiche", score: score.value, tier: score.tier,
        timings: { parse: parseT, structure: structT, total: Math.round(performance.now() - t0) },
      })
      if (!JSONMODE)
        console.log(`✅ FICHE (${score.value}/100) — parse ${parseT}ms · struct ${structT}ms [total ${ms(t0)}]  (design off)`)
      report.push({ id, verdict: `fiche (${score.value})`, time: ms(t0) })
      continue
    }
    // design : fiche → fill (maillon 6) → polish (maillon 7) = site livrable
    const { fillSite, polishSite, animateSite } = await loadDesignSteps()
    ev({ type: "step", id, step: "fill" })
    const tf = now()
    await fillSite(id)
    const fillT = Math.round(performance.now() - tf)
    ev({ type: "step", id, step: "polish" })
    const tpo = now()
    await polishSite(id)
    const polishT = Math.round(performance.now() - tpo)
    ev({ type: "step", id, step: "animate" })
    const ta = now()
    await animateSite(id) // rejoue les scroll-animations si le template en a (no-op sinon)
    const animT = Math.round(performance.now() - ta)
    ev({
      type: "prospect-done", id, verdict: "bati", score: score.value, tier: score.tier,
      timings: { parse: parseT, structure: structT, fill: fillT, polish: polishT, animate: animT, total: Math.round(performance.now() - t0) },
    })
    if (!JSONMODE)
      console.log(
        `✅ BÂTI (${score.value}/100) — parse ${parseT} · struct ${structT} · fill ${fillT} · polish ${polishT} · anim ${animT}ms [total ${ms(t0)}]`,
      )
    report.push({ id, verdict: `bâti (${score.value})`, time: ms(t0) })
  } catch (e) {
    ev({ type: "prospect-done", id, verdict: "echec", error: (e as Error).message.split("\n")[0] })
    if (!JSONMODE) console.log(`❌ ÉCHEC : ${(e as Error).message.split("\n")[0]} [${ms(t0)}]`)
    report.push({ id, verdict: "échec", time: ms(t0) })
  }
}

const built = report.filter((r) => r.verdict.startsWith("bâti")).length

if (JSONMODE) {
  ev({ type: "run-end", built, count: rows.length, ms: Math.round(performance.now() - tAll) })
} else {
  console.log(`\n── RÉSUMÉ ──`)
  for (const r of report) {
    console.log(`  ${r.verdict.padEnd(14)} ${r.time.padStart(8)}  ${r.id}`)
  }
  console.log(`\n${built}/${rows.length} sites bâtis · total ${ms(tAll)}\n`)
}
