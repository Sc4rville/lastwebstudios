#!/usr/bin/env node
// openai-image.mjs — image generation/editing through OpenAI's Images API (or any compatible API).
// Default model: gpt-image-2 (still served on 10/24/2026; gpt-image-1 was shut down on 10/23/2026).
// The 2.5 generation (gpt-image-2.5-sunburst for precise editing, -flare for fast generation) exists,
// but its prices are not published in the guide: measure them before making it the default (OPENAI_IMAGE_MODEL).
// REPLACES the Higgsfield `gpt_image_2` model: cheaper, a direct key (OPENAI_API_KEY from .env).
// Higgsfield stays ONLY for video (kling). See the memory note lws-image-gen-openai-pas-higgsfield.
//
// Settings: LWS_IMAGE=openai|none (none: clean exit, code 3, no call), OPENAI_IMAGE_BASE_URL
// (default https://api.openai.com/v1), OPENAI_IMAGE_MODEL (default gpt-image-2). See packages/shared/media.mjs.
//
// Usage :
//   node worker/openai-image.mjs --prompt "..." --out out.png [--size 1536x1024] [--quality high]
//   node worker/openai-image.mjs --prompt "relight golden hour" --image in.jpg --out out.png   (image→image editing)
//   node worker/openai-image.mjs --prompt "..." --image a.jpg --image b.jpg --out out.png        (several references)
//
// Output: writes the PNG to --out, prints a JSON {ok, out, model, size, bytes} on stdout.
//
// THE CAGE (packages/shared/cage.mjs): STOP set, or today's budget no longer covers an image (LWS_IMAGE_USD,
// cautious default $0.25) → code 3 "disabled", no call. Each generated image is recorded in the
// data/logs/spend.jsonl log (estimated cost, `kind: image`).
import fs from "node:fs"
import path from "node:path"
import { imageEngine, DEFAULT_IMAGE_MODEL, DEFAULT_IMAGE_BASE_URL } from "../packages/shared/media.mjs"
import { mediaGate, recordSpend } from "../packages/shared/cage.mjs"

// loads OPENAI_API_KEY from the env or the .env at the root
function loadKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
  try {
    const env = fs.readFileSync(path.resolve(process.cwd(), ".env"), "utf8")
    const m = env.match(/^OPENAI_API_KEY=(.+)$/m)
    if (m) return m[1].trim()
  } catch { /* no .env */ }
  return null
}

function parseArgs(argv) {
  const a = { images: [], size: "1536x1024", quality: "high", out: null, prompt: null, model: process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL }
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i]
    if (k === "--prompt") a.prompt = argv[++i]
    else if (k === "--image") a.images.push(argv[++i])
    else if (k === "--out") a.out = argv[++i]
    else if (k === "--size") a.size = argv[++i]
    else if (k === "--quality") a.quality = argv[++i]
    else if (k === "--model") a.model = argv[++i]
  }
  return a
}

async function main() {
  const a = parseArgs(process.argv)
  if (!a.prompt || !a.out) { console.error(JSON.stringify({ ok: false, error: "required: --prompt and --out" })); process.exit(1) }
  const KEY = loadKey()
  // image engine: LWS_IMAGE=none (or neither LWS_IMAGE nor a key) → generate NOTHING, code 3 = "disabled", not a failure
  const eng = imageEngine({ ...process.env, OPENAI_API_KEY: KEY || "" })
  if (eng.engine === "none") { console.log(JSON.stringify({ ok: false, skipped: true, reason: `image engine disabled (${eng.why}): keep the real photo as it is` })); process.exit(3) }
  const gate = mediaGate("image")
  if (!gate.ok) { console.log(JSON.stringify({ ok: false, skipped: true, reason: `cage: ${gate.why}: keep the real photo as it is` })); process.exit(3) }
  const BASE = (process.env.OPENAI_IMAGE_BASE_URL || DEFAULT_IMAGE_BASE_URL).replace(/\/+$/, "")
  const custom = BASE !== DEFAULT_IMAGE_BASE_URL
  if (!KEY && !custom) { console.error(JSON.stringify({ ok: false, error: "OPENAI_API_KEY missing (.env): set it, or LWS_IMAGE=none" })); process.exit(1) }
  const auth = KEY ? { Authorization: `Bearer ${KEY}` } : {}

  let res
  if (a.images.length) {
    // image→image editing (multipart): transforms/relights/crops the REAL photo
    const form = new FormData()
    form.append("model", a.model)
    form.append("prompt", a.prompt)
    form.append("size", a.size)
    form.append("quality", a.quality)
    for (const img of a.images) {
      const buf = fs.readFileSync(img)
      const type = /\.png$/i.test(img) ? "image/png" : /\.webp$/i.test(img) ? "image/webp" : "image/jpeg"
      form.append("image[]", new Blob([buf], { type }), path.basename(img))
    }
    res = await fetch(`${BASE}/images/edits`, { method: "POST", headers: auth, body: form })
  } else {
    // pure generation (text→image)
    res = await fetch(`${BASE}/images/generations`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ model: a.model, prompt: a.prompt, size: a.size, quality: a.quality, n: 1 }),
    })
  }
  const txt = await res.text()
  if (!res.ok) { console.error(JSON.stringify({ ok: false, status: res.status, error: txt.slice(0, 400) })); process.exit(1) }
  const json = JSON.parse(txt)
  const b64 = json?.data?.[0]?.b64_json
  if (!b64) { console.error(JSON.stringify({ ok: false, error: "no image in the response", raw: txt.slice(0, 200) })); process.exit(1) }
  fs.mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true })
  fs.writeFileSync(a.out, Buffer.from(b64, "base64"))
  const bytes = fs.statSync(a.out).size
  recordSpend({ kind: "image", source: "openai-image", usd: gate.costUsd, estimated: true, billing: "api", model: a.model, size: a.size, quality: a.quality })
  console.log(JSON.stringify({ ok: true, out: a.out, model: a.model, size: a.size, quality: a.quality, bytes, usage: json.usage || null }))
}

main().catch((e) => { console.error(JSON.stringify({ ok: false, error: String(e?.message || e) })); process.exit(1) })
