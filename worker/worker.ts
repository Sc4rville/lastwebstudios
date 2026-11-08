/**
 * worker.ts — THE WORKER (the "autonomous generation" step, on the box).
 *
 * Runs AS A DAEMON on the box (Hetzner), next to the cockpit. The cockpit (Coolify container) cannot
 * generate anything itself (no Claude Code, no Playwright browsers): it QUEUES requests in the
 * `batch_requests` queue (Supabase). This worker TAKES them and does the real work:
 *
 *   1. atomic claim of the oldest waiting job (FOR UPDATE SKIP LOCKED)
 *   2. generation:
 *        · 'composer' mode      → `claude -p` (headless Claude Code) reads `worker/compose-worker.md` and
 *          orchestrates lead engine + compose-batch (premium custom work). ⇒ runs ON THE PLAN (plan-first),
 *          through CLAUDE_CODE_OAUTH_TOKEN — NOT the API. This is the main path.
 *        · 'template-fill' mode → `npm run pipeline` (poliform template, cheap, API). Secondary path.
 *   3. reindexAll() → the built sites show up in the cockpit (shared Supabase catalogue)
 *   4. marks the job done / error, logs.
 *
 * THE 24/7 CAGE (packages/shared/cage.ts):
 *   · STOP (the `STOP` file at the root, or the cockpit's button): no more jobs taken; the running agent is
 *     interrupted, its job put back in the queue; the worker EXITS (code 3, which the systemd unit does not restart).
 *     To resume: lift the STOP then `systemctl --user restart lws-worker`.
 *   · $/day budget (LWS_BUDGET_USD_DAY): reached ⇒ no job claimed until midnight UTC. Each agent gets
 *     `--max-budget-usd` = min(LWS_JOB_MAX_USD, what is left today). Each job records its spend (Claude Code's
 *     estimate) in the data/logs/spend.jsonl log, next to the boost's image/video credits.
 *
 * PREREQUISITES on the box (see worker/setup-box.sh): Node, Claude Code (`claude setup-token` → plan),
 * Playwright + browsers, `.env` with DATABASE_URL (Supabase pooler). One job at a time per worker.
 *
 * Usage: npm run worker   (or through systemd: lws-worker.service)
 */
