/**
 * G9 (continued): with everything present (Postgres database + schema, Claude Code signed in, Workflow), `npm run doctor`
 * exits 0; a database without the schema is reported with "npm run db:init".
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

test("database without the schema: blocking, \"npm run db:init\"; after db:init: everything is ready, exit 0", async () => {
  const env = { DATABASE_URL: db.url, DB_SSL: "disable" }
  const a = await npmRun(ws.dir, "doctor", ["--json", "--for", "agency"], { env, timeoutMs: 90_000 })
  const ra = JSON.parse(a.stdout)
  const dbA = ra.checks.find((c: any) => c.id === "db")
  assert.equal(a.code, 1)
  assert.equal(dbA.status, "fail")
  assert.match(dbA.detail, /schema incomplete/)
  assert.equal(dbA.fix, "npm run db:init (idempotent, non-destructive)")

  const init = await npmRun(ws.dir, "db:init", [], { env })
  assert.equal(init.code, 0, init.out)
  const b = await npmRun(ws.dir, "doctor", ["--for", "agency"], { env, timeoutMs: 90_000 })
  assert.equal(b.code, 0, b.out)
  assert.match(b.stdout, /✓ Shared database: reachable, schema complete \(12 tables\)/)
  assert.match(b.stdout, /✓ ready/)
})
