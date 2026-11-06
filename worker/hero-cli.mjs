#!/usr/bin/env node
/**
 * hero-cli.mjs — génère un HERO VIDÉO cinématique via la CLI Higgsfield (headless, crédits Ultra), DÉTERMINISTE
 * et RAPIDE (~4 min, kling3_0_turbo en DUR). Remplace le best-of-N de l'agent (qui prenait ~28 min) : un seul
 * appel, turbo, pas de jugement d'images. Anime la VRAIE photo boostée du prospect quand elle existe
 * (image→vidéo = authentique + mouvement), sinon retombe sur texte→vidéo (générique mais premium). Idempotent.
 *
 *   node worker/hero-cli.mjs <id> [industrie] [--force]
 *
 * Pré-requis : `higgsfield auth login` fait une fois sur la machine (token Ultra).
 * LWS_VIDEO=none (ou ni clé ni CLI Higgsfield) : sortie propre, code 3 (« désactivé »), aucun appel ni crédit.
 * LA CAGE (packages/shared/cage.mjs) : STOP posé, ou budget du jour qui ne couvre plus une vidéo (LWS_VIDEO_USD,
 * défaut prudent 1,50 $) → code 3 aussi. Chaque vidéo générée est inscrite au registre data/logs/spend.jsonl.
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { videoEngine } from "../packages/shared/media.mjs"
import { mediaGate, recordSpend } from "../packages/shared/cage.mjs"

const [, , id, industryArg] = process.argv
const force = process.argv.includes("--force")
if (!id) { console.error("usage: node worker/hero-cli.mjs <id> [industrie] [--force]"); process.exit(1) }
const eng = videoEngine()
if (eng.engine === "none") { console.log(`⏭ vidéo de héros désactivée (${eng.why}) : le héros reste la plus belle vraie photo`); process.exit(3) }

// kling3_0_turbo EN DUR (jamais le normal, 2× plus lent). Seedance illimité possible via HF_VIDEO_MODEL.
const VIDEO_MODEL = process.env.HF_VIDEO_MODEL || "kling3_0_turbo"

const dir = join("data", "assets", id)
const heroPath = join(dir, "hero.mp4")
if (existsSync(heroPath) && !force) { console.log(`✓ hero déjà présent (${heroPath}) — skip`); process.exit(0) }
const gate = mediaGate("video")
if (!gate.ok) { console.log(`⏭ vidéo de héros non générée (cage : ${gate.why}) : le héros reste la plus belle vraie photo`); process.exit(3) }
mkdirSync(dir, { recursive: true })

// ── trouve la MEILLEURE photo boostée pour servir de frame de départ (image→vidéo = leur vraie réalisation) ──
// priorité : un héros 16:9 déjà préparé > une photo upscalée (2k/4k) > la plus grande image du dossier.
function bestStartImage() {
  let files = []
  try { files = readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && !/poster|frame|avant|logo|_/i.test(f)) } catch { return null }
  if (!files.length) return null
  const score = (f) => {
    let s = 0
    if (/hero.*16x9|16x9.*hero/i.test(f)) s += 1000
    if (/borderless|plein|wide|paysage/i.test(f)) s += 400
    if (/4k/i.test(f)) s += 300; else if (/2k/i.test(f)) s += 200
    try { s += Math.min(150, Math.round(statSync(join(dir, f)).size / 100000)) } catch { /* */ }
    return s
  }
  const best = files.sort((a, b) => score(b) - score(a))[0]
  return best ? join(dir, best) : null
}

