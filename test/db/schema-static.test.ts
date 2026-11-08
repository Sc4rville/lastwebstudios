/**
 * G5 (static, no database): db/schema.sql creates every table the code queries, and `pg-options`
 * picks the right TLS. The strong proof (each query PREPARED on a real database) is in test/pg/.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { extractSql } from "../helpers/sql-extract.ts"
import { TABLES } from "../../db/init.ts"
import { pgSsl, onPgNotice } from "../../packages/shared/pg-options.mjs"

const schema = readFileSync("db/schema.sql", "utf8")
const created = new Set([...schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]))

test("db/schema.sql creates exactly the contract's tables", () => {
  assert.deepEqual([...created].sort(), [...TABLES].sort())
})

test("every table a query of the code names exists in the schema", () => {
  const stmts = extractSql(".")
  assert.ok(stmts.length >= 80, `only ${stmts.length} queries extracted`)
  const used = new Set<string>()
  for (const s of stmts) for (const m of s.sql.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN|TABLE(?: IF NOT EXISTS)?)\s+([a-z_]+)/gi)) used.add(m[1].toLowerCase())
  for (const k of ["if", "set", "select", "skip", "information_schema"]) used.delete(k) // "FOR UPDATE SKIP LOCKED" is not a table
  const missing = [...used].filter((t) => !created.has(t))
  assert.deepEqual(missing, [])
})

test("the schema is idempotent and non-destructive (no DROP / TRUNCATE / DELETE)", () => {
  assert.doesNotMatch(schema, /\b(DROP|TRUNCATE|DELETE)\b/i)
  for (const m of schema.matchAll(/^(CREATE TABLE|ALTER TABLE|CREATE INDEX)[^\n]*/gm)) assert.match(m[0], /IF NOT EXISTS/, m[0])
})

test("pgSsl: DB_SSL first, then the URL's sslmode, then require outside loopback", () => {
  assert.equal(pgSsl("postgres://u:p@db.example.com:5432/x", {}), "require")
  assert.equal(pgSsl("postgres://u:p@127.0.0.1:5432/x", {}), false)
  assert.equal(pgSsl("postgres://u:p@localhost/x", {}), false)
  assert.equal(pgSsl("postgres://u:p@db.example.com/x", { DB_SSL: "disable" }), false)
  assert.equal(pgSsl("postgres://u:p@127.0.0.1/x", { DB_SSL: "require" }), "require")
  assert.equal(pgSsl("postgres://u:p@db.example.com/x?sslmode=disable", {}), false)
  assert.equal(pgSsl("postgres://u:p@db.example.com/x?sslmode=verify-full", {}), "verify-full")
  assert.equal(pgSsl("postgres://u:p@db.example.com/x", { DB_SSL: "n'importe quoi" }), "require")
})

test("onPgNotice silences \"already exists, skipping\" and keeps the real notices", () => {
  const seen: string[] = []
  const orig = console.warn
  console.warn = (m: string) => { seen.push(m) }
  try {
    onPgNotice({ code: "42701", message: 'column "love" of relation "generations" already exists, skipping', severity: "NOTICE" })
    onPgNotice({ code: "42P07", message: 'relation "crm_leads" already exists, skipping', severity: "NOTICE" })
    onPgNotice({ code: "01000", message: "quelque chose d'utile", severity: "WARNING" })
  } finally { console.warn = orig }
  assert.deepEqual(seen, ["postgres WARNING: quelque chose d'utile"])
})

test("db:init can upgrade: each declared column has a definition that can be ADDED (no key, no identity, NOT NULL only with DEFAULT)", async () => {
  const { declaredColumns, splitStatements } = await import("../../db/init.ts")
  const ddl = readFileSync("db/schema.sql", "utf8")
  const cols = declaredColumns(ddl)
  const tables = new Set(cols.map((c) => c.table))
  assert.equal(tables.size, splitStatements(ddl).filter((s) => /^CREATE TABLE/i.test(s)).length, "every table read")
  assert.ok(cols.length >= 100, `${cols.length} columns`)
  for (const c of cols.filter((x) => !x.key)) {
    assert.doesNotMatch(c.def, /PRIMARY KEY|GENERATED|REFERENCES/i, `${c.table}.${c.name}`)
    if (/NOT NULL/i.test(c.def)) assert.match(c.def, /DEFAULT/i, `${c.table}.${c.name}: NOT NULL without DEFAULT would fail on a filled table`)
  }
  assert.deepEqual(cols.filter((c) => c.key).map((c) => `${c.table}.${c.name}`).sort().slice(0, 3), ["asset_events.id", "assets.prospect_id", "assets.rel_path"])
})
