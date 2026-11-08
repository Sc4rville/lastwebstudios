/**
 * G15 + static G6 safety nets: the docs tell the truth (skills count, beauty-gate cap, honest funnel, radar),
 * the Docker image ships no secrets and no client material, no script stops other people's stations.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { INDUSTRIES } from "../leadengine/1_scraping/scripts/industries.ts"

const read = (p: string) => readFileSync(p, "utf8")
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))

test("docs/SKILLS.md gives the true count: skills + prompt.md modules + 1 internal = the folders", () => {
  const dirs = readdirSync(".claude/skills", { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  const skills = dirs.filter((d) => existsSync(join(".claude/skills", d, "SKILL.md")) && read(join(".claude/skills", d, "SKILL.md")).startsWith("---"))
  const prompts = dirs.filter((d) => !existsSync(join(".claude/skills", d, "SKILL.md")) && existsSync(join(".claude/skills", d, "prompt.md")))
  const internal = dirs.filter((d) => !skills.includes(d) && !prompts.includes(d))
  const doc = read("docs/SKILLS.md")
  assert.match(doc, new RegExp(`\\*\\*${dirs.length} folders\\*\\*`))
  assert.match(doc, new RegExp(`\\*\\*${skills.length} Claude Code skills\\*\\*`))
  assert.match(doc, new RegExp(`\\*\\*${prompts.length} prompt modules\\*\\*`))
  // « 1 internal skill », « 0 internal skills » (the open source edition has none)
  assert.match(doc, new RegExp(`\\*\\*${internal.length} internal skill${internal.length === 1 ? "" : "s"}\\*\\*`))
  for (const p of prompts) assert.match(doc, new RegExp("`" + p + "`"), `module ${p} missing from SKILLS.md`)
  for (const s of skills) assert.match(doc, new RegExp("`/?" + s + "`"), `skill ${s} missing from SKILLS.md`)
  assert.match(doc, /`generate-savior`/)
})

test("the beauty-gate cap is the same in the code and in every doc", () => {
  const code = read("architecture/orchestration/compose-batch.workflow.js")
  const cap = Number(/const GATE_MAX_LOOPS = (\d+)/.exec(code)?.[1])
  assert.ok(cap >= 1)
  assert.match(code, /for \(let k = 0; k < GATE_MAX_LOOPS; k\+\+\)/)
  // .claude/skills/lws is a team skill, missing from the open-source edition: only the files present are checked
  const docs = ["docs/SKILLS.md", "docs/DESIGN-ENGINE.md", "architecture/orchestration/compose-batch.md", "worker/compose-worker.md", ".claude/skills/lws/SKILL.md"].filter((f) => existsSync(f))
  assert.ok(docs.length >= 4, `cap docs not found: ${docs.join(", ")}`)
  for (const f of docs) {
    const caps = [...read(f).matchAll(/cap (\d+)/gi)].map((m) => Number(m[1]))
    assert.ok(caps.length, `${f} does not state the cap`)
    for (const c of caps) assert.equal(c, cap, `${f} says cap ${c}, the code ${cap}`)
  }
  assert.match(read(".claude/skills/beauty-gate/SKILL.md"), new RegExp(`Cap: ${cap} loops`))
})

test("honest funnel: no trace left of the \"2 complaints\" in the cockpit or the sequencer", () => {
  const files = [...walk("backoffice/reviewpipe/public").filter((f) => /\.(html|js|css)$/.test(f)), "outreach/scripts/sequencer.ts"]
  for (const f of files) assert.doesNotMatch(read(f), /2 plaintes|plainte [12]|6 étapes|plainte-a|plainte-b/, f)
})

test("design/industries/RADAR.md is up to date: as many trades as industries.ts", () => {
  const n = Object.keys(INDUSTRIES).length
  assert.match(read("design/industries/RADAR.md"), new RegExp(`> ${n} métiers`))
  const rows = read("design/industries/RADAR.md").split("\n").filter((l) => /^\| \d+ \|/.test(l)).length
  assert.equal(rows, n)
})

test(".dockerignore: no secrets, no data, no client material in the image", () => {
  const lines = new Set(read(".dockerignore").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")))
  for (const p of [".env", ".env.*", "**/sa-key.json", "**/credentials.json", "**/.hf-session.json", "**/*.pem", "**/*.key", "closing", "sessions", "website", "data", "output"]) {
    assert.ok(lines.has(p), `.dockerignore must contain ${p}`)
  }
})

