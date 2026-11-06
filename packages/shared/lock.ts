/**
 * lock.ts · VERROU EXCLUSIF d'une commande qui écrit un état partagé (le séquenceur : state.json, sends.jsonl, la base).
 *
 * Pourquoi : run-guarded.sh met un `flock` autour des jobs PLANIFIÉS, mais rien n'empêchait un tick lancé à la main
 * (ou depuis une autre machine branchée sur la même base) pendant celui du timer. Les deux lisaient le même état et
 * envoyaient la même étape deux fois au même prospect (reproduit par test/outreach/concurrency.test.ts, test blitz
 * du 24/10). Deux étages :
 *
 *   1. FICHIER local (`<dir>/.lock`, créé en exclusif `wx`) : { pid, host, at, cmd }. Un verrou dont le process est
 *      MORT (même machine) ou plus vieux que `staleMs` (défaut 30 min, un tick n'en dure jamais autant) est repris,
 *      et c'est dit. Rendu à la fin, et aussi sur SIGINT/SIGTERM.
 *   2. BAIL en base (si DATABASE_URL) : la ligne `meta.<dbKey>`, prise par un INSERT … ON CONFLICT … WHERE bail
 *      expiré (atomique), renouvelée toutes les 30 s, effacée à la fin. Couvre deux machines sur la même base.
 *      Base injoignable : on continue avec le seul verrou fichier (l'état retombe alors sur le fichier, lui aussi).
 *
 * Tenu par un process vivant : on attend (`waitMs`, défaut 3 min), puis on rend `null` (l'appelant sort en code 75).
 */
import { closeSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync, mkdirSync } from "node:fs"
import { hostname } from "node:os"
import { dirname } from "node:path"
import { randomUUID } from "node:crypto"
import { tryDb } from "./db.ts"

export type LockInfo = { pid: number; host: string; at: string; cmd: string; owner?: string }
export type HeldLock = { release: () => Promise<void>; info: LockInfo }
export type LockOptions = {
  file: string
  dbKey?: string
  cmd: string
  waitMs?: number
  staleMs?: number
  pollMs?: number
  log?: (s: string) => void
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Le process `pid` tourne-t-il encore (sur CETTE machine) ? EPERM = il existe, sous un autre utilisateur. */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM" }
}

function readLock(file: string): { info: LockInfo | null; raw: string; mtimeMs: number } | null {
  try {
    const raw = readFileSync(file, "utf8")
    const mtimeMs = statSync(file).mtimeMs
    let info: LockInfo | null = null
    try { const j = JSON.parse(raw); if (j && typeof j.pid === "number") info = j } catch { /* écrit à moitié, ou abîmé */ }
    return { info, raw, mtimeMs }
  } catch { return null } // disparu entre-temps
}

/** Pourquoi ce verrou peut être repris ("" = il est tenu). */
function staleReason(l: { info: LockInfo | null; mtimeMs: number }, staleMs: number, now = Date.now()): string {
  const ageMs = now - (l.info ? Date.parse(l.info.at) || l.mtimeMs : l.mtimeMs)
  if (!l.info) return now - l.mtimeMs > 10_000 ? "verrou illisible" : ""
  if (ageMs > staleMs) return `vieux de ${Math.round(ageMs / 60_000)} min`
  if (l.info.host === hostname() && !pidAlive(l.info.pid)) return `pid ${l.info.pid} mort`
  return ""
}

function tryCreate(file: string, info: LockInfo): boolean {
  let fd: number
  try { fd = openSync(file, "wx") } catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") return false; throw e }
  try { writeSync(fd, JSON.stringify(info)) } finally { closeSync(fd) }
  return true
}

/** Reprend un verrou orphelin SANS jamais effacer celui qu'un autre vient de poser : renommage atomique, puis contrôle. */
function takeOver(file: string, seenRaw: string): boolean {
  const aside = `${file}.stale-${process.pid}-${Date.now()}`
  try { renameSync(file, aside) } catch { return false } // un autre l'a déjà repris
  let moved = ""
  try { moved = readFileSync(aside, "utf8") } catch { /* */ }
  if (moved !== seenRaw) { try { renameSync(aside, file) } catch { /* */ } return false } // ce n'était plus le même : on le remet
  try { unlinkSync(aside) } catch { /* */ }
  return true
}

