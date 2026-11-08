/**
 * G7 (`claude -p` drift): an up-to-date tool list (Agent, no more Task/MultiEdit/TodoWrite), refusing to start
 * in `--bare` (neither plan nor skills), a correct auth message (the old "plan OFF (API)" lied as soon as
 * CLAUDE_CODE_OAUTH_TOKEN was missing), agents without an API key (plan-first), engines and models injected into the composer.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { DEFAULT_CLAUDE_ARGS, workerClaudeArgs, STALE_TOOLS } from "../../worker/claude-args.ts"
import { composerPrompt, composeEngines } from "../../worker/prompts.ts"
import { readableEvent } from "../../packages/llm/stream-events.ts"
import { claudeAuth } from "../../packages/llm/claude-code-status.ts"
import { bareRisk, planEnv } from "../../packages/llm/adapters/claude-code.ts"
import { tsx } from "../helpers/proc.ts"
import { makeWorkspace } from "../helpers/workspace.ts"
import type { BatchRow } from "../../packages/shared/batch.ts"

test("the worker's tools: Agent, Workflow, Skill; no more Task, MultiEdit, TodoWrite", () => {
  const args = workerClaudeArgs({})
  assert.equal(args.join(" "), DEFAULT_CLAUDE_ARGS)
  for (const t of ["Agent", "Workflow", "Skill", "Bash", "Read", "Write", "Edit"]) assert.ok(args.includes(t), t)
  for (const t of Object.keys(STALE_TOOLS)) assert.equal(args.includes(t), false, `${t} : ${STALE_TOOLS[t]}`)
  assert.ok(!args.includes("--dangerously-skip-permissions") && !args.includes("--bare"))
  assert.ok(args.includes("--strict-mcp-config"), "aucun serveur MCP (ni .mcp.json Supabase, ni connecteurs claude.ai type Gmail)")
  assert.deepEqual(workerClaudeArgs({ WORKER_CLAUDE_ARGS: "-p  --allowedTools Bash " }), ["-p", "--allowedTools", "Bash"])
})

test("--bare / CLAUDE_CODE_SIMPLE detected; planEnv removes only the API key", () => {
  assert.match(String(bareRisk(["-p", "--bare"], {})), /--bare/)
  assert.match(String(bareRisk(["-p"], { CLAUDE_CODE_SIMPLE: "1" })), /CLAUDE_CODE_SIMPLE/)
  assert.equal(bareRisk(["-p"], {}), null)
  const e = planEnv({ ANTHROPIC_API_KEY: "k", ANTHROPIC_AUTH_TOKEN: "t", ANTHROPIC_BASE_URL: "http://gw", CLAUDE_CODE_OAUTH_TOKEN: "o" })
  assert.equal(e.ANTHROPIC_API_KEY, undefined)
  assert.equal(e.ANTHROPIC_AUTH_TOKEN, "t")
  assert.equal(e.CLAUDE_CODE_OAUTH_TOKEN, "o")
})

test("the worker refuses to start in --bare (instead of failing job after job)", async () => {
  const ws = makeWorkspace()
  try {
    const env = { DATABASE_URL: "postgres://lws@127.0.0.1:9/lws", DB_SSL: "disable" }
    const a = await tsx(ws.dir, "worker/worker.ts", [], { env: { ...env, WORKER_CLAUDE_ARGS: "-p --bare --allowedTools Bash" }, timeoutMs: 30_000 })
    assert.equal(a.code, 1, a.out)
    assert.match(a.out, /--bare.*neither the plan's login nor CLAUDE_CODE_OAUTH_TOKEN, nor the repo's skills/)
    const b = await tsx(ws.dir, "worker/worker.ts", [], { env: { ...env, CLAUDE_CODE_SIMPLE: "1" }, timeoutMs: 30_000 })
    assert.equal(b.code, 1, b.out)
    assert.match(b.out, /CLAUDE_CODE_SIMPLE=1/)
  } finally { ws.cleanup() }
})

test("the plan's auth: claude.ai login read by `claude auth status`, token, gateway, signed out (no more fake \"plan OFF\")", () => {
  const bin = process.env.CLAUDE_BIN!
  const login = claudeAuth(bin, { ...process.env })
  assert.equal(login.loggedIn, true)
  assert.equal(login.source, "plan-login")
  assert.match(login.label, /subscription ✓ \(signed in with claude\.ai, max\)/)
  assert.equal(claudeAuth(bin, { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: "x" }).source, "plan-token")
  assert.equal(claudeAuth(bin, { ...process.env, ANTHROPIC_AUTH_TOKEN: "ollama", ANTHROPIC_BASE_URL: "http://127.0.0.1:11434" }).source, "auth-token")
  assert.equal(claudeAuth(bin, { ...process.env, ANTHROPIC_API_KEY: "sk" }).source, "plan-login", "the API key is removed from the product's claude -p: the plan stays the source")
  const none = claudeAuth(bin, { ...process.env, FAKE_CLAUDE_AUTH: "none" })
  assert.equal(none.loggedIn, false)
  assert.match(none.label, /not signed in.*claude auth login/)
  assert.equal(claudeAuth("/nonexistent/claude", {}).installed, false)
})

test("the worker announces the real auth source at startup", async () => {
  const ws = makeWorkspace()
  try {
    // unreachable database (port 9): the worker starts, announces its line, then loops on "claim failed" → killed at the timeout
    const r = await tsx(ws.dir, "worker/worker.ts", [], { env: { DATABASE_URL: "postgres://lws@127.0.0.1:9/lws", DB_SSL: "disable", WORKER_POLL_MS: "200" }, timeoutMs: 6_000 })
    assert.match(r.out, /✓ lws worker — .* · claude 9\.9\.9 · subscription ✓ \(signed in with claude\.ai, max\)/, r.out)
    assert.doesNotMatch(r.out, /plan OFF/)
  } finally { ws.cleanup() }
})

test("composerPrompt: models by role and media engines injected (no more \"boost: true ALWAYS\")", async () => {
  const row = { id: 7, industry: "pisciniste", seed: null, lim: 1, force_flag: 0, params_json: null } as unknown as BatchRow
  const off = await composerPrompt(row, ".", {})
  assert.doesNotMatch(off, /\{\{[A-Z_]+\}\}/, "no unfilled placeholder")
  assert.match(off, /models: \{"smart":"opus","fast":"haiku","judge":"sonnet"\}/)
  assert.match(off, /image: "none", video: "none"/)
  assert.match(off, /boost: false/)
  assert.doesNotMatch(off, /TOUJOURS|ALWAYS/)
  const on = await composerPrompt(row, ".", { OPENAI_API_KEY: "sk", LWS_VIDEO: "higgsfield", LWS_MODEL_SMART: "claude-opus-5-5" })
  assert.match(on, /image: "openai", video: "higgsfield"/)
  assert.match(on, /"smart":"claude-opus-5-5"/)
  assert.deepEqual(composeEngines({ LWS_IMAGE: "none", LWS_VIDEO: "none", OPENAI_API_KEY: "sk" }).boost, false)
})

test("readable log: the sub-agent tool is called Agent (new CLIs) or Task (old ones)", () => {
  const ev = (name: string) => JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name, input: { description: "diagnose orvane" } }] } })
  assert.equal(readableEvent(ev("Agent")), "🤖 sub-agent: diagnose orvane")
  assert.equal(readableEvent(ev("Task")), "🤖 sub-agent: diagnose orvane")
  assert.equal(readableEvent("noise"), "")
})
