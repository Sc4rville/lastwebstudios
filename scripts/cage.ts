/**
 * cage.ts · `npm run cage`: the 24/7 CAGE from a terminal (your server over SSH, a cron, the guide). Same state as
 * the cockpit's status pill (packages/shared/cage.ts): STOP, today's spend, the breaker, the sending mode.
 *
 *   npm run cage                      the state, in plain words (exit 0)   · `-- --json`: machine output
 *   npm run cage -- stop [reason…]    raise the emergency STOP (shared database if DATABASE_URL, else a STOP file)
 *   npm run cage -- resume            lift the emergency STOP (database + local file)
 *   npm run cage -- check             exit 3 when STOP is raised (file or cockpit), 0 otherwise: what
 *                                     architecture/scheduling/run-guarded.sh calls before every scheduled job
 *
 * The breaker is re-armed with `npm run sequencer -- breaker reset` (or in the cockpit): a deliberate human act.
 */
import { fileURLToPath } from "node:url"
import { homedir, userInfo } from "node:os"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { cageStatus, setStop, stopState } from "../packages/shared/cage.ts"
import { closeDb } from "../packages/shared/db.ts"

/** Exit code of `check` when STOP is raised (the worker uses the same: "stopped on purpose", not a crash). */
export const STOP_EXIT = 3

const usd = (n: number | null | undefined) => (n == null ? "-" : `$${n.toFixed(2)}`)
const pct = (x: number) => `${(Math.round(x * 1000) / 10).toFixed(1)}%`
const who = () => { try { return `cli:${userInfo().username}` } catch { return "cli" } }
/** where a STOP comes from, in words (« fichier » is the STOP file at the repository root, written by the CLI too) */
const source = (s: string | null | undefined) => (s === "fichier" ? "STOP file" : s === "cockpit" ? "cockpit" : String(s || ""))

export const USAGE = "usage: npm run cage [-- status | stop [reason] | resume | check] [--json]"

async function status(json: boolean): Promise<void> {
  const c = await cageStatus()
  if (json) { console.log(JSON.stringify(c, null, 2)); return }
  const b = c.budget, br = c.breaker
  console.log(c.alerts.length ? `⚠ the cage reports: ${c.alerts.join(", ")}` : "✓ all calm: nothing unusual")
  console.log(`  emergency STOP   ${c.stop.on ? `⏹ STOP (${source(c.stop.source)} : ${c.stop.reason})` : "not raised"}`)
  const bl = c.builds
  console.log(`  builds today     ${bl.cap != null ? `${bl.done} of ${bl.cap}${bl.reached ? " · CAP REACHED, no new build before midnight UTC" : ""}${bl.from === "budget" ? ` (LWS_BUDGET_USD_DAY ÷ $${bl.perBuildUsd} a build)` : ""}` : `${bl.done} · no daily cap (set LWS_BUILDS_PER_DAY)`}`)
  console.log(`  plan usage today ${b.capUsd != null ? `${usd(b.spentUsd)} / ${usd(b.capUsd)}${b.reached ? " · LIMIT REACHED, no job before midnight UTC" : ""}` : `${usd(b.spentUsd)}`} · an estimate of what your plan used, not a charge`)
  console.log(`                   agents ${usd(b.byKind.agent)} · skills ${usd(b.byKind.llm)} · images ${usd(b.byKind.image)} · videos ${usd(b.byKind.video)}`)
  if (br) {
    console.log(`  safety limit     ${br.open ? "⛔ REACHED: no email goes out until you lift it" : "fine"} · ${br.counts.sends} email(s) since ${br.since.slice(0, 10)}`)
    console.log(`                   bounces ${pct(br.rates.bounce)} (limit ${pct(br.thresholds.bounceRate)}) · spam complaints ${pct(br.rates.complaint)} (limit ${pct(br.thresholds.complaintRate)}) · unsubscribes ${pct(br.rates.unsub)} (limit ${pct(br.thresholds.unsubRate)})`)
    for (const r of br.reasons) console.log(`                   · ${r}`)
  } else console.log("  safety limit     the breaker is not active yet (no email sent): sending stops by itself on too many bounces, complaints or unsubscribes")
  console.log(`  email sending    ${c.send.mode === "dry-run" ? c.send.detail : `LIVE · ${c.send.detail}`}`)
}

async function main(): Promise<number> {
  try { process.loadEnvFile() } catch { /* no .env: STOP file only */ }
  const [cmd = "status", ...rest] = process.argv.slice(2).filter((a) => a !== "--json")
  const json = process.argv.includes("--json")
  if (cmd === "--help" || cmd === "-h") { console.log(USAGE); return 0 }
  if (cmd === "status") { await status(json); return 0 }
  if (cmd === "check") {
    const s = await stopState()
    if (s.on) { console.log(`⏹ STOP (${source(s.source)} : ${s.reason}): nothing runs.`); return STOP_EXIT }
    console.log("✓ no STOP")
    return 0
  }
  if (cmd === "stop" || cmd === "resume") {
    const on = cmd === "stop"
    const s = await setStop(on, rest.join(" "), who())
    if (s.on !== on) { console.error("✗ STOP not recorded (database unavailable?): as a last resort, `echo reason > STOP` at the repository root"); return 1 }
    // the systemd hint only where there is a 24/7 worker to restart (a laptop has none)
    const worker = existsSync(join(homedir(), ".config", "systemd", "user", "lws-worker.service"))
    console.log(on
      ? `⏹ STOP raised (${source(s.source)}${s.reason ? ` : ${s.reason}` : ""}). Nothing new starts: no search, no build, no email, until you resume.`
      : `▶ STOP lifted. Searches, builds and emails can run again.${worker ? " Restart the 24/7 worker: systemctl --user restart lws-worker" : ""}`)
    return 0
  }
  console.error(`unknown command "${cmd}". ${USAGE}`)
  return 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => { closeDb(); process.exit(code) }).catch((e) => { console.error(`✗ ${(e as Error).message}`); closeDb(); process.exit(1) })
}
