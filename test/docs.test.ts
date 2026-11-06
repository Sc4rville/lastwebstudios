/**
 * G15 + filets statiques G6 : la doc dit vrai (compte des skills, cap du beauty-gate, funnel honnête, radar),
 * l'image Docker n'embarque ni secrets ni matière client, aucun script n'arrête les stations des autres.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { INDUSTRIES } from "../leadengine/1_scraping/scripts/industries.ts"

const read = (p: string) => readFileSync(p, "utf8")
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))

test("docs/SKILLS.md donne le vrai compte : 25 skills + 5 modules prompt.md + 1 interne = 31 dossiers", () => {
  const dirs = readdirSync(".claude/skills", { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  const skills = dirs.filter((d) => existsSync(join(".claude/skills", d, "SKILL.md")) && read(join(".claude/skills", d, "SKILL.md")).startsWith("---"))
  const prompts = dirs.filter((d) => !existsSync(join(".claude/skills", d, "SKILL.md")) && existsSync(join(".claude/skills", d, "prompt.md")))
  const internal = dirs.filter((d) => !skills.includes(d) && !prompts.includes(d))
  const doc = read("docs/SKILLS.md")
  assert.match(doc, new RegExp(`\\*\\*${dirs.length} dossiers\\*\\*`))
  assert.match(doc, new RegExp(`\\*\\*${skills.length} skills Claude Code\\*\\*`))
  assert.match(doc, new RegExp(`\\*\\*${prompts.length} modules de prompt\\*\\*`))
  assert.match(doc, new RegExp(`\\*\\*${internal.length} skill interne\\*\\*`))
  for (const p of prompts) assert.match(doc, new RegExp("`" + p + "`"), `module ${p} absent de SKILLS.md`)
  for (const s of skills) assert.match(doc, new RegExp("`/?" + s + "`"), `skill ${s} absent de SKILLS.md`)
  assert.match(doc, /`generate-savior`/)
})

test("plafond du beauty-gate identique dans le code et dans toute la doc", () => {
  const code = read("architecture/orchestration/compose-batch.workflow.js")
  const cap = Number(/const GATE_MAX_LOOPS = (\d+)/.exec(code)?.[1])
  assert.ok(cap >= 1)
  assert.match(code, /for \(let k = 0; k < GATE_MAX_LOOPS; k\+\+\)/)
  // .claude/skills/lws est un skill d'équipe, absent de l'édition open source : on ne vérifie que les fichiers présents
  const docs = ["docs/SKILLS.md", "docs/DESIGN-ENGINE.md", "architecture/orchestration/compose-batch.md", "worker/compose-worker.md", ".claude/skills/lws/SKILL.md"].filter((f) => existsSync(f))
  assert.ok(docs.length >= 4, `docs du cap introuvables : ${docs.join(", ")}`)
  for (const f of docs) {
    const caps = [...read(f).matchAll(/cap (\d+)/gi)].map((m) => Number(m[1]))
    assert.ok(caps.length, `${f} ne cite pas le cap`)
    for (const c of caps) assert.equal(c, cap, `${f} dit cap ${c}, le code ${cap}`)
  }
  assert.match(read(".claude/skills/beauty-gate/SKILL.md"), new RegExp(`Cap : ${cap} boucles`))
})

test("funnel honnête : plus aucune trace des « 2 plaintes » dans le cockpit ni le séquenceur", () => {
  const files = [...walk("backoffice/reviewpipe/public").filter((f) => /\.(html|js|css)$/.test(f)), "outreach/scripts/sequencer.ts"]
  for (const f of files) assert.doesNotMatch(read(f), /2 plaintes|plainte [12]|6 étapes|plainte-a|plainte-b/, f)
})

test("design/industries/RADAR.md est à jour : autant de métiers que industries.ts", () => {
  const n = Object.keys(INDUSTRIES).length
  assert.match(read("design/industries/RADAR.md"), new RegExp(`> ${n} métiers`))
  const rows = read("design/industries/RADAR.md").split("\n").filter((l) => /^\| \d+ \|/.test(l)).length
  assert.equal(rows, n)
})

test(".dockerignore : ni secrets, ni données, ni matière client dans l'image", () => {
  const lines = new Set(read(".dockerignore").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")))
  for (const p of [".env", ".env.*", "**/sa-key.json", "**/credentials.json", "**/.hf-session.json", "**/*.pem", "**/*.key", "closing", "sessions", "website", "data", "output"]) {
    assert.ok(lines.has(p), `.dockerignore doit contenir ${p}`)
  }
})

