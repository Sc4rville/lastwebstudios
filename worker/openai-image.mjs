#!/usr/bin/env node
// openai-image.mjs — génération/édition d'image via l'API Images d'OpenAI (ou toute API compatible).
// Modèle par défaut : gpt-image-2 (toujours servi au 24/10/2026 ; gpt-image-1 a été arrêté le 23/10/2026).
// La génération 2.5 (gpt-image-2.5-sunburst pour l'édition précise, -flare pour la génération rapide) existe,
// mais ses prix ne sont pas publiés sur le guide : à mesurer avant d'en faire le défaut (OPENAI_IMAGE_MODEL).
// REMPLACE le modèle Higgsfield `gpt_image_2` : moins cher, clé directe (OPENAI_API_KEY de .env).
// Higgsfield reste UNIQUEMENT pour la vidéo (kling). Voir mémoire lws-image-gen-openai-pas-higgsfield.
//
// Réglages : LWS_IMAGE=openai|none (none : sortie propre, code 3, aucun appel), OPENAI_IMAGE_BASE_URL
// (défaut https://api.openai.com/v1), OPENAI_IMAGE_MODEL (défaut gpt-image-2). Cf. packages/shared/media.mjs.
//
// Usage :
//   node worker/openai-image.mjs --prompt "..." --out out.png [--size 1536x1024] [--quality high]
//   node worker/openai-image.mjs --prompt "relight golden hour" --image in.jpg --out out.png   (édition image→image)
//   node worker/openai-image.mjs --prompt "..." --image a.jpg --image b.jpg --out out.png        (plusieurs réfs)
//
// Sorties : écrit le PNG dans --out, imprime un JSON {ok, out, model, size, bytes} sur stdout.
//
// LA CAGE (packages/shared/cage.mjs) : STOP posé, ou budget du jour qui ne couvre plus une image (LWS_IMAGE_USD,
// défaut prudent 0,25 $) → code 3 « désactivé », aucun appel. Chaque image générée est inscrite au registre
// data/logs/spend.jsonl (coût estimé, `kind: image`).
import fs from "node:fs"
import path from "node:path"
import { imageEngine, DEFAULT_IMAGE_MODEL, DEFAULT_IMAGE_BASE_URL } from "../packages/shared/media.mjs"
import { mediaGate, recordSpend } from "../packages/shared/cage.mjs"

// charge OPENAI_API_KEY depuis l'env ou .env à la racine
function loadKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
  try {
    const env = fs.readFileSync(path.resolve(process.cwd(), ".env"), "utf8")
    const m = env.match(/^OPENAI_API_KEY=(.+)$/m)
    if (m) return m[1].trim()
  } catch { /* pas de .env */ }
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
  if (!a.prompt || !a.out) { console.error(JSON.stringify({ ok: false, error: "requis : --prompt et --out" })); process.exit(1) }
  const KEY = loadKey()
  // moteur image : LWS_IMAGE=none (ou ni LWS_IMAGE ni clé) → on ne génère RIEN, code 3 = « désactivé », pas une panne
  const eng = imageEngine({ ...process.env, OPENAI_API_KEY: KEY || "" })
  if (eng.engine === "none") { console.log(JSON.stringify({ ok: false, skipped: true, reason: `moteur image désactivé (${eng.why}) : garde la vraie photo telle quelle` })); process.exit(3) }
  const gate = mediaGate("image")
  if (!gate.ok) { console.log(JSON.stringify({ ok: false, skipped: true, reason: `cage : ${gate.why} : garde la vraie photo telle quelle` })); process.exit(3) }
  const BASE = (process.env.OPENAI_IMAGE_BASE_URL || DEFAULT_IMAGE_BASE_URL).replace(/\/+$/, "")
  const custom = BASE !== DEFAULT_IMAGE_BASE_URL
  if (!KEY && !custom) { console.error(JSON.stringify({ ok: false, error: "OPENAI_API_KEY absente (.env) : pose-la, ou LWS_IMAGE=none" })); process.exit(1) }
  const auth = KEY ? { Authorization: `Bearer ${KEY}` } : {}

  let res
  if (a.images.length) {
    // édition image→image (multipart) : transforme/relight/recadre la VRAIE photo
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
    // génération pure (texte→image)
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
  if (!b64) { console.error(JSON.stringify({ ok: false, error: "pas d'image dans la réponse", raw: txt.slice(0, 200) })); process.exit(1) }
  fs.mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true })
  fs.writeFileSync(a.out, Buffer.from(b64, "base64"))
  const bytes = fs.statSync(a.out).size
  recordSpend({ kind: "image", source: "openai-image", usd: gate.costUsd, estimated: true, billing: "api", model: a.model, size: a.size, quality: a.quality })
  console.log(JSON.stringify({ ok: true, out: a.out, model: a.model, size: a.size, quality: a.quality, bytes, usage: json.usage || null }))
}

main().catch((e) => { console.error(JSON.stringify({ ok: false, error: String(e?.message || e) })); process.exit(1) })