import { spawn, execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { readdirSync, existsSync, writeFileSync, rmSync, statSync } from "node:fs"
import { hostname } from "node:os"
import { join } from "node:path"
import {
  claimNextBatch, getBatch, markBatchDone, markBatchError, appendBatchLog, reclaimStaleBatches, requeueBatch, capBuildBatch, type BatchRow,
} from "../packages/shared/batch.ts"
import { reindexAll, pruneGeneration } from "../packages/shared/reindex.ts"
import { closeDb, setMeta } from "../packages/shared/db.ts"
import { syncTree, storageReady } from "../packages/shared/storage.ts"
import { composerPrompt, editPrompt, researchPrompt } from "./prompts.ts"
import { promptPreferences, stampSite, type PromptPref } from "../learning/scripts/taste.ts"
import { composerDirs, markBuilding, settleBuilding, reapIncomplete as reapMarked } from "./building.ts"
import { readableEvent } from "../packages/llm/stream-events.ts"
import { planEnv, bareRisk } from "../packages/llm/adapters/claude-code.ts"
import { claudeAuth } from "../packages/llm/claude-code-status.ts"
import { coachModel } from "../packages/llm/models.ts"
import { workerClaudeArgs } from "./claude-args.ts"
import { stopState, budgetStatus, buildsStatus, jobBudgetUsd, recordSpend, recordBuild } from "../packages/shared/cage.ts"
import { lineSplitter } from "../packages/shared/lines.mjs"

try { process.loadEnvFile() } catch { /* no .env: read the environment (DATABASE_URL, plan token) */ }

if (!process.env.DATABASE_URL) {
  console.error("✗ DATABASE_URL missing — set it in .env (Supabase pooler, see docs/DEPLOY.md).")
  process.exit(1)
}

const WORKER_ID = `${process.env.WORKER_NAME || hostname()}#${process.pid}`
const POLL_MS = Number(process.env.WORKER_POLL_MS) || 15_000
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude"
// The agents' arguments (`--allowedTools …`, up-to-date tool names): ./claude-args.ts. Can be overridden: WORKER_CLAUDE_ARGS.
const CLAUDE_ARGS = workerClaudeArgs()
// how often the running agent checks the emergency stop (file + database)
const STOP_POLL_MS = Number(process.env.WORKER_STOP_POLL_MS) || 5_000
/** Exit code on STOP: the systemd unit carries `RestartPreventExitStatus=3` (no restart loop). */
const STOP_EXIT_CODE = 3

// `--bare` (which will become `-p`'s default in a future Claude Code version) reads NEITHER the plan's login
// NOR CLAUDE_CODE_OAUTH_TOKEN, and loads NEITHER the skills NOR CLAUDE.md: the composer would fail on every job.
// Refuse to start rather than fail job after job.
const BARE = bareRisk(CLAUDE_ARGS)
if (BARE) {
  console.error(`✗ ${BARE}: in it, Claude Code reads neither the plan's login nor CLAUDE_CODE_OAUTH_TOKEN, nor the repo's skills.`)
  console.error("  Remove it (WORKER_CLAUDE_ARGS / CLAUDE_CODE_SIMPLE). If a Claude Code version makes it the default, pin the previous version (see npm run doctor).")
  process.exit(1)
}

// plan-first: the agents run on the plan. ANTHROPIC_API_KEY is REMOVED from their environment (in -p, Claude
// Code always uses an API key that is present BEFORE the plan → API billing, or a failure if the key is dead).
// WORKER_PLAN_STRICT=0 keeps the key (the old behaviour: agents billed to the API when a key is set).
const agentEnv = (extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  process.env.WORKER_PLAN_STRICT === "0" ? { ...process.env, ...extra } : { ...planEnv(process.env), ...extra }

// who pays for the agents: the plan (API key removed from their env, the default) or the API (WORKER_PLAN_STRICT=0 + key)
const BILLING = process.env.WORKER_PLAN_STRICT === "0" && process.env.ANTHROPIC_API_KEY ? "api" : "plan"

let stopping = false
process.on("SIGTERM", () => { stopping = true })
process.on("SIGINT", () => { stopping = true })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// The prompts (composer / edit / research) are built in ./prompts.ts: text coming from a human
// (a comment) is injected there FENCED as data, the batch parameters validated (F-1).

// readableEvent (stream-json → one readable line): packages/llm/stream-events.ts, shared with first-site.

/** Runs a command, relays stdout/stderr into the batch's log. `translate` = transforms each
 * line (e.g. stream-json → readable); returns "" to skip a line. Resolves with the exit code. */
type RunResult = { code: number; limited: boolean; resetText: string; tokens: number; costUsd: number; stopped: boolean; budgetHit: boolean }

function runStreamed(
  cmd: string, args: string[], env: NodeJS.ProcessEnv, batchId: number, stdin?: string,
  translate?: (line: string) => string,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: process.cwd(), env, stdio: ["pipe", "pipe", "pipe"] })
    // EMERGENCY STOP during the job: STOP set → the agent is interrupted (SIGTERM, then SIGKILL after 10 s)
    let stopped = false, budgetHit = false
    const stopWatch = setInterval(async () => {
      if (stopped) return
      const st = await stopState().catch(() => null)
      if (!st?.on) return
      stopped = true
      appendBatchLog(batchId, `⏹ STOP (${st.source}: ${st.reason}): agent interrupted, job put back in the queue`)
      try { child.kill("SIGTERM") } catch { /* already gone */ }
      setTimeout(() => { try { child.kill("SIGKILL") } catch { /* */ } }, 10_000).unref()
    }, STOP_POLL_MS)
    let tail = "" // throttle: not EVERY line is written to the DB (too many UPDATEs), they are batched a little
    let flush: ReturnType<typeof setTimeout> | null = null
    let limited = false, resetText = "" // the plan's session limit detected?
    let tokens = 0, costUsd = 0 // REAL MEASURE: claude -p's `result` event carries the usage + the $ cost (session total, sub-agents included)
    const onLine = (raw: string) => {
      if (/(session|usage) limit|hit your (session|usage) limit/i.test(raw)) { limited = true; resetText = raw }
      if (/max[_ -]?budget/i.test(raw)) budgetHit = true // the agent hit its --max-budget-usd
      if (raw.includes('"type":"result"')) {
        try { const j = JSON.parse(raw); if (j.type === "result") {
          const u = j.usage || {}; tokens = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
          if (typeof j.total_cost_usd === "number") costUsd = j.total_cost_usd
        } } catch { /* not a JSON line */ }
      }
      const line = translate ? translate(raw) : raw
      if (!line) return // filtered line (noise)
      console.log(`[batch ${batchId}] ${line}`)
      tail += line + "\n"
      if (!flush) flush = setTimeout(() => { const t = tail; tail = ""; flush = null; appendBatchLog(batchId, t.trimEnd()) }, 1200)
    }
    // a line (and a UTF-8 character) cut between two pipe reads is stitched back: otherwise a `result` event
    // straddling two chunks is lost, and its spend with it (the cage's log under-counted)
    const nonEmpty = (l: string) => { if (l) onLine(l) }
    const out = lineSplitter(nonEmpty), errLines = lineSplitter(nonEmpty)
    child.stdout?.on("data", (buf: Buffer) => out.push(buf))
    child.stderr?.on("data", (buf: Buffer) => { if (!translate) errLines.push(buf) }) // in stream-json mode, stderr = noise
    child.on("error", (e) => { clearInterval(stopWatch); appendBatchLog(batchId, `✗ spawn ${cmd}: ${e.message}`); resolve({ code: -1, limited, resetText, tokens, costUsd, stopped, budgetHit }) })
    child.on("close", (code) => {
      clearInterval(stopWatch)
      out.end(); errLines.end()
      if (flush) { clearTimeout(flush); appendBatchLog(batchId, tail.trimEnd()) }
      resolve({ code: code ?? -1, limited, resetText, tokens, costUsd, stopped, budgetHit })
    })
    if (stdin !== undefined) { child.stdin?.write(stdin); child.stdin?.end() }
  })
}

