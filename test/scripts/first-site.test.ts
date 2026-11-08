/**
 * G10: `npm run first-site -- <url>` chains score → parse → record → diagnose → compose → beauty-gate on the FICTIONAL
 * dated site « Orvane Piscines » served locally, boost off, no sync. Here with the fake `claude` (local
 * and workflow engines); the real run on the plan is logged in NIGHT/LOG.md (WP2) and its result in examples/.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { cpSync, readFileSync } from "node:fs"
import { parseArgs, prospectId, composeArgs, parseLauncherResult, workflowLauncherPrompt, RESULT_TAG, resolveSample } from "../../scripts/first-site.ts"
import { serveDir as serveSample, resolveInside } from "../../scripts/lib/serve-dir.mjs"
import { serveDir, type Http } from "../helpers/server.ts"
import { makeWorkspace, FIXTURES, type Workspace } from "../helpers/workspace.ts"
import { npmRun } from "../helpers/proc.ts"

const ID = "orvane-piscines-valmont-sur-lys"

test("arguments: URL required, options validated, a readable id", () => {
  assert.equal(parseArgs([]), null)
  assert.equal(parseArgs(["not-a-url"]), null)
  assert.throws(() => parseArgs(["http://x.example", "--engin", "local"]), /unknown option: --engin \(see the options: npm run first-site -- --help\)/)
  assert.throws(() => parseArgs(["--bogus-flag"]), /unknown option: --bogus-flag/, "named even with no URL")
  assert.throws(() => parseArgs(["http://x.example", "--engine", "turbo"]), /auto \| workflow \| local/)
  assert.throws(() => parseArgs(["http://x.example", "--date", "24/10"]), /YYYY-MM-DD/)
  const o = parseArgs(["http://127.0.0.1:1/", "--name", "Orvane Piscines", "--city", "Valmont-sur-Lys", "--boost"])!
  assert.equal(o.engine, "auto")
  assert.equal(o.boost, true)
  assert.equal(prospectId(o), ID)
  assert.equal(prospectId({ url: "https://www.vieux-site.example/accueil" }), "vieux-site")
  assert.throws(() => prospectId({ url: "http://x", id: "../etc" }), /lowercase/)
})

test("--sample: a FICTIONAL dated site from the cast replaces the URL (README: a first run without targeting a real business)", async () => {
  const o = parseArgs(["--sample", "orvane", "--engine", "local"])!
  assert.equal(o.sample, "orvane")
  assert.equal(o.url, "")
  // `--sample` alone : the sample of the agency's country (a US studio's first site is an Austin business, in English)
  assert.equal(parseArgs(["--sample"])!.sample, "auto")
  assert.equal(parseArgs(["--sample", "--engine", "local"])!.sample, "auto")
  assert.equal(resolveSample("auto", ".", "US").id, "pecanwood-pools-austin")
  assert.equal(resolveSample("auto", ".", "FR").id, ID)
  const us = resolveSample("pecanwood")
  assert.equal(us.city, "Austin"); assert.equal(us.industry, "pisciniste"); assert.match(us.phone || "", /^\(512\) 555-01\d\d$/)
  assert.match(readFileSync(join(us.dir, "index.html"), "utf8"), /<html lang="en">/)
  assert.throws(() => parseArgs(["--sample", "orvane", "http://x.example"]), /one or the other/)
  const want: Record<string, [string, string]> = { orvane: [ID, "pisciniste"], brisane: ["atelier-brisane-sornac-le-haut", "menuisier"], lumeo: ["cuisines-lumeo-vereuil", "cuisiniste"], quillanne: ["bassins-de-quillanne-quillanne-sur-orme", "pisciniste"], pecanwood: ["pecanwood-pools-austin", "pisciniste"] }
  for (const [name, [id, industry]] of Object.entries(want)) {
    const s = resolveSample(name)
    assert.equal(s.id, id)
    assert.equal(s.industry, industry)
    assert.ok(readFileSync(join(s.dir, "index.html"), "utf8").length > 200, `${name}: dated site present`)
    if (s.email) assert.match(s.email, /\.example$/, "fictional contact details only")
  }
  assert.equal(resolveSample("Orvane Piscines").city, "Valmont-sur-Lys")
  assert.throws(() => resolveSample("doralis"), /unknown/) // found, without a dated site
  assert.throws(() => resolveSample("zzz"), /unknown/)
  // the server: the loopback, the served folder and nothing else
  const s = resolveSample("brisane")
  const srv = await serveSample(s.dir)
  try {
    assert.match(srv.url, /^http:\/\/127\.0\.0\.1:\d+\/$/)
    const home = await fetch(srv.url)
    assert.equal(home.status, 200)
    assert.match(home.headers.get("content-type") || "", /text\/html/)
    for (const evil of ["/../../package.json", "/..%2f..%2fpackage.json", "/%2e%2e/%2e%2e/agency.config.json", "/%00", "/index.html%00.png"]) {
      const r = await fetch(srv.url.replace(/\/$/, "") + evil)
      assert.equal(r.status, 404, evil)
    }
    assert.equal((await fetch(srv.url, { method: "POST" })).status, 405)
    assert.equal(await resolveInside(s.dir, "/../../package.json"), null)
  } finally { await srv.close() }
})

test("the Workflow's args: no sync, boost off by default (image/video none), models by role", () => {
  const a = composeArgs({ id: ID, date: "2026-10-24", score: 83, pairings: [{ display: "Host Grotesk" }], boost: false, env: { OPENAI_API_KEY: "sk", HIGGSFIELD_API_KEY: "hf" } })
  assert.deepEqual({ sync: a.sync, boost: a.boost, image: a.image, video: a.video }, { sync: false, boost: false, image: "none", video: "none" })
  assert.deepEqual(a.models, { smart: "opus", fast: "haiku", judge: "sonnet" })
  assert.deepEqual(a.scores, { [ID]: 83 })
  assert.deepEqual(a.preferences, [], "no preference yet: an empty list, never undefined")
  // the owner's taste (D6) : fenced (bad id dropped, one clean line) before it reaches the Workflow
  const t = composeArgs({ id: ID, date: "2026-10-24", score: 83, pairings: [], boost: false, preferences: [{ id: "p-phone-top", text: "Phone at the top,\n one tap" }, { id: "../x", text: "bad" }] })
  assert.deepEqual(t.preferences, [{ id: "p-phone-top", text: "Phone at the top, one tap" }])
  const b = composeArgs({ id: ID, date: "2026-10-24", score: 83, pairings: [], boost: true, env: { OPENAI_API_KEY: "sk", PATH: "" } })
  assert.deepEqual({ boost: b.boost, image: b.image, video: b.video }, { boost: true, image: "openai", video: "none" })
  const p = workflowLauncherPrompt(a)
  assert.match(p, /Workflow\(\{ scriptPath: "architecture\/orchestration\/compose-batch\.workflow\.js", args: \{.*"sync":false/)
  assert.deepEqual(parseLauncherResult(`chatter\n${RESULT_TAG}{"passed":[{"id":"x"}],"failed":[]} end`), { passed: [{ id: "x" }], failed: [] })
  assert.equal(parseLauncherResult("nothing"), null)
})

let site: Http
let ws: Workspace
before(async () => { site = await serveDir(join(FIXTURES, "sites", "orvane-piscines")); ws = makeWorkspace() })
after(async () => { ws?.cleanup(); await site?.close() })

const ARGS = (date: string, ...extra: string[]) => [`${site.url}/`, "--name", "Orvane Piscines", "--city", "Valmont-sur-Lys", "--industry", "pisciniste", "--phone", "03 53 01 24 68", "--date", date, ...extra]
const calls = (log: string) => readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l))

test("local engine: site built, cross-checked (lint + verify), gate PASS logged, nothing synced", { timeout: 240_000 }, async () => {
  const log = ws.path("claude-local.log")
  // the owner's taste (D6) : one preference on, one off — the composer gets the first only, the report says it applied it
  ws.write("data/learning/taste.json", JSON.stringify({ version: 1, updatedAt: "2026-11-08T10:00:00.000Z", events: [], decisions: [], preferences: [
    { id: "p-phone-top", key: "phone-top", text: "Phone number at the top of the page, one tap to call", area: "contact", on: true, count: 1, confidence: 0.33, sources: [], createdAt: "2026-11-08T10:00:00.000Z", updatedAt: "2026-11-08T10:00:00.000Z", by: "rules" },
    { id: "p-dark-pages", key: "dark-pages", text: "Dark, cinematic pages rather than light ones", area: "colour", on: false, count: 1, confidence: 0.33, sources: [], createdAt: "2026-11-08T10:00:00.000Z", updatedAt: "2026-11-08T10:00:00.000Z", by: "rules" },
  ] }))
  const r = await npmRun(ws.dir, "first-site", ARGS("2026-10-24", "--engine", "local"), { env: { FAKE_CLAUDE_LOG: log, ANTHROPIC_API_KEY: "sk-ant-ne-doit-pas-passer" }, timeoutMs: 230_000 })
  assert.equal(r.code, 0, r.out.slice(-3000))
  assert.match(r.stdout, /\[1\/6\] score/)
  assert.match(r.stdout, /\[6\/6\] the blind judge's verdict\n\s+PASS in 1 round/)
  const dir = `output/sites/${ID}/2026-10-24-composer`
  assert.ok(ws.exists(`${dir}/index.html`))
  assert.ok(ws.exists(`${dir}/_after.png`) && ws.exists(`${dir}/_after.mobile.png`), "the verify's desktop + mobile screenshots")
  const rep = ws.json(`${dir}/first-site.json`)
  assert.equal(rep.engine, "local")
  assert.equal(rep.provider, "claude-code")
  assert.ok(rep.steps.score.value > 0)
  assert.equal(rep.gate.pass, true)
  assert.equal(rep.gate.verdict.margin, "much")
  assert.equal(rep.lint.clean, true)
  assert.equal(rep.lint.dashCount, 0)
  assert.equal(rep.verify.clean, true)
  assert.equal(rep.verify.mobile.overflowX, false)
  assert.equal(rep.compose.args.sync, false)
  assert.deepEqual(rep.preferences, { given: [{ id: "p-phone-top", text: "Phone number at the top of the page, one tap to call" }], applied: [{ id: "p-phone-top", text: "Phone number at the top of the page, one tap to call" }] })
  assert.match(r.stdout, /built with 1 of your 1 preference: Phone number at the top/)
  assert.deepEqual(ws.json(`${dir}/.lws-taste.json`).applied.map((p: any) => p.id), ["p-phone-top"])
  assert.ok(ws.exists(`data/prospects/${ID}.json`) && ws.exists(`data/assets/${ID}/avant.png`))
  const cs = calls(log)
  assert.ok(cs.every((c) => c.env.ANTHROPIC_API_KEY === false), "plan-first: no API key in any claude -p")
  assert.ok(!cs.some((c) => /sync-site\.ts/.test(c.stdin)), "no sync agent")
  const assets = cs.find((c) => /ASSET-BOOST step for/.test(c.stdin))
  assert.match(assets.stdin, /IMAGE: \*\*NONE\*\*/)
  const compose = cs.find((c) => /Compose the CUSTOM site of/.test(c.stdin))
  assert.match(compose.stdin, /<owner_preferences>\n- \[p-phone-top\] Phone number at the top/)
  assert.doesNotMatch(compose.stdin, /Dark, cinematic/)
  const structure = cs.find((c) => /## TEXTE BRUT/.test(c.stdin))
  assert.ok(structure.argv.includes("--json-schema"), "the record goes through structured output (the skill's schema.json)")
})

