/**
 * children.ts · every process the cockpit starts (a search's lead engine, a build's worker, the sequencer, the
 * pipeline, a feedback edit) is tracked here, in its own process group, so that stopping the cockpit stops them too:
 * SIGTERM to each group, SIGKILL after a grace period (a scraper that ignores SIGTERM included), and SIGKILL on any
 * exit path. Never an orphan `run.ts` scraping on after the cockpit is gone.
 */
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process"

const live = new Set<ChildProcess>()

/** spawn in its own process group (detached) and track it until it exits */
export function spawnTracked(cmd: string, args: string[], o: SpawnOptions = {}): ChildProcess {
  const c = spawn(cmd, args, { ...o, detached: true })
  live.add(c)
  const drop = () => live.delete(c)
  c.once("exit", drop); c.once("error", drop)
  return c
}

/** the number of tracked processes still running */
export const liveChildren = (): number => live.size

function signalAll(sig: NodeJS.Signals): void {
  for (const c of live) {
    if (!c.pid || c.exitCode !== null || c.signalCode !== null) { live.delete(c); continue }
    try { process.kill(-c.pid, sig) } catch { try { c.kill(sig) } catch { /* gone */ } }
  }
}

/** SIGTERM to every group, then SIGKILL to what is still there after `graceMs` */
export async function stopChildren(graceMs = 2000): Promise<void> {
  if (!live.size) return
  signalAll("SIGTERM")
  const t0 = Date.now()
  while (live.size && Date.now() - t0 < graceMs) await new Promise((r) => setTimeout(r, 100))
  if (live.size) signalAll("SIGKILL")
}

// any exit (a crash, process.exit from a watchdog) : what is left is killed, synchronously
process.on("exit", () => signalAll("SIGKILL"))
