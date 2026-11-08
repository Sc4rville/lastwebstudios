/**
 * server.ts · test servers, RANDOM port, GUARANTEED shutdown.
 *
 *   freePort()                       a free port on 127.0.0.1
 *   startProcess({...})              starts a product server (e.g. the cockpit) in its own process group,
 *                                    waits until it answers, and `stop()` kills the whole group (SIGTERM then SIGKILL)
 *   serveDir(dir) · jsonRoutes(map)  small in-process http servers (fictional site, fake SIRENE, fake Telegram…)
 *
 * Every started server is also registered to be killed when the test process exits (safety net).
 */
import { spawn, type ChildProcess } from "node:child_process"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { createServer as netServer } from "node:net"
import { readFile, stat } from "node:fs/promises"
import { extname, join, resolve, sep } from "node:path"

const live = new Set<ChildProcess>()
process.on("exit", () => { for (const c of live) { try { if (c.pid) process.kill(-c.pid, "SIGKILL") } catch { /* */ } } })

export function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = netServer()
    s.unref()
    s.on("error", rej)
    s.listen(0, "127.0.0.1", () => { const a = s.address(); const p = typeof a === "object" && a ? a.port : 0; s.close(() => res(p)) })
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type Proc = { port: number; url: string; output: () => string; stop: () => Promise<void> }

export async function startProcess(o: {
  cmd: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv; port: number
  readyPath?: string; timeoutMs?: number
}): Promise<Proc> {
  const child = spawn(o.cmd, o.args, { cwd: o.cwd, env: { ...process.env, ...(o.env || {}) }, stdio: ["ignore", "pipe", "pipe"], detached: true })
  live.add(child)
  let out = ""
  child.stdout?.on("data", (b: Buffer) => (out += b.toString()))
  child.stderr?.on("data", (b: Buffer) => (out += b.toString()))
  let exited = false
  child.on("exit", () => { exited = true; live.delete(child) })
  const url = `http://127.0.0.1:${o.port}`
  const stop = async () => {
    if (exited || !child.pid) return
    try { process.kill(-child.pid, "SIGTERM") } catch { /* */ }
    for (let i = 0; i < 40 && !exited; i++) await sleep(50)
    if (!exited) { try { process.kill(-child.pid, "SIGKILL") } catch { /* */ } }
    for (let i = 0; i < 40 && !exited; i++) await sleep(50)
    live.delete(child)
  }
  const deadline = Date.now() + (o.timeoutMs ?? 30_000)
  while (Date.now() < deadline) {
    if (exited) throw new Error(`the server stopped during startup:\n${out.slice(-2000)}`)
    try {
      const r = await fetch(url + (o.readyPath ?? "/"), { signal: AbortSignal.timeout(1500) })
      await r.arrayBuffer()
      return { port: o.port, url, output: () => out, stop }
    } catch { await sleep(150) }
  }
  await stop()
  throw new Error(`server not ready in ${o.timeoutMs ?? 30_000} ms:\n${out.slice(-2000)}`)
}

export type Http = { url: string; port: number; hits: { method: string; path: string; body: string }[]; close: () => Promise<void> }

async function listen(server: Server): Promise<number> {
  return new Promise((res) => server.listen(0, "127.0.0.1", () => { const a = server.address(); res(typeof a === "object" && a ? a.port : 0) }))
}

function wrap(server: Server, port: number, hits: Http["hits"]): Http {
  return { url: `http://127.0.0.1:${port}`, port, hits, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()) }) }
}

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" }

/** Serves a folder read-only (the fictional "old site"). */
export async function serveDir(dir: string): Promise<Http> {
  const base = resolve(dir)
  const hits: Http["hits"] = []
  const server = createServer(async (req, res) => {
    const p = decodeURIComponent((req.url || "/").split("?")[0])
    hits.push({ method: req.method || "GET", path: p, body: "" })
    let f = resolve(base, "." + p)
    if (f !== base && !f.startsWith(base + sep)) { res.writeHead(400); res.end(); return }
    try {
      if ((await stat(f)).isDirectory()) f = join(f, "index.html")
      const buf = await readFile(f)
      res.writeHead(200, { "Content-Type": MIME[extname(f)] || "application/octet-stream" })
      res.end(buf)
    } catch { res.writeHead(404); res.end("not found") }
  })
  return wrap(server, await listen(server), hits)
}

type Handler = (req: IncomingMessage, body: string, url: URL) => { status?: number; json?: unknown; text?: string } | Promise<{ status?: number; json?: unknown; text?: string }>

/** Small programmable JSON server: `routes["GET /search"] = (req, body, url) => ({ json })`. */
export async function jsonRoutes(routes: Record<string, Handler>): Promise<Http> {
  const hits: Http["hits"] = []
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let body = ""
    for await (const c of req) body += c
    const url = new URL(req.url || "/", "http://127.0.0.1")
    hits.push({ method: req.method || "GET", path: url.pathname + url.search, body })
    const h = routes[`${req.method} ${url.pathname}`] || routes[`* ${url.pathname}`] || routes["*"]
    if (!h) { res.writeHead(404); res.end("{}"); return }
    const r = await h(req, body, url)
    res.writeHead(r.status ?? 200, { "Content-Type": r.json !== undefined ? "application/json" : "text/plain" })
    res.end(r.json !== undefined ? JSON.stringify(r.json) : (r.text ?? ""))
  })
  return wrap(server, await listen(server), hits)
}