async function fileLock(o: Required<Pick<LockOptions, "file" | "cmd" | "waitMs" | "staleMs" | "pollMs" | "log">>, info: LockInfo): Promise<boolean> {
  mkdirSync(dirname(o.file), { recursive: true })
  const deadline = Date.now() + o.waitMs
  let told = false
  for (;;) {
    if (tryCreate(o.file, info)) return true
    const cur = readLock(o.file)
    if (cur) {
      const why = staleReason(cur, o.staleMs)
      if (why) {
        if (takeOver(o.file, cur.raw)) o.log(`⚠ verrou orphelin repris (${why}${cur.info ? ` · ${cur.info.cmd} du ${cur.info.at}` : ""})`)
        continue
      }
      if (!told) { told = true; o.log(`⏳ ${cur.info?.cmd ?? "une commande"} déjà en cours (pid ${cur.info?.pid ?? "?"} sur ${cur.info?.host ?? "?"}, depuis ${cur.info?.at ?? "?"}) : j'attends (≤ ${Math.round(o.waitMs / 1000)} s)`) }
    }
    if (Date.now() >= deadline) return false
    await sleep(o.pollMs)
  }
}

function releaseFile(file: string, owner: string): void {
  const cur = readLock(file)
  if (cur?.info?.owner === owner) { try { unlinkSync(file) } catch { /* */ } }
}

/** Prend le verrou (fichier, puis bail en base si DATABASE_URL). `null` = tenu ailleurs au-delà de `waitMs`. */
export async function acquireLock(opts: LockOptions): Promise<HeldLock | null> {
  const o = { waitMs: 180_000, staleMs: 30 * 60_000, pollMs: 250, log: (s: string) => console.error(s), ...opts }
  const owner = randomUUID()
  const info: LockInfo = { pid: process.pid, host: hostname(), at: new Date().toISOString(), cmd: o.cmd, owner }
  if (!(await fileLock(o, info))) return null

  // bail en base : deux machines branchées sur la même base ne tiquent jamais en même temps
  const db = o.dbKey ? tryDb() : null
  let lease = false
  let beat: ReturnType<typeof setInterval> | null = null
  const value = JSON.stringify(info)
  if (db && o.dbKey) {
    const deadline = Date.now() + o.waitMs
    let told = false
    try {
      for (;;) {
        const now = Date.now()
        const got = await db.prepare("INSERT INTO meta(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE meta.updated_at < ? RETURNING value")
          .get(o.dbKey, value, now, now - o.staleMs)
        if (got) { lease = true; break }
        if (!told) {
          told = true
          const row = await db.prepare("SELECT value FROM meta WHERE key = ?").get(o.dbKey) as { value?: string } | undefined
          let other: Partial<LockInfo> = {}
          try { other = JSON.parse(row?.value || "{}") } catch { /* */ }
          o.log(`⏳ ${other.cmd ?? "une commande"} déjà en cours sur ${other.host ?? "une autre machine"} (base partagée, depuis ${other.at ?? "?"}) : j'attends (≤ ${Math.round(o.waitMs / 1000)} s)`)
        }
        if (Date.now() >= deadline) { releaseFile(o.file, owner); return null }
        await sleep(Math.max(o.pollMs, 500))
      }
      beat = setInterval(() => {
        db.prepare("UPDATE meta SET updated_at = ? WHERE key = ? AND value = ?").run(Date.now(), o.dbKey, value).catch(() => { /* la base reviendra */ })
      }, 30_000)
      beat.unref()
    } catch (e) {
      o.log(`⚠ bail du verrou en base indisponible (${(e as Error).message.split("\n")[0].slice(0, 120)}) : verrou fichier seul`)
    }
  }

  let released = false
  const release = async () => {
    if (released) return
    released = true
    if (beat) clearInterval(beat)
    if (lease && db && o.dbKey) { try { await db.prepare("DELETE FROM meta WHERE key = ? AND value = ?").run(o.dbKey, value) } catch { /* expirera seul */ } }
    releaseFile(o.file, owner)
    process.off("exit", onExit)
    process.off("SIGINT", onSig); process.off("SIGTERM", onSig)
  }
  // process.exit() ou signal : le verrou fichier est rendu (synchrone) ; le bail en base expire seul au pire
  const onExit = () => releaseFile(o.file, owner)
  const onSig = (sig: NodeJS.Signals) => { release().finally(() => process.exit(sig === "SIGINT" ? 130 : 143)) }
  process.on("exit", onExit)
  process.once("SIGINT", onSig); process.once("SIGTERM", onSig)
  return { release, info }
}
