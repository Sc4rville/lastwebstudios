/**
 * G8 (acceptance check): the `structuration` skill returns a VALID ProspectSheet through every way
 * (claude-code, anthropic, anthropic-compatible, openai-compatible, codex), end to end through the real CLI
 * (`npm run structure`), against fake local servers. And G7: the visual gate no longer truncates its JSON
 * (max_tokens raised) and sends its screenshots as base64 images to the judge role.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { makeWorkspace, FIXTURES, type Workspace } from "../helpers/workspace.ts"
import { npmRun } from "../helpers/proc.ts"
import { fakeMessages, fakeChat, STRUCTURATION_JSON, type FakeServer } from "../helpers/llm-servers.ts"
import { serveDir } from "../helpers/server.ts"
import { GATE_MAX_TOKENS } from "../../leadengine/2_scoring/scripts/visual-gate.ts"

const ID = "orvane-piscines-valmont-sur-lys"
const SCHEMA = JSON.parse(readFileSync(".claude/skills/structuration/schema.json", "utf8"))
const RAW = {
  id: ID, url: "http://127.0.0.1:1/", title: "Orvane Piscines - Accueil", screenshot: `data/assets/${ID}/avant.png`, photos: [`data/assets/${ID}/bassin-1.svg`, `data/assets/${ID}/bassin-2.svg`],
  text: "Accueil | Nos réalisations | Contact\nORVANE PISCINES\nVotre piscine, notre savoir-faire depuis 1998\nConstruction de piscines - Rénovation de bassins - Spas et abris - Entretien saisonnier\nTél : 03 53 01 24 68 - contact@orvane-piscines.example\nVallée de la Lys\n© 2016 Orvane Piscines - Mentions légales",
}

/** The ProspectSheet contract (packages/shared/prospect.ts) on the sheet the CLI wrote. */
function assertProspectSheet(f: any) {
  assert.equal(f.id, ID)
  assert.equal(f.industry, "pisciniste")
  assert.equal(typeof f.identity?.name, "string")
  assert.equal(f.identity.city, "Valmont-sur-Lys")
  assert.equal(f.identity.phone, "03 53 01 24 68")
  assert.ok(Array.isArray(f.content?.services) && f.content.services.length >= 3 && f.content.services.every((s: unknown) => typeof s === "string"))
  assert.equal(typeof f.content.tagline, "string")
  assert.ok(Array.isArray(f.assets?.photos))
  assert.equal(f.existing?.url, RAW.url)
  assert.equal(typeof f.score?.value, "number")
  assert.equal(f.structureIssue, undefined, "structuring judged clean")
}

let ws: Workspace
before(() => { ws = makeWorkspace(); ws.write(`data/raw/${ID}.json`, JSON.stringify(RAW)) })
after(() => ws?.cleanup())

async function structure(env: NodeJS.ProcessEnv) {
  ws.write(`data/prospects/${ID}.json`, "{}")
  const r = await npmRun(ws.dir, "structure", [ID, "pisciniste", "Valmont-sur-Lys"], { env, timeoutMs: 60_000 })
  assert.equal(r.code, 0, r.out)
  return ws.json(`data/prospects/${ID}.json`)
}

test("way 1 · claude-code (default, plan): valid sheet, structured output --json-schema with the skill's schema", async () => {
  const log = ws.path("claude.log")
  assertProspectSheet(await structure({ FAKE_CLAUDE_LOG: log }))
  const call = JSON.parse(readFileSync(log, "utf8").trim().split("\n").pop()!)
  assert.deepEqual(JSON.parse(call.argv[call.argv.indexOf("--json-schema") + 1]), SCHEMA)
  assert.equal(call.argv[call.argv.indexOf("--model") + 1], "haiku", "fast role")
})