/** Every composer site that has an index.html (key "id/dir") — to spot a batch's NEW ones. */
function composerSites(): Set<string> {
  const out = new Set<string>()
  const base = "output/sites"
  if (!existsSync(base)) return out
  for (const id of readdirSync(base)) {
    let dates: string[] = []
    try { dates = readdirSync(join(base, id)) } catch { continue }
    for (const d of dates) if (/-composer$/.test(d) && existsSync(join(base, id, d, "index.html"))) out.add(`${id}/${d}`)
  }
  return out
}

/** Pushes a composed site's media to the Storage bucket (local, VM and salesport read the same
 *  source — no more rsync, and the VM finally serves the gitignored hero.mp4). `.storaged` marker → idempotent. */
async function storageSync(site: string): Promise<void> {
  if (!storageReady()) return // no key → stay FS-only (zero regression)
  const [id, date] = site.split("/")
  const dir = join("output", "sites", id, date)
  const marker = join(dir, ".storaged")
  if (existsSync(marker)) return
  // RESILIENT: a flaky upload must not leave a site silently invisible → 3 tries, then a LOUD
  // log (not a buried warning). The `.storaged` marker is only written on success → a failure
  // is picked up again at the next storageBackfill (startup) or healStuckSites (idle).
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const n = await syncTree(dir, `sites/${id}/${date}`)
      writeFileSync(marker, ""); if (n > 0) console.log(`☁️  ${site} → bucket (${n} files)`)
      return
    } catch (e) {
      console.warn(`storageSync ${site} (try ${attempt}/3): ${(e as Error).message}`)
      if (attempt < 3) await sleep(2000)
      else console.error(`🚨 storageSync ${site} FAILED after 3 tries — site NOT in the bucket (picked up again at the backfill)`)
    }
  }
}

/** Backfill: pushes to the bucket every composer site not synced yet (when the worker starts).
 *  Idempotent (`.storaged` marker) → the first loop migrates what exists, the next ones redo nothing. */
async function storageBackfill(): Promise<void> {
  if (!storageReady()) return
  const sites = [...composerSites()].filter((s) => !existsSync(join("output", "sites", ...s.split("/"), ".storaged")))
  if (!sites.length) return
  console.log(`☁️  Storage backfill: ${sites.length} site(s) to push…`)
  for (const s of sites) await storageSync(s)
}

/** Reap: deletes INTERRUPTED composer builds, that is only the folders the worker itself
 *  marked `.lws-building` (see ./building.ts), left without index.html or `.reviewing`, the marker
 *  still for 15 min. An unmarked folder (versioned, from another machine) is NEVER deleted.
 *  Also purges the database row. Runs when the worker is idle. */
async function reapIncomplete(): Promise<number> {
  return (await reapMarked(join("output", "sites"), { prune: pruneGeneration })).length
}

