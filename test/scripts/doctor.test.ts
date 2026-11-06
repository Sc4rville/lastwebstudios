/**
 * G9 : `npm run doctor` dit exactement ce qui manque et comment le réparer. Dans un workspace sans .env : exit ≠ 0
 * et une ligne « manque X ⇒ fais Y » par point bloquant ; sortie JSON stable (--json) ; chaque cas (Claude Code
 * absent ou déconnecté, --bare, Workflow absent, voie LLM tierce, clé API morte) est reconnu. Le cas « tout
 * présent, base comprise » est dans test/pg/doctor.test.ts.
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
  try { report = JSON.parse(r.stdout) } catch { throw new Error(`sortie non-JSON :\n${r.out.slice(-1500)}`) }
  return { code: r.code, report, get: (id: string) => report.checks.find((c) => c.id === id) }
}

test("workspace sans .env : exit 1, chaque point bloquant ou optionnel porte son « fais : … »", async () => {
  const d = await doctor([])
  assert.equal(d.code, 1)
  assert.equal(d.report.ok, false)
  for (const id of ["node", "deps", "chromium", "llm", "model-smart", "model-fast", "model-judge", "claude-code", "bare", "workflow", "db", "image", "video", "send"]) assert.ok(d.get(id), `point ${id} présent`)
  assert.equal(d.get("db")!.status, "fail")
  assert.match(d.get("db")!.fix!, /DATABASE_URL=.*npm run db:init/)
  for (const c of d.report.checks.filter((c) => c.status === "fail" || c.status === "warn")) assert.ok(c.fix, `${c.id} : pas de correctif proposé`)
  assert.equal(d.get("claude-code")!.status, "ok")
  assert.match(d.get("claude-code")!.detail, /plan ✓/)
  assert.equal(d.get("workflow")!.status, "ok", "outil Workflow vu dans l'init du (faux) claude -p")
  assert.equal(d.report.provider, "claude-code")
})

test("sortie lisible : « manque X ⇒ fais : Y » et un résumé", async () => {
  const r = await npmRun(ws.dir, "doctor", [], { timeoutMs: 90_000 })
  assert.equal(r.code, 1)
  assert.match(r.stdout, /✗ Base Postgres : manque DATABASE_URL/)
  assert.match(r.stdout, /manque ⇒ fais : pose DATABASE_URL=/)
  assert.match(r.stdout, /option ⇒ fais : OPENAI_API_KEY=/)
  assert.match(r.stdout, /point\(s\) bloquant\(s\)/)
})

test("--for first-site : pas de base requise, tout le reste présent ⇒ exit 0", async () => {
  const d = await doctor(["--for", "first-site"])
  assert.equal(d.code, 0, JSON.stringify(d.report.checks.filter((c) => c.status === "fail")))
  assert.equal(d.get("db"), undefined)
})

test("Claude Code déconnecté ou absent : bloquant, avec la commande qui répare", async () => {
  const off = await doctor(["--for", "first-site"], { FAKE_CLAUDE_AUTH: "none" })
  assert.equal(off.code, 1)
  assert.equal(off.get("claude-code")!.status, "fail")
  assert.match(off.get("claude-code")!.fix!, /claude auth login.*claude setup-token/)
  const none = await doctor(["--for", "first-site"], { CLAUDE_BIN: "/nonexistent/claude" })
  assert.equal(none.get("claude-code")!.status, "fail")
  assert.match(none.get("claude-code")!.fix!, /claude\.ai\/install\.sh/)
})

test("--bare et outils périmés dans WORKER_CLAUDE_ARGS ; Workflow absent ⇒ repli indiqué", async () => {
  const bare = await doctor(["--for", "first-site"], { WORKER_CLAUDE_ARGS: "-p --bare --allowedTools Bash MultiEdit Task" })
  assert.equal(bare.get("bare")!.status, "fail")
  assert.equal(bare.get("worker-tools")!.status, "warn")
  assert.match(bare.get("worker-tools")!.detail, /MultiEdit.*Task/)
  const nowf = await doctor(["--for", "first-site"], { FAKE_CLAUDE_NO_WORKFLOW: "1" })
  assert.equal(nowf.code, 0, "pas bloquant : first-site a un moteur local")
  assert.equal(nowf.get("workflow")!.status, "warn")
  assert.match(nowf.get("workflow")!.fix!, /Dynamic workflows.*--engine local/)
})

test("voie openai-compatible : serveur interrogé (GET /models), modèle manquant = bloquant par rôle", async () => {
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

test("voie anthropic : clé vérifiée gratuitement (GET /v1/models), clé morte = bloquant", async () => {
  const live = await fakeMessages()
  const dead = await jsonRoutes({ "GET /v1/models": () => ({ status: 401, json: { type: "error", error: { type: "authentication_error", message: "invalid" } } }) })
  try {
    const a = await doctor(["--for", "first-site"], { LWS_LLM: "anthropic", ANTHROPIC_API_KEY: "sk-ant-test", ANTHROPIC_BASE_URL: live.url })
    assert.equal(a.get("llm-auth")!.status, "ok")
    assert.equal(live.calls[0].headers.authorization, "Bearer sk-ant-test")
    assert.equal(live.calls.filter((c) => c.path === "/v1/messages").length, 0, "aucun appel payant")
    assert.equal(a.get("model-fast")!.detail.split(" ")[0], "claude-haiku-5-5")
    const b = await doctor(["--for", "first-site"], { LWS_LLM: "anthropic", ANTHROPIC_API_KEY: "sk-ant-morte", ANTHROPIC_BASE_URL: dead.url })
    assert.equal(b.get("llm-auth")!.status, "fail")
    assert.match(b.get("llm-auth")!.detail, /clé refusée \(401\)/)
    const c = await doctor(["--for", "first-site"], { LWS_LLM: "anthropic" })
    assert.match(c.get("llm-auth")!.fix!, /ANTHROPIC_API_KEY/)
  } finally { await live.close(); await dead.close() }
})

test("--offline : aucune sonde (ni claude -p, ni réseau), mais l'inventaire reste complet", async () => {
  const d = await doctor(["--offline"], { LWS_LLM: "anthropic", ANTHROPIC_API_KEY: "sk-ant-test", ANTHROPIC_BASE_URL: "http://127.0.0.1:9" })
  assert.equal(d.get("workflow")!.status, "info")
  assert.equal(d.get("llm-auth")!.status, "info")
})

test("tracking : envoi RÉEL sans TRACK_BASE/secret = bloquant (pas de désinscription 1-clic), secret trop court nommé, dry-run = info", async () => {
  // test blitz du 24/10 : en réel sans tracking, les mails partaient sans List-Unsubscribe et l'escalade gatée au clic
  // mourait en silence (aucun clic vu) ; ni le tick ni le doctor ne le disaient
  const cfgPath = "outreach/sequencer/config.json"
  const orig = ws.read(cfgPath)
  try {
    const off = await doctor(["--offline"])
    assert.equal(off.get("tracking")!.status, "info", "dry-run : sans effet")
    ws.write(cfgPath, JSON.stringify({ ...JSON.parse(orig), dryRun: false }))
    const live = await doctor(["--offline"], { LWS_LIVE_SEND: "1" })
    assert.equal(live.get("tracking")!.status, "fail")
    assert.match(live.get("tracking")!.detail, /TRACK_BASE absent : les mails RÉELS partiraient sans List-Unsubscribe/)
    assert.match(live.get("tracking")!.fix!, /openssl rand -hex 32/)
    const short = await doctor(["--offline"], { LWS_LIVE_SEND: "1", TRACK_BASE: "https://cockpit.agence.example", LWS_TRACK_SECRET: "trop-court" })
    assert.match(short.get("tracking")!.detail, /LWS_TRACK_SECRET trop court \(10 < 32 caractères\)/)
    const scheme = await doctor(["--offline"], { LWS_LIVE_SEND: "1", TRACK_BASE: "cockpit.agence.example", LWS_TRACK_SECRET: "x".repeat(40) })
    assert.match(scheme.get("tracking")!.detail, /n'est pas une URL http\(s\)/)
    const ok = await doctor(["--offline"], { LWS_LIVE_SEND: "1", TRACK_BASE: "https://cockpit.agence.example/", LWS_TRACK_SECRET: "x".repeat(40) })
    assert.equal(ok.get("tracking")!.status, "ok")
    assert.match(ok.get("tracking")!.detail, /https:\/\/cockpit\.agence\.example\/t\//)
  } finally { ws.write(cfgPath, orig) }
})
