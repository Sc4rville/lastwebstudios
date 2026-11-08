/**
 * Blitz test (10/24) · the per-send event cap (CAPS.perTracking = 20) HOLDS under a burst of simultaneous
 * clicks on the same signed link (gateway scanner, robot, replay). Before: "count then write" let
 * the whole burst through (each request saw < 20). No database here (events.jsonl file); with a database:
 * test/pg/tracking-flood.test.ts.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { makeWorkspace, type Workspace } from "../helpers/workspace.ts"
import { startCockpit } from "../helpers/cockpit.ts"
import { clickToken } from "../../outreach/tracking/links.ts"
import type { Proc } from "../helpers/server.ts"

const SECRET = "secret-de-test-fictif-rafale-0123456789abcdef"
let ws: Workspace, cockpit: Proc
before(async () => { ws = makeWorkspace({ seed: ["agency"] }); cockpit = await startCockpit(ws.dir, { LWS_TRACK_SECRET: SECRET }) })
after(async () => { await cockpit?.stop(); ws?.cleanup() })

test("a burst of 80 simultaneous clicks on one link: 302 for all, at most 20 events written", { timeout: 60_000 }, async () => {
  const tid = randomUUID()
  const token = clickToken(tid, "https://cal.agence.example/15min", SECRET)
  const codes = await Promise.all(Array.from({ length: 80 }, () => fetch(`${cockpit.url}/t/c/${token}`, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (test burst)" } }).then((r) => r.status)))
  assert.ok(codes.every((c) => c === 302), codes.join(","))
  const lines = ws.read("data/sequencer/events.jsonl").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.trackingId === tid)
  assert.ok(lines.length <= 20, `${lines.length} events written for a cap of 20`)
  assert.equal(lines.length, 20)
})
