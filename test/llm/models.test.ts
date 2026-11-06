/**
 * G7 + G8 : un seul endroit pour les modèles (packages/llm/models.ts), des rôles (smart / fast / judge) aux
 * défauts 5.5, des alias sur le chemin plan, et une sélection de voie EXPLICITE (LWS_LLM) qui n'envoie plus un
 * utilisateur d'Ollama sur `claude -p` par défaut.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { DEFAULT_MODELS, PLAN_ALIASES, resolveModel, modelFor, workflowModels, coachModel, isRole } from "../../packages/llm/models.ts"
import { selectProvider } from "../../packages/llm/provider.ts"
import { parseJson } from "../../packages/llm/json.ts"

test("défauts : Opus 5.5 / Haiku 5.5 / Sonnet 5.5 sur l'API, alias sur le plan", () => {
  assert.deepEqual(DEFAULT_MODELS, { smart: "claude-opus-5-5", fast: "claude-haiku-5-5", judge: "claude-sonnet-5-5" })
  for (const role of ["smart", "fast", "judge"] as const) {
    assert.equal(resolveModel(role, "anthropic", {}).model, DEFAULT_MODELS[role])
    assert.equal(resolveModel(role, "claude-code", {}).model, PLAN_ALIASES[role])
  }
  assert.deepEqual(workflowModels({}), { smart: "opus", fast: "haiku", judge: "sonnet" })
})

test("LWS_MODEL_<RÔLE> puis LWS_MODEL passent tels quels, sur toutes les voies", () => {
  const env = { LWS_MODEL_JUDGE: "claude-sonnet-5-5", LWS_MODEL: "qwen3:1.7b" }
  assert.deepEqual(resolveModel("judge", "claude-code", env), { model: "claude-sonnet-5-5", source: "LWS_MODEL_JUDGE" })
  assert.deepEqual(resolveModel("fast", "anthropic-compatible", env), { model: "qwen3:1.7b", source: "LWS_MODEL" })
  assert.equal(resolveModel("smart", "openai-compatible", env).model, "qwen3:1.7b")
  assert.equal(workflowModels(env).judge, "claude-sonnet-5-5")
})

test("openai-compatible exige un modèle (un serveur tiers ne connaît pas les IDs Claude) ; OPENAI_MODEL en repli", () => {
  assert.throws(() => resolveModel("fast", "openai-compatible", {}), /LWS_MODEL_FAST/)
  assert.equal(resolveModel("fast", "openai-compatible", { OPENAI_MODEL: "gpt-5.2-mini" }).model, "gpt-5.2-mini")
  assert.equal(resolveModel("fast", "anthropic-compatible", { ANTHROPIC_MODEL: "llama3.2:1b" }).model, "llama3.2:1b")
})

test("un ID explicite (appelant historique) passe tel quel ; un rôle est résolu", () => {
  assert.equal(modelFor("claude-opus-5", "anthropic", {}), "claude-opus-5")
  assert.equal(modelFor("smart", "anthropic", {}), "claude-opus-5-5")
  assert.equal(isRole("judge"), true)
  assert.equal(isRole("sonnet"), false)
})

test("coach : COACH_MODEL historique d'abord, sinon le rôle smart (alias opus sur le plan)", () => {
  assert.equal(coachModel({}), "opus")
  assert.equal(coachModel({ LWS_MODEL_SMART: "claude-opus-5-5" }), "claude-opus-5-5")
  assert.equal(coachModel({ COACH_MODEL: "sonnet", LWS_MODEL_SMART: "claude-opus-5-5" }), "sonnet")
})

test("sélection de la voie : LWS_LLM explicite, LLM_VIA historique, bases d'URL, défaut plan-first", () => {
  assert.equal(selectProvider({}).name, "claude-code")
  assert.equal(selectProvider({ ANTHROPIC_API_KEY: "sk-ant-x" }).name, "claude-code", "une clé seule ne bascule plus sur l'API (plan-first)")
  assert.equal(selectProvider({ LWS_LLM: "anthropic" }).name, "anthropic")
  assert.equal(selectProvider({ LWS_LLM: "OpenAI-Compatible" }).name, "openai-compatible")
  assert.throws(() => selectProvider({ LWS_LLM: "gpt" }), /inconnu/)
  assert.equal(selectProvider({ LLM_VIA: "plan" }).name, "claude-code")
  assert.equal(selectProvider({ LLM_VIA: "api" }).name, "anthropic")
  assert.equal(selectProvider({ ANTHROPIC_BASE_URL: "http://127.0.0.1:11434", ANTHROPIC_AUTH_TOKEN: "ollama" }).name, "anthropic-compatible", "un utilisateur Ollama ne part plus sur claude -p")
  assert.equal(selectProvider({ ANTHROPIC_BASE_URL: "https://api.anthropic.com" }).name, "claude-code")
  assert.equal(selectProvider({ OPENAI_BASE_URL: "https://openrouter.ai/api/v1" }).name, "openai-compatible")
  assert.equal(selectProvider({ LWS_LLM: "claude-code", OPENAI_BASE_URL: "http://x" }).name, "claude-code", "LWS_LLM l'emporte")
  assert.match(selectProvider({}).why, /plan-first/)
})

test("parseJson : clôtures ```, texte autour, raisonnement avant la réponse, accolades dans les chaînes", () => {
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(parseJson('Voici : {"a":{"b":[1,2]}} fin.'), { a: { b: [1, 2] } })
  assert.deepEqual(parseJson('Je pense que {x} est faux. Réponse : {"verdict":"pass","note":"un } dans le texte"}'), { verdict: "pass", note: "un } dans le texte" })
  assert.throws(() => parseJson("pas de json ici"), /non-JSON/)
})

// G7 (contrôle d'acceptation) : aucun ID de modèle de la génération 4 dans le code, et aucun ID Claude en dur
// hors de packages/llm/models.ts (les tests mis à part)
const CODE = /\.(ts|mjs|js|cjs)$/
const SKIP_DIRS = new Set(["node_modules", "output", "closing", "data", ".git", "NIGHT", ".oss-build"])
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : walk(join(dir, e.name))
    return CODE.test(e.name) ? [join(dir, e.name)] : []
  })
}

test("G7 : 0 occurrence de claude-(opus|sonnet)-4 dans le code hors packages/llm/models.ts", () => {
  const hits = walk(".").filter((f) => f !== join("packages", "llm", "models.ts") && /claude-(opus|sonnet)-4/.test(readFileSync(f, "utf8")))
  assert.deepEqual(hits, [])
})

test("source unique : aucun ID de modèle Claude en dur dans le produit hors packages/llm/models.ts", () => {
  const hits = walk(".").filter((f) => !f.startsWith("test" + "/") && f !== join("packages", "llm", "models.ts"))
    .filter((f) => /claude-(opus|sonnet|haiku)-\d/.test(readFileSync(f, "utf8")))
  assert.deepEqual(hits, [])
})
