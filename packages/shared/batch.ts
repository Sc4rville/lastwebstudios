/**
 * batch.ts — THE batch QUEUE (the `batch_requests` table, Supabase / Postgres).
 *
 * The cockpit (a Coolify container, without Claude Code/Playwright) can NOT generate by itself: it WRITES
 * a request to this queue. The WORKER (native on the box, with Claude Code + Playwright + the plan token)
 * PULLS it, generates, reindexes, and marks the job done. Both go through this shared table.
 *
 * ATOMIC claim (`FOR UPDATE SKIP LOCKED`) → safe even with several workers: two workers will never
 * take the same job. DB-owned: no file source, it is fresh state.
 *
 * Async interface (Postgres through db.ts). Used by serve.ts (enqueue/list) and worker/worker.ts (claim/mark).
 */
import { getDb } from "./db.ts"
import { buildsStatus } from "./cage.mjs"

export type BatchStatus = "queued" | "running" | "done" | "error" | "canceled"
export type BatchMode = "composer" | "template-fill" | "edit" | "research" | "find"

export interface BatchRow {
  id: number
  status: BatchStatus
  mode: BatchMode
  industry: string | null
  seed: string | null
  lim: number | null
  force_flag: number
  requested_by: string | null
  note: string | null
  worker: string | null
  log: string | null
  result_json: string | null
  created_at: number
  started_at: number | null
  finished_at: number | null
  retry_after: number | null
  attempts: number
  params_json: string | null
}

export interface EnqueueOpts {
  mode?: BatchMode
  industry?: string | null
  seed?: string | null
  lim?: number | null
  force?: boolean
  requestedBy?: string | null
  note?: string | null
  ids?: string[] | null // RERUN: re-compose these EXISTING prospects (skip scrape/already done), with the CURRENT composer
  params?: Record<string, unknown> | null // the job's free parameters (e.g. `find`: the interpreted brief)
}

