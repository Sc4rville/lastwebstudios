/**
 * G5 (statique, sans base) : db/schema.sql crée toutes les tables que le code interroge, et `pg-options`
 * choisit le bon TLS. La preuve forte (chaque requête PRÉPARÉE sur une vraie base) est dans test/pg/.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { extractSql } from "../helpers/sql-extract.ts"
import { TABLES } from "../../db/init.ts"
import { pgSsl, onPgNotice } from "../../packages/shared/pg-options.mjs"

const schema = readFileSync("db/schema.sql", "utf8")
const created = new Set([...schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]))

test("db/schema.sql crée exactement les tables du contrat (11 aujourd'hui)", () => {
  assert.deepEqual([...created].sort(), [...TABLES].sort())
})

test("chaque table citée par une requête du code existe dans le schéma", () => {
  const stmts = extractSql(".")
  assert.ok(stmts.length >= 80, `seulement ${stmts.length} requêtes extraites`)
  const used = new Set<string>()
  for (const s of stmts) for (const m of s.sql.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN|TABLE(?: IF NOT EXISTS)?)\s+([a-z_]+)/gi)) used.add(m[1].toLowerCase())
  for (const k of ["if", "set", "select", "skip", "information_schema"]) used.delete(k) // « FOR UPDATE SKIP LOCKED » n'est pas une table
  const missing = [...used].filter((t) => !created.has(t))
  assert.deepEqual(missing, [])
})

test("le schéma est idempotent et non destructif (aucun DROP / TRUNCATE / DELETE)", () => {
  assert.doesNotMatch(schema, /\b(DROP|TRUNCATE|DELETE)\b/i)
  for (const m of schema.matchAll(/^(CREATE TABLE|ALTER TABLE|CREATE INDEX)[^\n]*/gm)) assert.match(m[0], /IF NOT EXISTS/, m[0])
})

test("pgSsl : DB_SSL prime, puis sslmode de l'URL, puis require hors boucle locale", () => {
  assert.equal(pgSsl("postgres://u:p@db.example.com:5432/x", {}), "require")
  assert.equal(pgSsl("postgres://u:p@127.0.0.1:5432/x", {}), false)
  assert.equal(pgSsl("postgres://u:p@localhost/x", {}), false)
  assert.equal(pgSsl("postgres://u:p@db.example.com/x", { DB_SSL: "disable" }), false)
  assert.equal(pgSsl("postgres://u:p@127.0.0.1/x", { DB_SSL: "require" }), "require")
  assert.equal(pgSsl("postgres://u:p@db.example.com/x?sslmode=disable", {}), false)
  assert.equal(pgSsl("postgres://u:p@db.example.com/x?sslmode=verify-full", {}), "verify-full")
  assert.equal(pgSsl("postgres://u:p@db.example.com/x", { DB_SSL: "n'importe quoi" }), "require")
})

test("onPgNotice tait « already exists, skipping » et garde les vraies notices", () => {
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

test("db:init sait mettre à niveau : chaque colonne déclarée a une définition AJOUTABLE (ni clé, ni identité, NOT NULL seulement avec DEFAULT)", async () => {
  const { declaredColumns, splitStatements } = await import("../../db/init.ts")
  const ddl = readFileSync("db/schema.sql", "utf8")
  const cols = declaredColumns(ddl)
  const tables = new Set(cols.map((c) => c.table))
  assert.equal(tables.size, splitStatements(ddl).filter((s) => /^CREATE TABLE/i.test(s)).length, "toutes les tables lues")
  assert.ok(cols.length >= 100, `${cols.length} colonnes`)
  for (const c of cols.filter((x) => !x.key)) {
    assert.doesNotMatch(c.def, /PRIMARY KEY|GENERATED|REFERENCES/i, `${c.table}.${c.name}`)
    if (/NOT NULL/i.test(c.def)) assert.match(c.def, /DEFAULT/i, `${c.table}.${c.name} : NOT NULL sans DEFAULT échouerait sur une table remplie`)
  }
  assert.deepEqual(cols.filter((c) => c.key).map((c) => `${c.table}.${c.name}`).sort().slice(0, 3), ["asset_events.id", "assets.prospect_id", "assets.rel_path"])
})
