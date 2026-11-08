/**
 * storage.ts — the SINGLE cloud storage for media (Supabase Storage), so local, VM and salesport
 * read the same source. FS-first with a FALLBACK: if Storage isn't configured (no key) or fails,
 * everything falls back on the local filesystem → zero regression. Zero dependency (native fetch, Node 18+).
 *
 * Env (never committed): SUPABASE_SERVICE_KEY (service_role, writes). SUPABASE_URL and SUPABASE_BUCKET
 * are optional: the URL is DERIVED from DATABASE_URL (which the cockpit already has) if missing, the bucket defaults to
 * agency.config.json's `storage.bucket`. → the Coolify cockpit has NOTHING to reconfigure to READ by URL.
 *
 * Bucket keys:
 *   prospects/<id>/avant.png · logo.* · photo-*.jpg
 *   sites/<id>/<dir>/index.html · _after.png · assets/… (including hero.mp4/webm/poster)
 */
import { readFile, copyFile, mkdir } from "node:fs/promises"
import { readdirSync, statSync } from "node:fs"
import { extname, join, relative, dirname, resolve } from "node:path"
import { agency } from "./agency.mjs"

// the project's ref is in DATABASE_URL (pooler `postgres.<ref>@…` or direct `db.<ref>.supabase.co`)
function deriveUrlFromDb(): string {
  const m = (process.env.DATABASE_URL || "").match(/(?:postgres\.|db\.)([a-z0-9]{20})/i)
  return m ? `https://${m[1]}.supabase.co` : ""
}
// LAZY config (ES imports are hoisted before the callers load the .env)
function cfg() {
  const URL_BASE = (process.env.SUPABASE_URL || deriveUrlFromDb()).replace(/\/$/, "")
  const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || ""
  const BUCKET = process.env.SUPABASE_BUCKET || agency().storage.bucket
  return { URL_BASE, KEY, BUCKET }
}

/** base of the media served by the box (Caddy) if we migrated off Supabase (ASSETS_BASE_URL). Takes precedence. */
const assetsBase = (): string => (process.env.ASSETS_BASE_URL || "").replace(/\/$/, "")

/** Is Storage configured to WRITE (upload)? (box assets OR Supabase.) */
export const storageReady = (): boolean => { if (assetsBase()) return true; const { URL_BASE, KEY } = cfg(); return !!(URL_BASE && KEY) }
/** The project's base URL (empty if not found) — tells whether a read can be REDIRECTED to the bucket. */
export const storageBase = (): string => cfg().URL_BASE

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".avif": "image/avif", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".m4v": "video/mp4",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf",
}
const mimeOf = (p: string): string => MIME[extname(p).toLowerCase()] || "application/octet-stream"

/** A key's public URL (doesn't check it exists). The box (Caddy) if migrated, otherwise Supabase. */
export function urlFor(key: string): string {
  const a = assetsBase()
  if (a) return `${a}/${encodeURI(key)}`
  const { URL_BASE, BUCKET } = cfg()
  return `${URL_BASE}/storage/v1/object/public/${BUCKET}/${encodeURI(key)}`
}

/** Uploads a local file under `key` → returns the public URL, or null if unavailable/failed (→ FS fallback). */
export async function upload(localPath: string, key: string): Promise<string | null> {
  // migrated to the box: write the file where Caddy mounts it (output/sites, data/prospects)
  // and return the box URL. The worker runs ON the box → the file is often already in place.
  const a = assetsBase()
  if (a) {
    try {
      const dest = key.startsWith("sites/") ? key.replace(/^sites\//, "output/sites/")
        : key.startsWith("prospects/") ? key.replace(/^prospects\//, "data/prospects/") : join("output", key)
      if (resolve(localPath) !== resolve(dest)) { await mkdir(dirname(dest), { recursive: true }); await copyFile(localPath, dest) }
      return urlFor(key)
    } catch (e) { console.warn(`box assets failed ${key}: ${(e as Error).message}`); return null }
  }
  const { URL_BASE, KEY, BUCKET } = cfg()
  if (!URL_BASE || !KEY) return null
  let body: Buffer
  try { body = await readFile(localPath) } catch { return null } // no local file → nothing to upload
  try {
    const res = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${encodeURI(key)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": mimeOf(localPath),
        "x-upsert": "true", // a re-upload overwrites (idempotent)
        "cache-control": "public, max-age=31536000, immutable",
      },
      body: new Uint8Array(body),
    })
    if (!res.ok) { console.warn(`storage upload failed ${key}: ${res.status} ${(await res.text().catch(() => "")).slice(0, 140)}`); return null }
    return urlFor(key)
  } catch (e) { console.warn(`storage upload err ${key}: ${(e as Error).message}`); return null }
}

/** Is the file already in the bucket? (HEAD on the public URL.) */
export async function exists(key: string): Promise<boolean> {
  if (!cfg().URL_BASE) return false
  try { const r = await fetch(urlFor(key), { method: "HEAD" }); return r.ok } catch { return false }
}

/** RECURSIVELY pushes a local folder to the bucket under `keyPrefix` → the number of files uploaded.
 *  Idempotent (x-upsert). Used by the worker (syncing a fresh site) AND to backfill what exists. */
export async function syncTree(localRoot: string, keyPrefix: string): Promise<number> {
  if (!storageReady()) return 0
  let ok = 0
  const walk = (dir: string): string[] => {
    const out: string[] = []
    let entries: string[]; try { entries = readdirSync(dir) } catch { return out }
    for (const e of entries) {
      const p = join(dir, e)
      try { if (statSync(p).isDirectory()) out.push(...walk(p)); else out.push(p) } catch { /* broken link */ }
    }
    return out
  }
  for (const f of walk(localRoot)) {
    const rel = relative(localRoot, f).split("\\").join("/")
    if (rel.startsWith(".")) continue // markers (.reviewing, .storaged…): not in the bucket
    if (await upload(f, `${keyPrefix}/${rel}`)) ok++
  }
  return ok
}
