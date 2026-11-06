/**
 * G7 (dérives `claude -p`) : liste d'outils à jour (Agent, plus de Task/MultiEdit/TodoWrite), refus de démarrer
 * en `--bare` (ni plan ni skills), message d'auth juste (l'ancien « plan OFF (API) » mentait dès que
 * CLAUDE_CODE_OAUTH_TOKEN manquait), agents sans clé API (plan-first), moteurs et modèles injectés au composer.
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

test("outils du worker : Agent, Workflow, Skill ; plus de Task, MultiEdit, TodoWrite", () => {
  const args = workerClaudeArgs({})
  assert.equal(args.join(" "), DEFAULT_CLAUDE_ARGS)
  for (const t of ["Agent", "Workflow", "Skill", "Bash", "Read", "Write", "Edit"]) assert.ok(args.includes(t), t)
  for (const t of Object.keys(STALE_TOOLS)) assert.equal(args.includes(t), false, `${t} : ${STALE_TOOLS[t]}`)
  assert.ok(!args.includes("--dangerously-skip-permissions") && !args.includes("--bare"))
  assert.ok(args.includes("--strict-mcp-config"), "aucun serveur MCP (ni .mcp.json Supabase, ni connecteurs claude.ai type Gmail)")
  assert.deepEqual(workerClaudeArgs({ WORKER_CLAUDE_ARGS: "-p  --allowedTools Bash " }), ["-p", "--allowedTools", "Bash"])
})

test("--bare / CLAUDE_CODE_SIMPLE détectés ; planEnv retire seulement la clé API", () => {
  assert.match(String(bareRisk(["-p", "--bare"], {})), /--bare/)
  assert.match(String(bareRisk(["-p"], { CLAUDE_CODE_SIMPLE: "1" })), /CLAUDE_CODE_SIMPLE/)
  assert.equal(bareRisk(["-p"], {}), null)
  const e = planEnv({ ANTHROPIC_API_KEY: "k", ANTHROPIC_AUTH_TOKEN: "t", ANTHROPIC_BASE_URL: "http://gw", CLAUDE_CODE_OAUTH_TOKEN: "o" })
  assert.equal(e.ANTHROPIC_API_KEY, undefined)
  assert.equal(e.ANTHROPIC_AUTH_TOKEN, "t")
  assert.equal(e.CLAUDE_CODE_OAUTH_TOKEN, "o")
})

test("le worker refuse de démarrer en --bare (au lieu d'échouer job après job)", async () => {
  const ws = makeWorkspace()
  try {
    const env = { DATABASE_URL: "postgres://lws@127.0.0.1:9/lws", DB_SSL: "disable" }
    const a = await tsx(ws.dir, "worker/worker.ts", [], { env: { ...env, WORKER_CLAUDE_ARGS: "-p --bare --allowedTools Bash" }, timeoutMs: 30_000 })
    assert.equal(a.code, 1, a.out)
    assert.match(a.out, /--bare.*ni le login du plan ni CLAUDE_CODE_OAUTH_TOKEN, ni les skills/)
    const b = await tsx(ws.dir, "worker/worker.ts", [], { env: { ...env, CLAUDE_CODE_SIMPLE: "1" }, timeoutMs: 30_000 })
    assert.equal(b.code, 1, b.out)
    assert.match(b.out, /CLAUDE_CODE_SIMPLE=1/)
  } finally { ws.cleanup() }
})

test("auth du plan : login claude.ai lu par `claude auth status`, token, passerelle, non connecté (fini le faux « plan OFF »)", () => {
  const bin = process.env.CLAUDE_BIN!
  const login = claudeAuth(bin, { ...process.env })
  assert.equal(login.loggedIn, true)
  assert.equal(login.source, "plan-login")
  assert.match(login.label, /plan ✓ \(login claude\.ai, max\)/)
  assert.equal(claudeAuth(bin, { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: "x" }).source, "plan-token")
  assert.equal(claudeAuth(bin, { ...process.env, ANTHROPIC_AUTH_TOKEN: "ollama", ANTHROPIC_BASE_URL: "http://127.0.0.1:11434" }).source, "auth-token")
  assert.equal(claudeAuth(bin, { ...process.env, ANTHROPIC_API_KEY: "sk" }).source, "plan-login", "la clé API est retirée des claude -p du produit : le plan reste la source")
  const none = claudeAuth(bin, { ...process.env, FAKE_CLAUDE_AUTH: "none" })
  assert.equal(none.loggedIn, false)
  assert.match(none.label, /non connecté/)
  assert.equal(claudeAuth("/nonexistent/claude", {}).installed, false)
})

test("le worker annonce la vraie source d'auth au démarrage", async () => {
  const ws = makeWorkspace()
  try {
    // base injoignable (port 9) : le worker démarre, annonce sa ligne, puis boucle sur « claim KO » → tué au délai
    const r = await tsx(ws.dir, "worker/worker.ts", [], { env: { DATABASE_URL: "postgres://lws@127.0.0.1:9/lws", DB_SSL: "disable", WORKER_POLL_MS: "200" }, timeoutMs: 6_000 })
    assert.match(r.out, /✓ worker lws — .* · claude 9\.9\.9 · plan ✓ \(login claude\.ai, max\)/, r.out)
    assert.doesNotMatch(r.out, /plan OFF/)
  } finally { ws.cleanup() }
})

test("composerPrompt : modèles par rôle et moteurs média injectés (plus de « boost: true TOUJOURS »)", async () => {
  const row = { id: 7, industry: "pisciniste", seed: null, lim: 1, force_flag: 0, params_json: null } as unknown as BatchRow
  const off = await composerPrompt(row, ".", {})
  assert.doesNotMatch(off, /\{\{[A-Z_]+\}\}/, "aucun gabarit non rempli")
  assert.match(off, /models: \{"smart":"opus","fast":"haiku","judge":"sonnet"\}/)
  assert.match(off, /image: "none", video: "none"/)
  assert.match(off, /boost: false/)
  assert.doesNotMatch(off, /TOUJOURS/)
  const on = await composerPrompt(row, ".", { OPENAI_API_KEY: "sk", LWS_VIDEO: "higgsfield", LWS_MODEL_SMART: "claude-opus-5-5" })
  assert.match(on, /image: "openai", video: "higgsfield"/)
  assert.match(on, /"smart":"claude-opus-5-5"/)
  assert.deepEqual(composeEngines({ LWS_IMAGE: "none", LWS_VIDEO: "none", OPENAI_API_KEY: "sk" }).boost, false)
})

test("journal lisible : l'outil sous-agent s'appelle Agent (nouvelles CLI) ou Task (anciennes)", () => {
  const ev = (name: string) => JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name, input: { description: "diagnose orvane" } }] } })
  assert.equal(readableEvent(ev("Agent")), "🤖 sous-agent : diagnose orvane")
  assert.equal(readableEvent(ev("Task")), "🤖 sous-agent : diagnose orvane")
  assert.equal(readableEvent("bruit"), "")
})
