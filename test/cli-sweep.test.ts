/**
 * CLI SWEEP (G1): every `npm run <cli>` started WITHOUT an argument in an empty workspace (no .env,
 * no database, no key, outgoing network cut by a dead proxy) must answer cleanly: a usage line or
 * a clear message, never a SyntaxError or a stack trace. It is exactly what a stranger sees
 * who clones the repository and types a command.
 */
import { describe, test, before, after } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { makeWorkspace, type Workspace } from "./helpers/workspace.ts"
import { npmRun } from "./helpers/proc.ts"

// servers / daemons / actions on the machine: covered elsewhere (cockpit, start.sh) or left out on purpose
const SKIP: Record<string, string> = {
  "backoffice": "server (covered by test/cockpit and test/ops)",
  "backoffice:serve": "server (covered by test/cockpit)",
  "share": "opens a public cloudflared tunnel: never in a test",
  "calendar": "server + git + xdg-open",
  "docs": "docs server",
  "sales": "sales server",
  "hooks": "changes the git config",
  "sandbox": "server (the fictional agency): covered by test/sandbox.test.ts (--check)",
  "oss:export": "builds the open-source export: covered by test/oss/export.test.ts",
  "test": "harness", "test:pg": "harness", "test:e2e": "harness", "typecheck": "harness",
}
// the signature of a crash (not of a clean refusal)
const CRASH = /SyntaxError|ReferenceError|TypeError:|Cannot find module|ERR_MODULE_NOT_FOUND|ERR_UNKNOWN_FILE_EXTENSION|Unhandled|^\s+at .+:\d+:\d+\)?$/m

const scripts = Object.keys(JSON.parse(readFileSync("package.json", "utf8")).scripts as Record<string, string>).filter((s) => !SKIP[s])

describe("every CLI without an argument answers cleanly (usage or message, never a crash)", { concurrency: 4 }, () => {
  let ws: Workspace
  before(() => { ws = makeWorkspace() })
  after(() => ws?.cleanup())
  const env = {
    // outgoing network cut: fetch (Node ≥ 24 with NODE_USE_ENV_PROXY) goes through a dead proxy
    NODE_USE_ENV_PROXY: "1", HTTP_PROXY: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9", NO_PROXY: "127.0.0.1,localhost",
    BACKOFFICE_PORT: "1", LWS_NO_OPEN: "1",
  }
  for (const name of scripts) {
    test(`npm run ${name}`, async () => {
      const r = await npmRun(ws.dir, name, [], { env, timeoutMs: 60_000 })
      assert.equal(r.timedOut, false, `${name} does not return (60 s):\n${r.out.slice(-800)}`)
      assert.doesNotMatch(r.out, CRASH, `${name} crashes:\n${r.out.slice(-1500)}`)
      assert.ok(r.out.trim().length > 0, `${name} says nothing`)
    })
  }
})
