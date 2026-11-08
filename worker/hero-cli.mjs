#!/usr/bin/env node
/**
 * hero-cli.mjs — generates a cinematic VIDEO HERO through the Higgsfield CLI (headless, Ultra credits), DETERMINISTIC
 * and FAST (~4 min, kling3_0_turbo HARD-CODED). Replaces the agent's best-of-N (which took ~28 min): a single
 * call, turbo, no image judging. Animates the prospect's REAL boosted photo when there is one
 * (image→video = authentic + motion), otherwise falls back on text→video (generic but premium). Idempotent.
 *
 *   node worker/hero-cli.mjs <id> [industry] [--force]
 *
 * Prerequisite: `higgsfield auth login` done once on the machine (Ultra token).
 * LWS_VIDEO=none (or neither a key nor the Higgsfield CLI): clean exit, code 3 ("disabled"), no call and no credit.
 * THE CAGE (packages/shared/cage.mjs): STOP set, or today's budget no longer covers a video (LWS_VIDEO_USD,
 * cautious default $1.50) → code 3 too. Each generated video is recorded in the data/logs/spend.jsonl log.
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { videoEngine } from "../packages/shared/media.mjs"
import { mediaGate, recordSpend } from "../packages/shared/cage.mjs"

const [, , id, industryArg] = process.argv
const force = process.argv.includes("--force")
if (!id) { console.error("usage: node worker/hero-cli.mjs <id> [industry] [--force]"); process.exit(1) }
const eng = videoEngine()
if (eng.engine === "none") { console.log(`⏭ hero video disabled (${eng.why}): the hero stays the most beautiful real photo`); process.exit(3) }

// kling3_0_turbo HARD-CODED (never the normal one, 2× slower). Unlimited Seedance possible through HF_VIDEO_MODEL.
const VIDEO_MODEL = process.env.HF_VIDEO_MODEL || "kling3_0_turbo"

const dir = join("data", "assets", id)
const heroPath = join(dir, "hero.mp4")
if (existsSync(heroPath) && !force) { console.log(`✓ hero already there (${heroPath}) — skip`); process.exit(0) }
const gate = mediaGate("video")
if (!gate.ok) { console.log(`⏭ hero video not generated (cage: ${gate.why}): the hero stays the most beautiful real photo`); process.exit(3) }
mkdirSync(dir, { recursive: true })

// ── finds the BEST boosted photo to serve as the start frame (image→video = their real work) ──
// priority: a 16:9 hero already prepared > an upscaled photo (2k/4k) > the largest image in the folder.
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

// ── an explicit MOTION prompt per trade (the trap = a flat clip → a moving camera is imposed) ──
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
const mode = startImg ? `image→video (animates ${startImg.split("/").pop()})` : "text→video (generic)"
console.log(`🎬 hero ${id} (${A || "generic"}) — ${VIDEO_MODEL} · ${mode}…`)

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
  if (!url) throw new Error("no result_url")
} catch (e) {
  // image→video failed (the CLI does not support --image, or the job failed) → fall back on text→video (never blocking)
  console.warn(`⚠ image→video failed (${(e.message || e).toString().slice(0, 120)}) → falling back on text→video`)
  try { url = generate(false) } catch (e2) { console.error("✗ generation failed:", (e2.message || e2).toString().slice(0, 200)); process.exit(2) }
  if (!url) { console.error("✗ no result_url"); process.exit(2) }
}

const res = await fetch(url)
if (!res.ok) { console.error("✗ download failed:", res.status); process.exit(3) }
writeFileSync(heroPath, Buffer.from(await res.arrayBuffer()))
recordSpend({ kind: "video", source: "higgsfield", usd: gate.costUsd, estimated: true, billing: "credits", model: VIDEO_MODEL, prospect: id })
console.log(`✓ ${heroPath} (${statSync(heroPath).size} bytes)`)

// poster: first frame through ffmpeg (otherwise the composer falls back on a photo)
try {
  execFileSync("ffmpeg", ["-y", "-i", heroPath, "-vframes", "1", "-q:v", "3", join(dir, "hero-poster.jpg")], { stdio: "ignore" })
  console.log(`✓ poster hero-poster.jpg`)
} catch { /* no ffmpeg → not blocking */ }

try { writeFileSync(join(dir, "_cinematics.json"), JSON.stringify({ hero: "hero.mp4", source: "higgsfield-cli", model: VIDEO_MODEL, mode: startImg ? "image-to-video" : "text-to-video", start_image: startImg ? startImg.split("/").pop() : null, prompt }, null, 2)) } catch { /* */ }
process.exit(0)
