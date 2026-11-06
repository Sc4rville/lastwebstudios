/**
 * building.ts · le MARQUEUR DE CHANTIER des sites composer, et le ménage des runs interrompus.
 *
 * Avant (P1 de l'audit 2026-10-24) : à l'idle, le worker supprimait TOUT dossier `*-composer` sans
 * `index.html`, y compris des dossiers versionnés dans git (11 dossiers, 109 fichiers disparaissaient d'un
 * clone frais au premier tick). Désormais il ne supprime QUE ce qu'il a lui-même commencé :
 *
 *   1. pendant un batch composer, chaque NOUVEAU dossier `*-composer` sans index.html reçoit `.lws-building`
 *      (batch, worker, date) ; le marqueur est rafraîchi à chaque passage (battement de cœur) ;
 *   2. en fin de batch, le marqueur des dossiers terminés (index.html présent) est retiré ;
 *   3. à l'idle, `reapIncomplete` ne supprime qu'un dossier marqué, toujours sans index.html, sans
 *      `.reviewing`, et dont le marqueur n'a plus bougé depuis `staleMs` (un autre worker sur la même box
 *      en plein chantier n'est donc jamais touché).
 *
 * Fonctions pures sur un dossier de base (`output/sites` en prod) → testées sur un workspace jetable.
 */
import { existsSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export const BUILDING_MARKER = ".lws-building"
export const STALE_MS = 15 * 60 * 1000

const isDir = (p: string) => { try { return statSync(p).isDirectory() } catch { return false } }

/** Tous les dossiers `<id>/<date>-composer` présents (avec ou sans index.html). */
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

/** Pose (ou rafraîchit) `.lws-building` sur les dossiers composer APPARUS depuis `before` et encore sans index.html. */
export function markBuilding(base: string, before: Set<string>, info: { batchId: number | string; worker: string }): string[] {
  const marked: string[] = []
  for (const key of composerDirs(base)) {
    if (before.has(key)) continue
    const dir = join(base, ...key.split("/"))
    if (existsSync(join(dir, "index.html"))) continue
    try {
      writeFileSync(join(dir, BUILDING_MARKER), JSON.stringify({ batch: info.batchId, worker: info.worker, at: new Date().toISOString() }) + "\n")
      marked.push(key)
    } catch { /* dossier retiré entre-temps */ }
  }
  return marked
}

/** Fin de batch : retire le marqueur des dossiers terminés (index.html présent). Les autres le gardent. */
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
 * Ménage des runs INTERROMPUS : supprime seulement les dossiers composer marqués `.lws-building` par le worker,
 * sans index.html, sans `.reviewing`, au marqueur immobile depuis `staleMs`. Jamais un dossier non marqué
 * (versionné, copié à la main, venant d'une autre machine). Renvoie les clés `id/date` supprimées.
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
    // le dossier du prospect, s'il ne contenait QUE ce chantier
    try { if (readdirSync(join(base, id)).length === 0) rmSync(join(base, id), { recursive: true, force: true }) } catch { /* */ }
  }
  return reaped
}
