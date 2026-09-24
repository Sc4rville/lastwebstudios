import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { buildRules } from "../learning/scripts/learn.ts"
import type { Outcome } from "../learning/scripts/types.ts"

const o = (industry: string, outcome: Outcome["outcome"], signals: Outcome["signals"] = {}): Outcome =>
  ({ id: Math.random().toString(36), industry, outcome, signals, ts: "2026-01-01T00:00:00Z" })

test("no outcome → empty rules → the scoring runs on its human baselines", () => {
  const r = buildRules([], "now")
  assert.deepEqual(r.industries, {})
  assert.deepEqual(r.signals, {})
})

test("two anecdotes barely move anything (small-N shrinkage)", () => {
  const r = buildRules([o("pool-builder", "won"), o("ironworker", "lost")], "now")
  for (const d of Object.values(r.industries ?? {})) assert.ok(Math.abs(d.value ?? 0) <= 3, JSON.stringify(d))
})

test("volume moves the baseline, within bounds", () => {
  const outcomes = [
    ...Array.from({ length: 40 }, () => o("pool-builder", "won", { premium: true })),
    ...Array.from({ length: 40 }, () => o("ironworker", "lost")),
  ]
  const r = buildRules(outcomes, "now")
  assert.ok((r.industries?.["pool-builder"]?.value ?? 0) > 8)
  assert.ok((r.industries?.["ironworker"]?.value ?? 0) < -8)
  for (const d of Object.values(r.industries ?? {})) assert.ok(Math.abs(d.value ?? 0) <= 15)
  for (const m of Object.values(r.signals ?? {})) assert.ok(m >= 0.5 && m <= 1.5)
  assert.ok((r.signals?.premium ?? 1) > 1, "premium predicts a sale → its bonus grows")
})

test("the sample outcomes file is valid and produces rules", () => {
  const lines = readFileSync("demo/outcomes.sample.jsonl", "utf8").split("\n").filter(Boolean)
  const r = buildRules(lines.map((l) => JSON.parse(l)), "now")
  assert.equal(r.totalOutcomes, lines.length)
  assert.ok(Object.keys(r.signals ?? {}).length > 0)
})
