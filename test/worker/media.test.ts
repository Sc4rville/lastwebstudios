/**
 * G8 (optional media): LWS_IMAGE=openai|none + OPENAI_IMAGE_BASE_URL, LWS_VIDEO=higgsfield|none. A switched-off
 * engine exits cleanly (code 3, no call); a compatible base URL receives the Images request.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { imageEngine, videoEngine } from "../../packages/shared/media.mjs"
import { run } from "../helpers/proc.ts"
import { makeWorkspace } from "../helpers/workspace.ts"
import { createServer } from "node:http"

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

test("media engines: defaults from the keys, explicit choices, unknown value = none", () => {
  assert.equal(imageEngine({}).engine, "none")
  assert.equal(imageEngine({ OPENAI_API_KEY: "sk" }).engine, "openai")
  assert.equal(imageEngine({ OPENAI_API_KEY: "sk", LWS_IMAGE: "none" }).engine, "none")
  assert.equal(imageEngine({ LWS_IMAGE: "openai" }).engine, "openai")
  assert.equal(imageEngine({ LWS_IMAGE: "dalle" }).engine, "none")
  assert.equal(videoEngine({ PATH: "" }).engine, "none")
  assert.equal(videoEngine({ HIGGSFIELD_API_KEY: "hf", PATH: "" }).engine, "higgsfield")
  assert.equal(videoEngine({ HIGGSFIELD_API_KEY: "hf", LWS_VIDEO: "none" }).engine, "none")
})

test("openai-image.mjs: LWS_IMAGE=none (or neither key nor engine) → code 3, no call", async () => {
  const ws = makeWorkspace()
  try {
    const a = await run(process.execPath, ["worker/openai-image.mjs", "--prompt", "relight", "--out", "x.png"], { cwd: ws.dir, env: { LWS_IMAGE: "none", OPENAI_API_KEY: "sk-test" } })
    assert.equal(a.code, 3, a.out)
    assert.match(a.stdout, /"skipped":true/)
    const b = await run(process.execPath, ["worker/openai-image.mjs", "--prompt", "relight", "--out", "x.png"], { cwd: ws.dir })
    assert.equal(b.code, 3, b.out)
    assert.equal(ws.exists("x.png"), false)
  } finally { ws.cleanup() }
})

test("openai-image.mjs: OPENAI_IMAGE_BASE_URL receives the generation (default model gpt-image-2), PNG written", async () => {
  const hits: { path: string; auth?: string; body: any }[] = []
  const server = createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c
    hits.push({ path: req.url || "", auth: req.headers.authorization, body: JSON.parse(raw || "{}") })
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ data: [{ b64_json: PNG_B64 }], usage: { total_tokens: 1 } }))
  })
  const port = await new Promise<number>((ok) => server.listen(0, "127.0.0.1", () => ok((server.address() as any).port)))
  const ws = makeWorkspace()
  try {
    const r = await run(process.execPath, ["worker/openai-image.mjs", "--prompt", "abstract textured background", "--out", "out/fond.png", "--size", "1024x1024"], {
      cwd: ws.dir, env: { OPENAI_API_KEY: "sk-test", OPENAI_IMAGE_BASE_URL: `http://127.0.0.1:${port}/v1` },
    })
    assert.equal(r.code, 0, r.out)
    assert.equal(hits[0].path, "/v1/images/generations")
    assert.equal(hits[0].auth, "Bearer sk-test")
    assert.equal(hits[0].body.model, "gpt-image-2")
    assert.ok(existsSync(ws.path("out/fond.png")))
    assert.deepEqual(readFileSync(ws.path("out/fond.png")), Buffer.from(PNG_B64, "base64"))
    assert.match(r.stdout, /"ok":true/)
  } finally { ws.cleanup(); server.close() }
})

test("hero-cli.mjs : LWS_VIDEO=none → code 3, aucun appel Higgsfield, aucun fichier", async () => {
  const ws = makeWorkspace()
  try {
    const r = await run(process.execPath, ["worker/hero-cli.mjs", "orvane-piscines-valmont-sur-lys", "pisciniste"], { cwd: ws.dir, env: { LWS_VIDEO: "none" } })
    assert.equal(r.code, 3, r.out)
    assert.match(r.stdout, /hero video disabled/)
    assert.equal(ws.exists("data/assets/orvane-piscines-valmont-sur-lys/hero.mp4"), false)
  } finally { ws.cleanup() }
})