test("aucun script n'arrête TOUTES les stations de la machine (pkill -f global)", () => {
  for (const f of walk("backoffice").concat(walk("scripts"), walk("worker")).filter((f) => /\.(sh|ts|mjs|js)$/.test(f))) {
    const code = read(f).split("\n").filter((l) => !l.trim().startsWith("#") && !l.trim().startsWith("//")).join("\n")
    assert.doesNotMatch(code, /pkill\s+-f/, f)
  }
})

test(".env.example documente les variables ajoutées cette nuit (à poser au merge)", () => {
  const env = read(".env.example")
  for (const v of ["TELEGRAM_ALLOWED_CHAT_IDS", "LWS_LIVE_SEND", "DB_SSL", "DIGEST_TO"]) assert.match(env, new RegExp(`^# ${v}=`, "m"), v)
})

test(".env.example : tracking auto-hébergé, lecteur de réponses, transport, cage 24/7 (WP3), tous commentés", () => {
  const env = read(".env.example")
  for (const v of ["TRACK_BASE", "LWS_TRACK_SECRET", "LWS_REPLY_READER", "LWS_MAIL_TRANSPORT", "LWS_STOP_FILE", "LWS_BUDGET_USD_DAY", "LWS_JOB_MAX_USD", "LWS_IMAGE_USD", "LWS_VIDEO_USD", "WORKER_STOP_POLL_MS"]) {
    assert.match(env, new RegExp(`^# ${v}=`, "m"), v)
  }
})

test("docs du tracking et du funnel à jour : plus d'edge function Supabase ni de funnel « 6 étapes / 2 plaintes »", () => {
  const t = read("outreach/tracking/README.md")
  assert.doesNotMatch(t, /edge-function\.ts|Inactif pour l'instant/)
  assert.match(t, /List-Unsubscribe=One-Click/)
  if (!existsSync("docs/funnel-strategy.md")) return // doc interne de l'équipe, pas livrée dans l'édition open source
  const f = read("docs/funnel-strategy.md").split("## 8.")[1]
  assert.doesNotMatch(f, /6 étapes|personas \(2 plaintes\)|sequences\.html/)
  assert.match(f, /breaker\.ts/)
})

test(".env.example : toute la couche « apporte ton modèle » et les médias, plan-first, rien d'obligatoire", () => {
  const env = read(".env.example")
  for (const v of ["LWS_LLM", "LLM_VIA", "LWS_MODEL_SMART", "LWS_MODEL_FAST", "LWS_MODEL_JUDGE", "LWS_MODEL", "LWS_EFFORT_FAST", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN",
    "OPENAI_BASE_URL", "OPENAI_MODEL", "OPENAI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "LWS_IMAGE", "OPENAI_IMAGE_BASE_URL", "OPENAI_IMAGE_MODEL", "LWS_VIDEO", "HIGGSFIELD_API_KEY", "DATABASE_URL"]) {
    assert.match(env, new RegExp(`^# ${v}=`, "m"), `${v} documentée (commentée : optionnelle)`)
  }
  // aucune variable active : `cp .env.example .env` ne casse rien et laisse la voie par défaut (plan)
  assert.deepEqual(env.split("\n").filter((l) => /^[A-Z_]+=/.test(l)), [])
  assert.match(env, /LWS_LLM=claude-code/)
})

test("doctor et first-site sont des scripts npm ; `npm run demo` reste la vidéo de démo (utilisée par /pipe et Salesport)", () => {
  const scripts = JSON.parse(read("package.json")).scripts
  assert.equal(scripts.doctor, "tsx scripts/doctor.ts")
  assert.equal(scripts["first-site"], "tsx scripts/first-site.ts")
  assert.equal(scripts.demo, "tsx design/scripts/demo-video.ts")
})

test("pairings.oss.json : paires de polices libres présentes sur disque", () => {
  const { pairings } = JSON.parse(read("design/fonts/pairings.oss.json"))
  assert.ok(pairings.length >= 3)
  for (const p of pairings) {
    assert.equal(p.license, "OFL-1.1")
    for (const slug of [p.display_slug, p.body_slug]) assert.ok(existsSync(join("design/fonts", slug)), slug)
  }
})

test("vitrine : plus d'url() relative passée en style inline (résolue contre la feuille de style → 404)", () => {
  for (const f of ["website/index.html", "website/services.html", "website/equipe.html"]) {
    const root = process.env.LWS_TEST_ROOT || "."
    const p = join(root, f)
    if (!existsSync(p)) continue // export OSS sans la vitrine
    assert.doesNotMatch(read(p), /style="--amb:url\(/, f)
  }
})