/** Heal: the MIRROR of reapIncomplete. A composed site (index.html present) but stuck in
 *  `.reviewing` = the coach's finalisation INTERRUPTED (worker killed, session limit, flaky upload). The
 *  reindex re-gates any site with `.reviewing` (present=0) → the finished site becomes INVISIBLE in the cockpit, without
 *  an alert (the stylroc bug of 06/22). If `.reviewing` is OLD (the coach never takes more than ~15 min), it
 *  concludes the finalisation died → it PUBLISHES: removes `.reviewing` + (re)pushes to the bucket. "a finished site
 *  must NEVER stay invisible". Runs when idle, like reapIncomplete. */
async function healStuckSites(): Promise<number> {
  const base = "output/sites"; if (!existsSync(base)) return 0
  const STUCK_MS = 15 * 60 * 1000
  let n = 0
  for (const id of readdirSync(base)) {
    let dates: string[] = []; try { dates = readdirSync(join(base, id)) } catch { continue }
    for (const d of dates) {
      if (!/-composer$/.test(d)) continue
      const dir = join(base, id, d), rev = join(dir, ".reviewing")
      if (!existsSync(join(dir, "index.html")) || !existsSync(rev)) continue
      let age = Infinity; try { age = Date.now() - statSync(rev).mtimeMs } catch { /* */ }
      if (age < STUCK_MS) continue                              // coach probably still at work → leave it
      try { rmSync(rev, { force: true }) } catch { /* */ }       // dead finalisation → publish
      try { await storageSync(`${id}/${d}`) } catch { /* */ }    // make sure the bucket has the site
      console.log(`🩹 heal: ${id}/${d} unblocked (.reviewing ${Math.round(age / 60000)} min old)`)
      n++
    }
  }
  return n
}

/** A prospect's trade (so the coach reads the right playbook). */
async function siteIndustry(id: string): Promise<string> {
  try { const p = JSON.parse(await readFile(join("data", "prospects", `${id}.json`), "utf8")); return p.industry || "" } catch { return "" }
}

/** Post-composition GUARD: the coach (worker/coach.mjs) looks at a site's SERVED render and loops its
 *  fixes back to the composer. Its output is streamed to the batch's log prefixed "🔎 coach" → the cockpit
 *  detects the coach phase. Never breaks the batch (errors swallowed). */
function runCoach(batchId: number, id: string, date: string, industry: string): Promise<void> {
  return new Promise((resolve) => {
    const args = ["worker/coach.mjs", id, date]
    if (industry) args.push("--industry", industry)
    // the coach runs `claude -p` itself (plan): the smart role's model (packages/llm/models.ts), unless COACH_MODEL
    const child = spawn("node", args, { cwd: process.cwd(), env: { ...process.env, COACH_MODEL: coachModel() }, stdio: ["ignore", "pipe", "pipe"] })
    let tail = ""; let flush: ReturnType<typeof setTimeout> | null = null
    const onLine = (raw: string) => {
      const s = raw.trim(); if (!s) return
      const line = `🔎 coach · ${s.slice(0, 140)}`
      console.log(`[batch ${batchId}] ${line}`)
      tail += line + "\n"
      if (!flush) flush = setTimeout(() => { const t = tail; tail = ""; flush = null; appendBatchLog(batchId, t.trimEnd()) }, 1200)
    }
    const out = lineSplitter(onLine), errLines = lineSplitter(onLine)
    child.stdout?.on("data", (buf: Buffer) => out.push(buf)); child.stderr?.on("data", (buf: Buffer) => errLines.push(buf))
    child.on("close", () => { out.end(); errLines.end(); if (flush) { clearTimeout(flush); appendBatchLog(batchId, tail.trimEnd()) } resolve() })
    child.on("error", (e) => { appendBatchLog(batchId, `🔎 coach: spawn KO ${e.message}`); resolve() })
  })
}

/** A `claude -p` agent's arguments: the tool list + the job's $ cap (min(LWS_JOB_MAX_USD, what is left today)). */
function agentArgs(): string[] {
  const cap = jobBudgetUsd()
  return [...CLAUDE_ARGS, ...(cap != null && cap > 0 ? ["--max-budget-usd", String(cap)] : []), "--output-format", "stream-json", "--verbose"]
}

/** Records an agent's spend in the log (Claude Code's estimate, `total_cost_usd`). */
function spend(b: BatchRow, r: RunResult): void {
  if (!r.costUsd && !r.tokens) return
  recordSpend({ kind: "agent", source: `worker:${b.mode}`, usd: r.costUsd || 0, tokens: r.tokens, batchId: b.id, billing: BILLING, estimated: BILLING === "plan" })
}

