/**
 * first-site.ts · `npm run first-site -- <url>`: YOUR first real site, end to end, on YOUR subscription.
 *
 *   score (the gate) → parse (Playwright) → record (structuration skill, LWS_LLM way) → compose-batch:
 *   diagnose → asset-boost (off by default) → composer → deterministic safety net (lint + verify) → self-review →
 *   blind beauty-gate (cap 2) → local cross-check (lint + verify) → first-site.json report.
 *
 * The composer's engine (--engine):
 *   workflow  Claude Code's Workflow tool, exactly like the box's worker (agents in parallel)
 *   local     architecture/orchestration/workflow-local.ts: the SAME prompts and schemas, orchestrated here, one
 *             `claude -p` per agent (a Pro subscription without "Dynamic workflows", an old CLI, a local model)
 *   auto      workflow if the Claude Code session exposes it (init probe), otherwise local (default)
 *
 * Nothing goes anywhere else: no sync to a bucket or a database (args.sync=false), image/video boost off unless
 * --boost, no email. The result stays in output/sites/<id>/<date>-composer/; `npm run backoffice` shows it.
 *
 * Usage: see USAGE below (`npm run first-site -- --help`).
 */
import { agency } from "../packages/shared/agency.mjs"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { spawn, spawnSync } from "node:child_process"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { slug } from "../leadengine/1_scraping/scripts/util.ts"
import { normalizeIndustry } from "../leadengine/1_scraping/scripts/industries.ts"
import { workflowModels, selectProvider, parseJson } from "../packages/llm/index.ts"
import { planEnv } from "../packages/llm/adapters/claude-code.ts"
import { readableEvent } from "../packages/llm/stream-events.ts"
import { imageEngine, videoEngine } from "../packages/shared/media.mjs"
import { workerClaudeArgs } from "../worker/claude-args.ts"
import { runWorkflowFile, claudeAgentRunner } from "../architecture/orchestration/workflow-local.ts"
import { promptPreferences, fencePrefs, stampSite, type PromptPref } from "../learning/scripts/taste.ts"
import { lineSplitter, textCollector } from "../packages/shared/lines.mjs"
import { serveDir } from "./lib/serve-dir.mjs"

export const WORKFLOW_SCRIPT = "architecture/orchestration/compose-batch.workflow.js"
export const RESULT_TAG = "FIRST_SITE_RESULT="

export type FirstSiteOptions = {
  url: string; name?: string; city?: string; industry?: string; phone?: string; email?: string; id?: string
  engine: "auto" | "workflow" | "local"; boost: boolean; force: boolean; date: string; pairings: string; preflight: boolean
  /** `--sample <name>`: a fictional dated site from the cast, served locally (the url is set at launch). */
  sample?: string
}

export function parseArgs(argv: string[]): FirstSiteOptions | null {
  const val = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined }
  const flags = new Set(["--boost", "--force", "--no-preflight"])
  const valued = new Set(["--name", "--city", "--industry", "--phone", "--email", "--id", "--engine", "--date", "--pairings", "--sample"])
  const positional = argv.filter((a, i) => !a.startsWith("--") && !valued.has(argv[i - 1]))
  // `--sample` alone : the sample of the agency's own country (a US studio gets the Austin pool builder)
  const sample = argv.includes("--sample") ? (val("--sample") && !val("--sample")!.startsWith("--") ? val("--sample") : "auto") : undefined
  if (sample && positional.length) throw new Error("--sample replaces the URL: one or the other")
  // an unknown option is named first, even with no URL (never the bare usage block with no word on what was wrong)
  for (const a of argv) if (a.startsWith("--") && !flags.has(a) && !valued.has(a)) throw new Error(`unknown option: ${a} (see the options: npm run first-site -- --help)`)
  const url = sample ? "" : positional[0]
  if (!sample && (!url || !/^https?:\/\//i.test(url))) return null
  const engine = (val("--engine") || "auto") as FirstSiteOptions["engine"]
  if (!["auto", "workflow", "local"].includes(engine)) throw new Error(`--engine ${engine}: auto | workflow | local`)
  const date = val("--date") || new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`--date ${date}: format YYYY-MM-DD`)
  return {
    url, name: val("--name"), city: val("--city"), industry: val("--industry"), phone: val("--phone"), email: val("--email"), id: val("--id"),
    engine, boost: argv.includes("--boost"), force: argv.includes("--force"), date, pairings: val("--pairings") || join("design", "fonts", "pairings.json"),
    preflight: !argv.includes("--no-preflight"), ...(sample ? { sample } : {}),
  }
}