test("the README's command: `npm run first-site -- --sample orvane` serves the fictional dated site, builds, then stops the server", { timeout: 240_000 }, async () => {
  const log = ws.path("claude-sample.log")
  cpSync(join(process.cwd(), "data", "sample"), ws.path("data", "sample"), { recursive: true }) // shipped with the repo (the test workspace has no data/)
  const r = await npmRun(ws.dir, "first-site", ["--sample", "orvane", "--engine", "local", "--date", "2026-10-23"], { env: { FAKE_CLAUDE_LOG: log }, timeoutMs: 230_000 })
  assert.equal(r.code, 0, r.out.slice(-3000))
  const served = /served on (http:\/\/127\.0\.0\.1:\d+\/)/.exec(r.stdout)?.[1]
  assert.ok(served, r.stdout.slice(0, 600))
  assert.match(r.stdout, new RegExp(`first-site · ${ID} · ${served.replace(/[./]/g, "\\$&")} · pisciniste`))
  const rep = ws.json(`output/sites/${ID}/2026-10-23-composer/first-site.json`)
  assert.equal(rep.gate.pass, true)
  assert.equal(rep.url, served)
  await assert.rejects(fetch(served, { signal: AbortSignal.timeout(2000) }), "the dated site's server is stopped at the end of the run")
})