test("way 2 · anthropic (SDK 1.x): valid sheet, output_config.format = the skill's schema, Haiku 5.5", async () => {
  let s: FakeServer | null = null
  try {
    s = await fakeMessages({ reply: () => ({ text: STRUCTURATION_JSON }) })
    assertProspectSheet(await structure({ LWS_LLM: "anthropic", ANTHROPIC_API_KEY: "sk-ant-test", ANTHROPIC_BASE_URL: s.url }))
    const c = s.calls.find((x) => x.path === "/v1/messages")!
    assert.equal(c.body.model, "claude-haiku-5-5")
    assert.deepEqual(c.body.output_config.format, { type: "json_schema", schema: SCHEMA })
    assert.match(c.body.system[0].text, /# Structuring/)
    assert.match(c.body.messages[0].content[0].text, /## TEXTE BRUT\n\nAccueil/)
  } finally { await s?.close() }
})

test("way 3 · anthropic-compatible (Ollama, LiteLLM): valid sheet, JSON extracted from the text, local model", async () => {
  let s: FakeServer | null = null
  try {
    s = await fakeMessages({ reply: () => ({ text: "Voici la fiche :\n```json\n" + STRUCTURATION_JSON + "\n```" }) })
    assertProspectSheet(await structure({ LWS_LLM: "anthropic-compatible", ANTHROPIC_BASE_URL: s.url, ANTHROPIC_AUTH_TOKEN: "ollama", LWS_MODEL: "llama3.2:1b" }))
    const c = s.calls.find((x) => x.path === "/v1/messages")!
    assert.equal(c.body.model, "llama3.2:1b")
    assert.equal(c.headers.authorization, "Bearer ollama")
  } finally { await s?.close() }
})

test("way 4 · openai-compatible (OpenRouter, Groq, vLLM…): valid sheet, response_format = the skill's schema", async () => {
  let s: FakeServer | null = null
  try {
    s = await fakeChat({ reply: () => ({ text: STRUCTURATION_JSON }) })
    assertProspectSheet(await structure({ LWS_LLM: "openai-compatible", OPENAI_BASE_URL: s.url + "/v1", OPENAI_API_KEY: "sk-or-test", LWS_MODEL_FAST: "fake-small" }))
    const c = s.calls.find((x) => x.path === "/v1/chat/completions")!
    assert.equal(c.body.model, "fake-small")
    assert.deepEqual(c.body.response_format.json_schema.schema, SCHEMA)
    assert.equal(c.body.messages[0].role, "system")
  } finally { await s?.close() }
})

test("way 5 · codex (ChatGPT subscription, `codex exec`): valid sheet, --output-schema = the skill's schema, no -m guessed", async () => {
  const log = ws.path("codex.log")
  assertProspectSheet(await structure({ LWS_LLM: "codex", FAKE_CODEX_LOG: log }))
  const call = JSON.parse(readFileSync(log, "utf8").trim().split("\n").pop()!)
  assert.deepEqual(call.schema, SCHEMA, "--output-schema = the skill's schema, by file")
  assert.equal(call.model, null, "no OpenAI model ID guessed: the CLI's default")
})

test("visual gate: screenshots as base64 images, judge role (Sonnet 5.5), max_tokens raised (no more truncated JSON)", { timeout: 120_000 }, async () => {
  assert.ok(GATE_MAX_TOKENS >= 4096)
  const site = await serveDir(join(FIXTURES, "sites", "orvane-piscines"))
  let s: FakeServer | null = null
  try {
    s = await fakeMessages({ reply: () => ({ text: '{"besoin":77,"reasons":["design des années 2010","typographie système"]}', thinking: true }) })
    const r = await npmRun(ws.dir, "gate", [ID, `${site.url}/`], { env: { LWS_LLM: "anthropic", ANTHROPIC_API_KEY: "sk-ant-test", ANTHROPIC_BASE_URL: s.url }, timeoutMs: 110_000 })
    assert.equal(r.code, 0, r.out)
    assert.match(r.stdout, /visual need orvane-piscines-valmont-sur-lys: 77\/100/)
    const c = s.calls.find((x) => x.path === "/v1/messages")!
    assert.equal(c.body.model, "claude-sonnet-5-5")
    assert.equal(c.body.max_tokens, GATE_MAX_TOKENS)
    const imgs = c.body.messages[0].content.filter((b: any) => b.type === "image")
    assert.ok(imgs.length >= 1)
    assert.equal(imgs[0].source.type, "base64")
    assert.equal(imgs[0].source.media_type, "image/png")
    assert.deepEqual(c.body.output_config.format.schema, JSON.parse(readFileSync(".claude/skills/visual-scoring-gate/schema.json", "utf8")))
  } finally { await s?.close(); await site.close() }
})
