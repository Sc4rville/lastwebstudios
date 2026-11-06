/**
 * Test blitz (24/10) · le plafond d'évènements par envoi tient sous une rafale de clics simultanés, AVEC base
 * (table outreach_events, le mode de la box). Avant : « COUNT puis INSERT » laissait passer la rafale.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { freshDatabase } from "../helpers/pg.ts"
import { npmRun } from "../helpers/proc.ts"
import { makeWorkspace, type Workspace } from "../helpers/workspace.ts"
import { startCockpit } from "../helpers/cockpit.ts"
import { clickToken } from "../../outreach/tracking/links.ts"
import type { Proc } from "../helpers/server.ts"

const SECRET = "secret-de-test-fictif-rafale-pg-0123456789abcdef"
let db: Awaited<ReturnType<typeof freshDatabase>>, ws: Workspace, cockpit: Proc
before(async () => {
  db = await freshDatabase()
  ws = makeWorkspace({ seed: ["agency"] })
  const env = { DATABASE_URL: db.url, DB_SSL: "disable" }
  assert.equal((await npmRun(ws.dir, "db:init", [], { env })).code, 0)
  cockpit = await startCockpit(ws.dir, { ...env, LWS_TRACK_SECRET: SECRET })
})
after(async () => { await cockpit?.stop(); ws?.cleanup(); await db?.drop() })

test("rafale de 80 clics simultanés (avec base) : tous redirigés, exactement 20 évènements en base", { timeout: 60_000 }, async () => {
  const tid = randomUUID()
  const token = clickToken(tid, "https://cal.agence.example/15min", SECRET)
  const codes = await Promise.all(Array.from({ length: 80 }, () => fetch(`${cockpit.url}/t/c/${token}`, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (rafale de test)" } }).then((r) => r.status)))
  assert.ok(codes.every((c) => c === 302))
  const n = (await db.sql`SELECT count(*)::int AS n FROM outreach_events WHERE tracking_id = ${tid}`)[0].n
  assert.equal(n, 20, `${n} évènements pour un plafond de 20`)
})