const SAMPLE_NAMES = "orvane | brisane | lumeo | quillanne (French cast) · pecanwood (US cast, an Austin pool builder) · or --sample alone for your agency's country"

export const USAGE = `usage: npm run first-site -- <url of the dated site> [options]
       npm run first-site -- --sample [orvane|brisane|lumeo|quillanne|pecanwood] [options]
         a FICTIONAL dated site from the shipped cast, served on 127.0.0.1 for the run: your first run never
         targets a real business. --sample alone picks the one of your agency's country (US: pecanwood).

  Builds one site end to end on your subscription: score → read the site → prospect sheet → diagnose → compose →
  lint and verify → blind judge. Takes about 10–14 minutes and uses roughly $3 of plan quota (an estimate, not a
  bill; the API ways bill per token). Nothing is sent anywhere. The result lands in output/sites/<id>/<date>-composer/
  and shows up in the cockpit (npm run backoffice).

  --name "Business name"      --city "Town"            --industry <trade>   (French key or English name: plumber, roofer…)
  --phone …                   --email …                --id <slug>
  --engine auto|workflow|local   workflow = Claude Code's Workflow tool (agents in parallel, Max plan);
                                 local = one agent at a time (Pro plan); auto = workflow when available (default)
  --boost                     image/video boost (OpenAI, Higgsfield) if configured; off by default
  --force                     build even if their site already looks fine (the free first check would skip it)
  --date YYYY-MM-DD           --pairings <fonts.json>  --no-preflight (skip npm run doctor)

  Check your machine first: npm run doctor`
export type SampleSite = { id: string; name: string; city?: string; industry: string; phone?: string; email?: string; dir: string }

/** The fictional dated site `--sample <name>`: the cast's prospect whose id or name contains <name>, and that has a dated site. */
export function resolveSample(name: string, root = ".", countryIn?: string): SampleSite {
  // no agency of your own yet (no agency.config.json, no LWS_AGENCY_CONFIG) : the English default, like `npm run
  // sandbox` (the Austin pool builder) ; else the sample of your agency's country
  const country = countryIn ?? (!process.env.LWS_AGENCY_CONFIG && !existsSync(join(root, "agency.config.json")) ? "US" : String(agency().country || ""))
  // both casts : the French one (data/sample/cast.json) and the US one (data/sample/cast.us.json, its own data folder)
  type C = { data?: string; prospects: { id: string; name: string; trade: string; oldSite?: string }[] }
  const casts: C[] = ["cast.json", "cast.us.json"].map((f) => join(root, "data", "sample", f)).filter((f) => existsSync(f)).map((f) => JSON.parse(readFileSync(f, "utf8")))
  if (name === "auto") name = country.toUpperCase() === "US" ? "pecanwood" : "orvane"
  const q = slug(name)
  const withSite = casts.flatMap((c) => c.prospects.filter((p) => p.oldSite && existsSync(join(root, p.oldSite, "index.html"))).map((p) => ({ ...p, data: c.data || join("data", "sample", "data") })))
  const hits = withSite.filter((p) => p.id === q || p.id.includes(q) || slug(p.name).includes(q))
  if (hits.length !== 1) throw new Error(`--sample ${name}: ${hits.length ? "ambiguous" : "unknown"} · ${SAMPLE_NAMES}`)
  const p = hits[0]
  const sheetPath = join(root, p.data, "prospects", `${p.id}.json`)
  const sheet = existsSync(sheetPath) ? JSON.parse(readFileSync(sheetPath, "utf8")) : {}
  const id = sheet.identity ?? {}
  return { id: p.id, name: id.name || p.name, city: id.city || undefined, industry: sheet.industry || p.trade, phone: id.phone || undefined, email: id.email || undefined, dir: join(root, p.oldSite!) }
}

