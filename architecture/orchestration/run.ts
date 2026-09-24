/**
 * Orchestration — THE single authority on sequencing. Runs the whole pipeline over a seed, as a funnel.
 *
 * For each prospect:
 *   score (the gate) ─┬─ cold ............................... dropped (cost: one fetch)
 *                     ├─ not feasible ....................... kept for a manual build
 *                     └─ kept → parse → structure → compose → polish → verify → package
 *
 * The expensive steps (browser, LLM) only run on what survived the gate. Every step is timed.
 * The cage is checked before every prospect: STOP file, budget ceilings, anti-thrash circuit.
 * Blocks never call each other; they only exchange files through `data/`. This file is the only place
 * that knows the order.
 *
 * Export : runPipeline(opts)     CLI : npm run pipeline [-- <seed.csv>]
 */
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { scoreProspect } from "../../leadengine/2_scoring/scripts/score.ts"
import { parsePage } from "../../leadengine/3_parsing/scripts/parse.ts"
import { structureSheet } from "../../leadengine/3_parsing/scripts/structure.ts"
import { composeSite } from "../../design/scripts/compose.ts"
import { polishSite } from "../../design/scripts/polish.ts"
import { verifySite } from "../../design/scripts/verify.ts"
import { packageDemo } from "../../distribution/scripts/package.ts"
import { stopRequested, assertBudget, BudgetExceeded, logHalt, createFailureCircuit } from "../../packages/utils/guard.ts"
import { consolidateRun } from "../../packages/utils/journal.ts"
import { llmMode } from "../../packages/utils/llm.ts"

export type Row = { name: string; city: string; website: string; industry: string; email?: string }

export const slug = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

export function parseCsv(text: string): Row[] {
  const [header, ...lines] = text.trim().split("\n")
  const cols = header.split(",").map((c) => c.trim())
  return lines.filter(Boolean).map((line) => {
    const cells = line.split(",").map((c) => c.trim())
    const row = Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ""]))
    return { name: row.name, city: row.city, website: row.website, industry: row.industry || "kitchen-designer", email: row.email || undefined }
  })
}

export interface PipelineOpts {
  rows?: Row[]
  seedPath?: string
  limit?: number
  /** Skip the scoring gate. */
  force?: boolean
  /** Run the design + distribution steps (default true). */
  design?: boolean
}

export interface PipelineResult {
  report: { id: string; verdict: string; time: string }[]
  qualified: number
  built: number
  packaged: number
  totalMs: number
  cycle?: number
}

