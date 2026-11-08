/**
 * G9: `npm run doctor` says exactly what is missing and how to fix it. In a workspace without .env: exit ≠ 0
 * and one "missing X ⇒ do: Y" line per blocking point; stable JSON output (--json); each case (Claude Code
 * missing or signed out, --bare, Workflow missing, a third-party LLM way, a dead API key) is recognised. The "everything
 * present, database included" case is in test/pg/doctor.test.ts.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { makeWorkspace, type Workspace } from "../helpers/workspace.ts"
import { npmRun } from "../helpers/proc.ts"
import { fakeMessages, fakeChat } from "../helpers/llm-servers.ts"
import { jsonRoutes } from "../helpers/server.ts"

let ws: Workspace
before(() => { ws = makeWorkspace() })
after(() => ws?.cleanup())

type Check = { id: string; status: "ok" | "warn" | "fail" | "info"; label: string; detail: string; fix?: string }
const doctor = async (args: string[], env: NodeJS.ProcessEnv = {}) => {
  const r = await npmRun(ws.dir, "doctor", ["--json", ...args], { env, timeoutMs: 90_000 })
  let report: { ok: boolean; failures: number; provider: string | null; checks: Check[] }
  try { report = JSON.parse(r.stdout) } catch { throw new Error(`non-JSON output:\n${r.out.slice(-1500)}`) }
  return { code: r.code, report, get: (id: string) => report.checks.find((c) => c.id === id) }
}

test("workspace without .env, agency profile: no DATABASE_URL is a warning (the cockpit keeps a local one), every warning carries its « do: … »", async () => {
  const d = await doctor(["--for", "agency"])
  assert.equal(d.code, 0, JSON.stringify(d.report.checks.filter((c) => c.status === "fail")))
  for (const id of ["node", "deps", "chromium", "llm", "model-smart", "model-fast", "model-judge", "claude-code", "bare", "workflow", "db", "image", "video", "send"]) assert.ok(d.get(id), `check ${id} present`)
  // the same story as the cockpit's start line and .env.example : a local database, a shared one only for several machines
  assert.equal(d.get("db")!.status, "warn")
  assert.match(d.get("db")!.detail, /own local database \(data\/pglite\).*only for a worker on another machine/)
  assert.match(d.get("db")!.fix!, /DATABASE_URL=.*npm run db:init/)
  // optional add-ons that are off on purpose are information, with what turning them on costs
  assert.equal(d.get("image")!.status, "info"); assert.match(d.get("image")!.detail, /OPENAI_API_KEY=… in \.env \(cp \.env\.example \.env first\).*bills each image/)
  assert.equal(d.get("video")!.status, "info"); assert.match(d.get("video")!.detail, /bills each video/)
  assert.doesNotMatch(JSON.stringify(d.report.checks), /blind judge|Workflow tool|Ultra account|« /, "no jargon nor French quotes a newcomer can't act on")
  for (const c of d.report.checks.filter((c) => c.status === "fail" || c.status === "warn")) assert.ok(c.fix, `${c.id}: no fix offered`)
  assert.equal(d.get("claude-code")!.status, "ok")
  assert.match(d.get("claude-code")!.detail, /logged in \(claude\.ai/)
  assert.equal(d.get("workflow")!.status, "ok", "Workflow tool seen in the (fake) claude -p init")
  assert.equal(d.report.provider, "claude-code")
})

test("readable output (English): « missing X ⇒ do: Y » and a summary; the default (beginner) profile asks for no database", async () => {
  const r = await npmRun(ws.dir, "doctor", ["--for", "agency"], { timeoutMs: 90_000, env: { FAKE_CLAUDE_AUTH: "none" } })
  assert.equal(r.code, 1)
  assert.match(r.stdout, /⚠ Shared database: DATABASE_URL not set: the cockpit uses its own local database/)
  assert.match(r.stdout, /optional ⇒ do: for that: DATABASE_URL=/)
  assert.match(r.stdout, /· Image boost \(optional\): off: .*OPENAI_API_KEY=/)
  assert.match(r.stdout, /missing ⇒ do: claude auth login/)
  assert.match(r.stdout, /blocking issue\(s\)/)
  assert.doesNotMatch(r.stdout, /[àéèêç]|manque|fais :/, "English output")
  ws.write("agency.config.json", ws.read("agency.config.example.json")) // the demo agency, as is
  const d = await npmRun(ws.dir, "doctor", [], { timeoutMs: 90_000 })
  assert.equal(d.code, 0, d.out)
  assert.match(d.stdout, /getting started/)
  assert.match(d.stdout, /next: npm run first-site -- --sample /)
  assert.match(d.stdout, /Your agency: .*still the demo one/, "agency.config.json identical to the example ⇒ warned")
  const h = await npmRun(ws.dir, "doctor", ["--help"], { timeoutMs: 30_000 })
  assert.equal(h.code, 0); assert.match(h.stdout, /--for agency/)
})

test("--for first-site: no database needed, everything else present ⇒ exit 0", async () => {
  const d = await doctor(["--for", "first-site"])
  assert.equal(d.code, 0, JSON.stringify(d.report.checks.filter((c) => c.status === "fail")))
  assert.equal(d.get("db"), undefined)
})

test("Claude Code signed out or missing: blocking, with the command that fixes it", async () => {
  const off = await doctor(["--for", "first-site"], { FAKE_CLAUDE_AUTH: "none" })
  assert.equal(off.code, 1)
  assert.equal(off.get("claude-code")!.status, "fail")
  assert.match(off.get("claude-code")!.fix!, /claude auth login.*claude setup-token/)
  const none = await doctor(["--for", "first-site"], { CLAUDE_BIN: "/nonexistent/claude" })
  assert.equal(none.get("claude-code")!.status, "fail")
  assert.match(none.get("claude-code")!.fix!, /claude\.ai\/install\.sh/)
  assert.match(off.get("claude-code")!.detail, /not logged in/)
})

test("--bare and out-of-date tools in WORKER_CLAUDE_ARGS; Workflow missing ⇒ fallback said", async () => {
  const bare = await doctor(["--for", "first-site"], { WORKER_CLAUDE_ARGS: "-p --bare --allowedTools Bash MultiEdit Task" })
  assert.equal(bare.get("bare")!.status, "fail")
  assert.equal(bare.get("worker-tools")!.status, "warn")
  assert.match(bare.get("worker-tools")!.detail, /MultiEdit.*Task/)
  const nowf = await doctor(["--for", "first-site"], { FAKE_CLAUDE_NO_WORKFLOW: "1" })
  assert.equal(nowf.code, 0, "not blocking: first-site has a local engine")
  // a Pro plan is not a problem : said as information, nothing to do (never a /config step Pro can't take)
  assert.equal(nowf.get("workflow")!.status, "info")
  assert.match(nowf.get("workflow")!.detail, /one agent at a time.*--engine local.*nothing to do/)
})

test("openai-compatible way: server queried (GET /models), a missing model = blocking per role", async () => {
  const s = await fakeChat()
  try {
    const d = await doctor(["--for", "first-site"], { LWS_LLM: "openai-compatible", OPENAI_BASE_URL: s.url + "/v1" })
    assert.equal(d.get("llm-auth")!.status, "ok")
    assert.match(d.get("llm-auth")!.detail, /fake-small/)
    for (const r of ["smart", "fast", "judge"]) assert.equal(d.get(`model-${r}`)!.status, "fail")
    assert.equal(d.code, 1)
    const ok = await doctor(["--for", "first-site"], { LWS_LLM: "openai-compatible", OPENAI_BASE_URL: s.url + "/v1", LWS_MODEL: "fake-small" })
    assert.equal(ok.code, 0, JSON.stringify(ok.report.checks.filter((c) => c.status === "fail")))
  } finally { await s.close() }
})

test("anthropic way: key checked for free (GET /v1/models), dead key = blocking", async () => {
  const live = await fakeMessages()
  const dead = await jsonRoutes({ "GET /v1/models": () => ({ status: 401, json: { type: "error", error: { type: "authentication_error", message: "invalid" } } }) })
  try {
    const a = await doctor(["--for", "first-site"], { LWS_LLM: "anthropic", ANTHROPIC_API_KEY: "sk-ant-test", ANTHROPIC_BASE_URL: live.url })
    assert.equal(a.get("llm-auth")!.status, "ok")
    assert.equal(live.calls[0].headers.authorization, "Bearer sk-ant-test")
    assert.equal(live.calls.filter((c) => c.path === "/v1/messages").length, 0, "no paid call")
    assert.equal(a.get("model-fast")!.detail.split(" ")[0], "claude-haiku-5-5")
    const b = await doctor(["--for", "first-site"], { LWS_LLM: "anthropic", ANTHROPIC_API_KEY: "sk-ant-morte", ANTHROPIC_BASE_URL: dead.url })
    assert.equal(b.get("llm-auth")!.status, "fail")
    assert.match(b.get("llm-auth")!.detail, /key refused \(401\)/)
    const c = await doctor(["--for", "first-site"], { LWS_LLM: "anthropic" })
    assert.match(c.get("llm-auth")!.fix!, /ANTHROPIC_API_KEY/)
  } finally { await live.close(); await dead.close() }
})

test("--offline: no probe (neither claude -p nor network), but the inventory stays complete", async () => {
  const d = await doctor(["--offline", "--for", "agency"], { LWS_LLM: "anthropic", ANTHROPIC_API_KEY: "sk-ant-test", ANTHROPIC_BASE_URL: "http://127.0.0.1:9" })
  assert.equal(d.get("workflow")!.status, "info")
  assert.equal(d.get("llm-auth")!.status, "info")
})

test("tracking: REAL sending without TRACK_BASE/secret = blocking (no one-click unsubscribe), a too-short secret named, dry-run = info", async () => {
  // blitz test of 10/24: for real without tracking, the emails went out without List-Unsubscribe and the click-gated escalation
  // died silently (no click seen); neither the tick nor the doctor said so
  const cfgPath = "outreach/sequencer/config.json"
  const orig = ws.read(cfgPath)
  try {
    const off = await doctor(["--offline", "--for", "agency"])
    assert.equal(off.get("tracking")!.status, "info", "dry-run: no effect")
    ws.write(cfgPath, JSON.stringify({ ...JSON.parse(orig), dryRun: false }))
    const live = await doctor(["--offline", "--for", "agency"], { LWS_LIVE_SEND: "1" })
    assert.equal(live.get("tracking")!.status, "fail")
    assert.match(live.get("tracking")!.detail, /TRACK_BASE missing: LIVE mails would go out without List-Unsubscribe/)
    assert.match(live.get("tracking")!.fix!, /openssl rand -hex 32/)
    const short = await doctor(["--offline", "--for", "agency"], { LWS_LIVE_SEND: "1", TRACK_BASE: "https://cockpit.agence.example", LWS_TRACK_SECRET: "trop-court" })
    assert.match(short.get("tracking")!.detail, /LWS_TRACK_SECRET too short \(10 < 32 characters\)/)
    const scheme = await doctor(["--offline", "--for", "agency"], { LWS_LIVE_SEND: "1", TRACK_BASE: "cockpit.agence.example", LWS_TRACK_SECRET: "x".repeat(40) })
    assert.match(scheme.get("tracking")!.detail, /is not an http\(s\) URL/)
    const ok = await doctor(["--offline", "--for", "agency"], { LWS_LIVE_SEND: "1", TRACK_BASE: "https://cockpit.agence.example/", LWS_TRACK_SECRET: "x".repeat(40) })
    assert.equal(ok.get("tracking")!.status, "ok")
    assert.match(ok.get("tracking")!.detail, /https:\/\/cockpit\.agence\.example\/t\//)
  } finally { ws.write(cfgPath, orig) }
})

test("audit round 2: --for agency says whether a 24/7 worker picks the jobs up (alive, the cockpit itself, or nobody)", async () => {
  const { workerCheck } = await import("../../scripts/doctor.ts")
  assert.equal(workerCheck(JSON.stringify({ id: "box#1", at: Date.now() - 5_000 })).status, "ok")
  const cockpit = workerCheck(JSON.stringify({ id: "cockpit#123", at: Date.now() }))
  assert.equal(cockpit.status, "info"); assert.match(cockpit.detail, /the cockpit runs the jobs itself/)
  const gone = workerCheck(JSON.stringify({ id: "box#1", at: Date.now() - 3 * 3600_000 }))
  assert.equal(gone.status, "warn"); assert.match(gone.detail, /not running \(last seen 3 h ago\)/); assert.match(gone.fix || "", /npm run worker/)
  assert.equal(workerCheck(null).status, "warn")
  const d = await doctor(["--for", "agency"])
  assert.equal(d.get("worker")!.status, "info", "no shared database: the cockpit runs the jobs, nothing to fix")
})