export function prospectId(o: Pick<FirstSiteOptions, "id" | "name" | "city" | "url">): string {
  if (o.id) { if (!/^[a-z0-9][a-z0-9-]{1,100}$/.test(o.id)) throw new Error(`--id ${o.id}: lowercase letters, digits and dashes`); return o.id }
  if (o.name) return slug([o.name, o.city].filter(Boolean).join("-"))
  return slug(new URL(o.url).hostname.replace(/^www\./, "").replace(/\.[a-z]+$/i, ""))
}

/** The compose-batch Workflow's args for ONE prospect, without sync and (by default) without boost; `preferences` = the
 *  owner's active taste (learning/scripts/taste.ts, D6), fenced again by the Workflow. */
export function composeArgs(o: { id: string; date: string; score: number; pairings: unknown[]; boost: boolean; env?: Record<string, string | undefined>; preferences?: PromptPref[] }) {
  const env = o.env ?? process.env
  const image = o.boost ? imageEngine(env).engine : "none"
  const video = o.boost ? videoEngine(env).engine : "none"
  return { date: o.date, ids: [o.id], pairings: o.pairings, scores: { [o.id]: o.score }, boost: o.boost && (image !== "none" || video !== "none"), image, video, sync: false, models: workflowModels(env), language: agency(env).language, country: agency(env).country, preferences: fencePrefs(o.preferences || []).map((p) => ({ id: p.id, text: p.text })) }
}

/** The prompt of the agent that starts the Workflow tool (the "workflow" engine): nothing but the call. */
export function workflowLauncherPrompt(args: unknown): string {
  return `You were started by \`npm run first-site\` (headless, no human). The lead engine is already done: the record and the "before" capture exist.
Your ONLY task: call the **Workflow** tool once, exactly like this, then wait for its result.

Workflow({ scriptPath: "${WORKFLOW_SCRIPT}", args: ${JSON.stringify(args)} })

Run no other step yourself (no sync, no push, no sending). When the Workflow has returned its result, answer
ONLY one line: ${RESULT_TAG}<the Workflow's result JSON, on a single line>`
}

/** Extracts the JSON returned by the Workflow from the launcher agent's final text. */
export function parseLauncherResult(text: string): any | null {
  const i = text.lastIndexOf(RESULT_TAG)
  if (i < 0) return null
  const rest = text.slice(i + RESULT_TAG.length)
  const start = rest.indexOf("{")
  if (start < 0) return null
  try { return parseJson(rest.slice(start)) } catch { return null }
}

type Engine = "workflow" | "local"
type ComposeOutcome = { engine: Engine; ms: number; result: any; costUsd?: number; agents?: unknown[]; log: string[] }

function runWorkflowEngine(args: unknown, log: (s: string) => void, timeoutMs: number): Promise<ComposeOutcome> {
  const bin = process.env.CLAUDE_BIN || "claude"
  const base = workerClaudeArgs()
  const cliArgs = [...base, "--output-format", "stream-json", "--verbose", ...(base.includes("--strict-mcp-config") ? [] : ["--strict-mcp-config"])]
  const t0 = Date.now()
  const lines: string[] = []
  return new Promise((resolve, reject) => {
    // the Workflow runs in the session's background: wait for its end without an idle ceiling (our own timeout bounds it)
    const child = spawn(bin, cliArgs, { env: { ...planEnv(process.env), CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: "0" }, stdio: ["pipe", "pipe", "pipe"] })
    let final: any = null
    const errOut = textCollector(64_000)
    const timer = setTimeout(() => { log(`✗ timed out (${Math.round(timeoutMs / 60000)} min): stopping`); try { child.kill("SIGTERM") } catch { /* */ } }, timeoutMs)
    // lines and UTF-8 characters stitched back together across pipe reads (otherwise the final `result` can be lost)
    const out = lineSplitter((line) => {
      if (line.includes('"type":"result"')) { try { final = JSON.parse(line) } catch { /* */ } }
      const r = readableEvent(line)
      if (r) lines.push(r)
      if (r && !r.startsWith("✓ ")) log(`   ${r.slice(0, 160)}`) // the final result is read further down, not repeated
    })
    child.stdout.on("data", (b: Buffer) => out.push(b))
    child.stderr.on("data", (b: Buffer) => errOut.push(b))
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`spawn ${bin}: ${e.message}`)) })
    child.on("close", (code) => {
      clearTimeout(timer)
      out.end()
      const err = errOut.text()
      if (!final) return reject(new Error(`claude -p (code ${code}) without a result: ${err.slice(-400)}`))
      if (final.is_error || final.subtype !== "success") return reject(new Error(`claude -p failed (${final.subtype}): ${String(final.result ?? "").slice(0, 300)}`))
      resolve({ engine: "workflow", ms: Date.now() - t0, result: parseLauncherResult(String(final.result ?? "")), costUsd: typeof final.total_cost_usd === "number" ? final.total_cost_usd : undefined, log: lines })
    })
    child.stdin.on("error", () => { /* */ })
    child.stdin.write(workflowLauncherPrompt(args))
    child.stdin.end()
  })
}

