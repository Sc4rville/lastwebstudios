/**
 * pg-options.mjs · SHARED Postgres connection options (db.ts, worker/coach.mjs, scripts/*.mjs).
 * Plain JS (+ pg-options.d.mts) so TypeScript and the .mjs files can both import it.
 *
 * TLS (postgres.js's `ssl`), by order of priority:
 *   1. DB_SSL = disable | require | prefer | verify-full   (disable = no TLS: local Postgres, docker)
 *   2. `sslmode=` in DATABASE_URL (same vocabulary, + allow → prefer)
 *   3. default: `require` for a remote host (Supabase…), no TLS on loopback / a unix socket
 */
const LOOPBACK = /^(127\.\d+\.\d+\.\d+|localhost|::1|\[::1\])$/i

/** @returns {false | "require" | "prefer" | "verify-full"} */
export function pgSsl(url = "", env = process.env) {
  const norm = (v) => {
    const s = String(v || "").trim().toLowerCase()
    if (["disable", "off", "false", "0", "no"].includes(s)) return false
    if (["require", "on", "true", "1", "yes"].includes(s)) return "require"
    if (s === "prefer" || s === "allow") return "prefer"
    if (s === "verify-full" || s === "verify-ca") return "verify-full"
    return undefined
  }
  const fromEnv = norm(env.DB_SSL)
  if (fromEnv !== undefined) return fromEnv
  let host = "", mode
  try { const u = new URL(url); host = decodeURIComponent(u.hostname); mode = norm(u.searchParams.get("sslmode")) } catch { /* unusual URL */ }
  if (mode !== undefined) return mode
  if (!host || host.startsWith("/") || LOOPBACK.test(host)) return false
  return "require"
}

/**
 * Connection pool size (postgres.js's `max` option): DB_POOL_MAX if set (integer ≥ 1), else the caller's
 * default. The sandbox (PGlite, a single shared Postgres session) sets DB_POOL_MAX=1 for each process.
 * @param {number} def @returns {number}
 */
export function pgPoolMax(def, env = process.env) {
  const n = parseInt(String(env.DB_POOL_MAX || ""), 10)
  return Number.isFinite(n) && n >= 1 ? n : def
}

// uninteresting Postgres NOTICEs (idempotent `IF NOT EXISTS` migrations: "already exists, skipping")
const QUIET = new Set(["42701", "42P07", "42710", "42P06", "42P16", "00000"])
/** postgres.js's onnotice: silences the noise of idempotent migrations, keeps the rest. */
export function onPgNotice(n) {
  if ((n && QUIET.has(n.code)) || /already exists, skipping|does not exist, skipping/i.test(String(n && n.message))) return
  console.warn(`postgres ${n && n.severity ? n.severity : "NOTICE"}: ${n && n.message}`)
}