/** Runs ONE claimed batch: generates (composer or template-fill) → reindex → marks the result. */
async function runBatch(b: BatchRow): Promise<void> {
  const label = `#${b.id} ${b.mode}${b.industry ? ` · ${b.industry}` : ""}${b.lim ? ` · ${b.lim}` : ""} (by ${b.requested_by || "?"})`
  console.log(`▶ batch ${label}`)
  await appendBatchLog(b.id, `▶ started by ${WORKER_ID} — mode ${b.mode}`)
  const t0 = Date.now()
  // composer sites that exist BEFORE the run → we will know which ones are NEW (to hand to the coach afterwards).
  const beforeSites = b.mode === "composer" ? composerSites() : new Set<string>()

  // plan-first: by default, the pipeline (lead engine + fill) runs ON THE PLAN (claude -p), not the API.
  // Essential when the API credit is at zero. Can be overridden with WORKER_LLM_VIA=api.
  const LLM_VIA = process.env.WORKER_LLM_VIA || "plan"

  let res: RunResult
  let tastePrefs: PromptPref[] = []
  if (b.mode === "research") {
    // RESEARCH, automatic (on approval) or manual (the "resolve" button): for each id, a claude -p agent
    // resolves the missing contacts + runs /account-research → brief + call script,
    // saved in the shared DB (crm_leads / outreach). Idempotent, bounded, without coach or heavy reindex.
    let ids: string[] = [], openings: Record<string, unknown> = {}
    try { const pj = JSON.parse(b.params_json || "{}"); ids = (pj.ids as string[]) || []; if (pj.openings && typeof pj.openings === "object") openings = pj.openings } catch { /* malformed params_json */ }
    if (!ids.length) { await markBatchError(b.id, "research: params_json {ids} missing"); return }
    const env = agentEnv({ LLM_VIA })
    res = { code: 0, limited: false, resetText: "", tokens: 0, costUsd: 0, stopped: false, budgetHit: false }
    for (const id of ids) {
      await appendBatchLog(b.id, `🔬 research + call script: ${id}`)
      const prompt = await researchPrompt(id, ".", typeof openings[id] === "string" ? openings[id] : null)
      const r = await runStreamed(CLAUDE_BIN, agentArgs(), env, b.id, prompt, readableEvent)
      spend(b, r)
      res.tokens += r.tokens; res.costUsd += r.costUsd
      if (r.limited || r.stopped) { res = { ...r, tokens: res.tokens, costUsd: res.costUsd }; break } // limit / STOP → handled below
      if (r.code !== 0) { res.code = r.code; res.budgetHit ||= r.budgetHit } // keeps the last failure (best effort per prospect)
    }
  } else if (b.mode === "edit") {
    // A site's FEEDBACK, ON THE BOX. COMPOSER (bespoke) site → a claude -p agent that edits the HTML/CSS
    // directly (the surgical editor only works on template-fill, it needs an inventory).
    // Template-fill site → `npm run edit` (surgical). Target {id,date} in params_json.
    let id = "", date = ""
    try { const p = JSON.parse(b.params_json || "{}"); id = p.id; date = p.date } catch { /* */ }
    if (!id || !date) { await markBatchError(b.id, "edit: params_json {id,date} missing"); return }
    const isComposer = /-composer$/.test(date)
    await appendBatchLog(b.id, `✍️ feedback on ${id} / ${date}${isComposer ? " (bespoke → agent)" : " (surgical)"}`)
    if (isComposer) {
      const env = agentEnv({ LLM_VIA })
      // the owner's preferences (D6) : the edit agent keeps to them, the site's record says which ones it applies
      const prefs = await promptPreferences()
      const prompt = await editPrompt(id, date, ".", prefs)
      res = await runStreamed(CLAUDE_BIN, agentArgs(), env, b.id, prompt, readableEvent)
      try { stampSite(join("output", "sites", id, date), prefs, "edit") } catch { /* the site still shows */ }
      spend(b, res)
    } else {
      res = await runStreamed("npm", ["run", "edit", "--", id, date], { ...process.env, LLM_VIA }, b.id)
    }
  } else if (b.mode === "template-fill") {
    // the cheap/deterministic path: npm run pipeline with the batch's env (on the plan by default)
    const env: NodeJS.ProcessEnv = { ...process.env, PIPELINE_JSON: "1", LLM_VIA }
    if (b.seed) env.SEED = b.seed
    if (b.lim) env.LIMIT = String(b.lim)
    if (b.force_flag) env.FORCE = "1"
    res = await runStreamed("npm", ["run", "pipeline"], env, b.id)
  } else {
    // the premium path (composer): a headless Claude Code agent, ON THE PLAN (claude.ai login or
    // CLAUDE_CODE_OAUTH_TOKEN). The agent runs the lead engine itself (`npm run pipeline DESIGN=0`), whose
    // structuring goes through runSkill → the LWS_LLM path (claude-code by default, so the plan too). The API key
    // is removed from the env (agentEnv): PURE plan by default. WORKER_PLAN_STRICT=0 = the old behaviour.
    const env = agentEnv({ LLM_VIA }) // the agent AND its sub-pipeline on the plan
    // the owner's preferences (D6) : given to each composer through the Workflow's args, recorded with each new site
    tastePrefs = await promptPreferences()
    const prompt = await composerPrompt(b, ".", process.env, tastePrefs)
    // stream-json + verbose → the agent emits ALL its events (tools, files, sub-agents), which are
    // turned into readable progress in the batch's log (transparency: watch the agent work).
    const args = agentArgs()
    // BUILD MARKER: each composer folder created during THIS run carries `.lws-building` (refreshed
    // every 10 s) as long as it has no index.html → only what is marked can be cleaned up when idle.
    const sitesBase = join("output", "sites")
    const before = composerDirs(sitesBase)
    const mark = () => { try { markBuilding(sitesBase, before, { batchId: b.id, worker: WORKER_ID }) } catch { /* best-effort */ } }
    const beat = setInterval(mark, 10_000)
    try { res = await runStreamed(CLAUDE_BIN, args, env, b.id, prompt, readableEvent); spend(b, res) }
    finally {
      clearInterval(beat)
      mark()
      const { unfinished } = settleBuilding(sitesBase, before)
      if (unfinished.length) await appendBatchLog(b.id, `🚧 ${unfinished.length} build(s) without index.html (marked .lws-building, cleaned up when idle if they stop moving): ${unfinished.join(", ")}`)
    }
  }

  // STOP during the job: nothing is published, the job goes back in the queue (it resumes when the worker restarts)
  if (res.stopped) {
    await requeueBatch(b.id, Date.now(), "STOP: job interrupted by the emergency stop, resumed when the worker is restarted")
    console.log(`⏹ batch #${b.id} interrupted by STOP → put back in the queue`)
    try { await reindexAll() } catch { /* */ }
    return
  }

  // THE COACH GATE (composer): the coach runs BEFORE publishing. The new sites are first marked
  // `.reviewing` (→ the reindex keeps them UNPUBLISHED, "coach at work", NEVER the draft), the coach
  // reviews/fixes them, THEN the marker is removed and the reviewed/fixed result published. WORKER_NO_COACH=1 turns it off.
  const coachOn = b.mode === "composer" && process.env.WORKER_NO_COACH !== "1"
  const newSites = b.mode === "composer" ? [...composerSites()].filter((s) => !beforeSites.has(s)) : []
  // each new site counts in today's builds (the daily cap is said in builds : LWS_BUILDS_PER_DAY or derived)
  for (const s of newSites) recordBuild({ id: s.split("/")[0], source: `worker:${WORKER_ID}`, batchId: b.id })
  // each new site says which of the owner's preferences it was built with (given, and those its composer says it applied)
  for (const s of newSites) { try { stampSite(join("output", "sites", s), tastePrefs, "composer") } catch { /* */ } }
  const freshSites = coachOn ? newSites : []
  for (const s of freshSites) { try { writeFileSync(join("output", "sites", s, ".reviewing"), "") } catch { /* */ } }

  // reindex (the fresh composer sites stay GATED while `.reviewing` is there → no draft in the cockpit)
  let indexed = ""
  try { const r = await reindexAll(); indexed = `${r.generations} builds indexed` }
  catch (e) { indexed = `reindex failed: ${(e as Error).message}` }

  // the GUARD: reviews each new site (SERVED render) + loops its fixes back to the composer, THEN publishes
  if (freshSites.length) {
    try {
      // a STABLE marker per prospect → the cockpit (regex `id`) shows a "build" card that fills
      // site by site, EVEN in parallel composition (before: fragile phrasing → no card for multi batches).
      await appendBatchLog(b.id, "🎬 " + freshSites.map((s) => "`" + s.split("/")[0] + "`").join(" "))
      await appendBatchLog(b.id, `🔎 coach — ${freshSites.length} site(s) under review BEFORE publishing`)
      for (const s of freshSites) {
        const [id, date] = s.split("/")
        await runCoach(b.id, id, date, await siteIndustry(id))
        try { rmSync(join("output", "sites", s, ".reviewing"), { force: true }) } catch { /* */ } // review over → publishable
        // custom cursor: OFF by default (the trailing "hollow sphere" v1 feels like a gimmick → to rework
        // as a skill, see [[motion-intentional-no-gimmicks]]). Opt in with CURSOR_INJECT=1 when v2 is ready.
        if (process.env.CURSOR_INJECT === "1") {
          try { execFileSync("node", ["worker/inject-cursor.mjs", join("output", "sites", s)], { stdio: "ignore" }) } catch { /* */ }
        }
        await storageSync(s) // media (hero.mp4 included) → bucket: the VM serves them even when gitignored
      }
      await reindexAll() // publishes the reviewed/fixed sites (the coach may have edited / marked 'a-revoir')
    } catch (e) { await appendBatchLog(b.id, `🔎 coach: error ${(e as Error).message}`) }
  }

  const ms = Date.now() - t0
  if (res.code === 0) {
    await markBatchDone(b.id, { ok: true, ms, indexed, worker: WORKER_ID, tokens: res.tokens, costUsd: res.costUsd })
    console.log(`✓ batch #${b.id} done in ${Math.round(ms / 1000)}s — ${indexed} — ${res.tokens ? `${Math.round(res.tokens / 1000)}k tokens · $${res.costUsd.toFixed(2)}` : "usage n/a"}`)
  } else if (res.limited) {
    // THE PLAN'S SESSION LIMIT → do NOT end in error: PAUSE and resume on its own
    // after the reset (generation skips the sites already composed → resuming = only what is left).
    const retryAfter = nextReset(res.resetText)
    const when = new Date(retryAfter).toISOString().slice(11, 16)
    const r = await requeueBatch(b.id, retryAfter, `the plan's session limit — resumes automatically around ${when} UTC`)
    console.log(`⏸ batch #${b.id} ${r === "gaveup" ? "given up (too many tries)" : `paused → resumes ${when} UTC`}`)
  } else if (res.budgetHit) {
    await markBatchError(b.id, `the job's $ cap was reached (--max-budget-usd, see LWS_JOB_MAX_USD / LWS_BUDGET_USD_DAY) · ${indexed}`)
    console.log(`💸 batch #${b.id} stopped by its $ cap — ${indexed}`)
  } else {
    await markBatchError(b.id, `exit code ${res.code} (${indexed})`)
    console.log(`✗ batch #${b.id} failed (code ${res.code}) — ${indexed}`)
  }
}