async function runLocalEngine(args: unknown, log: (s: string) => void): Promise<ComposeOutcome> {
  const lines: string[] = []
  const r = await runWorkflowFile(WORKFLOW_SCRIPT, args, claudeAgentRunner({ log: (s) => { lines.push(s); log(s) } }), { log: (s) => { lines.push(s); log(s) } })
  return { engine: "local", ms: r.ms, result: r.result, costUsd: r.costUsd, agents: r.agents, log: lines }
}

function nodeJson(script: string, args: string[]): { code: number; json: any } {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 180_000, maxBuffer: 16 << 20 })
  let json: any = null
  try { json = JSON.parse(r.stdout) } catch { json = { unreadable: (r.stdout || r.stderr || "").slice(0, 400) } }
  return { code: r.status ?? -1, json }
}

/** The local cross-check (the composer's safety nets, run again here: the agent is not taken at its word). */
export function verifySite(dir: string): { lint: any; verify: any; clean: boolean } {
  const index = join(dir, "index.html")
  const lint = nodeJson(join("design", "scripts", "lint.mjs"), [index]).json
  const verify = nodeJson(join("design", "verify", "verify.cjs"), [index, join(dir, "_after.png")]).json
  return { lint, verify, clean: !!lint?.clean && !!verify?.clean && (lint?.dashCount ?? 1) === 0 }
}

const step = (n: number, total: number, s: string) => console.log(`\n[${n}/${total}] ${s}`)
const secs = (ms: number) => `${Math.round(ms / 1000)} s`

