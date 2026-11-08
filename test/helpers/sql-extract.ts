/**
 * sql-extract.ts · extracts EVERY SQL query written in the code (prepare("…"), prepare(`…`),
 * sql`…`, and literal "ALTER/CREATE …" DDL). Used to PROVE that db/schema.sql covers the code:
 * the pg test PREPARES each of them on a database set up by `npm run db:init` (PREPARE validates tables and
 * columns without running anything).
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export type SqlStmt = { file: string; line: number; sql: string; kind: "prepare" | "tagged" | "ddl" }

/** Code files that talk to the database (the others have no SQL). */
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
    if (!existsSync(join(root, file))) continue // team tool missing from the open-source edition (recapture-avant, _watch)
    const src = readFileSync(join(root, file), "utf8")
    // prepare("…") / prepare('…') / prepare(`…`)
    const re = /\.prepare\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      const body = m[2]
      if (/\$\{/.test(body)) continue // dynamically built SQL: no such case in the code today
      out.push({ file, line: lineOf(src, m.index), sql: body.replace(/\\n/g, "\n"), kind: "prepare" })
    }
    // sql`… ${x} …` (postgres.js tagged template) → placeholders $1..$n
    const tag = /\b(?:sql|s)`([\s\S]*?)`/g
    while ((m = tag.exec(src))) {
      let i = 0
      const body = m[1].replace(/\$\{[^}]*\}/g, () => `$${++i}`)
      if (/^\s*(select|insert|update|delete|with)\b/i.test(body)) out.push({ file, line: lineOf(src, m.index), sql: body, kind: "tagged" })
    }
    // literal DDL passed as a variable (e.g. qualify.ts: a list of ALTER TABLE)
    const ddl = /(["'`])\s*((?:ALTER|CREATE)\s+TABLE[\s\S]*?)\1/g
    while ((m = ddl.exec(src))) {
      const sql = m[2]
      if (out.some((s) => s.file === file && s.sql === sql)) continue
      out.push({ file, line: lineOf(src, m.index), sql, kind: "ddl" })
    }
  }
  return out
}

/** `?` (SQLite style, converted by db.ts) → `$1,$2…` as db.ts:toPg does. */
export function toPg(q: string): string { let i = 0; return q.replace(/\?/g, () => `$${++i}`) }
