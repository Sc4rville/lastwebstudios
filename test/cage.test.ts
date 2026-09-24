import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createFailureCircuit } from "../packages/utils/guard.ts"
import { assertBudget, BudgetExceeded, priceUsage } from "../packages/utils/meter.ts"

test("the circuit opens on the same failure twice in a row, and re-arms after a success", () => {
  const open = createFailureCircuit(2)
  assert.equal(open("boom", 0), false)
  assert.equal(open("boom", 1), true)
  const again = createFailureCircuit(2)
  assert.equal(again("boom", 0), false)
  assert.equal(again("boom", 2), false) // prospect 1 succeeded in between
  assert.equal(again("other", 3), false)
})

test("spend is priced from the operator's .env, provider-agnostic", () => {
  process.env.LLM_PRICE_IN_PER_MTOK = "2"
  process.env.LLM_PRICE_OUT_PER_MTOK = "10"
  assert.equal(priceUsage({ input_tokens: 1_000_000, output_tokens: 100_000 }), 3)
})

test("a ceiling reached in the ledger stops the next call", () => {
  const dir = mkdtempSync(join(tmpdir(), "lws-"))
  const ledger = join(dir, "spend.jsonl")
  writeFileSync(ledger, JSON.stringify({ ts: new Date().toISOString(), usd: 4.2 }) + "\n{corrupted line\n")
  process.env.SPEND_LOG_PATH = ledger
  process.env.DAILY_BUDGET_USD = "5"
  assert.doesNotThrow(() => assertBudget())
  process.env.DAILY_BUDGET_USD = "4"
  assert.throws(() => assertBudget(), BudgetExceeded)
  delete process.env.DAILY_BUDGET_USD
  process.env.LIFETIME_BUDGET_USD = "1"
  assert.throws(() => assertBudget(), /Lifetime/)
  delete process.env.LIFETIME_BUDGET_USD
  delete process.env.SPEND_LOG_PATH
  rmSync(dir, { recursive: true })
})