export async function firstSite(o: FirstSiteOptions): Promise<number> {
  const T = 6
  const t0 = Date.now()
  const id = prospectId(o)
  const industry = o.industry || ""
  const report: Record<string, any> = { id, url: o.url, date: o.date, startedAt: new Date().toISOString(), steps: {} }
  console.log(`▶ first-site · ${id} · ${o.url}${industry ? ` · ${industry}` : ""}`)

  // 0 ── preflight: what doctor judges blocking for a first site (no database needed)
  let engine: Engine = o.engine === "auto" ? "local" : o.engine
  if (o.preflight) {
    const { runDoctor, formatReport } = await import("./doctor.ts")
    const d = await runDoctor({ target: "first-site", offline: false, env: process.env, cwd: process.cwd() })
    if (!d.ok) { console.log(formatReport(d)); return 1 }
    const wf = d.checks.find((c) => c.id === "workflow")
    if (o.engine === "auto") engine = wf?.status === "ok" ? "workflow" : "local"
    console.log(`✓ preflight (npm run doctor) · model way ${d.provider} · composer engine: ${engine}${o.engine === "auto" ? " (auto)" : ""}`)
  }
  report.engine = engine
  report.provider = selectProvider().name

  // 1 ── the gate
  step(1, T, "score (the gate: does this site need rebuilding?)")
  const { scoreProspect } = await import("../leadengine/2_scoring/scripts/score.ts")
  let t = Date.now()
  const score = await scoreProspect(id, o.url, { industry, name: o.name, city: o.city, phone: o.phone, email: o.email })
  mkdirSync(join("data", "raw"), { recursive: true })
  writeFileSync(join("data", "raw", `${id}.score.json`), JSON.stringify(score, null, 2))
  report.steps.score = { ms: Date.now() - t, value: score.value, tier: score.tier, reasons: score.reasons.slice(0, 4) }
  console.log(`   ${score.value}/100 (${score.tier}) in ${secs(Date.now() - t)}${score.accroche ? ` · hook: ${score.accroche}` : ""}`)
  for (const r of score.reasons.slice(0, 4)) console.log(`   - ${r}`)
  if (score.tier === "cold" && !o.force) {
    console.log("→ DROPPED by the gate (this site does not need rebuilding). --force to build anyway.")
    return 1
  }

  // 2 ── parse
  step(2, T, "read the site (Playwright: before screenshot, photos, logo, text)")
  const { parsePage } = await import("../leadengine/3_parsing/scripts/parse.ts")
  t = Date.now()
  const raw = await parsePage(id, o.url)
  report.steps.parse = { ms: Date.now() - t, photos: raw.photos.length, logo: !!raw.logo, textChars: raw.text.length }
  console.log(`   ${raw.photos.length} photo(s), logo ${raw.logo ? "yes" : "no"}, ${raw.text.length} characters in ${secs(Date.now() - t)}`)

  // 3 ── record
  step(3, T, `prospect sheet (structuration skill, via ${report.provider})`)
  const { structureFiche } = await import("../leadengine/3_parsing/scripts/structure.ts")
  t = Date.now()
  const fiche = await structureFiche(id, industry, { name: o.name || id, city: o.city || "", phone: o.phone }, score)
  report.steps.structure = { ms: Date.now() - t, services: fiche.content?.services?.length ?? 0, issue: (fiche as any).structureIssue ?? null }
  console.log(`   ${fiche.content?.services?.length ?? 0} service(s)${(fiche as any).structureIssue ? ` · ⚠ ${(fiche as any).structureIssue}` : ""} in ${secs(Date.now() - t)}`)

  // 4 ── compose (diagnose → boost → composer → safety net → self-review → beauty-gate)
  const pairingsDoc = JSON.parse(readFileSync(o.pairings, "utf8"))
  const pairings = Array.isArray(pairingsDoc) ? pairingsDoc : pairingsDoc.pairings
  if (!Array.isArray(pairings) || !pairings.length) throw new Error(`${o.pairings}: no "pairings" array`)
  // the owner's taste (D6) : what they said about earlier sites goes into this one, and the report says what it applied
  const prefs = await promptPreferences()
  const args = composeArgs({ id, date: o.date, score: score.value, pairings, boost: o.boost, preferences: prefs })
  report.compose = { args: { ...args, pairings: `${pairings.length} pair(s) from ${o.pairings}` } }
  step(4, T, `compose (engine ${engine} · boost ${args.boost ? `image ${args.image} / video ${args.video}` : "off"} · models ${JSON.stringify(args.models)})`)
  const log = (s: string) => console.log(s)
  const outcome = engine === "workflow"
    ? await runWorkflowEngine(args, log, Number(process.env.LWS_FIRST_SITE_TIMEOUT_MS ?? 120 * 60_000))
    : await runLocalEngine(args, log)
  report.steps.compose = { ms: outcome.ms, engine: outcome.engine, planEstimateUsd: outcome.costUsd ?? null, agents: outcome.agents ?? null }
  report.workflowResult = outcome.result
  console.log(`   composed in ${secs(outcome.ms)}${outcome.costUsd != null ? ` · Claude Code estimate $${outcome.costUsd.toFixed(2)} (plan quota, not a bill)` : ""}`)

  // 5 ── local cross-check
  step(5, T, "local re-check (lint.mjs + verify.cjs, desktop and mobile)")
  const dir = join("output", "sites", id, `${o.date}-composer`)
  if (!existsSync(join(dir, "index.html"))) {
    console.log(`✗ no site: ${dir}/index.html missing`)
    report.ok = false
    report.totalMs = Date.now() - t0
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "first-site.json"), JSON.stringify(report, null, 2))
    return 1
  }
  const net = verifySite(dir)
  report.lint = { clean: net.lint?.clean ?? false, dashCount: net.lint?.dashCount ?? null, problems: net.lint?.problems ?? null }
  report.verify = { clean: net.verify?.clean ?? false, desktop: net.verify?.desktop ?? null, mobile: net.verify?.mobile ?? null }
  console.log(`   lint: ${report.lint.clean ? "clean" : "needs a look"} (${report.lint.dashCount ?? "?"} em/en dash(es)) · verify: ${report.verify.clean ? "clean" : "needs a look"}`)

  // 6 ── the beauty-gate's verdict
  step(6, T, "the blind judge's verdict")
  const r = outcome.result
  const gate = r?.passed?.find((x: any) => x.id === id) ?? r?.failed?.find((x: any) => x.id === id) ?? null
  report.gate = gate ? { pass: !!r.passed?.some((x: any) => x.id === id), loops: gate.loops ?? null, font: gate.font ?? null, verdict: gate.verdict ?? null, why: gate.why ?? null } : { pass: null, note: "Workflow result unreadable: see the site's control.md" }
  console.log(`   ${report.gate.pass === true ? "PASS" : report.gate.pass === false ? "FAIL" : "unknown"}${gate?.loops ? ` in ${gate.loops} round(s)` : ""}${gate?.font ? ` · fonts ${gate.font}` : ""}`)
  if (gate?.verdict?.reasons) for (const x of gate.verdict.reasons.slice(0, 4)) console.log(`   - ${x}`)

  // which of the owner's preferences it was built with : those the composer says it applied (only ids it was given)
  const said = Array.isArray(gate?.preferences) ? gate.preferences : []
  const rec = stampSite(dir, prefs, "first-site", { applied: said, traits: gate?.tone === "dark" || gate?.tone === "light" ? { tone: gate.tone } : {} })
  report.preferences = { given: prefs.map((p) => ({ id: p.id, text: p.text })), applied: (rec?.applied || []).map((p) => ({ id: p.id, text: p.text })) }
  if (prefs.length) console.log(`   built with ${report.preferences.applied.length} of your ${prefs.length} preference${prefs.length === 1 ? "" : "s"}${report.preferences.applied.length ? `: ${report.preferences.applied.map((p: PromptPref) => p.text).join(" · ")}` : ""}`)

  report.totalMs = Date.now() - t0
  report.ok = net.clean
  writeFileSync(join(dir, "first-site.json"), JSON.stringify(report, null, 2))
  console.log(`\n${net.clean ? "✓" : "⚠"} ${dir}/index.html in ${Math.round(report.totalMs / 60000)} min · report ${dir}/first-site.json`)
  console.log("  See the before / after in the cockpit: npm run backoffice")
  return net.clean ? 0 : 2
}

