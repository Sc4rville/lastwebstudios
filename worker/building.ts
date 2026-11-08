/**
 * building.ts · the BUILD MARKER of composer sites, and the clean-up of interrupted runs.
 *
 * Before (P1 of the 2026-10-24 audit): when idle, the worker deleted EVERY `*-composer` folder without
 * `index.html`, including folders versioned in git (11 folders, 109 files vanished from a
 * fresh clone at the first tick). Now it deletes ONLY what it started itself:
 *
 *   1. during a composer batch, each NEW `*-composer` folder without index.html gets `.lws-building`
 *      (batch, worker, date); the marker is refreshed on every pass (heartbeat);
 *   2. at the end of the batch, the marker of finished folders (index.html present) is removed;
 *   3. when idle, `reapIncomplete` only deletes a marked folder, still without index.html, without
 *      `.reviewing`, whose marker has not moved for `staleMs` (another worker on the same box
 *      in the middle of a build is never touched).
 *
 * Pure functions on a base folder (`output/sites` in production) → tested on a throwaway workspace.
 */
import { existsSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export const BUILDING_MARKER = ".lws-building"
export const STALE_MS = 15 * 60 * 1000

const isDir = (p: string) => { try { return statSync(p).isDirectory() } catch { return false } }

/** Every `<id>/<date>-composer` folder present (with or without index.html). */
export function composerDirs(base: string): Set<string> {
  const out = new Set<string>()
  if (!existsSync(base)) return out
  for (const id of readdirSync(base)) {
    if (!isDir(join(base, id))) continue
    let dates: string[] = []
    try { dates = readdirSync(join(base, id)) } catch { continue }
    for (const d of dates) if (/-composer$/.test(d) && isDir(join(base, id, d))) out.add(`${id}/${d}`)
  }
  return out
}

/** Sets (or refreshes) `.lws-building` on the composer folders that APPEARED since `before` and still have no index.html. */
export function markBuilding(base: string, before: Set<string>, info: { batchId: number | string; worker: string }): string[] {
  const marked: string[] = []
  for (const key of composerDirs(base)) {
    if (before.has(key)) continue
    const dir = join(base, ...key.split("/"))
    if (existsSync(join(dir, "index.html"))) continue
    try {
      writeFileSync(join(dir, BUILDING_MARKER), JSON.stringify({ batch: info.batchId, worker: info.worker, at: new Date().toISOString() }) + "\n")
      marked.push(key)
    } catch { /* folder removed in the meantime */ }
  }
  return marked
}

/** End of batch: removes the marker from finished folders (index.html present). The others keep it. */
export function settleBuilding(base: string, before: Set<string>): { finished: string[]; unfinished: string[] } {
  const finished: string[] = [], unfinished: string[] = []
  for (const key of composerDirs(base)) {
    if (before.has(key)) continue
    const dir = join(base, ...key.split("/"))
    if (!existsSync(join(dir, BUILDING_MARKER))) continue
    if (existsSync(join(dir, "index.html"))) { try { rmSync(join(dir, BUILDING_MARKER), { force: true }) } catch { /* */ } finished.push(key) }
    else unfinished.push(key)
  }
  return { finished, unfinished }
}

/**
 * Clean-up of INTERRUPTED runs: deletes only the composer folders marked `.lws-building` by the worker,
 * without index.html, without `.reviewing`, whose marker has been still for `staleMs`. Never an unmarked folder
 * (versioned, copied by hand, coming from another machine). Returns the deleted `id/date` keys.
 */
export async function reapIncomplete(base: string, opts: { staleMs?: number; prune?: (id: string, date: string) => Promise<void>; now?: number } = {}): Promise<string[]> {
  const staleMs = opts.staleMs ?? STALE_MS
  const now = opts.now ?? Date.now()
  const reaped: string[] = []
  for (const key of composerDirs(base)) {
    const [id, d] = key.split("/")
    const dir = join(base, id, d)
    const marker = join(dir, BUILDING_MARKER)
    if (!existsSync(marker) || existsSync(join(dir, "index.html")) || existsSync(join(dir, ".reviewing"))) continue
    let age = 0
    try { age = now - statSync(marker).mtimeMs } catch { continue }
    if (age < staleMs) continue
    try { rmSync(dir, { recursive: true, force: true }) } catch { continue }
    try { await opts.prune?.(id, d) } catch { /* index DB best-effort */ }
    reaped.push(key)
    // the prospect's folder, if it held ONLY this build
    try { if (readdirSync(join(base, id)).length === 0) rmSync(join(base, id), { recursive: true, force: true }) } catch { /* */ }
  }
  return reaped
}
