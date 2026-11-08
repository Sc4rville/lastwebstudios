/**
 * Blitz test (24/10) · TWO workers (two machines) on the same Postgres queue: each job is taken ONCE
 * (`FOR UPDATE SKIP LOCKED`), none is forgotten, each job carries the name of the worker that did it. A fake `claude` that
 * "works" 400 ms so the two workers really overlap.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { freshDatabase } from "../helpers/pg.ts"
import { npmRun } from "../helpers/proc.ts"
import { makeWorkspace, type Workspace } from "../helpers/workspace.ts"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function startWorker(ws: Workspace, dbUrl: string, name: string) {
  const child = spawn(process.execPath, ["--import", "tsx", "worker/worker.ts"], {
    cwd: ws.dir, detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, DATABASE_URL: dbUrl, DB_SSL: "disable", WORKER_POLL_MS: "200", WORKER_STOP_POLL_MS: "300", WORKER_NO_COACH: "1", WORKER_NAME: name, FAKE_CLAUDE_LOG: ws.path("claude.log"), FAKE_CLAUDE_SLEEP_MS: "400" },
  })
  let out = ""
  child.stdout!.on("data", (b) => (out += b)); child.stderr!.on("data", (b) => (out += b))
  return { out: () => out, kill: () => { if (child.pid && child.exitCode === null) { try { process.kill(-child.pid, "SIGKILL") } catch { /* */ } } } }
}

test("two workers, 8 jobs: each done exactly once, all done, shared between the two machines", { timeout: 120_000 }, async () => {
  const db = await freshDatabase()
  const a = makeWorkspace({ seed: ["agency"] }), b = makeWorkspace({ seed: ["agency"] })
  const wa = { kill: () => {}, out: () => "" }, wb = { kill: () => {}, out: () => "" }
  try {
    assert.equal((await npmRun(a.dir, "db:init", [], { env: { DATABASE_URL: db.url, DB_SSL: "disable" } })).code, 0)
    const ids = ["orvane-piscines-valmont-sur-lys", "atelier-brisane-menuiserie-sornac-le-haut", "cuisines-lumeo-vereuil"]
    for (let i = 0; i < 8; i++) await db.sql`INSERT INTO batch_requests (status, mode, params_json, requested_by, created_at) VALUES ('queued', 'research', ${JSON.stringify({ ids: [ids[i % 3]] })}, 'test', ${Date.now() + i})`
    Object.assign(wa, startWorker(a, db.url, "box-a")); Object.assign(wb, startWorker(b, db.url, "box-b"))
    for (let i = 0; i < 400; i++) {
      const left = await db.sql`SELECT count(*)::int AS n FROM batch_requests WHERE status <> 'done'`
      if (left[0].n === 0) break
      await sleep(150)
    }
    const rows = await db.sql`SELECT id, status, worker, attempts FROM batch_requests ORDER BY id`
    assert.ok(rows.every((r: any) => r.status === "done"), `${JSON.stringify(rows)}\n${wa.out().slice(-800)}\n${wb.out().slice(-800)}`)
    assert.ok(rows.every((r: any) => r.attempts === 1), "aucun job pris deux fois")
    const calls = [a, b].flatMap((ws) => (ws.exists("claude.log") ? ws.read("claude.log").trim().split("\n") : []))
    assert.equal(calls.length, 8, "8 agents started in all, not one more")
    const by = new Set(rows.map((r: any) => String(r.worker).replace(/#\d+$/, ""))) // "box-a#<pid>"
    assert.deepEqual([...by].sort(), ["box-a", "box-b"], "both machines worked")
  } finally { wa.kill(); wb.kill(); a.cleanup(); b.cleanup(); await db.drop() }
})