// --- CLI ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile() } catch { /* no .env: the environment alone */ }
  const argv = process.argv.slice(2)
  if (argv.includes("--help") || argv.includes("-h")) { console.log(USAGE); process.exit(0) }
  let opts: FirstSiteOptions | null = null
  try { opts = parseArgs(argv) } catch (e) { console.error(`✗ ${(e as Error).message}`); process.exit(1) }
  if (!opts) { console.error(`✗ give the address of a dated site, or --sample for a fictional one (try: npm run first-site -- --sample)\n\n${USAGE}`); process.exit(1) }
  if (opts.industry) opts = { ...opts, industry: normalizeIndustry(opts.industry) } // "plumber" → the canonical key
  let server: { url: string; close: () => Promise<void> } | null = null
  try {
    if (opts.sample) {
      const s = resolveSample(opts.sample)
      server = await serveDir(s.dir)
      opts = { ...opts, url: server.url, id: opts.id ?? s.id, name: opts.name ?? s.name, city: opts.city ?? s.city, industry: opts.industry ?? s.industry, phone: opts.phone ?? s.phone, email: opts.email ?? s.email }
      console.log(`▶ --sample ${opts.sample}: fictional dated site "${s.name}" (${s.dir}) served on ${server.url}`)
    }
    const code = await firstSite(opts)
    await server?.close()
    process.exit(code)
  } catch (e) { await server?.close().catch(() => {}); console.error(`✗ first-site: ${(e as Error).message.split("\n").slice(0, 3).join("\n")}`); process.exit(1) }
}
