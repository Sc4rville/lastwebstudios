/**
 * Blitz test (10/24) · a DAMAGED sequencer config (a typo on the box): broken JSON, `steps` missing or
 * empty, unknown mailbox pool, negative delay. Expected: a clear message naming the file and the fault, code ≠ 0,
 * NOTHING is read, sent or moved, and never a raw stack trace.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { tsx } from "../helpers/proc.ts"
import { makeWorkspace } from "../helpers/workspace.ts"

const ORVANE = "orvane-piscines-valmont-sur-lys"
const CASES: [string, (cfg: any) => string][] = [
  ["broken JSON", (cfg) => JSON.stringify(cfg).slice(0, -3)],
  ["steps missing", (cfg) => { delete cfg.steps; return JSON.stringify(cfg) }],
  ["steps empty", (cfg) => JSON.stringify({ ...cfg, steps: [] })],
  ["unknown pool", (cfg) => JSON.stringify({ ...cfg, steps: [{ ...cfg.steps[0], pool: "C" }, ...cfg.steps.slice(1)] })],
  ["inboxes missing", (cfg) => { delete cfg.inboxes; return JSON.stringify(cfg) }],
  ["negative delay", (cfg) => JSON.stringify({ ...cfg, steps: [cfg.steps[0], { ...cfg.steps[1], delayDays: -3 }] })],
]

for (const [label, mutate] of CASES) {
  test(`sequencer config: ${label} → a clear message, nothing goes out`, { timeout: 60_000 }, async () => {
    const ws = makeWorkspace({ seed: ["agency"] })
    try {
      const cfg = JSON.parse(ws.read("outreach/sequencer/config.json"))
      cfg.inboxes = { A: [], B: [{ email: "b1@agence.example", throttlePerDay: 8 }] }
      ws.write("outreach/sequencer/config.json", JSON.stringify(cfg))
      ws.write(`data/savior/${ORVANE}.json`, JSON.stringify({ senderName: "Camille (fictive)", subject: "Une idée", body: "Bonjour, l'aperçu : https://demo.agence.example/" }))
      assert.equal((await tsx(ws.dir, "outreach/scripts/sequencer.ts", ["enroll", ORVANE, "--now", "2026-10-24T08:00:00.000Z"])).code, 0)
      ws.write("outreach/sequencer/config.json", mutate(JSON.parse(ws.read("outreach/sequencer/config.json"))))
      const r = await tsx(ws.dir, "outreach/scripts/sequencer.ts", ["tick", "--now", "2026-10-24T09:00:00.000Z"], { env: { LWS_MAIL_TRANSPORT: "simulated" } })
      assert.equal(r.code, 78, r.out) // EX_CONFIG
      assert.match(r.out, /outreach\/sequencer\/config\.json/, "the faulty file is named")
      assert.doesNotMatch(r.out, /\n\s+at .*\.ts:\d+:\d+/, `no raw stack trace:\n${r.out.slice(-600)}`)
      assert.equal(ws.exists("data/sequencer/sends.jsonl"), false, "nothing went out (even simulated)")
      assert.equal(ws.json<any[]>("data/sequencer/state.json")[0].step, 0, "nothing moved")
    } finally { ws.cleanup() }
  })
}

test("the shipped config passes validation (and each fault is named one by one)", async () => {
  const { configProblems } = await import("../../outreach/scripts/sequencer.ts")
  const { readFileSync } = await import("node:fs")
  assert.deepEqual(configProblems(JSON.parse(readFileSync("outreach/sequencer/config.json", "utf8"))), [])
  const p = configProblems({ inboxes: { B: [{ email: "pas-un-mail", throttlePerDay: 0 }] }, steps: [{ id: "a", pool: "B", delayDays: 0, source: "savior" }, { id: "a", pool: "Z", delayDays: "3", source: "fax", gate: "ouvert" }] })
  assert.deepEqual(p, [
    "inboxes.B[0].email is invalid", "inboxes.B[0].throttlePerDay must be a number > 0",
    "steps[1] (a).id is a duplicate", "steps[1] (a).pool \"Z\" is unknown (pools: B)", "steps[1] (a).delayDays must be a number ≥ 0",
    "steps[1] (a).source \"fax\" is unknown (savior, demo, seo, contenu, persona:<slot>)", "steps[1] (a).gate \"ouvert\" is unknown (only \"clicked\" exists)",
  ])
})