// Works out when to resume after a session limit. Reads "resets 3:40am (UTC)" when present
// (next UTC occurrence), otherwise +60 min. Bounded to [now+10min, now+6h]: robust even if the parse misses.
function nextReset(text: string): number {
  const now = Date.now()
  const m = /resets?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text || "")
  let target = now + 60 * 60_000
  if (m) {
    let h = parseInt(m[1], 10); const min = m[2] ? parseInt(m[2], 10) : 0; const ap = (m[3] || "").toLowerCase()
    if (ap === "pm" && h < 12) h += 12
    if (ap === "am" && h === 12) h = 0
    const d = new Date(now); d.setUTCHours(h, min, 0, 0)
    if (d.getTime() <= now) d.setUTCDate(d.getUTCDate() + 1) // already past today → tomorrow
    target = d.getTime() + 2 * 60_000 // a small buffer after the reset
  }
  return Math.min(Math.max(target, now + 10 * 60_000), now + 6 * 60 * 60_000)
}

async function main(): Promise<void> {
  // what will the agents run on? (the old "plan OFF (API)" showed as soon as CLAUDE_CODE_OAUTH_TOKEN
  // was missing, even with a valid claude.ai login: wrong. `claude auth status` is read now.)
  const auth = claudeAuth(CLAUDE_BIN, process.env.WORKER_PLAN_STRICT === "0" ? process.env : planEnv(process.env))
  const b0 = budgetStatus()
  console.log(`✓ lws worker — ${WORKER_ID} · claude ${auth.version ?? "?"} · ${auth.label} · poll ${POLL_MS}ms · budget ${b0.capUsd != null ? `$${b0.spentUsd} of $${b0.capUsd} today` : "no cap (LWS_BUDGET_USD_DAY)"}`)
  if (!auth.installed) console.warn(`⚠ ${CLAUDE_BIN} not found: the composer / edit / research modes will fail (npm run doctor).`)
  else if (!auth.loggedIn) console.warn("⚠ Claude Code is not signed in: `claude auth login` (subscription) or `claude setup-token` → CLAUDE_CODE_OAUTH_TOKEN (see worker/README.md).")
  // at startup: a job left 'running' (worker killed mid-run) goes to 'error' (no zombie)
  try { const n = await reclaimStaleBatches(); if (n) console.log(`⚠ ${n} zombie job(s) cleaned up`) } catch { /* */ }
  // Storage backfill in the background (does not block the claim): pushes what exists to the bucket once.
  storageBackfill().catch((e) => console.warn(`Storage backfill: ${(e as Error).message}`))

  // `--job <id>` : run ONE job already claimed by the cockpit's built-in engine, then exit (same code path)
  const jobArg = process.argv.indexOf("--job")
  if (jobArg >= 0) {
    const id = Number(process.argv[jobArg + 1])
    const b = await getBatch(id)
    if (!b) { console.error(`✗ job #${id} not found`); closeDb(); process.exit(2) }
    try { await runBatch(b) } catch (e) { try { await markBatchError(b.id, (e as Error).message) } catch { /* */ } }
    closeDb(); return
  }
  let exitCode = 0, budgetLogged = ""
  while (!stopping) {
    // heartbeat : the cockpit's built-in engine stays out of the way while a real worker is alive
    await setMeta("worker.heartbeat", JSON.stringify({ id: WORKER_ID, at: Date.now() })).catch(() => {})
    // THE CAGE, at every tick: STOP first (exit), then today's budget (claim nothing)
    const st = await stopState().catch(() => null)
    if (st?.on) {
      console.log(`⏹ STOP (${st.source}: ${st.reason}) — the worker stops, no job is taken.`)
      console.log(`  To resume: ${st.source === "fichier" ? "rm STOP" : "the cockpit's Resume button"}, then restart the worker (systemctl --user restart lws-worker).`)
      exitCode = STOP_EXIT_CODE
      break
    }
    const bs = budgetStatus()
    if (bs.reached) {
      if (budgetLogged !== bs.day) { console.log(`💸 today's budget reached: $${bs.spentUsd} of $${bs.capUsd} → no job claimed until ${bs.resetsAt.slice(11, 16)} UTC on ${bs.resetsAt.slice(0, 10)}`); budgetLogged = bs.day }
      await sleep(POLL_MS); continue
    }
    // today's cap in builds reached : no new build is claimed (feedback edits and call scripts still are)
    const bl = buildsStatus()
    let b: BatchRow | null = null
    try { b = await claimNextBatch(WORKER_ID, bl.reached ? ["edit", "research"] : undefined) }
    catch (e) { console.warn(`⚠ claim failed: ${(e as Error).message}`); await sleep(POLL_MS); continue }
    // a build job past what is left today keeps what fits ; the rest waits for tomorrow in a job of its own
    if (b && b.mode === "composer") {
      try { const cap = await capBuildBatch(b); if (!cap.run) { console.log(`⏸ job #${b.id}: today's cap of ${bl.cap} builds is reached, it waits for tomorrow`); continue } } catch (e) { console.warn(`⚠ builds cap: ${(e as Error).message}`) }
    }

    if (!b) {
      // empty queue → clean up interrupted runs (composer folders without index.html), then wait
      try { const r = await reapIncomplete(); if (r) { console.log(`🧹 ${r} interrupted folder(s) cleaned up`); await reindexAll().catch(() => {}) } } catch { /* */ }
      try { const h = await healStuckSites(); if (h) { console.log(`🩹 ${h} stuck site(s) unblocked → published again`); await reindexAll().catch(() => {}) } } catch { /* */ }
      await sleep(POLL_MS); continue
    }
    // HEAL BEFORE each batch (not only when idle): during a run of several batches in a row,
    // the worker is NEVER idle → a site stuck in .reviewing would stay "incomplete" for the whole run.
    // Here the stuck ones (>15 min) of the previous batch are unblocked before the next one starts. "never again".
    try { const h = await healStuckSites(); if (h) { console.log(`🩹 ${h} site(s) unblocked before #${b.id}`); await reindexAll().catch(() => {}) } } catch { /* */ }
    try { await runBatch(b) }
    catch (e) { try { await markBatchError(b.id, (e as Error).message) } catch { /* */ } }
  }

  if (!exitCode) console.log("⏹ stop requested — clean shutdown.")
  closeDb()
  if (exitCode) process.exit(exitCode)
}

main().catch((e) => { console.error("✗ worker:", e); closeDb(); process.exit(1) })
