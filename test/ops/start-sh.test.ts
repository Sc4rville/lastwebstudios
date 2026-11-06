/**
 * G6 : `npm run backoffice` (start.sh) ne tue que SA propre station. Une « autre station » (même ligne de
 * commande `reviewpipe/serve.ts`, autre dossier) survit ; la nôtre est relancée proprement via son pidfile.
 * Tout est lancé dans des workspaces jetables, ports aléatoires, et tué en fin de test.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn, type ChildProcess } from "node:child_process"
import { readFileSync } from "node:fs"
import { makeWorkspace } from "../helpers/workspace.ts"
import { freePort, startProcess, type Proc } from "../helpers/server.ts"

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test("start.sh : relance sa propre station (pidfile) et laisse vivre celle d'un autre dossier", { timeout: 120_000 }, async () => {
  const ours = makeWorkspace({ seed: ["agency"] })
  const other = makeWorkspace()
  let decoy: ChildProcess | null = null
  const procs: Proc[] = []
  try {
    // l'« autre station » : même motif de ligne de commande que l'ancien `pkill -f 'reviewpipe/serve\.ts'`
    decoy = spawn(process.execPath, ["-e", "setInterval(() => {}, 1e6)", "backoffice/reviewpipe/serve.ts"], { cwd: other.dir, stdio: "ignore", detached: true })
    await sleep(300)
    assert.ok(decoy.pid && alive(decoy.pid))
    const port = await freePort()
    const env = { BACKOFFICE_PORT: String(port), LWS_NO_OPEN: "1", LWS_RUN_DIR: ours.path("run") }
    const first = await startProcess({ cmd: "bash", args: ["backoffice/reviewpipe/start.sh"], cwd: ours.dir, env, port, readyPath: "/api/run", timeoutMs: 45_000 })
    procs.push(first)
    const pid1 = Number(readFileSync(ours.path("run", `station-${port}.pid`), "utf8"))
    assert.ok(alive(pid1), "le pidfile désigne la station qui tourne")
    // relance : la 1re station (la nôtre) est arrêtée, une nouvelle prend le même port
    const second = await startProcess({ cmd: "bash", args: ["backoffice/reviewpipe/start.sh"], cwd: ours.dir, env, port, readyPath: "/api/run", timeoutMs: 45_000 })
    procs.push(second)
    // startProcess a pu répondre grâce à l'ANCIENNE station : on attend que la nouvelle écoute vraiment
    for (let i = 0; i < 300 && !/station de contrôle/.test(second.output()); i++) await sleep(100)
    assert.match(second.output(), new RegExp(`ancienne station arrêtée \\(pid ${pid1}\\)`))
    assert.match(second.output(), /station de contrôle/)
    for (let i = 0; i < 40 && alive(pid1); i++) await sleep(100)
    assert.equal(alive(pid1), false, "notre ancienne station est arrêtée")
    const pid2 = Number(readFileSync(ours.path("run", `station-${port}.pid`), "utf8"))
    assert.notEqual(pid2, pid1)
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/run`)).status, 200)
    assert.ok(alive(decoy.pid!), "la station d'un AUTRE dossier n'a pas été touchée")
  } finally {
    for (const p of procs) await p.stop()
    if (decoy?.pid) { try { process.kill(-decoy.pid, "SIGKILL") } catch { /* */ } }
    ours.cleanup(); other.cleanup()
  }
})

test("start.sh ne contient plus de pkill global et ne réutilise pas un pid étranger", () => {
  const lib = readFileSync("backoffice/reviewpipe/station-lib.sh", "utf8")
  assert.match(lib, /is_our_station/)
  assert.match(lib, /readlink -f "\/proc\/\$pid\/cwd"/)
  assert.doesNotMatch(readFileSync("backoffice/reviewpipe/start.sh", "utf8"), /pkill/)
})
