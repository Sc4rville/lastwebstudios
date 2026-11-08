/**
 * workflow-local.ts · runs a Workflow script (e.g. compose-batch.workflow.js) WITHOUT Claude Code's Workflow
 * tool: the orchestration (pipeline, loops, beauty-gate) runs here in Node, each `agent()` becomes a
 * `claude -p` (structured output `--json-schema` when the script gives a schema).
 *
 * Why: the Workflow tool does not exist everywhere (a Pro subscription without "Dynamic workflows" turned on, old
 * CLIs, Claude Code plugged into a local model). Same prompts, same schemas, same loop logic: only the
 * orchestration engine changes. It is first-site's "single agent" fallback (one agent at a time).
 *
 * A Workflow script's contract (code.claude.com/docs/en/workflows): `export const meta = {…}` then an async
 * body that uses args / agent / pipeline / parallel / phase / log / budget, and `return`s a result.
 */
import { readFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { parseJson } from "../../packages/llm/json.ts"
import { planEnv } from "../../packages/llm/adapters/claude-code.ts"
import { readableEvent } from "../../packages/llm/stream-events.ts"
import { lineSplitter, textCollector } from "../../packages/shared/lines.mjs"

export type AgentOpts = { label?: string; phase?: string; schema?: Record<string, unknown>; model?: string; effort?: string }
export type AgentCall = { prompt: string; opts: AgentOpts; index: number }
export type AgentResult = { value: any; costUsd?: number; ms: number }
export type AgentRunner = (call: AgentCall) => Promise<AgentResult>

export type LocalRun = {
  result: any
  agents: { index: number; label: string; phase: string; ok: boolean; ms: number; costUsd?: number; error?: string }[]
  costUsd: number
  ms: number
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...a: string[]) => (...v: unknown[]) => Promise<unknown>

/** The runnable body of a Workflow script: `export const meta` becomes a plain constant. */
export function workflowBody(src: string): string {
  return src.replace(/^\s*export\s+const\s+meta\s*=/m, "const meta =")
}

export async function runWorkflowFile(scriptPath: string, args: unknown, runner: AgentRunner, o: { log?: (s: string) => void; concurrency?: number } = {}): Promise<LocalRun> {
  return runWorkflowSource(await readFile(scriptPath, "utf8"), args, runner, o)
}

export async function runWorkflowSource(src: string, args: unknown, runner: AgentRunner, o: { log?: (s: string) => void; concurrency?: number } = {}): Promise<LocalRun> {
  const log = o.log ?? ((s: string) => console.log(s))
  const limit = Math.max(1, o.concurrency ?? 1)
  const agents: LocalRun["agents"] = []
  let currentPhase = ""
  let active = 0
  const waiters: (() => void)[] = []
  const acquire = async () => { while (active >= limit) await new Promise<void>((r) => waiters.push(r)); active++ }
  const release = () => { active--; waiters.shift()?.() }
  let n = 0
  const t0 = Date.now()

  // agent(): like the Workflow tool, a dead agent does not crash the script, it returns null
  const agent = async (prompt: string, opts: AgentOpts = {}) => {
    const index = ++n
    const label = opts.label ?? `agent#${index}`
    const phase = opts.phase ?? currentPhase
    await acquire()
    const t = Date.now()
    try {
      log(`▶ ${phase ? `[${phase}] ` : ""}${label}${opts.model ? ` (${opts.model})` : ""}`)
      const r = await runner({ prompt, opts, index })
      agents.push({ index, label, phase, ok: true, ms: r.ms, costUsd: r.costUsd })
      log(`✓ ${label} in ${Math.round(r.ms / 1000)} s`)
      return r.value
    } catch (e) {
      const error = (e as Error).message.split("\n")[0].slice(0, 300)
      agents.push({ index, label, phase, ok: false, ms: Date.now() - t, error })
      log(`✗ ${label}: ${error}`)
      return null
    } finally { release() }
  }
  // pipeline(): each item goes through every stage; a stage that throws turns the item into null
  const pipeline = async (items: unknown[], ...stages: ((prev: any, item: any, i: number) => Promise<any>)[]) =>
    Promise.all(items.map(async (item, i) => {
      let prev: any = item
      for (const stage of stages) {
        try { prev = await stage(prev, item, i) } catch (e) { log(`✗ stage abandoned for item ${i}: ${(e as Error).message.split("\n")[0]}`); return null }
      }
      return prev
    }))
  const parallel = async (thunks: (() => Promise<any>)[]) => Promise.all(thunks.map((t) => t().catch(() => null)))
  const phase = (title: string) => { currentPhase = title; log(`── ${title}`) }
  const budget = { total: null, spent: () => 0, remaining: () => Infinity }
  const workflow = () => { throw new Error("nested workflow() is not supported by the local engine") }

  const fn = new AsyncFunction("args", "agent", "pipeline", "parallel", "phase", "log", "budget", "workflow", workflowBody(src))
  const result = await fn(args, agent, pipeline, parallel, phase, log, budget, workflow)
  const costUsd = agents.reduce((s, a) => s + (a.costUsd ?? 0), 0)
  return { result, agents, costUsd, ms: Date.now() - t0 }
}

/** A composition agent's tools (the same rights as a Workflow sub-agent on the box). */
export const AGENT_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Skill", "WebFetch"]

/**
 * The `claude -p` runner: one agent = one process, native structured output when there is a schema, readable progress.
 * On the plan (ANTHROPIC_API_KEY removed), with no MCP server (neither the repo's .mcp.json nor claude.ai connectors).
 */
export function claudeAgentRunner(o: { bin?: string; cwd?: string; env?: Record<string, string | undefined>; timeoutMs?: number; log?: (s: string) => void; tools?: string[] } = {}): AgentRunner {
  const bin = o.bin ?? process.env.CLAUDE_BIN ?? "claude"
  const log = o.log ?? ((s: string) => console.log(s))
  const timeoutMs = o.timeoutMs ?? Number(process.env.LWS_AGENT_TIMEOUT_MS ?? 45 * 60_000)
  return ({ prompt, opts }) => new Promise((resolve, reject) => {
    const args = ["-p", "--output-format", "stream-json", "--verbose", "--strict-mcp-config", "--allowedTools", ...(o.tools ?? AGENT_TOOLS)]
    if (opts.model) args.push("--model", opts.model)
    if (opts.schema) args.push("--json-schema", JSON.stringify(opts.schema))
    const t0 = Date.now()
    const child = spawn(bin, args, { cwd: o.cwd, env: planEnv(o.env ?? process.env), stdio: ["pipe", "pipe", "pipe"] })
    let final: any = null
    const errOut = textCollector(64_000)
    const timer = setTimeout(() => { try { child.kill("SIGTERM") } catch { /* */ } }, timeoutMs)
    // lines and UTF-8 characters stitched back together across pipe reads: the `result` (the agent's value) is never cut
    const out = lineSplitter((line) => {
      if (line.includes('"type":"result"')) { try { final = JSON.parse(line) } catch { /* */ } }
      const r = readableEvent(line)
      if (r && !r.startsWith("✓ ")) log(`   ${opts.label ?? ""} ${r}`)
    })
    child.stdout.on("data", (b: Buffer) => out.push(b))
    child.stderr.on("data", (b: Buffer) => errOut.push(b))
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`spawn ${bin}: ${e.message}`)) })
    child.on("close", (code) => {
      clearTimeout(timer)
      out.end()
      const err = errOut.text()
      const ms = Date.now() - t0
      if (!final) return reject(new Error(`claude -p (code ${code}) without a result: ${err.slice(0, 300)}`))
      if (final.is_error || final.subtype !== "success") return reject(new Error(`claude -p failed (${final.subtype}): ${String(final.result ?? "").slice(0, 300)}`))
      const costUsd = typeof final.total_cost_usd === "number" ? final.total_cost_usd : undefined
      if (!opts.schema) return resolve({ value: String(final.result ?? ""), costUsd, ms })
      if (final.structured_output && typeof final.structured_output === "object") return resolve({ value: final.structured_output, costUsd, ms })
      try { resolve({ value: parseJson(String(final.result ?? "")), costUsd, ms }) } catch (e) { reject(e as Error) }
    })
    child.stdin.on("error", () => { /* */ })
    child.stdin.write(prompt)
    child.stdin.end()
  })
}
