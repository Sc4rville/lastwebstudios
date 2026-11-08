/**
 * lock.ts · an EXCLUSIVE LOCK for a command that writes shared state (the sequencer: state.json, sends.jsonl, the database).
 *
 * Why: run-guarded.sh puts a `flock` around the SCHEDULED jobs, but nothing stopped a tick started by hand
 * (or from another machine on the same database) during the timer's. Both read the same state and
 * sent the same step twice to the same prospect (reproduced by test/outreach/concurrency.test.ts, blitz test
 * of 24/10). Two stages:
 *
 *   1. Local FILE (`<dir>/.lock`, created exclusively with `wx`): { pid, host, at, cmd }. A lock whose process is
 *      DEAD (same machine) or older than `staleMs` (default 30 min, a tick never lasts that long) is taken over,
 *      and that is said. Released at the end, and also on SIGINT/SIGTERM.
 *   2. Database LEASE (if DATABASE_URL): the `meta.<dbKey>` row, taken by an INSERT … ON CONFLICT … WHERE the lease
 *      has expired (atomic), renewed every 30 s, deleted at the end. Covers two machines on the same database.
 *      Database unreachable: we go on with the file lock alone (the state then falls back on the file too).
 *
 * Held by a live process: we wait (`waitMs`, default 3 min), then return `null` (the caller exits with code 75).
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

/** Is process `pid` still running (on THIS machine)? EPERM = it exists, under another user. */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM" }
}

function readLock(file: string): { info: LockInfo | null; raw: string; mtimeMs: number } | null {
  try {
    const raw = readFileSync(file, "utf8")
    const mtimeMs = statSync(file).mtimeMs
    let info: LockInfo | null = null
    try { const j = JSON.parse(raw); if (j && typeof j.pid === "number") info = j } catch { /* half written, or damaged */ }
    return { info, raw, mtimeMs }
  } catch { return null } // gone in the meantime
}

/** Why this lock can be taken over ("" = it is held). */
function staleReason(l: { info: LockInfo | null; mtimeMs: number }, staleMs: number, now = Date.now()): string {
  const ageMs = now - (l.info ? Date.parse(l.info.at) || l.mtimeMs : l.mtimeMs)
  if (!l.info) return now - l.mtimeMs > 10_000 ? "unreadable lock" : ""
  if (ageMs > staleMs) return `${Math.round(ageMs / 60_000)} min old`
  if (l.info.host === hostname() && !pidAlive(l.info.pid)) return `pid ${l.info.pid} dead`
  return ""
}

function tryCreate(file: string, info: LockInfo): boolean {
  let fd: number
  try { fd = openSync(file, "wx") } catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") return false; throw e }
  try { writeSync(fd, JSON.stringify(info)) } finally { closeSync(fd) }
  return true
}

/** Takes over an orphan lock WITHOUT ever deleting one someone else just set: atomic rename, then a check. */
function takeOver(file: string, seenRaw: string): boolean {
  const aside = `${file}.stale-${process.pid}-${Date.now()}`
  try { renameSync(file, aside) } catch { return false } // someone else already took it over
  let moved = ""
  try { moved = readFileSync(aside, "utf8") } catch { /* */ }
  if (moved !== seenRaw) { try { renameSync(aside, file) } catch { /* */ } return false } // it was no longer the same one: put it back
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
        if (takeOver(o.file, cur.raw)) o.log(`⚠ orphan lock taken over (${why}${cur.info ? ` · ${cur.info.cmd} from ${cur.info.at}` : ""})`)
        continue
      }
      if (!told) { told = true; o.log(`⏳ ${cur.info?.cmd ?? "a command"} already running (pid ${cur.info?.pid ?? "?"} on ${cur.info?.host ?? "?"}, since ${cur.info?.at ?? "?"}): waiting (≤ ${Math.round(o.waitMs / 1000)} s)`) }
    }
    if (Date.now() >= deadline) return false
    await sleep(o.pollMs)
  }
}

function releaseFile(file: string, owner: string): void {
  const cur = readLock(file)
  if (cur?.info?.owner === owner) { try { unlinkSync(file) } catch { /* */ } }
}

/** Takes the lock (file, then a database lease if DATABASE_URL). `null` = held elsewhere beyond `waitMs`. */
export async function acquireLock(opts: LockOptions): Promise<HeldLock | null> {
  const o = { waitMs: 180_000, staleMs: 30 * 60_000, pollMs: 250, log: (s: string) => console.error(s), ...opts }
  const owner = randomUUID()
  const info: LockInfo = { pid: process.pid, host: hostname(), at: new Date().toISOString(), cmd: o.cmd, owner }
  if (!(await fileLock(o, info))) return null

  // database lease: two machines on the same database never tick at the same time
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
          o.log(`⏳ ${other.cmd ?? "a command"} already running on ${other.host ?? "another machine"} (shared database, since ${other.at ?? "?"}): waiting (≤ ${Math.round(o.waitMs / 1000)} s)`)
        }
        if (Date.now() >= deadline) { releaseFile(o.file, owner); return null }
        await sleep(Math.max(o.pollMs, 500))
      }
      beat = setInterval(() => {
        db.prepare("UPDATE meta SET updated_at = ? WHERE key = ? AND value = ?").run(Date.now(), o.dbKey, value).catch(() => { /* the database will come back */ })
      }, 30_000)
      beat.unref()
    } catch (e) {
      o.log(`⚠ database lock lease unavailable (${(e as Error).message.split("\n")[0].slice(0, 120)}): file lock only`)
    }
  }

  let released = false
  const release = async () => {
    if (released) return
    released = true
    if (beat) clearInterval(beat)
    if (lease && db && o.dbKey) { try { await db.prepare("DELETE FROM meta WHERE key = ? AND value = ?").run(o.dbKey, value) } catch { /* will expire by itself */ } }
    releaseFile(o.file, owner)
    process.off("exit", onExit)
    process.off("SIGINT", onSig); process.off("SIGTERM", onSig)
  }
  // process.exit() or a signal: the file lock is released (synchronously); the database lease expires by itself at worst
  const onExit = () => releaseFile(o.file, owner)
  const onSig = (sig: NodeJS.Signals) => { release().finally(() => process.exit(sig === "SIGINT" ? 130 : 143)) }
  process.on("exit", onExit)
  process.once("SIGINT", onSig); process.once("SIGTERM", onSig)
  return { release, info }
}
