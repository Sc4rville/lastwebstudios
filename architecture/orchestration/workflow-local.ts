/**
 * workflow-local.ts · exécute un script Workflow (ex. compose-batch.workflow.js) SANS l'outil Workflow de Claude
 * Code : l'orchestration (pipeline, boucles, beauty-gate) tourne ici en Node, chaque `agent()` devient un
 * `claude -p` (sortie structurée `--json-schema` quand le script donne un schéma).
 *
 * Pourquoi : l'outil Workflow n'existe pas partout (abonnement Pro sans « Dynamic workflows » activé, vieilles
 * CLI, Claude Code branché sur un modèle local). Mêmes prompts, mêmes schémas, même logique de boucle : seul le
 * moteur d'orchestration change. C'est le repli « mono-agent » de first-site (un agent à la fois).
 *
 * Contrat d'un script Workflow (code.claude.com/docs/en/workflows) : `export const meta = {…}` puis un corps
 * async qui utilise args / agent / pipeline / parallel / phase / log / budget, et `return` un résultat.
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

/** Le corps exécutable d'un script Workflow : `export const meta` devient une simple constante. */
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

  // agent() : comme l'outil Workflow, un agent mort ne fait pas planter le script, il rend null
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
      log(`✓ ${label} en ${Math.round(r.ms / 1000)} s`)
      return r.value
    } catch (e) {
      const error = (e as Error).message.split("\n")[0].slice(0, 300)
      agents.push({ index, label, phase, ok: false, ms: Date.now() - t, error })
      log(`✗ ${label} : ${error}`)
      return null
    } finally { release() }
  }
  // pipeline() : chaque item traverse toutes les étapes ; une étape qui lève fait tomber l'item à null
  const pipeline = async (items: unknown[], ...stages: ((prev: any, item: any, i: number) => Promise<any>)[]) =>
    Promise.all(items.map(async (item, i) => {
      let prev: any = item
      for (const stage of stages) {
        try { prev = await stage(prev, item, i) } catch (e) { log(`✗ étape abandonnée pour l'item ${i} : ${(e as Error).message.split("\n")[0]}`); return null }
      }
      return prev
    }))
  const parallel = async (thunks: (() => Promise<any>)[]) => Promise.all(thunks.map((t) => t().catch(() => null)))
  const phase = (title: string) => { currentPhase = title; log(`── ${title}`) }
  const budget = { total: null, spent: () => 0, remaining: () => Infinity }
  const workflow = () => { throw new Error("workflow() imbriqué non supporté par le moteur local") }

  const fn = new AsyncFunction("args", "agent", "pipeline", "parallel", "phase", "log", "budget", "workflow", workflowBody(src))
  const result = await fn(args, agent, pipeline, parallel, phase, log, budget, workflow)
  const costUsd = agents.reduce((s, a) => s + (a.costUsd ?? 0), 0)
  return { result, agents, costUsd, ms: Date.now() - t0 }
}

/** Outils d'un agent de composition (mêmes droits qu'un sous-agent du Workflow sur la box). */
export const AGENT_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Skill", "WebFetch"]

/**
 * Le runner `claude -p` : un agent = un process, sortie structurée native si schéma, progression lisible.
 * Sur le plan (ANTHROPIC_API_KEY retirée), sans serveur MCP (ni .mcp.json du dépôt, ni connecteurs claude.ai).
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
    // lignes et caractères UTF-8 recollés entre deux lectures du tube : le `result` (valeur de l'agent) n'est jamais coupé
    const out = lineSplitter((line) => {
      if (line.includes('"type":"result"')) { try { final = JSON.parse(line) } catch { /* */ } }
      const r = readableEvent(line)
      if (r && !r.startsWith("✓ ")) log(`   ${opts.label ?? ""} ${r}`)
    })
    child.stdout.on("data", (b: Buffer) => out.push(b))
    child.stderr.on("data", (b: Buffer) => errOut.push(b))
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`spawn ${bin} : ${e.message}`)) })
    child.on("close", (code) => {
      clearTimeout(timer)
      out.end()
      const err = errOut.text()
      const ms = Date.now() - t0
      if (!final) return reject(new Error(`claude -p (code ${code}) sans résultat : ${err.slice(0, 300)}`))
      if (final.is_error || final.subtype !== "success") return reject(new Error(`claude -p a échoué (${final.subtype}) : ${String(final.result ?? "").slice(0, 300)}`))
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
