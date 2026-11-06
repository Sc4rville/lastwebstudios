/**
 * G7 + G8 : le contrat des 4 adaptateurs, contre de FAUX serveurs locaux (aucun appel réel).
 *
 *   anthropic             @anthropic-ai/sdk 1.x : Authorization Bearer (plus X-Api-Key), anthropic-version 2026-10-21,
 *                         système en cache (cache_control), image base64, sortie structurée, plancher max_tokens
 *   anthropic-compatible  Ollama / LiteLLM : ANTHROPIC_AUTH_TOKEN en Bearer, pas de champs exotiques par défaut
 *   openai-compatible     Chat Completions : image_url data URL, response_format json_schema, replis 400/429
 *   claude-code           `claude -p` (faux binaire) : --json-schema, aucun outil ni MCP, clé API retirée, repli regex
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { anthropicAdapter, MIN_MAX_TOKENS } from "../../packages/llm/adapters/anthropic.ts"
import { openaiCompatibleAdapter } from "../../packages/llm/adapters/openai-compatible.ts"
import { claudeCodeAdapter } from "../../packages/llm/adapters/claude-code.ts"
import { completeJson, LlmError } from "../../packages/llm/index.ts"
import { fakeMessages, fakeChat } from "../helpers/llm-servers.ts"
import { makeWorkspace } from "../helpers/workspace.ts"

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64")
const IMG = { path: "x.png", mediaType: "image/png", data: PNG.toString("base64") }
const SCHEMA = { type: "object", properties: { besoin: { type: "number" }, reasons: { type: "array", items: { type: "string" } } }, required: ["reasons"], additionalProperties: false }

test("SDK 1.x (anthropic) : Bearer, version 2026-10-21, système en cache, image base64, sortie structurée, plancher max_tokens", async () => {
  const s = await fakeMessages({ reply: () => ({ text: '{"besoin":72,"reasons":["daté"]}', thinking: true }) })
  try {
    const a = anthropicAdapter("anthropic", { ANTHROPIC_API_KEY: "sk-ant-test-123", ANTHROPIC_BASE_URL: s.url, LWS_LLM_RETRIES: "0" })
    const r = await a.complete({ system: "PROMPT DU SKILL", user: "## URL\n\nhttp://exemple.example", images: [IMG], model: "claude-sonnet-5-5", role: "judge", maxTokens: 1024, schema: SCHEMA })
    const c = s.calls[0]
    assert.equal(c.headers.authorization, "Bearer sk-ant-test-123")
    assert.equal(c.headers["x-api-key"], undefined, "SDK 1.x : la clé ne part plus en X-Api-Key")
    assert.equal(c.headers["anthropic-version"], "2026-10-21")
    assert.equal(c.body.model, "claude-sonnet-5-5")
    assert.equal(c.body.max_tokens, MIN_MAX_TOKENS, "1024 relevé au plancher : la réflexion des 5.5 compte dans max_tokens")
    assert.deepEqual(c.body.system, [{ type: "text", text: "PROMPT DU SKILL", cache_control: { type: "ephemeral" } }])
    assert.equal(c.body.messages[0].role, "user")
    assert.deepEqual(c.body.messages[0].content[0], { type: "text", text: "## URL\n\nhttp://exemple.example" })
    assert.deepEqual(c.body.messages[0].content[1], { type: "image", source: { type: "base64", media_type: "image/png", data: IMG.data } })
    assert.deepEqual(c.body.output_config, { format: { type: "json_schema", schema: SCHEMA } })
    for (const k of ["temperature", "top_p", "top_k"]) assert.equal(k in c.body, false, `${k} refusé en 400 par l'API 2026-10-21`)
    assert.equal(r.text, '{"besoin":72,"reasons":["daté"]}', "le bloc thinking est ignoré, seul le texte compte")
    assert.deepEqual(r.structured, { besoin: 72, reasons: ["daté"] })
    assert.equal(r.usage?.inputTokens, 120)
  } finally { await s.close() }
})

test("anthropic : effort par rôle (LWS_EFFORT_<RÔLE>) dans output_config, sinon absent", async () => {
  const s = await fakeMessages({ reply: () => ({ text: "{}" }) })
  try {
    await anthropicAdapter("anthropic", { ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: s.url, LWS_EFFORT_FAST: "low" }).complete({ system: "s", user: "u", model: "claude-haiku-5-5", role: "fast", maxTokens: 8000 })
    await anthropicAdapter("anthropic", { ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: s.url }).complete({ system: "s", user: "u", model: "claude-haiku-5-5", role: "fast", maxTokens: 8000 })
    assert.deepEqual(s.calls[0].body.output_config, { effort: "low" })
    assert.equal(s.calls[0].body.max_tokens, 8000)
    assert.equal("output_config" in s.calls[1].body, false)
  } finally { await s.close() }
})

test("anthropic : erreurs lisibles (401 clé refusée, max_tokens tronqué, refus) et clé absente", async () => {
  const s = await fakeMessages({ reply: (_b, n) => n === 1 ? { status: 401, error: { type: "authentication_error", message: "invalid x-api-key" } } : n === 2 ? { text: '{"a":', stop_reason: "max_tokens" } : { text: "", stop_reason: "refusal" } })
  try {
    const a = anthropicAdapter("anthropic", { ANTHROPIC_API_KEY: "sk-ant-morte", ANTHROPIC_BASE_URL: s.url, LWS_LLM_RETRIES: "0" })
    const req = { system: "s", user: "u", model: "claude-haiku-5-5", maxTokens: 4096 }
    await assert.rejects(a.complete(req), (e: any) => e instanceof LlmError && e.status === 401 && /clé refusée/.test(e.message))
    await assert.rejects(a.complete(req), /tronquée/)
    await assert.rejects(a.complete(req), /refusé/)
  } finally { await s.close() }
  assert.throws(() => anthropicAdapter("anthropic", {}), /ANTHROPIC_API_KEY manquante/)
})

test("anthropic-compatible (Ollama, LiteLLM) : ANTHROPIC_AUTH_TOKEN en Bearer, ni cache_control ni output_config par défaut", async () => {
  const s = await fakeMessages({ reply: () => ({ text: 'Voilà : {"reasons":["ok"]}' }) })
  try {
    const env = { LWS_LLM: "anthropic-compatible", ANTHROPIC_BASE_URL: s.url, ANTHROPIC_AUTH_TOKEN: "ollama", LWS_MODEL: "llama3.2:1b" }
    const r = await completeJson({ roleOrModel: "fast", system: "s", user: "u", maxTokens: 2048, schema: SCHEMA }, env)
    const c = s.calls[0]
    assert.equal(c.headers.authorization, "Bearer ollama")
    assert.equal(c.body.model, "llama3.2:1b")
    assert.equal(c.body.max_tokens, 2048, "pas de plancher hors API Claude (un petit modèle local a sa propre limite)")
    assert.equal(c.body.system[0].cache_control, undefined)
    assert.equal("output_config" in c.body, false)
    assert.deepEqual(r.json, { reasons: ["ok"] })
    assert.equal(r.structured, false, "JSON extrait du texte (repli)")
    assert.equal(r.provider.name, "anthropic-compatible")
  } finally { await s.close() }
  assert.throws(() => anthropicAdapter("anthropic-compatible", {}), /ANTHROPIC_BASE_URL/)
})

test("openai-compatible : Bearer, system + user, image en image_url base64, response_format json_schema", async () => {
  const s = await fakeChat({ reply: () => ({ text: '{"besoin":40,"reasons":["moyen"]}' }) })
  try {
    const a = openaiCompatibleAdapter({ OPENAI_BASE_URL: s.url + "/v1", OPENAI_API_KEY: "sk-or-test" })
    const r = await a.complete({ system: "PROMPT", user: "blocs", images: [IMG], model: "fake-small", maxTokens: 3000, schema: SCHEMA })
    const c = s.calls[0]
    assert.equal(c.path, "/v1/chat/completions")
    assert.equal(c.headers.authorization, "Bearer sk-or-test")
    assert.deepEqual(c.body.messages[0], { role: "system", content: "PROMPT" })
    assert.deepEqual(c.body.messages[1].content[0], { type: "text", text: "blocs" })
    assert.deepEqual(c.body.messages[1].content[1], { type: "image_url", image_url: { url: `data:image/png;base64,${IMG.data}` } })
    assert.equal(c.body.max_tokens, 3000)
    assert.deepEqual(c.body.response_format, { type: "json_schema", json_schema: { name: "skill_output", schema: SCHEMA, strict: false } })
    assert.deepEqual(r.structured, { besoin: 40, reasons: ["moyen"] })
  } finally { await s.close() }
})

test("openai-compatible : replis automatiques (response_format refusé, max_completion_tokens exigé, 429) et erreurs claires", async () => {
  const s = await fakeChat({ reply: (b, n) => {
    if (n === 1) return { status: 400, error: "response_format json_schema is not supported by this model" }
    if (n === 2) { assert.equal("response_format" in b, false); return { status: 400, error: "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead." } }
    if (n === 3) { assert.equal(b.max_completion_tokens, 500); return { status: 429, error: "slow down", headers: { "retry-after": "0" } } }
    if (n === 4) return { text: '```json\n{"reasons":["x"]}\n```' }
    return { text: "{}", finish_reason: "length" }
  } })
  try {
    const a = openaiCompatibleAdapter({ OPENAI_BASE_URL: s.url + "/v1" })
    const r = await a.complete({ system: "s", user: "u", model: "m", maxTokens: 500, schema: SCHEMA })
    assert.equal(s.calls.length, 4)
    assert.equal(s.calls[0].headers.authorization, undefined, "serveur local sans clé : pas d'en-tête")
    assert.match(r.text, /reasons/)
    await assert.rejects(a.complete({ system: "s", user: "u", model: "m", maxTokens: 500 }), /tronquée/)
  } finally { await s.close() }
})

test("claude-code : --json-schema → structured_output, aucun outil ni serveur MCP, réglages du projet, clé API retirée", async () => {
  const ws = makeWorkspace()
  try {
    const log = ws.path("claude.log")
    const env = { ...process.env, FAKE_CLAUDE_LOG: log, ANTHROPIC_API_KEY: "sk-ant-ne-doit-pas-passer", FAKE_CLAUDE_RESULT: '{"reasons":["structuré"]}' }
    const r = await claudeCodeAdapter(env).complete({ system: "PROMPT", user: "## X\n\ny", model: "haiku", maxTokens: 1000, schema: SCHEMA })
    assert.deepEqual(r.structured, { reasons: ["structuré"] })
    const call = JSON.parse(readFileSync(log, "utf8").trim().split("\n")[0])
    const argv: string[] = call.argv
    assert.equal(argv[argv.indexOf("--model") + 1], "haiku")
    assert.deepEqual(JSON.parse(argv[argv.indexOf("--json-schema") + 1]), SCHEMA)
    assert.equal(argv[argv.indexOf("--tools") + 1], "", "un skill sans image n'a besoin d'AUCUN outil")
    assert.ok(argv.includes("--strict-mcp-config"), "ni le .mcp.json du dépôt ni les connecteurs claude.ai")
    assert.equal(argv[argv.indexOf("--setting-sources") + 1], "project", "pas les hooks / plugins de l'utilisateur")
    assert.equal(call.env.ANTHROPIC_API_KEY, false, "en -p, une clé API passerait AVANT le plan : retirée")
    assert.match(call.stdin, /^PROMPT\n\n## X/)
  } finally { ws.cleanup() }
})

test("claude-code : sans structured_output (vieille CLI, refus), le JSON est extrait du texte ; images lues via Read puis effacées", async () => {
  const ws = makeWorkspace()
  try {
    const log = ws.path("claude.log")
    const env = { ...process.env, FAKE_CLAUDE_LOG: log, FAKE_CLAUDE_NO_STRUCTURED: "1", FAKE_CLAUDE_RESULT: 'Analyse… puis {"besoin":90,"reasons":["2012"]}' }
    const r = await completeJson({ roleOrModel: "judge", system: "PROMPT", user: "u", images: [IMG], maxTokens: 8192, schema: SCHEMA }, env)
    assert.deepEqual(r.json, { besoin: 90, reasons: ["2012"] })
    assert.equal(r.structured, false)
    const call = JSON.parse(readFileSync(log, "utf8").trim())
    assert.equal(call.argv[call.argv.indexOf("--model") + 1], "sonnet", "rôle judge → alias sonnet sur le plan")
    assert.equal(call.argv[call.argv.indexOf("--tools") + 1], "Read")
    const img = /- (\/\S+img-0\.png)/.exec(call.stdin)?.[1]
    assert.ok(img, "le chemin de la capture est dans le prompt")
    assert.equal(existsSync(img!), false, "le dossier temporaire des captures est supprimé après l'appel")
  } finally { ws.cleanup() }
})

test("claude-code : un échec du plan remonte un message clair (pas une pile)", async () => {
  await assert.rejects(claudeCodeAdapter({ ...process.env, FAKE_CLAUDE_MODE: "fail" }).complete({ system: "s", user: "u", model: "haiku", maxTokens: 10 }), /claude -p \(code 1\)/)
  await assert.rejects(claudeCodeAdapter({ ...process.env, CLAUDE_BIN: "/nonexistent/claude" }).complete({ system: "s", user: "u", model: "haiku", maxTokens: 10 }), /npm run doctor/)
})

test("bases d'URL invalides : message clair au lieu d'une pile (TypeError Invalid URL)", () => {
  assert.throws(() => anthropicAdapter("anthropic-compatible", { ANTHROPIC_BASE_URL: "127.0.0.1:11434 x", ANTHROPIC_AUTH_TOKEN: "o" }), /ANTHROPIC_BASE_URL invalide/)
  assert.throws(() => openaiCompatibleAdapter({ OPENAI_BASE_URL: "pas une url" }), /OPENAI_BASE_URL invalide/)
})
