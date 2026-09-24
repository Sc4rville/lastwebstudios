/**
 * journal.ts — the atelier's memory.
 *
 * An unattended loop wakes up with no memory: if it is not written in the repo, it did not happen.
 * Every run appends one row to `journal/metrics.md` (the fitness trend) and one entry to
 * `journal/run-log.md` (the diary, most recent on top). Both are gitignored in this public build.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { meterStatus } from "./meter.ts"

const DIR = () => process.env.JOURNAL_DIR || join(process.cwd(), "journal")

export type RunSummary = {
  prospects: number
  qualified: number
  built: number
  packaged: number
  totalMs: number
  report: { id: string; verdict: string; time: string }[]
}

const METRICS_HEAD =
  "# Metrics — one row per cycle\n\n| cycle | date | prospects | qualified | built | packaged | spend $ | duration |\n|---:|---|---:|---:|---:|---:|---:|---:|\n"

/** Append the run to metrics + run-log. Returns the cycle number. */
export function consolidateRun(run: RunSummary): number {
  const dir = DIR()
  mkdirSync(dir, { recursive: true })
  const metricsPath = join(dir, "metrics.md")
  const metrics = existsSync(metricsPath) ? readFileSync(metricsPath, "utf8") : METRICS_HEAD
  const cycle = (metrics.match(/^\| \d+ \|/gm)?.length ?? 0) + 1
  const spend = meterStatus().cycleUsd
  const date = new Date().toISOString().slice(0, 16).replace("T", " ")
  const row = `| ${cycle} | ${date} | ${run.prospects} | ${run.qualified} | ${run.built} | ${run.packaged} | ${spend.toFixed(4)} | ${(run.totalMs / 1000).toFixed(1)}s |\n`
  writeFileSync(metricsPath, metrics + row)

  const logPath = join(dir, "run-log.md")
  const prev = existsSync(logPath) ? readFileSync(logPath, "utf8").replace(/^# Run log\n\n/, "") : ""
  const entry = [
    `## Cycle ${cycle} — ${date}`,
    "",
    `${run.built}/${run.prospects} built · ${run.qualified} qualified · ${run.packaged} packaged · $${spend.toFixed(4)}`,
    "",
    ...run.report.map((r) => `- \`${r.id}\` — ${r.verdict} (${r.time})`),
    "",
  ].join("\n")
  writeFileSync(logPath, `# Run log\n\n${entry}\n${prev}`)
  return cycle
}
