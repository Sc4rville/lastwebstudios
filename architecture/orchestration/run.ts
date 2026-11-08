/**
 * Orchestration — THE CHIEF. Chains the whole pipeline over the seed, as a funnel.
 *
 * ⚠⚠ TEMPLATE-FILL PATH (SECONDARY) ⚠⚠
 * This script does: score → parse → record → fill → polish → animate. The `fill` pours the record into
 * ONE SINGLE default template (`poliform`) for EVERY prospect → near-identical results
 * ("clones"). It is the cheap/proven path, NOT the premium result.
 * For CUSTOM work (the main path) → the **composer**: `architecture/orchestration/compose-batch.md`
 * (agent orchestrator diagnose→compose→beauty-gate). The composer is NOT here (it runs as agents).
 * See docs/STATUS.md « DEUX voies de design » + docs/DESIGN-ENGINE.md.
 *
 * For each prospect:
 *   score (the gate) → if kept: parse → structure → fill → polish → animate
 * Times each step. SEED=<path> targets another seed; DESIGN=0 stops at the record.
 *
 * Usage: npm run pipeline   (template-fill; for custom work see compose-batch.md)
 */
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { scoreProspect } from "../../leadengine/2_scoring/scripts/score.ts"
import { parsePage } from "../../leadengine/3_parsing/scripts/parse.ts"
import { structureFiche } from "../../leadengine/3_parsing/scripts/structure.ts"

// design (the template-fill path): loaded ON DEMAND. The open source edition does not ship it (it depends on
// design/templates/, copied third-party sites): the composer (`npm run first-site`, the worker) is its only way to
// build. Computed specifiers so the typecheck passes without these files.
type DesignSteps = { fillSite: (id: string) => Promise<unknown>; polishSite: (id: string) => Promise<unknown>; animateSite: (id: string) => Promise<unknown> }
async function loadDesignSteps(): Promise<DesignSteps> {
  const base = "../../design/scripts/"
  try {
    const [f, p, a] = await Promise.all([import(base + "fill.ts"), import(base + "polish.ts"), import(base + "animate.ts")])
    return { fillSite: f.fillSite, polishSite: p.polishSite, animateSite: a.animateSite }
  } catch (e) {
    throw new Error(`template-fill is not available in this edition (design/scripts/fill.ts missing): build with the composer (npm run first-site -- <url>, or the worker). DESIGN=0 stops the pipeline at the record. (${(e as Error).message})`)
  }
}

// loads .env itself (never depend on the scheduler's cwd) — see cron robustness
try { process.loadEnvFile() } catch { /* no .env: read the environment */ }

// DESIGN=0 → stop at the record (lead engine only); otherwise record → fill → polish (default: end to end)
const DESIGN = process.env.DESIGN !== "0"

// SEED=<path> targets another seed (default: kitchen makers). E.g.: SEED=data/raw/prospects.seed.csv
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

const force = process.env.FORCE === "1" // ignores the gate (debug)

// GUARD RAIL (opt-in through INDUSTRY=<trade>): before running, it GUARANTEES LIMIT FRESH prospects
// for this trade. If some are missing (need 5, have 2), it scrapes the DELTA (3) — otherwise it settles
// for the fixed SEED (historical behaviour). The prospects stay listed (registry + the scraper's CSV).
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
    console.error(`✗ seed not found: ${SEED}\n  Set SEED=<path to a CSV name,city,website,phone,industry,email> (e.g. a fictional seed: test/fixtures/seeds/orvane.seed.csv)`)
    process.exit(1)
  }
  const allRows = parseCsv(await readFile(SEED, "utf8"))
  rows = allRows.slice(0, Number(process.env.LIMIT) || allRows.length)
}

// PIPELINE_JSON=1 → emits one JSON event per line (a machine-readable stream) instead of the pretty output
const JSONMODE = process.env.PIPELINE_JSON === "1"
const ev = (e: Record<string, unknown>) => JSONMODE && console.log(JSON.stringify(e))

if (JSONMODE) ev({ type: "run-start", count: rows.length, force })
else console.log(`\n🏭 PIPELINE — ${rows.length} prospects${force ? " (FORCE: gate ignored)" : ""}\n`)

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
      if (!JSONMODE) console.log(`DROPPED (${score.value}/100) [${ms(t0)}]`)
      report.push({ id, verdict: `dropped (${score.value})`, time: ms(t0) })
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
        console.log(`✅ RECORD (${score.value}/100) — parse ${parseT}ms · struct ${structT}ms [total ${ms(t0)}]  (design off)`)
      report.push({ id, verdict: `record (${score.value})`, time: ms(t0) })
      continue
    }
    // design: record → fill (step 6) → polish (step 7) = a deliverable site
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
    await animateSite(id) // replays the scroll animations if the template has some (no-op otherwise)
    const animT = Math.round(performance.now() - ta)
    ev({
      type: "prospect-done", id, verdict: "bati", score: score.value, tier: score.tier,
      timings: { parse: parseT, structure: structT, fill: fillT, polish: polishT, animate: animT, total: Math.round(performance.now() - t0) },
    })
    if (!JSONMODE)
      console.log(
        `✅ BUILT (${score.value}/100) — parse ${parseT} · struct ${structT} · fill ${fillT} · polish ${polishT} · anim ${animT}ms [total ${ms(t0)}]`,
      )
    report.push({ id, verdict: `built (${score.value})`, time: ms(t0) })
  } catch (e) {
    ev({ type: "prospect-done", id, verdict: "echec", error: (e as Error).message.split("\n")[0] })
    if (!JSONMODE) console.log(`❌ FAILED: ${(e as Error).message.split("\n")[0]} [${ms(t0)}]`)
    report.push({ id, verdict: "failed", time: ms(t0) })
  }
}

const built = report.filter((r) => r.verdict.startsWith("built")).length

if (JSONMODE) {
  ev({ type: "run-end", built, count: rows.length, ms: Math.round(performance.now() - tAll) })
} else {
  console.log(`\n── SUMMARY ──`)
  for (const r of report) {
    console.log(`  ${r.verdict.padEnd(14)} ${r.time.padStart(8)}  ${r.id}`)
  }
  console.log(`\n${built}/${rows.length} sites built · total ${ms(tAll)}\n`)
}
