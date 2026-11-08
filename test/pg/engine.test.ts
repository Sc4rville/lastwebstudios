/**
 * The cockpit's BUILT-IN ENGINE (backoffice/reviewpipe/engine.ts): with a database and no external worker it claims
 * one queued job at a time and runs it. Simulated mode (LWS_SANDBOX=1): a `find` job invents fictional prospects
 * (sheets + score files, reserved domains, fiction phones) and a `composer` job delivers a site. Real mode: the
 * job is handed to `worker/worker.ts --job <id>` (the fake `claude` of the tests answers). A fresh external
 * heartbeat keeps the engine out of the way.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { makeWorkspace, type Workspace } from "../helpers/workspace.ts"
import { npmRun, tsx } from "../helpers/proc.ts"
import { freshDatabase } from "../helpers/pg.ts"

let ws: Workspace, db: Awaited<ReturnType<typeof freshDatabase>>
before(async () => {
  ws = makeWorkspace({ seed: ["agency"] })
  db = await freshDatabase()
  const r = await npmRun(ws.dir, "db:init", [], { env: { DATABASE_URL: db.url, DB_SSL: "disable" } })
  assert.equal(r.code, 0, r.out)
})
after(async () => { ws?.cleanup(); await db?.drop() })

const env = (extra: Record<string, string> = {}) => ({ DATABASE_URL: db.url, DB_SSL: "disable", DB_POOL_MAX: "1", ...extra })
/** one engine tick, in a child (the module keeps its own timers and db pool) */
const script = (body: string) => `import { tick } from "./backoffice/reviewpipe/engine.ts"\nimport { enqueueBatch, enqueueResearch, listBatches } from "./packages/shared/batch.ts"\nimport { setMeta } from "./packages/shared/db.ts"\nimport { closeDb } from "./packages/shared/db.ts"\nconst events = []\n${body}\nconsole.log("RESULT " + JSON.stringify({ events, batches: (await listBatches(50)).map((b) => ({ id: b.id, mode: b.mode, status: b.status })) }))\ncloseDb()\n`
async function runScript(body: string, extra: Record<string, string> = {}) {
  ws.write("_t.mts", script(body))
  const r = await tsx(ws.dir, "_t.mts", [], { env: env(extra), timeoutMs: 120_000 })
  const line = r.stdout.split("\n").find((l) => l.startsWith("RESULT "))
  assert.ok(line, r.out)
  return JSON.parse(line!.slice(7)) as { events: any[]; batches: { id: number; mode: string; status: string }[] }
}

