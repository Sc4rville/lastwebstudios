/**
 * G9 (suite) : avec tout présent (base Postgres + schéma, Claude Code connecté, Workflow), `npm run doctor`
 * sort en 0 ; une base sans schéma est signalée avec « npm run db:init ».
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { freshDatabase } from "../helpers/pg.ts"
import { npmRun } from "../helpers/proc.ts"
import { makeWorkspace, type Workspace } from "../helpers/workspace.ts"

let db: Awaited<ReturnType<typeof freshDatabase>>
let ws: Workspace
before(async () => { db = await freshDatabase(); ws = makeWorkspace() })
after(async () => { ws?.cleanup(); await db?.drop() })

test("base sans schéma : bloquant, « npm run db:init » ; après db:init : tout est prêt, exit 0", async () => {
  const env = { DATABASE_URL: db.url, DB_SSL: "disable" }
  const a = await npmRun(ws.dir, "doctor", ["--json"], { env, timeoutMs: 90_000 })
  const ra = JSON.parse(a.stdout)
  const dbA = ra.checks.find((c: any) => c.id === "db")
  assert.equal(a.code, 1)
  assert.equal(dbA.status, "fail")
  assert.match(dbA.detail, /schéma incomplet/)
  assert.equal(dbA.fix, "npm run db:init (idempotent, non destructif)")

  const init = await npmRun(ws.dir, "db:init", [], { env })
  assert.equal(init.code, 0, init.out)
  const b = await npmRun(ws.dir, "doctor", [], { env, timeoutMs: 90_000 })
  assert.equal(b.code, 0, b.out)
  assert.match(b.stdout, /✓ Base Postgres : joignable, schéma complet \(12 tables\)/)
  assert.match(b.stdout, /✓ prêt/)
})
