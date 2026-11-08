/**
 * D6 · the owner's taste reaches the 24/7 worker on ANOTHER machine : the cockpit keeps taste.json on its own disk and
 * mirrors the active preferences in the shared database (meta › learning.taste) ; the worker, which has no taste file,
 * reads the mirror, gives the preferences to the edit agent as fenced data, and records them with the site.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { freshDatabase } from "../helpers/pg.ts"
import { npmRun, tsx } from "../helpers/proc.ts"
import { makeWorkspace } from "../helpers/workspace.ts"

const ID = "orvane-piscines-valmont-sur-lys", DATE = "2026-10-20-composer"

test("the database mirror: a worker with no taste file gets the cockpit's active preferences, in its prompt and its site record", { timeout: 120_000 }, async () => {
  const db = await freshDatabase()
  const cockpit = makeWorkspace({ seed: ["agency"] }), box = makeWorkspace({ seed: ["agency"] })
  try {
    const env = { DATABASE_URL: db.url, DB_SSL: "disable", DB_POOL_MAX: "1" }
    assert.equal((await npmRun(cockpit.dir, "db:init", [], { env })).code, 0)
    // the cockpit learns from a comment (the rules, as in the sandbox) and mirrors what is on
    cockpit.write("_learn.mts", `import { loadTaste, saveTaste, mirrorTaste, applyFeedback, distillRules, setPref } from "./learning/scripts/taste.ts"
import { closeDb } from "./packages/shared/db.ts"
const t = loadTaste()
applyFeedback(t, { id: "f-1", kind: "comment", site: "${ID}", at: new Date().toISOString(), via: "rules" }, distillRules("The phone number at the top please. And darker pages."))
setPref(t, "p-dark-pages", { on: false })
saveTaste(t); await mirrorTaste(t); closeDb()`)
    const r1 = await tsx(cockpit.dir, "_learn.mts", [], { env })
    assert.equal(r1.code, 0, r1.out)
    const meta = await db.sql`SELECT value FROM meta WHERE key = 'learning.taste'`
    assert.deepEqual(JSON.parse(meta[0].value).preferences.map((p: any) => p.id), ["p-phone-top"], "only what is on is mirrored")
    // the box : no data/learning at all ; an edit job for Orvane's site
    assert.equal(box.exists("data/learning/taste.json"), false)
    const [job] = await db.sql`INSERT INTO batch_requests (status, mode, params_json, requested_by, created_at) VALUES ('running', 'edit', ${JSON.stringify({ id: ID, date: DATE })}, 'test', ${Date.now()}) RETURNING id`
    const log = box.path("claude.log")
    const r2 = await tsx(box.dir, "worker/worker.ts", ["--job", String(job.id)], { env: { ...env, WORKER_NO_COACH: "1", WORKER_NAME: "test-box", FAKE_CLAUDE_LOG: log }, timeoutMs: 90_000 })
    assert.equal(r2.code, 0, r2.out)
    const edit = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((c) => /<commentaire_operateur>/.test(c.stdin))
    assert.ok(edit, "the edit agent ran")
    assert.match(edit.stdin, /<owner_preferences>\n- \[p-phone-top\] Phone number at the top of the page, one tap to call\n<\/owner_preferences>/)
    assert.doesNotMatch(edit.stdin, /Dark, cinematic/)
    assert.deepEqual(box.json(`output/sites/${ID}/${DATE}/.lws-taste.json`).given.map((p: any) => p.id), ["p-phone-top"])
  } finally { cockpit.cleanup(); box.cleanup(); await db.drop() }
})
