/**
 * The CODEX way (ChatGPT subscription through `codex exec`), against the FAKE binary test/fixtures/bin/codex (no real
 * call): a pure call (read-only sandbox, ephemeral session, temporary folder), JSON schema by file
 * (--output-schema), attached images (-i), last message read from the -o file, API key REMOVED from the environment
 * (otherwise Codex bills the API instead of the subscription), `-m` only when a model is set, readable errors.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { codexAdapter, usageFromEvents, modelFromEvents } from "../../packages/llm/adapters/codex.ts"
import { codexAuth } from "../../packages/llm/codex-status.ts"
import { completeJson, LlmError, resolveModel, selectProvider } from "../../packages/llm/index.ts"
import { makeWorkspace, FIXTURES } from "../helpers/workspace.ts"

const BIN = join(FIXTURES, "bin", "codex")
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64")
const IMG = { path: "x.png", mediaType: "image/png", data: PNG.toString("base64") }
const SCHEMA = { type: "object", properties: { besoin: { type: "number" }, reasons: { type: "array", items: { type: "string" } } }, required: ["reasons"], additionalProperties: false }
const env = (extra: Record<string, string>) => ({ ...process.env, LWS_CODEX_BIN: BIN, ...extra })

test("codex: pure call (exec, --ephemeral, read-only, temporary -C), schema by file, attached image, API key removed, no -m without a model", async () => {
  const ws = makeWorkspace()
  try {
    const log = ws.path("codex.log")
    const a = codexAdapter(env({ FAKE_CODEX_LOG: log, FAKE_CODEX_RESULT: '{"besoin":72,"reasons":["daté"]}', OPENAI_API_KEY: "sk-test-a-ne-pas-envoyer" }))
    const r = await a.complete({ system: "PROMPT DU SKILL", user: "## URL\n\nhttp://exemple.example", images: [IMG], model: "", role: "judge", maxTokens: 1024, schema: SCHEMA })
    assert.deepEqual(r.structured, { besoin: 72, reasons: ["daté"] })
    assert.equal(r.provider, "codex")
    assert.equal(r.model, "fake-codex", "the model the CLI announces when none is set")
    assert.deepEqual(r.usage, { inputTokens: 12, outputTokens: 34 })
    const call = JSON.parse(readFileSync(log, "utf8").trim())
    const argv: string[] = call.argv
    assert.equal(argv[0], "exec")
    for (const f of ["--ephemeral", "--skip-git-repo-check", "--json"]) assert.ok(argv.includes(f), f)
    assert.equal(argv[argv.indexOf("-s") + 1], "read-only")
    assert.ok(argv.includes("-C") && argv.includes("-o"), "temporary working folder and last-message file")
    assert.equal(argv[argv.length - 1], "-", "the prompt arrives on stdin")
    assert.equal(argv.includes("-m"), false, "no OpenAI model ID guessed")
    assert.equal(call.images.length, 1, "the image goes as an attachment (-i)")
    assert.equal(call.hasApiKey, false, "OPENAI_API_KEY removed: the subscription, not the API")
    assert.match(call.prompt, /^PROMPT DU SKILL\n\n## URL/)
    assert.match(call.prompt, /structured output/)
  } finally { ws.cleanup() }
})

test("codex: -m when a model is set (LWS_MODEL_<ROLE>), JSON extracted from the text without a schema, a readable error when signed out", async () => {
  const ws = makeWorkspace()
  try {
    const log = ws.path("codex.log")
    const r = await completeJson({ system: "s", user: "u", roleOrModel: "fast", maxTokens: 1000 }, env({ LWS_LLM: "codex", LWS_MODEL_FAST: "gpt-fake", FAKE_CODEX_LOG: log, FAKE_CODEX_RESULT: 'Voici :\n```json\n{"ok":true}\n```' }))
    assert.equal(r.provider.name, "codex")
    assert.equal(r.structured, false, "no schema: extraction from the text")
    assert.deepEqual(r.json, { ok: true })
    assert.equal(r.response.model, "gpt-fake")
    const call = JSON.parse(readFileSync(log, "utf8").trim())
    assert.equal(call.model, "gpt-fake")
    assert.equal(call.argv.includes("--output-schema"), false)
    await assert.rejects(codexAdapter(env({ FAKE_CODEX_MODE: "fail" })).complete({ system: "s", user: "u", model: "", maxTokens: 10 }), (e: unknown) => e instanceof LlmError && e.provider === "codex" && /codex login/.test(e.message))
  } finally { ws.cleanup() }
})

test("codex: way selection, model per role (empty = CLI default), login state (subscription / API key / none)", () => {
  assert.equal(selectProvider({ LWS_LLM: "codex" }).name, "codex")
  assert.equal(resolveModel("smart", "codex", {}).model, "")
  assert.equal(resolveModel("smart", "codex", { LWS_MODEL: "gpt-x" }).model, "gpt-x")
  assert.equal(codexAuth(BIN, { ...process.env }).source, "chatgpt")
  assert.equal(codexAuth(BIN, { ...process.env, FAKE_CODEX_AUTH: "api" }).source, "api-key")
  assert.equal(codexAuth(BIN, { ...process.env, FAKE_CODEX_AUTH: "none" }).loggedIn, false)
  assert.equal(codexAuth(join(FIXTURES, "bin", "absent-codex"), { ...process.env }).installed, false)
  assert.deepEqual(usageFromEvents('{"type":"turn.completed","usage":{"input_tokens":3,"output_tokens":4}}\nbruit\n'), { inputTokens: 3, outputTokens: 4 })
  assert.equal(modelFromEvents('{"type":"thread.started","model":"m1"}\n'), "m1")
})
