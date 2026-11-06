/**
 * pg-options.mjs · options de connexion Postgres PARTAGÉES (db.ts, worker/coach.mjs, scripts/*.mjs).
 * En JS pur (+ pg-options.d.mts) pour être importable aussi bien par le TypeScript que par les .mjs.
 *
 * TLS (`ssl` de postgres.js), par ordre de priorité :
 *   1. DB_SSL = disable | require | prefer | verify-full   (disable = pas de TLS : Postgres local, docker)
 *   2. `sslmode=` dans DATABASE_URL (même vocabulaire, + allow → prefer)
 *   3. défaut : `require` pour un hôte distant (Supabase…), pas de TLS sur la boucle locale / un socket unix
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
  try { const u = new URL(url); host = decodeURIComponent(u.hostname); mode = norm(u.searchParams.get("sslmode")) } catch { /* URL atypique */ }
  if (mode !== undefined) return mode
  if (!host || host.startsWith("/") || LOOPBACK.test(host)) return false
  return "require"
}

/**
 * Taille du pool de connexions (option `max` de postgres.js) : DB_POOL_MAX si posé (entier ≥ 1), sinon le défaut de
 * l'appelant. La sandbox (PGlite, une seule session Postgres partagée) pose DB_POOL_MAX=1 pour chaque process.
 * @param {number} def @returns {number}
 */
export function pgPoolMax(def, env = process.env) {
  const n = parseInt(String(env.DB_POOL_MAX || ""), 10)
  return Number.isFinite(n) && n >= 1 ? n : def
}

// NOTICE Postgres sans intérêt (migrations idempotentes `IF NOT EXISTS` : « already exists, skipping »)
const QUIET = new Set(["42701", "42P07", "42710", "42P06", "42P16", "00000"])
/** onnotice de postgres.js : tait le bruit des migrations idempotentes, garde le reste. */
export function onPgNotice(n) {
  if ((n && QUIET.has(n.code)) || /already exists, skipping|does not exist, skipping/i.test(String(n && n.message))) return
  console.warn(`postgres ${n && n.severity ? n.severity : "NOTICE"}: ${n && n.message}`)
}