test("simulated: a `find` job invents fictional prospects, one by one, with progress events", async () => {
  const r = await runScript(`await enqueueBatch({ mode: "find", lim: 12, params: { trades: ["cuisiniste", "menuisier"], place: "Lyon", country: "FR", count: 12, mix: false } })\nawait tick((e) => events.push(e))`, { LWS_SANDBOX: "1" })
  const find = r.batches.find((b) => b.mode === "find")!
  assert.equal(find.status, "done")
  const jobEvents = r.events.filter((e) => e.type === "job" && e.mode === "find")
  assert.ok(jobEvents.filter((e) => e.status === "running" && e.found).length >= 3, "one event per prospect found")
  assert.equal(jobEvents.at(-1).status, "done")
  const sheets = readdirSync(ws.path("data/prospects")).filter((f) => f.endsWith(".json") && !f.endsWith(".example.json"))
  const invented = sheets.map((f) => JSON.parse(readFileSync(ws.path("data/prospects", f), "utf8"))).filter((s) => s._sample && /sandbox engine/.test(s._sample))
  assert.ok(invented.length >= 3 && invented.length <= 12, `${invented.length} invented`)
  for (const s of invented) {
    assert.match(s.existing.url, /\.example\//, "reserved domain")
    assert.match(s.identity.phone, /^04 65 71 \d\d \d\d$/, "Lyon: the ARCEP fiction block of its zone (04 65 71)")
    assert.equal(s.identity.city, "Lyon")
    assert.ok(existsSync(ws.path("data/assets", s.id, "avant.png")) || existsSync(ws.path("data/assets", s.id, "avant.svg")), "its own « before »")
    assert.ok(["cuisiniste", "menuisier"].includes(s.industry))
    assert.ok(existsSync(ws.path("data/raw", `${s.id}.score.json`)))
  }
})

test("simulated: a `composer` job plays diagnose → compose → check → judge and delivers a site", { timeout: 60_000 }, async () => {
  const r = await runScript(`await enqueueBatch({ mode: "composer", ids: ["orvane-piscines-valmont-sur-lys"], lim: 1 })\nawait tick((e) => events.push(e))`, { LWS_SANDBOX: "1" })
  assert.equal(r.batches.find((b) => b.mode === "composer")!.status, "done")
  const steps = r.events.filter((e) => e.type === "job" && e.mode === "composer").map((e) => e.step).filter(Boolean)
  for (const s of ["diagnose", "compose", "check", "judge", "done"]) assert.ok(steps.includes(s), s)
  const dirs = readdirSync(ws.path("output/sites/orvane-piscines-valmont-sur-lys")).filter((d) => d.endsWith("-composer") && existsSync(ws.path("output/sites/orvane-piscines-valmont-sur-lys", d, "index.html")))
  assert.ok(dirs.length >= 1, "a site folder with index.html")
})

test("real mode: the job is handed to worker/worker.ts --job (fake claude), the batch ends done or error, never stuck running", { timeout: 120_000 }, async () => {
  const r = await runScript(`await enqueueResearch("orvane-piscines-valmont-sur-lys")\nawait tick((e) => events.push(e))`)
  const b = r.batches.find((x) => x.mode === "research")!
  assert.ok(["done", "error"].includes(b.status), b.status)
  assert.ok(r.events.some((e) => e.type === "job" && e.status === b.status))
})

test("a fresh external heartbeat keeps the engine out of the way; a stale one does not", async () => {
  const r1 = await runScript(`await setMeta("worker.heartbeat", JSON.stringify({ id: "box#1", at: Date.now() }))\nawait enqueueBatch({ mode: "find", lim: 3, params: { trades: ["cuisiniste"], count: 3 } })\nawait tick((e) => events.push(e))`, { LWS_SANDBOX: "1" })
  assert.equal(r1.batches.find((b) => b.mode === "find" && b.status === "queued")?.status, "queued", "left to the external worker")
  const r2 = await runScript(`await setMeta("worker.heartbeat", JSON.stringify({ id: "box#1", at: Date.now() - 5 * 60_000 }))\nawait tick((e) => events.push(e))`, { LWS_SANDBOX: "1" })
  assert.ok(r2.batches.every((b) => b.status !== "queued"), "stale heartbeat → the engine takes the job")
})

test("two lanes: a search never waits behind a build (find and build run side by side)", { timeout: 120_000 }, async () => {
  const r = await runScript(`await enqueueBatch({ mode: "composer", ids: ["orvane-piscines-valmont-sur-lys"], lim: 1 })\nawait enqueueBatch({ mode: "find", lim: 2, params: { trades: ["menuisier"], place: "Lyon", country: "FR", count: 2, mix: false } })\nawait tick((e) => events.push(e))`, { LWS_SANDBOX: "1" })
  const jobs = r.events.filter((e) => e.type === "job")
  const firstFind = jobs.findIndex((e) => e.mode === "find")
  const buildDone = jobs.findIndex((e) => e.mode === "composer" && e.status === "done")
  assert.ok(firstFind >= 0 && buildDone >= 0, JSON.stringify(jobs.map((e) => `${e.mode}:${e.status}`)))
  assert.ok(firstFind < buildDone, "the search started while the build was running")
  assert.ok(r.batches.filter((b) => b.mode === "find" || b.mode === "composer").every((b) => b.status === "done"), JSON.stringify(r.batches))
})

test("audit round 2: the cockpit's own engine honours the daily limit (reached → nothing new is claimed, as the worker)", async () => {
  const day = new Date().toISOString()
  ws.write("data/logs/spend.jsonl", JSON.stringify({ at: day, day: day.slice(0, 10), kind: "agent", source: "test", usd: 25, billing: "plan", estimated: true }) + "\n")
  try {
    const r = await runScript(`await enqueueBatch({ mode: "find", lim: 2, params: { trades: ["menuisier"], place: "Lyon", country: "FR", count: 2, mix: false } })\nawait tick((e) => events.push(e))`, { LWS_SANDBOX: "1", LWS_BUDGET_USD_DAY: "20" })
    const mine = r.batches.filter((b) => b.mode === "find").sort((a, b) => b.id - a.id)[0]
    assert.equal(mine.status, "queued", "past the $20 daily limit the job waits")
    const r2 = await runScript(`await tick((e) => events.push(e))`, { LWS_SANDBOX: "1", LWS_BUDGET_USD_DAY: "50" })
    assert.notEqual(r2.batches.find((b) => b.id === mine.id)!.status, "queued", "under a higher limit it runs")
  } finally { ws.write("data/logs/spend.jsonl", "") }
})

test("round 3 (D2): today's cap in builds holds in the engine : a job past it keeps what fits, the rest waits for tomorrow in its own job", { timeout: 120_000 }, async () => {
  const day = new Date().toISOString()
  // one build already done today, a cap of 2 : one more fits, the other two wait (never claimed before midnight UTC)
  ws.write("data/logs/builds.jsonl", JSON.stringify({ at: day, day: day.slice(0, 10), id: "earlier-build", source: "test" }) + "\n")
  try {
    const r = await runScript(`await enqueueBatch({ mode: "composer", ids: ["orvane-piscines-valmont-sur-lys", "atelier-brisane-sornac-le-haut", "cuisines-lumeo-vereuil"], lim: 3 })\nawait tick((e) => events.push(e))`, { LWS_SANDBOX: "1", LWS_BUILDS_PER_DAY: "2" })
    const composers = r.batches.filter((b) => b.mode === "composer").sort((a, b) => a.id - b.id)
    const done = composers.filter((b) => b.status === "done"), waiting = composers.filter((b) => b.status === "queued")
    assert.ok(done.length >= 1 && waiting.length >= 1, JSON.stringify(composers))
    const builds = ws.read("data/logs/builds.jsonl").trim().split("\n").map((l) => JSON.parse(l)).filter((b) => b.day === day.slice(0, 10))
    assert.equal(builds.length, 2, "today's builds stop at the cap (the earlier one + one)")
    const row = (await db.sql`SELECT params_json, retry_after, log FROM batch_requests WHERE id = ${waiting[waiting.length - 1].id}`)[0]
    assert.equal(JSON.parse(row.params_json).ids.length, 2, "the two that did not fit")
    assert.ok(Number(row.retry_after) > Date.now(), "nobody claims it before the cap resets")
    assert.match(row.log, /waits for tomorrow: today's cap of 2 builds is reached/)
    // the cap reached : a second tick claims no build at all
    const r2 = await runScript(`await tick((e) => events.push(e))`, { LWS_SANDBOX: "1", LWS_BUILDS_PER_DAY: "2" })
    assert.ok(!r2.events.some((e) => e.type === "job" && e.mode === "composer" && e.status === "running"), JSON.stringify(r2.events.slice(0, 5)))
  } finally {
    ws.write("data/logs/builds.jsonl", "")
    await db.sql`UPDATE batch_requests SET status = 'canceled' WHERE status = 'queued'`
  }
})