/** Queues a batch request (the cockpit's button). Returns the row created. */
export async function enqueueBatch(opts: EnqueueOpts): Promise<BatchRow> {
  const mode: BatchMode = opts.mode === "template-fill" ? "template-fill" : opts.mode === "find" ? "find" : "composer"
  // RERUN: the id list travels in params_json (like enqueueEdit) → the worker passes it to the workflow
  const params = opts.ids && opts.ids.length ? JSON.stringify({ ...(opts.params || {}), ids: opts.ids.slice(0, 200) }) : opts.params ? JSON.stringify(opts.params) : null
  const rows = (await getDb().prepare(
    `INSERT INTO batch_requests (status, mode, industry, seed, lim, force_flag, requested_by, note, params_json, created_at)
     VALUES ('queued', ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
  ).all(
    mode,
    opts.industry ?? null,
    opts.seed ?? null,
    opts.lim ?? null,
    opts.force ? 1 : 0,
    opts.requestedBy ?? null,
    opts.note ?? null,
    params,
    Date.now(),
  )) as BatchRow[]
  return rows[0]
}

/**
 * Queues an EDIT job (feedback on a site): the worker (box) will run `npm run edit -- <id> <date>`
 * to apply the comment (control.md). Use it instead of a local spawn (the cockpit container
 * has neither Claude nor Playwright → it can't edit).
 */
export async function enqueueEdit(id: string, date: string, requestedBy?: string | null): Promise<BatchRow> {
  const rows = (await getDb().prepare(
    `INSERT INTO batch_requests (status, mode, note, params_json, requested_by, created_at)
     VALUES ('queued', 'edit', ?, ?, ?, ?)
     RETURNING *`,
  ).all(`feedback ${id}`, JSON.stringify({ id, date }), requestedBy ?? null, Date.now())) as BatchRow[]
  return rows[0]
}

/**
 * Queues a RESEARCH job for ONE prospect: on APPROVAL (automatic) or through the "resolve" button
 * (manual). The worker (box) will run the contact resolver + the /account-research skill → brief +
 * call script + missing contacts resolved, persisted in the shared DB (crm_leads, outreach). The
 * worker is idempotent (skips if already done). Mirrors enqueueEdit; the id travels in params_json.ids.
 */
export async function enqueueResearch(id: string, requestedBy?: string | null, extra: Record<string, unknown> = {}): Promise<BatchRow> {
  const rows = (await getDb().prepare(
    `INSERT INTO batch_requests (status, mode, note, params_json, requested_by, created_at)
     VALUES ('queued', 'research', ?, ?, ?, ?)
     RETURNING *`,
  ).all(`research ${id}`, JSON.stringify({ ...extra, ids: [id] }), requestedBy ?? null, Date.now())) as BatchRow[]
  return rows[0]
}

/** The last N batches (for the queue shown in the cockpit), most recent first. */
export async function listBatches(limit = 30): Promise<BatchRow[]> {
  return (await getDb().prepare(
    `SELECT * FROM batch_requests ORDER BY created_at DESC LIMIT ?`,
  ).all(limit)) as BatchRow[]
}

/** One batch by id. */
export async function getBatch(id: number): Promise<BatchRow | undefined> {
  return (await getDb().prepare(`SELECT * FROM batch_requests WHERE id = ?`).get(id)) as BatchRow | undefined
}

/**
 * ATOMICALLY takes the oldest waiting job and moves it to 'running'. Returns the row, or null
 * if the queue is empty. `FOR UPDATE SKIP LOCKED`: two concurrent workers never step on each other.
 */
export async function claimNextBatch(worker: string, onlyModes?: BatchMode[]): Promise<BatchRow | null> {
  const now = Date.now()
  // `onlyModes` : the cockpit's engine, busy with a heavy job, still takes the light ones (research) alongside
  const modeFilter = onlyModes && onlyModes.length ? ` AND mode IN (${onlyModes.map((m) => `'${m.replace(/'/g, "")}'`).join(",")})` : ""
  const rows = (await getDb().prepare(
    `UPDATE batch_requests SET status='running', started_at=?, worker=?, attempts=attempts+1
       WHERE id = (
         SELECT id FROM batch_requests
          WHERE status='queued' AND COALESCE(retry_after, 0) <= ?${modeFilter}
          ORDER BY (mode='research') DESC, created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
     RETURNING *`,
  ).all(now, worker, now)) as BatchRow[]
  return rows[0] ?? null
}

/**
 * Puts a batch back in the queue to RESUME later (e.g. the plan's session limit was reached). It is only
 * taken again after `retryAfter`. Generation is idempotent (it excludes sites already composed) → the
 * resumed run only does what is left. Past `maxAttempts`, it gives up with an error (no endless loop).
 */
export async function requeueBatch(id: number, retryAfter: number, note: string, maxAttempts = 24): Promise<"requeued" | "gaveup"> {
  const b = await getBatch(id)
  if (b && b.attempts >= maxAttempts) {
    await markBatchError(id, `gave up after ${b.attempts} attempts — ${note}`)
    return "gaveup"
  }
  await getDb().prepare(
    `UPDATE batch_requests
        SET status='queued', retry_after=?, finished_at=NULL, worker=NULL,
            log = right(coalesce(log,'') || ? , 8000)
      WHERE id = ?`,
  ).run(retryAfter, `\n⏸ ${note}`, id)
  return "requeued"
}

/** the sites the composer jobs running now will build (ids, or `lim` when the job picks them) ; `queued` adds the jobs
 *  waiting their turn today (never the ones that wait for tomorrow) */
export async function buildsInFlight(o: { exceptId?: number; queued?: boolean } = {}): Promise<number> {
  const exceptId = o.exceptId
  const rows = (await getDb().prepare(`SELECT id, lim, params_json, retry_after, status FROM batch_requests WHERE mode='composer' AND status IN (${o.queued ? "'queued','running'" : "'running'"})`).all()) as any[]
  let n = 0
  for (const r of rows) {
    if (r.id === exceptId) continue
    if (r.status === "queued" && Number(r.retry_after) > Date.now()) continue // waits for tomorrow : not today's
    let ids: unknown = null; try { ids = JSON.parse(r.params_json || "{}").ids } catch { /* */ }
    n += Array.isArray(ids) && ids.length ? ids.length : Math.max(1, Number(r.lim) || 1)
  }
  return n
}

/**
 * Today's cap in builds (LWS_BUILDS_PER_DAY, or the daily limit ÷ the estimate of one build), applied to a composer
 * job just claimed : what fits today stays in it, the rest moves to a new job that nobody claims before the cap resets
 * (midnight UTC, `retry_after`) and says so in its log. Nothing fits → the whole job waits. Never more builds a day than
 * the cap says, whoever queued them (Hands-off, a bulk Build, the API).
 */
export async function capBuildBatch(b: BatchRow, nowIso = new Date().toISOString()): Promise<{ run: boolean; later: string[]; waitsUntil: number | null }> {
  if (b.mode !== "composer") return { run: true, later: [], waitsUntil: null }
  const st = buildsStatus(nowIso)
  if (st.cap == null) return { run: true, later: [], waitsUntil: null }
  const left = Math.max(0, st.cap - st.done - await buildsInFlight({ exceptId: b.id }).catch(() => 0))
  const until = Date.parse(st.resetsAt)
  const say = `waits for tomorrow: today's cap of ${st.cap} build${st.cap === 1 ? "" : "s"} is reached`
  let p: any = {}; try { p = JSON.parse(b.params_json || "{}") } catch { /* */ }
  const ids: string[] = Array.isArray(p.ids) ? p.ids : []
  if (left <= 0) {
    await getDb().prepare(`UPDATE batch_requests SET status='queued', retry_after=?, started_at=NULL, worker=NULL, attempts=GREATEST(attempts-1,0), log = right(coalesce(log,'') || ?, 8000) WHERE id = ?`).run(until, `\n⏸ ${say}`, b.id)
    return { run: false, later: ids, waitsUntil: until }
  }
  if (!ids.length) {
    if ((Number(b.lim) || 1) > left) { await getDb().prepare("UPDATE batch_requests SET lim=? WHERE id=?").run(left, b.id); b.lim = left }
    return { run: true, later: [], waitsUntil: null }
  }
  if (ids.length <= left) return { run: true, later: [], waitsUntil: null }
  const keep = ids.slice(0, left), later = ids.slice(left)
  const params = JSON.stringify({ ...p, ids: keep })
  await getDb().prepare("UPDATE batch_requests SET params_json=?, lim=? WHERE id=?").run(params, keep.length, b.id)
  b.params_json = params; b.lim = keep.length
  const { ids: _drop, ...rest } = p
  void _drop
  const nb = await enqueueBatch({ mode: "composer", ids: later, lim: later.length, requestedBy: b.requested_by, note: b.note, params: rest })
  await getDb().prepare(`UPDATE batch_requests SET retry_after=?, log=? WHERE id=?`).run(until, `⏸ ${say}\n`, nb.id)
  await appendBatchLog(b.id, `${keep.length} today, ${later.length} tomorrow (today's cap of ${st.cap} build${st.cap === 1 ? "" : "s"})`)
  return { run: true, later, waitsUntil: until }
}

/** Appends a line to the batch's log (bounded on the display side). Best-effort. */
export async function appendBatchLog(id: number, line: string): Promise<void> {
  try {
    await getDb().prepare(
      `UPDATE batch_requests
          SET log = right(coalesce(log,'') || ? || E'\n', 8000)
        WHERE id = ?`,
    ).run(line, id)
  } catch { /* best-effort: the log must never break a run */ }
}

/** Marks a batch as done. `result` = {built, count, ms, ids…}. */
export async function markBatchDone(id: number, result: Record<string, unknown>): Promise<void> {
  await getDb().prepare(
    `UPDATE batch_requests SET status='done', finished_at=?, result_json=? WHERE id = ?`,
  ).run(Date.now(), JSON.stringify(result), id)
}

/** Marks a batch as failed, with the error message. */
export async function markBatchError(id: number, error: string): Promise<void> {
  await getDb().prepare(
    `UPDATE batch_requests
        SET status='error', finished_at=?, log = right(coalesce(log,'') || ?, 8000)
      WHERE id = ?`,
  ).run(Date.now(), `\n✗ ${error}`, id)
}

/**
 * Zombie net: a job 'running' for too long (a worker that died mid-run) is put back to
 * 'queued' OR moved to 'error' depending on `requeue`. Called by the worker at start-up.
 */
export async function reclaimStaleBatches(olderThanMs = 2 * 60 * 60 * 1000, requeue = false): Promise<number> {
  const cutoff = Date.now() - olderThanMs
  const next = requeue ? "queued" : "error"
  const rows = (await getDb().prepare(
    `UPDATE batch_requests
        SET status=?, log = coalesce(log,'') || E'\n⚠ taken back: the worker was silent past the threshold'
      WHERE status='running' AND coalesce(started_at,0) < ?
     RETURNING id`,
  ).all(next, cutoff)) as { id: number }[]
  return rows.length
}
