/**
 * G6: the worker no longer deletes versioned folders. Only the builds it marked itself
 * `.lws-building`, left without index.html, with a still marker, are cleaned up when idle.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { utimesSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { BUILDING_MARKER, composerDirs, markBuilding, settleBuilding, reapIncomplete } from "../../worker/building.ts"
import { makeWorkspace } from "../helpers/workspace.ts"

const age = (f: string, ms: number) => { const t = (Date.now() - ms) / 1000; utimesSync(f, t, t) }

test("a -composer folder TRACKED BY GIT and without index.html survives the reap; only the marked build goes", async () => {
  const ws = makeWorkspace()
  try {
    const base = ws.path("output/sites")
    ws.write("output/sites/fiche-versionnee/2026-06-13-composer/notes.md", "batch interrompu, dossier commité\n")
    execFileSync("git", ["init", "-q"], { cwd: ws.dir })
    execFileSync("git", ["add", "-f", "output/sites"], { cwd: ws.dir }) // -f: the open source edition ignores output/
    execFileSync("git", ["-c", "user.email=test@lws.example", "-c", "user.name=test", "commit", "-qm", "fixture"], { cwd: ws.dir })
    ws.write("output/sites/chantier-mort/2026-10-24-composer/brouillon.html", "<p>à moitié</p>")
    const marker = ws.write(`output/sites/chantier-mort/2026-10-24-composer/${BUILDING_MARKER}`, "{}")
    age(marker, 60 * 60 * 1000)
    const pruned: string[] = []
    const reaped = await reapIncomplete(base, { prune: async (id, d) => { pruned.push(`${id}/${d}`) } })
    assert.deepEqual(reaped, ["chantier-mort/2026-10-24-composer"])
    assert.deepEqual(pruned, reaped)
    assert.ok(ws.exists("output/sites/fiche-versionnee/2026-06-13-composer/notes.md"), "the versioned folder is intact")
    assert.equal(ws.exists("output/sites/chantier-mort"), false, "the emptied prospect folder is removed")
    assert.doesNotMatch(execFileSync("git", ["status", "--porcelain", "--", "output/sites/fiche-versionnee"], { cwd: ws.dir, encoding: "utf8" }), /\S/, "git sees no deletion of the versioned folder")
  } finally { ws.cleanup() }
})

test("a marked but FRESH build (another worker is on it) is not touched", async () => {
  const ws = makeWorkspace()
  try {
    ws.write(`output/sites/p/2026-10-24-composer/${BUILDING_MARKER}`, "{}")
    assert.deepEqual(await reapIncomplete(ws.path("output/sites")), [])
    assert.ok(ws.exists("output/sites/p/2026-10-24-composer"))
  } finally { ws.cleanup() }
})

test("marked but with index.html, or under review (.reviewing): never deleted", async () => {
  const ws = makeWorkspace()
  try {
    for (const d of ["fini", "en-revue"]) age(ws.write(`output/sites/${d}/2026-10-24-composer/${BUILDING_MARKER}`, "{}"), 3_600_000)
    ws.write("output/sites/fini/2026-10-24-composer/index.html", "<html></html>")
    ws.write("output/sites/en-revue/2026-10-24-composer/.reviewing", "")
    assert.deepEqual(await reapIncomplete(ws.path("output/sites")), [])
  } finally { ws.cleanup() }
})

test("markBuilding marks ONLY the composer folders that appeared during the run and still have no index.html", () => {
  const ws = makeWorkspace({ seed: ["agency"] })
  try {
    const base = ws.path("output/sites")
    ws.write("output/sites/ancien/2026-06-13-composer/x.txt", "")
    const before = composerDirs(base)
    assert.ok(before.has("ancien/2026-06-13-composer"))
    ws.write("output/sites/neuf-a/2026-10-24-composer/x.txt", "")
    ws.write("output/sites/neuf-b/2026-10-24-composer/index.html", "<html></html>")
    ws.write("output/sites/neuf-c/2026-10-24/index.html", "<html></html>") // template-fill: not a composer build
    const marked = markBuilding(base, before, { batchId: 12, worker: "box#1" })
    assert.deepEqual(marked, ["neuf-a/2026-10-24-composer"])
    assert.equal(existsSync(join(base, "ancien/2026-06-13-composer", BUILDING_MARKER)), false)
    assert.match(ws.read(`output/sites/neuf-a/2026-10-24-composer/${BUILDING_MARKER}`), /"batch":12/)
  } finally { ws.cleanup() }
})

test("settleBuilding: at the end of a batch, the finished sites lose their marker, the unfinished ones keep it", () => {
  const ws = makeWorkspace()
  try {
    const base = ws.path("output/sites")
    const before = composerDirs(base)
    ws.write("output/sites/a/2026-10-24-composer/x.txt", "")
    ws.write("output/sites/b/2026-10-24-composer/x.txt", "")
    markBuilding(base, before, { batchId: 1, worker: "w" })
    ws.write("output/sites/a/2026-10-24-composer/index.html", "<html></html>")
    const r = settleBuilding(base, before)
    assert.deepEqual(r, { finished: ["a/2026-10-24-composer"], unfinished: ["b/2026-10-24-composer"] })
    assert.equal(ws.exists(`output/sites/a/2026-10-24-composer/${BUILDING_MARKER}`), false)
    assert.ok(ws.exists(`output/sites/b/2026-10-24-composer/${BUILDING_MARKER}`))
  } finally { ws.cleanup() }
})

test("the marker is gitignored (never committed) and skipped by the bucket sync (a dot file)", () => {
  assert.match(readFileSync(".gitignore", "utf8"), /^output\/sites\/\*\*\/\.lws-building$/m)
  assert.ok(BUILDING_MARKER.startsWith("."), "syncTree skips the files starting with a dot")
})
