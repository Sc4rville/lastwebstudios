/**
 * La voie CODEX (abonnement ChatGPT via `codex exec`), contre le FAUX binaire test/fixtures/bin/codex (aucun appel
 * réel) : appel pur (bac à sable read-only, session éphémère, dossier temporaire), schéma JSON par fichier
 * (--output-schema), images jointes (-i), dernier message lu dans le fichier -o, clé API RETIRÉE de l'environnement
 * (sinon Codex facture l'API au lieu de l'abonnement), `-m` seulement quand un modèle est posé, erreurs lisibles.
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

test("codex : appel pur (exec, --ephemeral, read-only, -C temporaire), schéma par fichier, image jointe, clé API retirée, pas de -m sans modèle", async () => {
  const ws = makeWorkspace()
  try {
    const log = ws.path("codex.log")
    const a = codexAdapter(env({ FAKE_CODEX_LOG: log, FAKE_CODEX_RESULT: '{"besoin":72,"reasons":["daté"]}', OPENAI_API_KEY: "sk-test-a-ne-pas-envoyer" }))
    const r = await a.complete({ system: "PROMPT DU SKILL", user: "## URL\n\nhttp://exemple.example", images: [IMG], model: "", role: "judge", maxTokens: 1024, schema: SCHEMA })
    assert.deepEqual(r.structured, { besoin: 72, reasons: ["daté"] })
    assert.equal(r.provider, "codex")
    assert.equal(r.model, "fake-codex", "modèle annoncé par la CLI quand aucun n'est posé")
    assert.deepEqual(r.usage, { inputTokens: 12, outputTokens: 34 })
    const call = JSON.parse(readFileSync(log, "utf8").trim())
    const argv: string[] = call.argv
    assert.equal(argv[0], "exec")
    for (const f of ["--ephemeral", "--skip-git-repo-check", "--json"]) assert.ok(argv.includes(f), f)
    assert.equal(argv[argv.indexOf("-s") + 1], "read-only")
    assert.ok(argv.includes("-C") && argv.includes("-o"), "dossier de travail temporaire et fichier du dernier message")
    assert.equal(argv[argv.length - 1], "-", "le prompt arrive sur stdin")
    assert.equal(argv.includes("-m"), false, "aucun ID de modèle OpenAI deviné")
    assert.equal(call.images.length, 1, "l'image part en pièce jointe (-i)")
    assert.equal(call.hasApiKey, false, "OPENAI_API_KEY retirée : l'abonnement, pas l'API")
    assert.match(call.prompt, /^PROMPT DU SKILL\n\n## URL/)
    assert.match(call.prompt, /sortie structurée/)
  } finally { ws.cleanup() }
})

test("codex : -m quand un modèle est posé (LWS_MODEL_<RÔLE>), JSON extrait du texte sans schéma, erreur lisible si non connecté", async () => {
  const ws = makeWorkspace()
  try {
    const log = ws.path("codex.log")
    const r = await completeJson({ system: "s", user: "u", roleOrModel: "fast", maxTokens: 1000 }, env({ LWS_LLM: "codex", LWS_MODEL_FAST: "gpt-fake", FAKE_CODEX_LOG: log, FAKE_CODEX_RESULT: 'Voici :\n```json\n{"ok":true}\n```' }))
    assert.equal(r.provider.name, "codex")
    assert.equal(r.structured, false, "sans schéma : extraction du texte")
    assert.deepEqual(r.json, { ok: true })
    assert.equal(r.response.model, "gpt-fake")
    const call = JSON.parse(readFileSync(log, "utf8").trim())
    assert.equal(call.model, "gpt-fake")
    assert.equal(call.argv.includes("--output-schema"), false)
    await assert.rejects(codexAdapter(env({ FAKE_CODEX_MODE: "fail" })).complete({ system: "s", user: "u", model: "", maxTokens: 10 }), (e: unknown) => e instanceof LlmError && e.provider === "codex" && /codex login/.test(e.message))
  } finally { ws.cleanup() }
})

test("codex : sélection de la voie, modèle par rôle (vide = défaut CLI), état du login (abonnement / clé API / absent)", () => {
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
