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
  assert.ok(invented.length >= 3 && invented.length <= 8, `${invented.length} invented`)
  for (const s of invented) {
    assert.match(s.existing.url, /\.example\//, "reserved domain")
    assert.match(s.identity.phone, /^0\d 99 00 \d\d \d\d$/, "ARCEP fiction range")
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