test("no script stops ALL the stations on the machine (global pkill -f)", () => {
  for (const f of walk("backoffice").concat(walk("scripts"), walk("worker")).filter((f) => /\.(sh|ts|mjs|js)$/.test(f))) {
    const code = read(f).split("\n").filter((l) => !l.trim().startsWith("#") && !l.trim().startsWith("//")).join("\n")
    assert.doesNotMatch(code, /pkill\s+-f/, f)
  }
})

test(".env.example documents the variables added that night (to set at merge time)", () => {
  const env = read(".env.example")
  for (const v of ["TELEGRAM_ALLOWED_CHAT_IDS", "LWS_LIVE_SEND", "DB_SSL", "DIGEST_TO"]) assert.match(env, new RegExp(`^# ${v}=`, "m"), v)
})

test(".env.example: self-hosted tracking, reply reader, transport, 24/7 cage (WP3), all commented out", () => {
  const env = read(".env.example")
  for (const v of ["TRACK_BASE", "LWS_TRACK_SECRET", "LWS_REPLY_READER", "LWS_MAIL_TRANSPORT", "LWS_STOP_FILE", "LWS_BUDGET_USD_DAY", "LWS_JOB_MAX_USD", "LWS_IMAGE_USD", "LWS_VIDEO_USD", "WORKER_STOP_POLL_MS"]) {
    assert.match(env, new RegExp(`^# ${v}=`, "m"), v)
  }
})

test("tracking and funnel docs up to date: no more Supabase edge function nor a \"6 steps / 2 complaints\" funnel", () => {
  const t = read("outreach/tracking/README.md")
  assert.doesNotMatch(t, /edge-function\.ts|Inactif pour l'instant/)
  assert.match(t, /List-Unsubscribe=One-Click/)
  if (!existsSync("docs/funnel-strategy.md")) return // the team's internal doc, not shipped in the open-source edition
  const f = read("docs/funnel-strategy.md").split("## 8.")[1]
  assert.doesNotMatch(f, /6 étapes|personas \(2 plaintes\)|sequences\.html/)
  assert.match(f, /breaker\.ts/)
})

test(".env.example: the whole \"bring your own model\" layer and the media, plan first, nothing mandatory", () => {
  const env = read(".env.example")
  for (const v of ["LWS_LLM", "LLM_VIA", "LWS_MODEL_SMART", "LWS_MODEL_FAST", "LWS_MODEL_JUDGE", "LWS_MODEL", "LWS_EFFORT_FAST", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN",
    "OPENAI_BASE_URL", "OPENAI_MODEL", "OPENAI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "LWS_IMAGE", "OPENAI_IMAGE_BASE_URL", "OPENAI_IMAGE_MODEL", "LWS_VIDEO", "HIGGSFIELD_API_KEY", "DATABASE_URL"]) {
    assert.match(env, new RegExp(`^# ${v}=`, "m"), `${v} documented (commented out: optional)`)
  }
  // no active variable: `cp .env.example .env` breaks nothing and keeps the default path (plan)
  assert.deepEqual(env.split("\n").filter((l) => /^[A-Z_]+=/.test(l)), [])
  assert.match(env, /LWS_LLM=claude-code/)
})

test("doctor and first-site are npm scripts; `npm run demo` stays the demo video (used by /pipe and Salesport)", () => {
  const scripts = JSON.parse(read("package.json")).scripts
  assert.equal(scripts.doctor, "tsx scripts/doctor.ts")
  assert.equal(scripts["first-site"], "tsx scripts/first-site.ts")
  assert.equal(scripts.demo, "tsx design/scripts/demo-video.ts")
})

test("pairings.oss.json: free font pairs present on disk", () => {
  const { pairings } = JSON.parse(read("design/fonts/pairings.oss.json"))
  assert.ok(pairings.length >= 3)
  for (const p of pairings) {
    assert.equal(p.license, "OFL-1.1")
    for (const slug of [p.display_slug, p.body_slug]) assert.ok(existsSync(join("design/fonts", slug)), slug)
  }
})

test("showcase: no more relative url() passed in an inline style (resolved against the stylesheet → 404)", () => {
  for (const f of ["website/index.html", "website/services.html", "website/equipe.html"]) {
    const root = process.env.LWS_TEST_ROOT || "."
    const p = join(root, f)
    if (!existsSync(p)) continue // OSS export without the showcase
    assert.doesNotMatch(read(p), /style="--amb:url\(/, f)
  }
})
