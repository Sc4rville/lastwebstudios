/**
 * Blitz test (24/10) · the cockpit under HOSTILE INPUT, without a database (the mode of a stranger who clones the repository).
 *
 * Every POST route read from the source (like nodb.test.ts's GET sweep) receives absurd bodies:
 * empty, broken JSON, `null`, array, string, wrong types, traversal ids (`../../`), control unicode, huge
 * fields. Expected: never a 5xx, the server still answers after each request, nothing is written outside the
 * workspace, no process is started by invalid input. `/api/pipeline` is excluded (it starts a real network
 * scrape, tested elsewhere), like the public /t/ routes (tracking.test.ts).
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { makeWorkspace, type Workspace } from "../helpers/workspace.ts"
import { startCockpit } from "../helpers/cockpit.ts"
import type { Proc } from "../helpers/server.ts"
import { hostileSweep } from "../helpers/hostile.ts"

let ws: Workspace, cockpit: Proc, before0: Set<string>, parent0: Set<string>
const SKIP_DIRS = new Set(["node_modules", "design", "video", "ecom"])
function files(dir: string, root = dir, out = new Set<string>()): Set<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink() || SKIP_DIRS.has(e.name) && dir === root) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) files(p, root, out); else out.add(relative(root, p))
  }
  return out
}
before(async () => {
  ws = makeWorkspace({ seed: ["agency"] })
  before0 = files(ws.dir)
  parent0 = new Set(readdirSync(dirname(ws.dir)))
  cockpit = await startCockpit(ws.dir)
})
after(async () => { await cockpit?.stop(); ws?.cleanup() })

test("hostile sweep: every POST route × 9 absurd bodies → never a 500, the server always answers", { timeout: 240_000 }, async () => {
  const { routes, bad } = await hostileSweep(cockpit.url)
  assert.ok(routes >= 35, `only ${routes} POST routes found`)
  assert.deepEqual(bad, [])
})

test("nothing is written outside the workspace; no file named after a traversal; no job started by invalid input", async () => {
  assert.deepEqual([...new Set(readdirSync(dirname(ws.dir)))].filter((f) => !parent0.has(f) && /passwd|agency\.config|x\.json/.test(f)), [])
  const now = files(ws.dir)
  const created = [...now].filter((f) => !before0.has(f))
  const suspicious = created.filter((f) => /passwd|\.\.|\u0000/.test(f))
  assert.deepEqual(suspicious, [], `created: ${created.join(", ")}`)
  // the agency and prospect sheet files were not rewritten by a traversal
  // the agency file that runs (the owner's, or the demo one in a fresh clone of the open-source edition)
  for (const f of ["agency.config.json", "agency.config.example.json"]) if (existsSync(ws.path(f))) assert.doesNotMatch(ws.read(f), /pendingGmail|"status"/)
  for (const f of created) assert.ok(statSync(ws.path(f)).size < 20_000_000)
  assert.doesNotMatch(cockpit.output(), /npm run (edit|fill|demo|outreach)/, "no CLI started on invalid input")
})

test("a 17 MB body: refused without crashing the server", { timeout: 60_000 }, async () => {
  const big = JSON.stringify({ id: "orvane-piscines-valmont-sur-lys", text: "x".repeat(17_000_000) })
  const r = await fetch(cockpit.url + "/api/love", { method: "POST", headers: { "content-type": "application/json" }, body: big, signal: AbortSignal.timeout(30_000) }).then((x) => x.status).catch(() => -1)
  assert.ok(r === -1 || (r >= 400 && r < 500), `status ${r}`)
  assert.equal(await fetch(cockpit.url + "/api/run").then((x) => x.status), 200, "still alive")
})
