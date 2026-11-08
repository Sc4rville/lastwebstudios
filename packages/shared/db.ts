/**
 * db.ts — the backoffice's SHARED DATABASE (Supabase / Postgres, through DATABASE_URL).
 *
 * Migrated from node:sqlite (local) → Postgres (cloud, SHARED between the team's machines and the server). The schema is
 * versioned in `db/schema.sql` (rebuilt from the code's queries) and is applied with
 * `npm run db:init` (idempotent) on any Postgres. The interface stays compatible
 * (`getDb().prepare(q).get/all/run`) but becomes ASYNC: the callers (reindex.ts, serve.ts) `await`
 * each query. The callers' SQL is unchanged (the `?` are turned into `$1,$2…` here, and
 * `ON CONFLICT … DO UPDATE SET col=excluded.col` is the same in Postgres).
 *
 * The SOURCE-OF-TRUTH model is unchanged: the FILESYSTEM stays the bus (`data/prospects/*.json`, `output/sites/**`);
 * the DB is a rebuildable INDEX/CACHE (reindexAll) + the only home of fresh state (status, scores,
 * comments, runs). The file wins over the cache columns.
 *
 * CONNECTION: `DATABASE_URL` (Supabase, in `.env`, never committed). ⚠ On an IPv4 server (Hetzner),
 * use the POOLER URL (Supabase → Settings → Database → Connection pooling, **session mode**) — the
 * direct connection `db.<ref>.supabase.co:5432` is IPv6-only and fails from an IPv4 host.
 * TLS: `DB_SSL=disable|require|prefer|verify-full` (default: require outside loopback, see pg-options.mjs).
 */
import postgres from "postgres"
import { pgSsl, onPgNotice, pgPoolMax } from "./pg-options.mjs"

let _sql: ReturnType<typeof postgres> | null = null

// LAZY read of DATABASE_URL (on first use): ES imports are hoisted BEFORE the callers' `process.loadEnvFile()`
// → reading it when the module loads would give "" even when .env does define it.
function client() {
  if (!_sql) {
    const DATABASE_URL = process.env.DATABASE_URL || ""
    if (!DATABASE_URL) throw new Error("No database: DATABASE_URL is not set (npm run backoffice starts a local one ; any Postgres works, then npm run db:init)")
    _sql = postgres(DATABASE_URL, {
      ssl: pgSsl(DATABASE_URL),
      onnotice: onPgNotice, // silences the "already exists, skipping" NOTICEs of idempotent migrations
      prepare: false, // compatible with a transaction-mode pooler
      max: pgPoolMax(4), // small pool: a single backoffice process (DB_POOL_MAX to force it, 1 in the PGlite sandbox)
      idle_timeout: 20,
      types: {
        // int8 (bigint, OID 20) → JS Number: our timestamps (epoch ms) are < 2^53 → comparable without surprises
        int8: { to: 20, from: [20], serialize: (x: number) => "" + x, parse: (x: string) => parseInt(x, 10) },
      },
    })
  }
  return _sql
}

// SQLite-style "?" placeholders → Postgres "$1,$2,…" → the callers' SQL stays unchanged
function toPg(q: string): string { let i = 0; return q.replace(/\?/g, () => `$${++i}`) }

export type Stmt = {
  get: (...args: any[]) => Promise<any>
  all: (...args: any[]) => Promise<any[]>
  run: (...args: any[]) => Promise<void>
}
export type Db = { prepare: (q: string) => Stmt }

const db: Db = {
  prepare(q: string): Stmt {
    const pg = toPg(q)
    return {
      async get(...a) { return ((await client().unsafe(pg, a)) as any[])[0] },
      async all(...a) { return (await client().unsafe(pg, a)) as any[] },
      async run(...a) { await client().unsafe(pg, a) },
    }
  },
}

/** The shared DB (Postgres). Throws if DATABASE_URL is missing — for the callers that depend on it (serve.ts). */
export function getDb(): Db { return db }

/** The DB, or null if DATABASE_URL is missing — the PIPELINE path (telemetry must never break a build). */
export function tryDb(): Db | null { return process.env.DATABASE_URL ? db : null }

/** Closes the connection pool cleanly. Idempotent. */
export function closeDb(): void { try { _sql?.end({ timeout: 5 }) } catch { /* already closed */ } _sql = null }

export async function setMeta(key: string, value: string): Promise<void> {
  try {
    await getDb().prepare("INSERT INTO meta(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
      .run(key, value, Date.now())
  } catch { /* best-effort */ }
}

export async function getMeta(key: string): Promise<string | null> {
  try {
    const row = await getDb().prepare("SELECT value FROM meta WHERE key=?").get(key) as { value: string } | undefined
    return row?.value ?? null
  } catch { return null }
}
