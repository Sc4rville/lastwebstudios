/**
 * G12 (worker de la box, simulé, vraie file Postgres, FAUX `claude`) : LA CAGE côté génération.
 *   · STOP présent ⇒ le worker sort en ≤ 1 tick (« ⏹ STOP », code 3) sans réclamer de job ;
 *   · STOP posé PENDANT un job (bouton du cockpit) ⇒ l'agent est interrompu, le job repart en file, le worker sort ;
 *   · budget du jour atteint ⇒ aucun job réclamé ;
 *   · sous le budget ⇒ l'agent reçoit `--max-budget-usd` = min(plafond du job, reste du jour) et sa dépense est
 *     inscrite au registre data/logs/spend.jsonl.
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

test("STOP présent au démarrage : le worker sort au 1er tick (« ⏹ STOP », code 3), le job reste en file", { timeout: 60_000 }, async () => {
  const { db, ws } = await setup()
  const w = (ws.write("STOP", "maintenance de la box\n"), startWorker(ws, db.url))
  try {
    const code = await Promise.race([w.exited, sleep(30_000).then(() => -99)])
    assert.equal(code, 3, w.out())
    assert.match(w.out(), /⏹ STOP \(fichier : maintenance de la box\) — le worker s'arrête, aucun job n'est pris/)
    assert.equal((await db.sql`SELECT status FROM batch_requests`)[0].status, "queued")
    assert.equal(ws.exists("claude.log"), false, "aucun agent lancé")
  } finally { w.kill(); ws.cleanup(); await db.drop() }
})

test("budget du jour atteint : aucun job réclamé (le worker attend minuit UTC), dit une seule fois", { timeout: 60_000 }, async () => {
  const { db, ws } = await setup()
  ws.write("data/logs/spend.jsonl", JSON.stringify({ at: today(), day: today().slice(0, 10), kind: "agent", source: "worker:composer", usd: 21.4 }) + "\n")
  const w = startWorker(ws, db.url, { LWS_BUDGET_USD_DAY: "20" })
  try {
    for (let i = 0; i < 100 && !/budget du jour atteint/.test(w.out()); i++) await sleep(100)
    await sleep(1500) // ~5 ticks
    assert.match(w.out(), /💸 budget du jour atteint : 21\.4 \$ \/ 20 \$ → aucun job réclamé jusqu'à 00:00 UTC/)
    assert.equal(w.out().match(/budget du jour atteint/g)!.length, 1)
    assert.equal((await db.sql`SELECT status, attempts FROM batch_requests`)[0].status, "queued")
    assert.equal(ws.exists("claude.log"), false)
  } finally { w.kill(); ws.cleanup(); await db.drop() }
})

test("sous le budget : --max-budget-usd = min(LWS_JOB_MAX_USD, reste du jour), dépense de l'agent inscrite au registre", { timeout: 60_000 }, async () => {
  const { db, ws } = await setup()
  ws.write("data/logs/spend.jsonl", JSON.stringify({ at: today(), day: today().slice(0, 10), kind: "image", source: "openai-image", usd: 18.5 }) + "\n")
  const w = startWorker(ws, db.url, { LWS_BUDGET_USD_DAY: "20", LWS_JOB_MAX_USD: "3", FAKE_CLAUDE_COST: "1.25" })
  try {
    for (let i = 0; i < 200; i++) { if ((await db.sql`SELECT status FROM batch_requests`)[0].status === "done") break; await sleep(150) }
    assert.equal((await db.sql`SELECT status FROM batch_requests`)[0].status, "done", w.out())
    const argv = JSON.parse(ws.read("claude.log").trim().split("\n")[0]).argv as string[]
    assert.equal(argv[argv.indexOf("--max-budget-usd") + 1], "1.5", "reste du jour 1,50 $ < plafond du job 3 $")
    const spend = ws.read("data/logs/spend.jsonl").trim().split("\n").map((l) => JSON.parse(l))
    assert.deepEqual(spend.slice(1).map((s) => [s.kind, s.source, s.usd, s.billing, s.estimated]), [["agent", "worker:research", 1.25, "plan", true]])
    // 18,5 + 1,25 = 19,75 $ : le job suivant aurait 0,25 $ ; à 20 $ plus rien ne serait réclamé
  } finally { w.kill(); ws.cleanup(); await db.drop() }
})

test("STOP posé PENDANT un job (bouton du cockpit = drapeau en base) : agent interrompu, job remis en file, worker sorti", { timeout: 60_000 }, async () => {
  const { db, ws } = await setup()
  const w = startWorker(ws, db.url, { FAKE_CLAUDE_SLEEP_MS: "30000" })
  try {
    for (let i = 0; i < 200; i++) { if ((await db.sql`SELECT status FROM batch_requests`)[0].status === "running") break; await sleep(100) }
    for (let i = 0; i < 100 && !ws.exists("claude.log"); i++) await sleep(100) // l'agent tourne
    const t0 = Date.now()
    await db.sql`INSERT INTO meta (key, value, updated_at) VALUES ('cage.stop', ${JSON.stringify({ on: true, reason: "bouton STOP", by: "lws", at: today() })}, ${Date.now()})`
    const code = await Promise.race([w.exited, sleep(25_000).then(() => -99)])
    assert.equal(code, 3, w.out())
    assert.ok(Date.now() - t0 < 15_000, "l'agent de 30 s a été interrompu")
    const job = (await db.sql`SELECT status, log FROM batch_requests`)[0]
    assert.equal(job.status, "queued", "le job reprendra quand le worker sera relancé")
    assert.match(job.log, /⏹ STOP \(cockpit : bouton STOP\) : agent interrompu, job remis en file/)
    assert.match(w.out(), /⏹ batch #1 interrompu par STOP → remis en file/)
    assert.match(w.out(), /⏹ STOP \(cockpit : bouton STOP\) — le worker s'arrête/)
  } finally { w.kill(); ws.cleanup(); await db.drop() }
})

test("sortie de l'agent coupée en morceaux de 7 octets (tube réel, sortie longue) : la dépense est QUAND MÊME inscrite au registre", { timeout: 60_000 }, async () => {
  // test blitz du 24/10 : le worker découpait chaque morceau du tube sur « \n » ; l'évènement `result` à cheval sur deux
  // morceaux devenait illisible et sa dépense était perdue (registre vide : la cage du budget sous-comptait)
  const { db, ws } = await setup()
  const w = startWorker(ws, db.url, { LWS_BUDGET_USD_DAY: "20", FAKE_CLAUDE_COST: "2.5", FAKE_CLAUDE_CHUNKED: "7" })
  try {
    for (let i = 0; i < 300; i++) { if ((await db.sql`SELECT status FROM batch_requests`)[0].status === "done") break; await sleep(150) }
    const job = (await db.sql`SELECT status, log FROM batch_requests`)[0]
    assert.equal(job.status, "done", w.out())
    const spend = ws.read("data/logs/spend.jsonl").trim().split("\n").map((l) => JSON.parse(l))
    assert.deepEqual(spend.map((s) => [s.kind, s.source, s.usd]), [["agent", "worker:research", 2.5]])
    assert.ok(!String(job.log).includes("�"), "journal du batch sans demi-caractère")
  } finally { w.kill(); ws.cleanup(); await db.drop() }
})