// ── prompt de MOUVEMENT explicite par métier (le piège = le clip plat → on impose une caméra qui bouge) ──
const A = (industryArg || "").toLowerCase()
const MOVE = "slow cinematic dolly-in, gentle camera push toward the subject, golden-hour light, shallow depth of field, subtle lens flare, premium real-estate film look, NO text, NO logos"
const PROMPTS = [
  [/piscin|pool/, `Slow cinematic dolly-in over a luxury backyard swimming pool, crystal-clear turquoise water with gently dancing sun caustics and soft ripples, elegant stone coping, ${MOVE}`],
  [/recept|lieu|salle|domaine|chateau|mariage|wedding/, `Sweeping cinematic push through an elegant French wedding venue at golden hour, warm string lights glowing, manicured gardens drifting past, ${MOVE}`],
  [/cuisin|kitchen/, `Slow cinematic dolly across a high-end designer kitchen, warm light raking over natural wood and stone, soft reflections moving on premium finishes, ${MOVE}`],
  [/couvr|toit|toiture|roof|charpent/, `Cinematic aerial glide over a beautifully renovated rooftop and slate tiles at golden hour, craftsmanship detail catching the light, ${MOVE}`],
  [/metal|ferronn|forge|acier/, `Cinematic slow push toward glowing forged metal and drifting sparks in an artisan workshop, dramatic warm light, ${MOVE}`],
  [/paysag|jardin|garden/, `Slow cinematic pan across a lush landscaped garden at golden hour, sunlight filtering through swaying foliage, ${MOVE}`],
]
const prompt = (PROMPTS.find(([re]) => re.test(A)) || [, `Slow cinematic establishing push over a premium French artisan business at warm golden hour, elegant atmosphere, ${MOVE}`])[1]

const hf = (args) => execFileSync("higgsfield", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 })

const startImg = bestStartImage()
const mode = startImg ? `image→vidéo (anime ${startImg.split("/").pop()})` : "texte→vidéo (générique)"
console.log(`🎬 hero ${id} (${A || "générique"}) — ${VIDEO_MODEL} · ${mode}…`)

let url = ""
function generate(withImage) {
  const args = ["generate", "create", VIDEO_MODEL, "--prompt", prompt, "--aspect_ratio", "16:9", "--wait", "--wait-timeout", "8m", "--json"]
  if (withImage && startImg) args.push("--image", startImg)
  const out = hf(args)
  const arr = JSON.parse(out.slice(out.indexOf("[")))
  const job = Array.isArray(arr) ? arr[0] : arr
  return job?.result_url || job?.results?.raw || ""
}
try {
  url = generate(true)
  if (!url) throw new Error("pas de result_url")
} catch (e) {
  // image→vidéo a raté (CLI ne supporte pas --image, ou job KO) → fallback texte→vidéo (jamais bloquant)
  console.warn(`⚠ image→vidéo KO (${(e.message || e).toString().slice(0, 120)}) → fallback texte→vidéo`)
  try { url = generate(false) } catch (e2) { console.error("✗ génération KO:", (e2.message || e2).toString().slice(0, 200)); process.exit(2) }
  if (!url) { console.error("✗ pas de result_url"); process.exit(2) }
}

const res = await fetch(url)
if (!res.ok) { console.error("✗ download KO:", res.status); process.exit(3) }
writeFileSync(heroPath, Buffer.from(await res.arrayBuffer()))
recordSpend({ kind: "video", source: "higgsfield", usd: gate.costUsd, estimated: true, billing: "credits", model: VIDEO_MODEL, prospect: id })
console.log(`✓ ${heroPath} (${statSync(heroPath).size} octets)`)

// poster : 1re frame via ffmpeg (sinon le composer retombe sur une photo)
try {
  execFileSync("ffmpeg", ["-y", "-i", heroPath, "-vframes", "1", "-q:v", "3", join(dir, "hero-poster.jpg")], { stdio: "ignore" })
  console.log(`✓ poster hero-poster.jpg`)
} catch { /* ffmpeg absent → non bloquant */ }

try { writeFileSync(join(dir, "_cinematics.json"), JSON.stringify({ hero: "hero.mp4", source: "higgsfield-cli", model: VIDEO_MODEL, mode: startImg ? "image-to-video" : "text-to-video", start_image: startImg ? startImg.split("/").pop() : null, prompt }, null, 2)) } catch { /* */ }
process.exit(0)
