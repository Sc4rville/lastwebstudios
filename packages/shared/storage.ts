/**
 * storage.ts — stockage cloud UNIQUE des médias (Supabase Storage), pour que local, VM et salesport
 * lisent la même source. FS-first avec REPLI : si Storage n'est pas configuré (clé absente) ou échoue,
 * tout retombe sur le filesystem local → zéro régression. Zéro dépendance (fetch natif Node 18+).
 *
 * Env (jamais committé) : SUPABASE_SERVICE_KEY (service_role, écritures). SUPABASE_URL et SUPABASE_BUCKET
 * sont optionnels : l'URL est DÉRIVÉE de DATABASE_URL (que le cockpit a déjà) si absente, le bucket vaut
 * `storage.bucket` de agency.config.json par défaut. → le cockpit Coolify n'a RIEN à reconfigurer pour LIRE par URL.
 *
 * Clés du bucket :
 *   prospects/<id>/avant.png · logo.* · photo-*.jpg
 *   sites/<id>/<dir>/index.html · _after.png · assets/… (dont hero.mp4/webm/poster)
 */
import { readFile, copyFile, mkdir } from "node:fs/promises"
import { readdirSync, statSync } from "node:fs"
import { extname, join, relative, dirname, resolve } from "node:path"
import { agency } from "./agency.mjs"

// le ref du projet est dans DATABASE_URL (pooler `postgres.<ref>@…` ou direct `db.<ref>.supabase.co`)
function deriveUrlFromDb(): string {
  const m = (process.env.DATABASE_URL || "").match(/(?:postgres\.|db\.)([a-z0-9]{20})/i)
  return m ? `https://${m[1]}.supabase.co` : ""
}
// config LAZY (les imports ES sont hoistés avant le chargement du .env par les appelants)
function cfg() {
  const URL_BASE = (process.env.SUPABASE_URL || deriveUrlFromDb()).replace(/\/$/, "")
  const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || ""
  const BUCKET = process.env.SUPABASE_BUCKET || agency().storage.bucket
  return { URL_BASE, KEY, BUCKET }
}

/** base des médias servis par la box (Caddy) si on a migré hors Supabase (ASSETS_BASE_URL). Prioritaire. */
const assetsBase = (): string => (process.env.ASSETS_BASE_URL || "").replace(/\/$/, "")

/** Storage est-il configuré pour ÉCRIRE (upload) ? (box assets OU Supabase.) */
export const storageReady = (): boolean => { if (assetsBase()) return true; const { URL_BASE, KEY } = cfg(); return !!(URL_BASE && KEY) }
/** Base URL du projet (vide si introuvable) — sert à savoir si on peut REDIRIGER une lecture vers le bucket. */
export const storageBase = (): string => cfg().URL_BASE

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".avif": "image/avif", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".m4v": "video/mp4",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf",
}
const mimeOf = (p: string): string => MIME[extname(p).toLowerCase()] || "application/octet-stream"

/** URL publique d'une clé (ne vérifie pas l'existence). Box (Caddy) si migré, sinon Supabase. */
export function urlFor(key: string): string {
  const a = assetsBase()
  if (a) return `${a}/${encodeURI(key)}`
  const { URL_BASE, BUCKET } = cfg()
  return `${URL_BASE}/storage/v1/object/public/${BUCKET}/${encodeURI(key)}`
}

/** Upload un fichier local sous `key` → renvoie l'URL publique, ou null si indispo/échec (→ repli FS). */
export async function upload(localPath: string, key: string): Promise<string | null> {
  // migré sur la box : on écrit le fichier à l'emplacement monté dans Caddy (output/sites, data/prospects)
  // et on renvoie l'URL box. Le worker tourne SUR la box → le fichier est souvent déjà à destination.
  const a = assetsBase()
  if (a) {
    try {
      const dest = key.startsWith("sites/") ? key.replace(/^sites\//, "output/sites/")
        : key.startsWith("prospects/") ? key.replace(/^prospects\//, "data/prospects/") : join("output", key)
      if (resolve(localPath) !== resolve(dest)) { await mkdir(dirname(dest), { recursive: true }); await copyFile(localPath, dest) }
      return urlFor(key)
    } catch (e) { console.warn(`assets box KO ${key}: ${(e as Error).message}`); return null }
  }
  const { URL_BASE, KEY, BUCKET } = cfg()
  if (!URL_BASE || !KEY) return null
  let body: Buffer
  try { body = await readFile(localPath) } catch { return null } // pas de fichier local → rien à uploader
  try {
    const res = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${encodeURI(key)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": mimeOf(localPath),
        "x-upsert": "true", // ré-upload écrase (idempotent)
        "cache-control": "public, max-age=31536000, immutable",
      },
      body: new Uint8Array(body),
    })
    if (!res.ok) { console.warn(`storage upload KO ${key}: ${res.status} ${(await res.text().catch(() => "")).slice(0, 140)}`); return null }
    return urlFor(key)
  } catch (e) { console.warn(`storage upload err ${key}: ${(e as Error).message}`); return null }
}

/** Le fichier existe-t-il déjà dans le bucket ? (HEAD sur l'URL publique.) */
export async function exists(key: string): Promise<boolean> {
  if (!cfg().URL_BASE) return false
  try { const r = await fetch(urlFor(key), { method: "HEAD" }); return r.ok } catch { return false }
}

/** Pousse RÉCURSIVEMENT un dossier local vers le bucket sous `keyPrefix` → nb de fichiers uploadés.
 *  Idempotent (x-upsert). Sert au worker (sync d'un site frais) ET au backfill de l'existant. */
export async function syncTree(localRoot: string, keyPrefix: string): Promise<number> {
  if (!storageReady()) return 0
  let ok = 0
  const walk = (dir: string): string[] => {
    const out: string[] = []
    let entries: string[]; try { entries = readdirSync(dir) } catch { return out }
    for (const e of entries) {
      const p = join(dir, e)
      try { if (statSync(p).isDirectory()) out.push(...walk(p)); else out.push(p) } catch { /* lien cassé */ }
    }
    return out
  }
  for (const f of walk(localRoot)) {
    const rel = relative(localRoot, f).split("\\").join("/")
    if (rel.startsWith(".")) continue // marqueurs (.reviewing, .storaged…) : pas dans le bucket
    if (await upload(f, `${keyPrefix}/${rel}`)) ok++
  }
  return ok
}
