/**
 * sql-extract.ts · extrait TOUTES les requêtes SQL écrites dans le code (prepare("…"), prepare(`…`),
 * sql`…`, et les DDL littérales « ALTER/CREATE … »). Sert à PROUVER que db/schema.sql couvre le code :
 * le test pg PRÉPARE chacune d'elles sur une base montée par `npm run db:init` (PREPARE valide tables et
 * colonnes sans rien exécuter).
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export type SqlStmt = { file: string; line: number; sql: string; kind: "prepare" | "tagged" | "ddl" }

/** Fichiers du code qui parlent à la base (les autres n'ont pas de SQL). */
export const SQL_FILES = [
  "backoffice/reviewpipe/serve.ts", "backoffice/reviewpipe/invoices.ts", "backoffice/telegram/bot.ts",
  "leadengine/1_scraping/scripts/qualify.ts", "learning/scripts/weights.ts", "outreach/scripts/draft.ts",
  "outreach/scripts/mark.ts", "outreach/scripts/research-save.ts", "outreach/scripts/sequencer.ts",
  "packages/shared/batch.ts", "packages/shared/db.ts", "packages/shared/recapture-avant.ts",
  "packages/shared/reindex.ts", "worker/coach.mjs", "scripts/_watch.mjs",
  "outreach/tracking/events.ts", "backoffice/reviewpipe/machine.ts", "packages/shared/lock.ts", "outreach/scripts/lib/optout.ts",
]

const lineOf = (src: string, idx: number) => src.slice(0, idx).split("\n").length

export function extractSql(root: string, files = SQL_FILES): SqlStmt[] {
  const out: SqlStmt[] = []
  for (const file of files) {
    if (!existsSync(join(root, file))) continue // outil d'équipe absent de l'édition open source (recapture-avant, _watch)
    const src = readFileSync(join(root, file), "utf8")
    // prepare("…") / prepare('…') / prepare(`…`)
    const re = /\.prepare\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      const body = m[2]
      if (/\$\{/.test(body)) continue // SQL construit dynamiquement : pas de cas dans le code aujourd'hui
      out.push({ file, line: lineOf(src, m.index), sql: body.replace(/\\n/g, "\n"), kind: "prepare" })
    }
    // sql`… ${x} …` (postgres.js tagged template) → placeholders $1..$n
    const tag = /\b(?:sql|s)`([\s\S]*?)`/g
    while ((m = tag.exec(src))) {
      let i = 0
      const body = m[1].replace(/\$\{[^}]*\}/g, () => `$${++i}`)
      if (/^\s*(select|insert|update|delete|with)\b/i.test(body)) out.push({ file, line: lineOf(src, m.index), sql: body, kind: "tagged" })
    }
    // DDL littérales passées en variable (ex. qualify.ts : liste d'ALTER TABLE)
    const ddl = /(["'`])\s*((?:ALTER|CREATE)\s+TABLE[\s\S]*?)\1/g
    while ((m = ddl.exec(src))) {
      const sql = m[2]
      if (out.some((s) => s.file === file && s.sql === sql)) continue
      out.push({ file, line: lineOf(src, m.index), sql, kind: "ddl" })
    }
  }
  return out
}

/** `?` (style SQLite, converti par db.ts) → `$1,$2…` comme le fait db.ts:toPg. */
export function toPg(q: string): string { let i = 0; return q.replace(/\?/g, () => `$${++i}`) }