test("workflow engine: the Workflow tool is called with the args (sync off), with no background wait ceiling", { timeout: 240_000 }, async () => {
  const log = ws.path("claude-wf.log")
  const r = await npmRun(ws.dir, "first-site", ARGS("2026-10-25", "--engine", "workflow"), { env: { FAKE_CLAUDE_LOG: log }, timeoutMs: 230_000 })
  assert.equal(r.code, 0, r.out.slice(-3000))
  const launcher = calls(log).find((c) => /FIRST_SITE_RESULT=/.test(c.stdin))
  assert.ok(launcher, "the Workflow launcher was called")
  assert.ok(launcher.argv.includes("Workflow") && launcher.argv.includes("Agent"))
  assert.equal(launcher.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS, "0")
  assert.match(launcher.stdin, /"sync":false/)
  const rep = ws.json(`output/sites/${ID}/2026-10-25-composer/first-site.json`)
  assert.equal(rep.engine, "workflow")
  assert.equal(rep.gate.pass, true)
})

test("auto without the Workflow tool ⇒ local engine; undecided judge ⇒ gate FAIL after 2 rounds, site kept and logged", { timeout: 240_000 }, async () => {
  const r = await npmRun(ws.dir, "first-site", ARGS("2026-10-26"), { env: { FAKE_CLAUDE_NO_WORKFLOW: "1", FAKE_CLAUDE_JUDGE: "tie" }, timeoutMs: 230_000 })
  assert.equal(r.code, 0, r.out.slice(-3000))
  assert.match(r.stdout, /composer engine: local \(auto\)/)
  const rep = ws.json(`output/sites/${ID}/2026-10-26-composer/first-site.json`)
  assert.equal(rep.engine, "local")
  assert.equal(rep.gate.pass, false)
  assert.equal(rep.gate.loops, 2)
})

test("blocking preflight (Claude Code signed out): nothing starts, the fix is said", { timeout: 120_000 }, async () => {
  const r = await npmRun(ws.dir, "first-site", ARGS("2026-10-27"), { env: { FAKE_CLAUDE_AUTH: "none" }, timeoutMs: 110_000 })
  assert.equal(r.code, 1)
  assert.match(r.stdout, /missing ⇒ do: claude auth login/)
  assert.equal(ws.exists(`output/sites/${ID}/2026-10-27-composer`), false)
})
