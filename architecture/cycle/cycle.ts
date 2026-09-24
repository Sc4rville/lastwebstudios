/**
 * cycle.ts — one unattended CYCLE of the atelier, in code: ORIENT → ACT → VERIFY → LEARN.
 *
 *   1. ORIENT — read the memory (last cycle's metrics), check the cage (STOP file, budget ceilings)
 *   2. ACT    — run the pipeline over the seed
 *   3. VERIFY — type-check the codebase: broken code must never become the next cycle's memory
 *   4. LEARN  — recompute the scoring rules from field outcomes, write a one-line digest
 *
 * A scheduler (cron, systemd timer…) fires this every few hours. In the private build, an agent also runs
 * a PLAN/RESEARCH phase between ORIENT and ACT and may modify its own tools on a branch — see docs/GENESIS.md.
 *
 * CLI : npm run cycle              (seed: data/raw/seed.csv)
 *       npm run cycle -- --demo    (the fictional demo seed, served locally)
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { runPipeline, parseCsv, type PipelineResult, type Row } from "../orchestration/run.ts"
import { stopRequested } from "../../packages/utils/guard.ts"
import { meterStatus, assertBudget, BudgetExceeded } from "../../packages/utils/meter.ts"
import { buildRules } from "../../learning/scripts/learn.ts"
import { RULES_PATH } from "../../learning/scripts/rules.ts"
import type { Outcome } from "../../learning/scripts/types.ts"

const log = (phase: string, msg: string) => console.log(`[cycle ${new Date().toISOString().slice(11, 19)}] ${phase.padEnd(6)} ${msg}`)

// 1. ORIENT ─────────────────────────────────────────────────────────────────────────────────────────────
function orient(): { halted: false } | { halted: true; reason: string } {
  const metrics = join("journal", "metrics.md")
  const last = existsSync(metrics) ? readFileSync(metrics, "utf8").trim().split("\n").pop() : undefined
  log("ORIENT", last?.startsWith("| ") && !last.startsWith("|---") ? `last cycle: ${last}` : "first cycle — no memory yet")
  if (stopRequested()) return { halted: true, reason: "STOP file at the repo root" }
  try {
    assertBudget()
  } catch (e) {
    if (e instanceof BudgetExceeded) return { halted: true, reason: e.message }
    throw e
  }
  log("ORIENT", "cage ok (no STOP, budget under ceilings)")
  return { halted: false }
}

// 3. VERIFY ─────────────────────────────────────────────────────────────────────────────────────────────
function verify(): boolean {
  try {
    execFileSync(join("node_modules", ".bin", "tsc"), ["--noEmit"], { stdio: "pipe", timeout: 120_000 })
    log("VERIFY", "tsc green")
    return true
  } catch (e) {
    log("VERIFY", `tsc FAILED\n${String((e as { stdout?: Buffer }).stdout ?? e).slice(0, 600)}`)
    return false
  }
}

// 4. LEARN ──────────────────────────────────────────────────────────────────────────────────────────────
function learn(result: PipelineResult, tscOk: boolean): string {
  const source = join("data", "outcomes.jsonl")
  if (existsSync(source)) {
    const outcomes = readFileSync(source, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Outcome)
    const rules = buildRules(outcomes, new Date().toISOString())
    mkdirSync(join("learning", "rules"), { recursive: true })
    writeFileSync(RULES_PATH(), JSON.stringify(rules, null, 2) + "\n")
    log("LEARN", `rules recomputed from ${outcomes.length} outcome(s) — the next gate uses them`)
  } else log("LEARN", "no field outcome yet — scoring stays on its human baselines")

  const m = meterStatus()
  return [
    `cycle #${result.cycle}`,
    `${result.built}/${result.qualified} built`,
    `${result.packaged} packaged`,
    `$${m.cycleUsd.toFixed(4)} spent`,
    tscOk ? "tsc green" : "TSC FAILED",
  ].join(" · ")
}

// main ──────────────────────────────────────────────────────────────────────────────────────────────────
const o = orient()
if (o.halted) {
  log("ORIENT", `HALT — ${o.reason}`)
  process.exit(0)
}

let rows: Row[] | undefined
let close = () => {}
if (process.argv.includes("--demo")) {
  const { serveStatic, demoSeed } = await import("../../demo/server.ts")
  const { url, server } = await serveStatic("demo")
  rows = parseCsv(await demoSeed(url))
  close = () => server.close()
}

log("ACT", "running the pipeline")
let result: PipelineResult
try {
  result = await runPipeline({ rows, seedPath: rows ? undefined : join("data", "raw", "seed.csv") })
} finally {
  close()
}
const tscOk = verify()
const digest = learn(result, tscOk)
log("LEARN", `digest: ${digest}`)
process.exitCode = tscOk ? 0 : 1
