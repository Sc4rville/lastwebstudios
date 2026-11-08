/**
 * The harness itself: the tests run in a throwaway workspace, with no real data, no .env,
 * no access to the real database or the real model. If one of these safety nets gives way, everything else is suspect.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { makeWorkspace } from "./helpers/workspace.ts"
import { run } from "./helpers/proc.ts"

test("the tests' cwd is a throwaway workspace with no real data and no .env", () => {
  const cwd = process.cwd()
  assert.notEqual(cwd, process.env.LWS_TEST_ROOT, "the tests must never run in the repository")
  for (const d of ["output", "closing", "sessions", "website", "NIGHT", ".oss-build", ".sandbox"]) assert.equal(existsSync(join(cwd, d)), false, `${d}/ must not be copied`)
  // data/: only the product's FICTIONAL cast (data/sample/) travels with the code, never the real data
  if (existsSync(join(cwd, "data"))) assert.deepEqual(readdirSync(join(cwd, "data")), ["sample"], "data/ only holds data/sample/")
  assert.equal(existsSync(join(cwd, ".env")), false)
  assert.ok(existsSync(join(cwd, "package.json")))
})

test("the test environment is cleaned (no key, no remote database, no sending)", () => {
  for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "SUPABASE_SERVICE_KEY", "TELEGRAM_BOT_TOKEN", "LWS_LIVE_SEND", "DIGEST_TO", "CLAUDE_CODE_OAUTH_TOKEN"]) {
    assert.equal(process.env[k], undefined, `${k} must not leak into the tests`)
  }
  if (process.env.DATABASE_URL) assert.match(process.env.DATABASE_URL, /@127\.0\.0\.1:\d+\//, "only a throwaway local database is allowed")
  assert.equal(process.env.LWS_SIRENE, "0")
})

test("`claude` resolves to the fake test binary (no call to the real model)", async () => {
  assert.match(String(process.env.CLAUDE_BIN), /test\/fixtures\/bin\/claude$/)
  const r = await run("claude", ["--version"], { cwd: process.cwd() })
  assert.equal(r.code, 0)
  assert.match(r.stdout, /fake test binary/)
})

test("one workspace per test: an isolated copy, fictional fixtures, cleaned up afterwards", () => {
  const ws = makeWorkspace({ seed: ["agency"] })
  try {
    assert.ok(ws.exists("data/prospects/orvane-piscines-valmont-sur-lys.json"))
    assert.ok(ws.exists("output/sites/orvane-piscines-valmont-sur-lys/2026-10-20-composer/index.html"))
    for (const f of ["orvane-piscines-valmont-sur-lys", "atelier-brisane-menuiserie-sornac-le-haut", "cuisines-lumeo-vereuil"]) {
      const s = ws.json(`data/prospects/${f}.json`)
      assert.match(s._fixture, /FICTIF/)
      assert.ok(!s.identity.email || /\.example$/.test(s.identity.email), "fictional emails on .example only")
    }
    ws.write("data/x.json", "{}")
    assert.equal(existsSync(join(process.cwd(), "data", "x.json")), false, "writing in the workspace does not touch the cwd")
  } finally { ws.cleanup() }
  assert.equal(existsSync(ws.dir), false)
})

test("package.json declares engines.node >= 20.12 and the test scripts", () => {
  const p = JSON.parse(readFileSync("package.json", "utf8"))
  assert.equal(p.engines?.node, ">=20.12")
  for (const s of ["typecheck", "test", "test:pg", "test:e2e", "db:init"]) assert.ok(p.scripts[s], `script ${s}`)
})