const since = (t: number) => Math.round(performance.now() - t)
const fmt = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`)

export async function runPipeline(opts: PipelineOpts = {}): Promise<PipelineResult> {
  const all = opts.rows ?? parseCsv(await readFile(opts.seedPath ?? join("data", "raw", "seed.csv"), "utf8"))
  const rows = all.slice(0, opts.limit || all.length)
  const design = opts.design !== false
  const report: PipelineResult["report"] = []
  let qualified = 0
  let built = 0
  let packaged = 0

  if (stopRequested()) {
    logHalt("STOP present at start — pipeline not launched.")
    console.log("⏹  STOP file at the repo root — nothing runs.")
    return { report, qualified, built, packaged, totalMs: 0 }
  }

  console.log(`\n▍PIPELINE — ${rows.length} prospect(s) · LLM ${llmMode()}${opts.force ? " · gate skipped (FORCE)" : ""}\n`)
  const tAll = performance.now()
  const circuit = createFailureCircuit(2)

  for (const [i, row] of rows.entries()) {
    const id = slug(`${row.name}-${row.city}`)
    if (stopRequested()) {
      logHalt(`STOP requested during the run (before ${id}).`)
      console.log("⏹  STOP — clean stop between two prospects.")
      break
    }
    try {
      assertBudget()
    } catch (e) {
      if (!(e instanceof BudgetExceeded)) throw e
      logHalt(e.message)
      console.log(`⏹  ${e.message}`)
      break
    }

    const t0 = performance.now()
    const steps: string[] = []
    const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
      const t = performance.now()
      const out = await fn()
      steps.push(`${name} ${fmt(since(t))}`)
      return out
    }
    console.log(`• ${row.name} (${row.city}) — ${row.website}`)

    try {
      const score = await step("score", () => scoreProspect(row.website, { industry: row.industry, email: row.email }))
      console.log(`    score ${score.value}/100 · ${score.tier.toUpperCase()}${score.expectedValue != null ? ` · expected value ${score.expectedValue}` : ""}`)
      for (const r of score.reasons.slice(0, 4)) console.log(`      – ${r}`)

      if (!opts.force && score.tier === "cold") {
        console.log(`    → DROPPED at the gate [${fmt(since(t0))}]\n`)
        report.push({ id, verdict: `dropped (${score.value})`, time: fmt(since(t0)) })
        continue
      }
      qualified++
      if (!opts.force && score.feasible === false) {
        console.log(`    → KEPT for a manual build (nothing to rebuild from) [${fmt(since(t0))}]\n`)
        report.push({ id, verdict: `kept, manual (${score.value})`, time: fmt(since(t0)) })
        continue
      }

      const raw = await step("parse", () => parsePage(id, row.website))
      console.log(`    parse     ${raw.photos.length} photos · ${raw.nav.length} nav labels · ${raw.sections.length} headings`)
      const sheet = await step("structure", () => structureSheet(id, row.industry, { name: row.name, city: row.city, email: row.email }, score))
      console.log(`    structure ${sheet.content.services.length} services · ${sheet.content.offers?.length ?? 0} offers · ${sheet.content.process?.length ?? 0} steps → data/prospects/${id}.json`)
      if (!design) {
        report.push({ id, verdict: `sheet (${score.value})`, time: fmt(since(t0)) })
        console.log(`    → SHEET only (DESIGN=0) [${fmt(since(t0))}]\n`)
        continue
      }

      const out = await step("compose", () => composeSite(id))
      console.log(`    compose   → ${out}`)
      const brand = await step("polish", () => polishSite(id))
      console.log(`    polish    brand ${brand}`)
      const verdict = await step("verify", () => verifySite(id))
      console.log(`    verify    ${verdict.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}`).join(" · ")}`)
      if (!verdict.pass) throw new Error("verify gate failed")
      built++
      const pkg = await step("package", () => packageDemo(id))
      packaged++
      console.log(`    package   → ${pkg}/index.html`)
      console.log(`    → BUILT [${steps.join(" · ")} · total ${fmt(since(t0))}]\n`)
      report.push({ id, verdict: `built (${score.value})`, time: fmt(since(t0)) })
    } catch (e) {
      const msg = (e as Error).message.split("\n")[0]
      console.log(`    → FAILED: ${msg} [${fmt(since(t0))}]\n`)
      report.push({ id, verdict: "failed", time: fmt(since(t0)) })
      if (circuit(msg, i)) {
        logHalt(`Circuit open: the same failure twice in a row ("${msg}") — anti-thrash stop.`)
        console.log("⏹  Circuit open: same failure twice in a row → clean stop.")
        break
      }
    }
  }

  const totalMs = since(tAll)
  console.log(`▍SUMMARY — ${rows.length} in · ${qualified} qualified · ${built} built · ${packaged} packaged · ${fmt(totalMs)}`)
  for (const r of report) console.log(`   ${r.verdict.padEnd(22)} ${r.time.padStart(7)}  ${r.id}`)

  const cycle = consolidateRun({ prospects: rows.length, qualified, built, packaged, totalMs, report })
  await mkdir("journal", { recursive: true })
  await writeFile(join("journal", "last-run.json"), JSON.stringify({ cycle, report, qualified, built, packaged, totalMs }, null, 2))
  console.log(`\n📓 journal → cycle ${cycle} (journal/metrics.md · journal/run-log.md)`)
  return { report, qualified, built, packaged, totalMs, cycle }
}

// --- CLI ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPipeline({
    seedPath: process.argv[2],
    force: process.env.FORCE === "1",
    design: process.env.DESIGN !== "0",
    limit: Number(process.env.LIMIT) || undefined,
  }).catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
