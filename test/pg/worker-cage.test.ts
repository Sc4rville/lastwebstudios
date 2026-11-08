/**
 * G12 (the box's worker, simulated, real Postgres queue, FAKE `claude`): THE CAGE on the building side.
 *   · STOP present ⇒ the worker exits within ≤ 1 tick ("⏹ STOP", code 3) without claiming a job;
 *   · STOP set DURING a job (cockpit button) ⇒ the agent is interrupted, the job goes back to the queue, the worker exits;
 *   · daily budget reached ⇒ no job claimed;
 *   · under the budget ⇒ the agent gets `--max-budget-usd` = min(job cap, what is left today) and its spend is
 *     written to the data/logs/spend.jsonl ledger.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { freshDatabase } from "../helpers/pg.ts"
import { npmRun } from "../helpers/proc.ts"
import { makeWorkspace, type Workspace } from "../helpers/workspace.ts"

const ID = "orvane-piscines-valmont-sur-lys"
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const today = () => new Date().toISOString()

async function setup() {
  const db = await freshDatabase()
  const ws = makeWorkspace({ seed: ["agency"] })
  assert.equal((await npmRun(ws.dir, "db:init", [], { env: { DATABASE_URL: db.url, DB_SSL: "disable" } })).code, 0)
  await db.sql`INSERT INTO batch_requests (status, mode, params_json, requested_by, created_at) VALUES ('queued', 'research', ${JSON.stringify({ ids: [ID] })}, 'test', ${Date.now()})`
  return { db, ws }
}

function startWorker(ws: Workspace, dbUrl: string, env: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, ["--import", "tsx", "worker/worker.ts"], {
    cwd: ws.dir, detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, DATABASE_URL: dbUrl, DB_SSL: "disable", WORKER_POLL_MS: "300", WORKER_STOP_POLL_MS: "300", WORKER_NO_COACH: "1", WORKER_NAME: "test-box", FAKE_CLAUDE_LOG: ws.path("claude.log"), ...env },
  })
  let out = ""
  child.stdout!.on("data", (b) => (out += b)); child.stderr!.on("data", (b) => (out += b))
  const exited = new Promise<number>((r) => child.on("exit", (c) => r(c ?? -1)))
  const kill = () => { if (child.pid && child.exitCode === null) { try { process.kill(-child.pid, "SIGKILL") } catch { /* */ } } }
  return { child, out: () => out, exited, kill }
}

test("STOP present at startup: the worker exits on the 1st tick (\"⏹ STOP\", code 3), the job stays queued", { timeout: 60_000 }, async () => {
  const { db, ws } = await setup()
  const w = (ws.write("STOP", "maintenance de la box\n"), startWorker(ws, db.url))
  try {
    const code = await Promise.race([w.exited, sleep(30_000).then(() => -99)])
    assert.equal(code, 3, w.out())
    assert.match(w.out(), /⏹ STOP \(fichier: maintenance de la box\) — the worker stops, no job is taken/)
    assert.equal((await db.sql`SELECT status FROM batch_requests`)[0].status, "queued")
    assert.equal(ws.exists("claude.log"), false, "no agent started")
  } finally { w.kill(); ws.cleanup(); await db.drop() }
})

