/**
 * batch.ts — LA FILE D'ATTENTE des batchs (table `batch_requests`, Supabase / Postgres).
 *
 * Le cockpit (conteneur Coolify, sans Claude Code/Playwright) ne peut PAS générer lui-même : il ÉCRIT
 * une demande dans cette file. Le WORKER (natif sur la box, avec Claude Code + Playwright + token plan)
 * la DÉPILE, génère, réindexe, et marque le job fait. Les deux passent par cette table partagée.
 *
 * Claim ATOMIQUE (`FOR UPDATE SKIP LOCKED`) → sûr même si plusieurs workers tournent : deux workers ne
 * prendront jamais le même job. DB-owned : aucune source fichier, c'est de l'état neuf.
 *
 * Interface async (Postgres via db.ts). Réutilisé par serve.ts (enqueue/list) et worker/worker.ts (claim/mark).
 */
import { getDb } from "./db.ts"

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
  ids?: string[] | null // RERUN : re-composer ces prospects EXISTANTS (skip scrape/déjà-fait), via le composer ACTUEL
  params?: Record<string, unknown> | null // paramètres libres du job (ex. `find` : le brief interprété)
}

/** Empile une demande de batch (le bouton du cockpit). Renvoie la ligne créée. */
export async function enqueueBatch(opts: EnqueueOpts): Promise<BatchRow> {
  const mode: BatchMode = opts.mode === "template-fill" ? "template-fill" : opts.mode === "find" ? "find" : "composer"
  // RERUN : on porte la liste d'ids dans params_json (comme enqueueEdit) → le worker la passe au workflow
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
 * Empile un job d'ÉDITION (feedback d'un site) : le worker (box) relancera `npm run edit -- <id> <date>`
 * pour appliquer le commentaire (control.md). À utiliser à la place d'un spawn local (le conteneur
 * cockpit n'a ni Claude ni Playwright → il ne peut pas éditer).
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
 * Empile un job de RECHERCHE pour UN prospect : à l'APPROBATION (auto) ou via le bouton « résoudre »
 * (manuel). Le worker (box) relancera le résolveur de contacts + le skill /account-research → brief +
 * script d'appel + contacts manquants résolus, persistés dans la DB partagée (crm_leads, outreach). Le
 * worker est idempotent (saute si déjà fait). Miroir d'enqueueEdit ; l'id voyage dans params_json.ids.
 */
export async function enqueueResearch(id: string, requestedBy?: string | null): Promise<BatchRow> {
  const rows = (await getDb().prepare(
    `INSERT INTO batch_requests (status, mode, note, params_json, requested_by, created_at)
     VALUES ('queued', 'research', ?, ?, ?, ?)
     RETURNING *`,
  ).all(`research ${id}`, JSON.stringify({ ids: [id] }), requestedBy ?? null, Date.now())) as BatchRow[]
  return rows[0]
}

/** Les N derniers batchs (pour la file affichée au cockpit), plus récents en tête. */
export async function listBatches(limit = 30): Promise<BatchRow[]> {
  return (await getDb().prepare(
    `SELECT * FROM batch_requests ORDER BY created_at DESC LIMIT ?`,
  ).all(limit)) as BatchRow[]
}

/** Un batch par id. */
export async function getBatch(id: number): Promise<BatchRow | undefined> {
  return (await getDb().prepare(`SELECT * FROM batch_requests WHERE id = ?`).get(id)) as BatchRow | undefined
}

/**
 * Prend ATOMIQUEMENT le plus ancien job en attente et le passe à 'running'. Renvoie la ligne, ou null
 * si la file est vide. `FOR UPDATE SKIP LOCKED` : deux workers concurrents ne se marchent pas dessus.
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
 * Remet un batch en file pour REPRISE plus tard (ex: limite de session du plan atteinte). Il ne sera
 * re-pris qu'après `retryAfter`. La génération est idempotente (exclut les sites déjà composés) → la
 * reprise ne refait que ce qui reste. Au-delà de `maxAttempts`, on abandonne en erreur (anti-boucle).
 */
export async function requeueBatch(id: number, retryAfter: number, note: string, maxAttempts = 24): Promise<"requeued" | "gaveup"> {
  const b = await getBatch(id)
  if (b && b.attempts >= maxAttempts) {
    await markBatchError(id, `abandon après ${b.attempts} tentatives — ${note}`)
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

/** Ajoute une ligne au journal du batch (queue bornée côté affichage). Best-effort. */
export async function appendBatchLog(id: number, line: string): Promise<void> {
  try {
    await getDb().prepare(
      `UPDATE batch_requests
          SET log = right(coalesce(log,'') || ? || E'\n', 8000)
        WHERE id = ?`,
    ).run(line, id)
  } catch { /* best-effort : le journal ne doit jamais casser un run */ }
}

/** Marque un batch terminé avec succès. `result` = {built, count, ms, ids…}. */
export async function markBatchDone(id: number, result: Record<string, unknown>): Promise<void> {
  await getDb().prepare(
    `UPDATE batch_requests SET status='done', finished_at=?, result_json=? WHERE id = ?`,
  ).run(Date.now(), JSON.stringify(result), id)
}

/** Marque un batch en échec, avec le message d'erreur. */
export async function markBatchError(id: number, error: string): Promise<void> {
  await getDb().prepare(
    `UPDATE batch_requests
        SET status='error', finished_at=?, log = right(coalesce(log,'') || ?, 8000)
      WHERE id = ?`,
  ).run(Date.now(), `\n✗ ${error}`, id)
}

/**
 * Filet anti-zombie : un job 'running' depuis trop longtemps (worker mort en plein run) est remis en
 * 'queued' OU passé en 'error' selon `requeue`. Appelé par le worker au démarrage.
 */
export async function reclaimStaleBatches(olderThanMs = 2 * 60 * 60 * 1000, requeue = false): Promise<number> {
  const cutoff = Date.now() - olderThanMs
  const next = requeue ? "queued" : "error"
  const rows = (await getDb().prepare(
    `UPDATE batch_requests
        SET status=?, log = coalesce(log,'') || E'\n⚠ repris : worker silencieux > seuil'
      WHERE status='running' AND coalesce(started_at,0) < ?
     RETURNING id`,
  ).all(next, cutoff)) as { id: number }[]
  return rows.length
}
