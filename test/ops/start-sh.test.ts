/**
 * G6: `npm run backoffice` (start.sh) only kills ITS OWN station. An "other station" (same
 * `reviewpipe/serve.ts` command line, another folder) survives; ours is restarted cleanly through its pidfile.
 * Everything runs in throwaway workspaces, on random ports, and is killed at the end of the test.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn, type ChildProcess } from "node:child_process"
import { readFileSync } from "node:fs"
import { makeWorkspace } from "../helpers/workspace.ts"
import { freePort, startProcess, type Proc } from "../helpers/server.ts"

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test("start.sh: restarts its own station (pidfile) and leaves another folder's alive", { timeout: 120_000 }, async () => {
  const ours = makeWorkspace({ seed: ["agency"] })
  const other = makeWorkspace()
  let decoy: ChildProcess | null = null
  const procs: Proc[] = []
  try {
    // the "other station": the same command line pattern as the old `pkill -f 'reviewpipe/serve\.ts'`
    decoy = spawn(process.execPath, ["-e", "setInterval(() => {}, 1e6)", "backoffice/reviewpipe/serve.ts"], { cwd: other.dir, stdio: "ignore", detached: true })
    await sleep(300)
    assert.ok(decoy.pid && alive(decoy.pid))
    const port = await freePort()
    const env = { BACKOFFICE_PORT: String(port), LWS_NO_OPEN: "1", LWS_RUN_DIR: ours.path("run") }
    const first = await startProcess({ cmd: "bash", args: ["backoffice/reviewpipe/start.sh"], cwd: ours.dir, env, port, readyPath: "/api/run", timeoutMs: 45_000 })
    procs.push(first)
    const pid1 = Number(readFileSync(ours.path("run", `station-${port}.pid`), "utf8"))
    assert.ok(alive(pid1), "the pidfile points at the running station")
    // restart: the 1st station (ours) is stopped, a new one takes the same port
    const second = await startProcess({ cmd: "bash", args: ["backoffice/reviewpipe/start.sh"], cwd: ours.dir, env, port, readyPath: "/api/run", timeoutMs: 45_000 })
    procs.push(second)
    // startProcess may have answered thanks to the OLD station: wait until the new one really listens
    for (let i = 0; i < 300 && !/Cockpit →/.test(second.output()); i++) await sleep(100)
    assert.match(second.output(), new RegExp(`Previous cockpit stopped \\(pid ${pid1}\\)`))
    assert.match(second.output(), /Cockpit →/)
    // no DATABASE_URL : its own local database, reopened by the restart (the old cockpit closed it first)
    for (let i = 0; i < 100 && !/Indexed →|No database/.test(second.output()); i++) await sleep(100)
    assert.match(second.output(), /Local database \(data\/pglite\)/)
    assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/prospects`)).json()).noDb, false, "Find prospects works on a laptop")
    for (let i = 0; i < 40 && alive(pid1); i++) await sleep(100)
    assert.equal(alive(pid1), false, "our old station is stopped")
    const pid2 = Number(readFileSync(ours.path("run", `station-${port}.pid`), "utf8"))
    assert.notEqual(pid2, pid1)
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/run`)).status, 200)
    assert.ok(alive(decoy.pid!), "ANOTHER folder's station was not touched")
  } finally {
    for (const p of procs) await p.stop()
    if (decoy?.pid) { try { process.kill(-decoy.pid, "SIGKILL") } catch { /* */ } }
    ours.cleanup(); other.cleanup()
  }
})

test("start.sh has no global pkill left and does not reuse a foreign pid", () => {
  const lib = readFileSync("backoffice/reviewpipe/station-lib.sh", "utf8")
  assert.match(lib, /is_our_station/)
  assert.match(lib, /readlink -f "\/proc\/\$pid\/cwd"/)
  assert.doesNotMatch(readFileSync("backoffice/reviewpipe/start.sh", "utf8"), /pkill/)
})

test("start.sh : a port held by another program → the next free one, printed, and that is the one that answers (and opens)", { timeout: 90_000 }, async () => {
  const ws = makeWorkspace({ seed: ["agency"] })
  const { createServer } = await import("node:net")
  const port = await freePort()
  const squatter = createServer(() => {}).listen(port, "127.0.0.1")
  let p: Proc | null = null
  try {
    // LWS_LOCAL_DB=0 : this test is about the port only
    p = await startProcess({ cmd: "bash", args: ["backoffice/reviewpipe/start.sh"], cwd: ws.dir, env: { BACKOFFICE_PORT: String(port), LWS_NO_OPEN: "1", LWS_LOCAL_DB: "0", LWS_RUN_DIR: ws.path("run") }, port: port + 1, readyPath: "/api/run", timeoutMs: 45_000 })
    for (let i = 0; i < 100 && !/Cockpit →/.test(p.output()); i++) await sleep(100)
    assert.match(p.output(), new RegExp(`Port ${port} is busy \\(another program\\): using ${port + 1}\\.`))
    assert.match(p.output(), new RegExp(`Cockpit → http://127\\.0\\.0\\.1:${port + 1}`))
    assert.ok(readFileSync(ws.path("run", `station-${port + 1}.pid`), "utf8").trim(), "the pidfile follows the real port")
    // the browser is opened on the port the cockpit really listens on
    assert.match(readFileSync("backoffice/reviewpipe/start.sh", "utf8"), /export BACKOFFICE_PORT="\$PORT"[\s\S]*curl -fsS -o \/dev\/null "http:\/\/127\.0\.0\.1:\$PORT\/api\/run"/)
  } finally { await p?.stop(); squatter.close(); ws.cleanup() }
})
