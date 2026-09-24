import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { probeHtml } from "../leadengine/2_scoring/scripts/score.ts"
import { buildAxes, weighted, tierOf, needFloor, capUnreachable, expectedValue } from "../leadengine/2_scoring/scripts/model.ts"

test("the dated fixture is a strong need, the modern one is not", () => {
  const dated = probeHtml(readFileSync("demo/before/index.html", "utf8"), "http://x/")
  const modern = probeHtml(readFileSync("demo/modern/index.html", "utf8"), "https://x/")
  assert.ok(dated.need >= 60, `dated need ${dated.need}`)
  assert.ok(dated.feasible, "enough material to rebuild from")
  assert.ok(modern.need < needFloor(75), `modern need ${modern.need}`)
})

test("the five axes are weighted to 100 and tiered", () => {
  const axes = { need: 100, leverage: 100, value: 100, reachability: 100, expansion: 100 }
  assert.equal(weighted(axes), 100)
  assert.equal(tierOf(60), "hot")
  assert.equal(tierOf(59), "warm")
  assert.equal(tierOf(34), "cold")
  assert.equal(expectedValue(axes), 100)
})

test("learned rules are applied on top of the baselines, never instead of them", () => {
  const meta = { industry: "ironworker", email: "a@example.com" }
  const base = buildAxes(70, meta, { premium: true })
  const tuned = buildAxes(70, meta, { premium: true }, { industries: { ironworker: { value: 10 } }, signals: { premium: 1.5 } })
  assert.equal(tuned.value - base.value, 10 + 6) // +10 delta, premium bonus 12 → 18
  assert.equal(tuned.need, base.need)
})

test("a legacy industry key resolves through its alias", () => {
  assert.deepEqual(buildAxes(50, { industry: "ferronnier" }), buildAxes(50, { industry: "ironworker" }))
})

test("the need floor drops as the value of the trade rises", () => {
  assert.ok(needFloor(95) < needFloor(50))
  assert.equal(needFloor(0), 40)
  assert.equal(needFloor(100), 25)
})

test("nobody to reach → never hot", () => {
  const reasons: string[] = []
  assert.equal(capUnreachable("hot", { industry: "x" }, reasons), "warm")
  assert.equal(reasons.length, 1)
  assert.equal(capUnreachable("hot", { industry: "x", email: "a@example.com" }, []), "hot")
})
