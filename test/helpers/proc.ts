/**
 * proc.ts · runs a product CLI in a workspace and returns {code, stdout, stderr}.
 * The process is ALWAYS killed at the timeout (no orphan process if a test breaks).
 */
import { spawn } from "node:child_process"
import { textCollector } from "../../packages/shared/lines.mjs"

export type RunResult = { code: number; stdout: string; stderr: string; out: string; ms: number; timedOut: boolean }

export function run(cmd: string, args: string[], o: { cwd: string; env?: NodeJS.ProcessEnv; input?: string; timeoutMs?: number } ): Promise<RunResult> {
  const t0 = Date.now()
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: o.cwd, env: { ...process.env, ...(o.env || {}) }, stdio: ["pipe", "pipe", "pipe"], detached: true })
    // bytes decoded at the end (an accented character split between two reads does not make an assertion flaky)
    const so = textCollector(), se = textCollector()
    let timedOut = false
    child.stdout.on("data", (b: Buffer) => so.push(b))
    child.stderr.on("data", (b: Buffer) => se.push(b))
    const kill = (sig: NodeJS.Signals) => { try { if (child.pid) process.kill(-child.pid, sig) } catch { /* already gone */ } }
    const timer = setTimeout(() => { timedOut = true; kill("SIGKILL") }, o.timeoutMs ?? 60_000)
    child.on("close", (code) => { clearTimeout(timer); kill("SIGKILL"); const stdout = so.text(), stderr = se.text(); resolve({ code: code ?? -1, stdout, stderr, out: stdout + stderr, ms: Date.now() - t0, timedOut }) })
    child.on("error", (e) => { clearTimeout(timer); const stdout = so.text(), stderr = se.text(); resolve({ code: -1, stdout, stderr: stderr + String(e), out: stdout + stderr + String(e), ms: Date.now() - t0, timedOut }) })
    if (o.input !== undefined) child.stdin.write(o.input)
    child.stdin.end()
  })
}

/** Runs a product TypeScript script through tsx (equivalent to `npm run <x>` without npm's overhead). */
export function tsx(cwd: string, script: string, args: string[] = [], o: { env?: NodeJS.ProcessEnv; input?: string; timeoutMs?: number } = {}): Promise<RunResult> {
  return run(process.execPath, ["--import", "tsx", script, ...args], { cwd, ...o })
}

/** `npm run <name> -- <args>` (the real user path). */
export function npmRun(cwd: string, name: string, args: string[] = [], o: { env?: NodeJS.ProcessEnv; input?: string; timeoutMs?: number } = {}): Promise<RunResult> {
  return run("npm", ["run", "--silent", name, ...(args.length ? ["--", ...args] : [])], { cwd, ...o })
}
