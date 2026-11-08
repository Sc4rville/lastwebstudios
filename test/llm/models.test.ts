/**
 * G7 + G8: a single place for the models (packages/llm/models.ts), roles (smart / fast / judge) with
 * 5.5 defaults, aliases on the plan path, and an EXPLICIT way selection (LWS_LLM) that no longer sends an
 * Ollama user to `claude -p` by default.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { DEFAULT_MODELS, PLAN_ALIASES, resolveModel, modelFor, workflowModels, coachModel, isRole } from "../../packages/llm/models.ts"
import { selectProvider } from "../../packages/llm/provider.ts"
import { parseJson } from "../../packages/llm/json.ts"

test("defaults: Opus 5.5 / Haiku 5.5 / Sonnet 5.5 on the API, aliases on the plan", () => {
  assert.deepEqual(DEFAULT_MODELS, { smart: "claude-opus-5-5", fast: "claude-haiku-5-5", judge: "claude-sonnet-5-5" })
  for (const role of ["smart", "fast", "judge"] as const) {
    assert.equal(resolveModel(role, "anthropic", {}).model, DEFAULT_MODELS[role])
    assert.equal(resolveModel(role, "claude-code", {}).model, PLAN_ALIASES[role])
  }
  assert.deepEqual(workflowModels({}), { smart: "opus", fast: "haiku", judge: "sonnet" })
})

test("LWS_MODEL_<ROLE>, then LWS_MODEL, pass through as they are, on every way", () => {
  const env = { LWS_MODEL_JUDGE: "claude-sonnet-5-5", LWS_MODEL: "qwen3:1.7b" }
  assert.deepEqual(resolveModel("judge", "claude-code", env), { model: "claude-sonnet-5-5", source: "LWS_MODEL_JUDGE" })
  assert.deepEqual(resolveModel("fast", "anthropic-compatible", env), { model: "qwen3:1.7b", source: "LWS_MODEL" })
  assert.equal(resolveModel("smart", "openai-compatible", env).model, "qwen3:1.7b")
  assert.equal(workflowModels(env).judge, "claude-sonnet-5-5")
})

test("openai-compatible requires a model (a third-party server doesn't know the Claude IDs); OPENAI_MODEL as a fallback", () => {
  assert.throws(() => resolveModel("fast", "openai-compatible", {}), /LWS_MODEL_FAST/)
  assert.equal(resolveModel("fast", "openai-compatible", { OPENAI_MODEL: "gpt-5.2-mini" }).model, "gpt-5.2-mini")
  assert.equal(resolveModel("fast", "anthropic-compatible", { ANTHROPIC_MODEL: "llama3.2:1b" }).model, "llama3.2:1b")
})

test("an explicit ID (legacy caller) passes through as it is; a role is resolved", () => {
  assert.equal(modelFor("claude-opus-5", "anthropic", {}), "claude-opus-5")
  assert.equal(modelFor("smart", "anthropic", {}), "claude-opus-5-5")
  assert.equal(isRole("judge"), true)
  assert.equal(isRole("sonnet"), false)
})

test("coach: the legacy COACH_MODEL first, else the smart role (the opus alias on the plan)", () => {
  assert.equal(coachModel({}), "opus")
  assert.equal(coachModel({ LWS_MODEL_SMART: "claude-opus-5-5" }), "claude-opus-5-5")
  assert.equal(coachModel({ COACH_MODEL: "sonnet", LWS_MODEL_SMART: "claude-opus-5-5" }), "sonnet")
})

test("way selection: explicit LWS_LLM, legacy LLM_VIA, base URLs, plan-first default", () => {
  assert.equal(selectProvider({}).name, "claude-code")
  assert.equal(selectProvider({ ANTHROPIC_API_KEY: "sk-ant-x" }).name, "claude-code", "a key alone no longer switches to the API (plan-first)")
  assert.equal(selectProvider({ LWS_LLM: "anthropic" }).name, "anthropic")
  assert.equal(selectProvider({ LWS_LLM: "OpenAI-Compatible" }).name, "openai-compatible")
  assert.throws(() => selectProvider({ LWS_LLM: "gpt" }), /is unknown/)
  assert.equal(selectProvider({ LLM_VIA: "plan" }).name, "claude-code")
  assert.equal(selectProvider({ LLM_VIA: "api" }).name, "anthropic")
  assert.equal(selectProvider({ ANTHROPIC_BASE_URL: "http://127.0.0.1:11434", ANTHROPIC_AUTH_TOKEN: "ollama" }).name, "anthropic-compatible", "an Ollama user no longer lands on claude -p")
  assert.equal(selectProvider({ ANTHROPIC_BASE_URL: "https://api.anthropic.com" }).name, "claude-code")
  assert.equal(selectProvider({ OPENAI_BASE_URL: "https://openrouter.ai/api/v1" }).name, "openai-compatible")
  assert.equal(selectProvider({ LWS_LLM: "claude-code", OPENAI_BASE_URL: "http://x" }).name, "claude-code", "LWS_LLM wins")
  assert.match(selectProvider({}).why, /plan-first/)
})

test("parseJson: ``` fences, text around, reasoning before the answer, braces inside strings", () => {
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(parseJson('Voici : {"a":{"b":[1,2]}} fin.'), { a: { b: [1, 2] } })
  assert.deepEqual(parseJson('Je pense que {x} est faux. Réponse : {"verdict":"pass","note":"un } dans le texte"}'), { verdict: "pass", note: "un } dans le texte" })
  assert.throws(() => parseJson("pas de json ici"), /not JSON/)
})

// G7 (acceptance check): no generation-4 model ID in the code, and no hard-coded Claude ID
// outside packages/llm/models.ts (tests aside)
const CODE = /\.(ts|mjs|js|cjs)$/
const SKIP_DIRS = new Set(["node_modules", "output", "closing", "data", ".git", "NIGHT", ".oss-build"])
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : walk(join(dir, e.name))
    return CODE.test(e.name) ? [join(dir, e.name)] : []
  })
}

test("G7: 0 occurrences of claude-(opus|sonnet)-4 in the code outside packages/llm/models.ts", () => {
  const hits = walk(".").filter((f) => f !== join("packages", "llm", "models.ts") && /claude-(opus|sonnet)-4/.test(readFileSync(f, "utf8")))
  assert.deepEqual(hits, [])
})

test("single source: no hard-coded Claude model ID in the product outside packages/llm/models.ts", () => {
  const hits = walk(".").filter((f) => !f.startsWith("test" + "/") && f !== join("packages", "llm", "models.ts"))
    .filter((f) => /claude-(opus|sonnet|haiku)-\d/.test(readFileSync(f, "utf8")))
  assert.deepEqual(hits, [])
})
