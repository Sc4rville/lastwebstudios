/**
 * db.ts — LA BASE PARTAGÉE du backoffice (Supabase / Postgres, via DATABASE_URL).
 *
 * Migré de node:sqlite (local) → Postgres (cloud, PARTAGÉ entre Naly, Yann et la box). Le schéma est
 * versionné dans `db/schema.sql` (reconstruit depuis les requêtes du code) et s'applique avec
 * `npm run db:init` (idempotent) sur n'importe quel Postgres. L'interface reste compatible
 * (`getDb().prepare(q).get/all/run`) mais devient ASYNC : les appelants (reindex.ts, serve.ts) `await`
 * chaque requête. Le SQL des appelants est inchangé (les `?` sont convertis en `$1,$2…` ici, et
 * `ON CONFLICT … DO UPDATE SET col=excluded.col` est identique en Postgres).
 *
 * MODÈLE DE VÉRITÉ inchangé : le FILESYSTEM reste le bus (`data/prospects/*.json`, `output/sites/**`) ;
 * la DB est un INDEX/CACHE reconstructible (reindexAll) + l'unique maison de l'état neuf (status, scores,
 * comments, runs). Le fichier gagne sur les colonnes-cache.
 *
 * CONNEXION : `DATABASE_URL` (Supabase, dans `.env`, jamais committé). ⚠ Sur un serveur IPv4 (Hetzner),
 * utiliser l'URL du POOLER (Supabase → Settings → Database → Connection pooling, **session mode**) — la
 * connexion directe `db.<ref>.supabase.co:5432` est IPv6-only et échoue depuis un hôte IPv4.
 * TLS : `DB_SSL=disable|require|prefer|verify-full` (défaut : require hors boucle locale, cf. pg-options.mjs).
 */
import postgres from "postgres"
import { pgSsl, onPgNotice, pgPoolMax } from "./pg-options.mjs"

let _sql: ReturnType<typeof postgres> | null = null

// Lecture LAZY de DATABASE_URL (au 1er usage) : les imports ES sont hoistés AVANT `process.loadEnvFile()`
// des appelants → la lire au chargement du module donnerait "" même quand .env la définit bien.
function client() {
  if (!_sql) {
    const DATABASE_URL = process.env.DATABASE_URL || ""
    if (!DATABASE_URL) throw new Error("DATABASE_URL manquant : pose-le dans .env (n'importe quel Postgres ; schéma : npm run db:init)")
    _sql = postgres(DATABASE_URL, {
      ssl: pgSsl(DATABASE_URL),
      onnotice: onPgNotice, // tait les NOTICE « already exists, skipping » des migrations idempotentes
      prepare: false, // compatible pooler transaction-mode
      max: pgPoolMax(4), // petit pool : un seul process backoffice (DB_POOL_MAX pour forcer, 1 en sandbox PGlite)
      idle_timeout: 20,
      types: {
        // int8 (bigint, OID 20) → JS Number : nos timestamps (epoch ms) sont < 2^53 → comparables sans surprise
        int8: { to: 20, from: [20], serialize: (x: number) => "" + x, parse: (x: string) => parseInt(x, 10) },
      },
    })
  }
  return _sql
}

// placeholders style SQLite "?" → Postgres "$1,$2,…" → le SQL des appelants reste inchangé
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

/** La DB partagée (Postgres). Lève si DATABASE_URL manque — pour les appelants qui en dépendent (serve.ts). */
export function getDb(): Db { return db }

/** La DB ou null si DATABASE_URL absent — chemin PIPELINE (la télémétrie ne doit jamais casser un build). */
export function tryDb(): Db | null { return process.env.DATABASE_URL ? db : null }

/** Ferme proprement le pool de connexions. Idempotent. */
export function closeDb(): void { try { _sql?.end({ timeout: 5 }) } catch { /* déjà fermé */ } _sql = null }

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