test("daily budget reached: no job claimed (the worker waits for midnight UTC), said only once", { timeout: 60_000 }, async () => {
  const { db, ws } = await setup()
  ws.write("data/logs/spend.jsonl", JSON.stringify({ at: today(), day: today().slice(0, 10), kind: "agent", source: "worker:composer", usd: 21.4 }) + "\n")
  const w = startWorker(ws, db.url, { LWS_BUDGET_USD_DAY: "20" })
  try {
    for (let i = 0; i < 100 && !/today's budget reached/.test(w.out()); i++) await sleep(100)
    await sleep(1500) // ~5 ticks
    assert.match(w.out(), /💸 today's budget reached: \$21\.4 of \$20 → no job claimed until 00:00 UTC/)
    assert.equal(w.out().match(/today's budget reached/g)!.length, 1)
    assert.equal((await db.sql`SELECT status, attempts FROM batch_requests`)[0].status, "queued")
    assert.equal(ws.exists("claude.log"), false)
  } finally { w.kill(); ws.cleanup(); await db.drop() }
})

test("under the budget: --max-budget-usd = min(LWS_JOB_MAX_USD, what is left today), the agent's spend written to the ledger", { timeout: 60_000 }, async () => {
  const { db, ws } = await setup()
  ws.write("data/logs/spend.jsonl", JSON.stringify({ at: today(), day: today().slice(0, 10), kind: "image", source: "openai-image", usd: 18.5 }) + "\n")
  const w = startWorker(ws, db.url, { LWS_BUDGET_USD_DAY: "20", LWS_JOB_MAX_USD: "3", FAKE_CLAUDE_COST: "1.25" })
  try {
    for (let i = 0; i < 200; i++) { if ((await db.sql`SELECT status FROM batch_requests`)[0].status === "done") break; await sleep(150) }
    assert.equal((await db.sql`SELECT status FROM batch_requests`)[0].status, "done", w.out())
    const argv = JSON.parse(ws.read("claude.log").trim().split("\n")[0]).argv as string[]
    assert.equal(argv[argv.indexOf("--max-budget-usd") + 1], "1.5", "$1.50 left today < $3 job cap")
    const spend = ws.read("data/logs/spend.jsonl").trim().split("\n").map((l) => JSON.parse(l))
    assert.deepEqual(spend.slice(1).map((s) => [s.kind, s.source, s.usd, s.billing, s.estimated]), [["agent", "worker:research", 1.25, "plan", true]])
    // 18.5 + 1.25 = $19.75: the next job would get $0.25; at $20 nothing more would be claimed
  } finally { w.kill(); ws.cleanup(); await db.drop() }
})

test("STOP set DURING a job (cockpit button = flag in the database): agent interrupted, job back in the queue, worker exited", { timeout: 60_000 }, async () => {
  const { db, ws } = await setup()
  const w = startWorker(ws, db.url, { FAKE_CLAUDE_SLEEP_MS: "30000" })
  try {
    for (let i = 0; i < 200; i++) { if ((await db.sql`SELECT status FROM batch_requests`)[0].status === "running") break; await sleep(100) }
    for (let i = 0; i < 100 && !ws.exists("claude.log"); i++) await sleep(100) // l'agent tourne
    const t0 = Date.now()
    await db.sql`INSERT INTO meta (key, value, updated_at) VALUES ('cage.stop', ${JSON.stringify({ on: true, reason: "bouton STOP", by: "lws", at: today() })}, ${Date.now()})`
    const code = await Promise.race([w.exited, sleep(25_000).then(() => -99)])
    assert.equal(code, 3, w.out())
    assert.ok(Date.now() - t0 < 15_000, "the 30 s agent was interrupted")
    const job = (await db.sql`SELECT status, log FROM batch_requests`)[0]
    assert.equal(job.status, "queued", "the job resumes when the worker is restarted")
    assert.match(job.log, /⏹ STOP \(cockpit: bouton STOP\): agent interrupted, job put back in the queue/)
    assert.match(w.out(), /⏹ batch #1 interrupted by STOP → put back in the queue/)
    assert.match(w.out(), /⏹ STOP \(cockpit: bouton STOP\) — the worker stops/)
  } finally { w.kill(); ws.cleanup(); await db.drop() }
})

test("the agent's output cut into 7-byte chunks (real pipe, long output): the spend is STILL written to the ledger", { timeout: 60_000 }, async () => {
  // blitz test of 24/10: the worker split each pipe chunk on "\n"; a `result` event straddling two
  // chunks became unreadable and its spend was lost (empty ledger: the budget cage under-counted)
  const { db, ws } = await setup()
  const w = startWorker(ws, db.url, { LWS_BUDGET_USD_DAY: "20", FAKE_CLAUDE_COST: "2.5", FAKE_CLAUDE_CHUNKED: "7" })
  try {
    for (let i = 0; i < 300; i++) { if ((await db.sql`SELECT status FROM batch_requests`)[0].status === "done") break; await sleep(150) }
    const job = (await db.sql`SELECT status, log FROM batch_requests`)[0]
    assert.equal(job.status, "done", w.out())
    const spend = ws.read("data/logs/spend.jsonl").trim().split("\n").map((l) => JSON.parse(l))
    assert.deepEqual(spend.map((s) => [s.kind, s.source, s.usd]), [["agent", "worker:research", 2.5]])
    assert.ok(!String(job.log).includes("�"), "batch log without half characters")
  } finally { w.kill(); ws.cleanup(); await db.drop() }
})
