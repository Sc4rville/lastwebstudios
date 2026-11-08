/**
 * The user's own cockpit (`npm run backoffice`, README step 5), not the sandbox : on a Claude subscription it says
 * Connected when Claude Code is signed in, « Not signed in » with `claude auth login` when it is not, and the install
 * line only when the command is missing (final rookie check : the codex branch overwrote the Claude answer, so every
 * subscriber was told to install Claude Code). With no agency.config.json it runs as the US demo studio (D1), never
 * the French one.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { rmSync } from "node:fs"
import { join } from "node:path"
import { makeWorkspace, FIXTURES, type Workspace } from "../helpers/workspace.ts"
import { startCockpit } from "../helpers/cockpit.ts"
import type { Proc } from "../helpers/server.ts"

let ws: Workspace
const procs: Proc[] = []
before(() => { ws = makeWorkspace(); rmSync(ws.path("agency.config.json"), { force: true }) })
after(async () => { for (const p of procs) await p.stop(); ws?.cleanup() })

const FAKE = join(FIXTURES, "bin", "claude")
const base = { LWS_SANDBOX: "", LWS_LLM: "", LWS_AGENCY_CONFIG: "" }
async function cockpit(env: NodeJS.ProcessEnv): Promise<Proc> { const p = await startCockpit(ws.dir, { ...base, ...env }); procs.push(p); return p }
const get = async (p: Proc, path: string) => (await fetch(p.url + path, { signal: AbortSignal.timeout(30_000) })).json() as Promise<any>

test("Claude subscription: Connected when signed in ; « Not signed in » + claude auth login when not ; install only when missing", { timeout: 120_000 }, async () => {
  const signedIn = await cockpit({ CLAUDE_BIN: FAKE })
  const a = await get(signedIn, "/api/ai-status")
  assert.equal(a.way, "claude-code"); assert.equal(a.ok, true, JSON.stringify(a)); assert.equal(a.label, "Connected"); assert.equal(a.installed, true)
  assert.equal((await get(signedIn, "/api/ai-status?way=claude-code")).ok, true)
  // the other ways keep their own answers (the codex branch never overwrites another way's)
  assert.equal((await get(signedIn, "/api/ai-status?way=openai-compatible")).label, "No model server yet")
  // no agency.config.json : the US demo studio (D1), English, dollars
  const st = await get(signedIn, "/api/settings")
  assert.match(String(st.file), /agency\.config\.example\.us\.json$/); assert.equal(st.country, "US"); assert.equal(st.demo, true)

  const signedOut = await cockpit({ CLAUDE_BIN: FAKE, FAKE_CLAUDE_AUTH: "none" })
  const b = await get(signedOut, "/api/ai-status")
  assert.equal(b.ok, false); assert.equal(b.installed, true); assert.equal(b.label, "Not signed in"); assert.match(b.fix, /claude auth login/)

  const missing = await cockpit({ CLAUDE_BIN: join(ws.dir, "no-such-claude") })
  const c = await get(missing, "/api/ai-status")
  assert.equal(c.ok, false); assert.equal(c.installed, false); assert.match(c.fix, /claude\.ai\/install\.sh/)
})
