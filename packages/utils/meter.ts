/**
 * meter.ts — API spend meter + budget ceilings (the cage).
 *
 * The ONLY place where dollars leave the atelier is `llm.ts`: every LLM call goes through it.
 * `recordSpend` runs after each call, `assertBudget` before the next one.
 *
 * - Prices come from `.env` (USD per 1M tokens), so the meter stays provider-agnostic.
 * - Ledger: one JSONL line per call in `journal/spend.jsonl` (gitignored).
 * - Three ceilings, hardest first: lifetime → day → cycle (one process = one cycle).
 */
import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"

export interface Usage {
  input_tokens?: number | null
  output_tokens?: number | null
}

export class BudgetExceeded extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BudgetExceeded"
  }
}

const spendLog = () => process.env.SPEND_LOG_PATH || join(process.cwd(), "journal", "spend.jsonl")
const num = (key: string): number | null => {
  const n = Number(process.env[key] ?? "")
  return Number.isFinite(n) && n > 0 ? n : null
}

let processTotalUsd = 0 // this process ≈ one cycle / one pipeline run

/** Cost in USD of one call, from the usage the API returned. */
export function priceUsage(u: Usage): number {
  const pin = num("LLM_PRICE_IN_PER_MTOK") ?? 0
  const pout = num("LLM_PRICE_OUT_PER_MTOK") ?? 0
  return ((u.input_tokens ?? 0) * pin + (u.output_tokens ?? 0) * pout) / 1_000_000
}

function ledger(): { ts: string; usd: number }[] {
  const path = spendLog()
  if (!existsSync(path)) return []
  const rows: { ts: string; usd: number }[] = []
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line)
      if (typeof e.ts === "string" && typeof e.usd === "number") rows.push(e)
    } catch {
      /* corrupted line: ignored, never fatal */
    }
  }
  return rows
}

export const lifetimeTotalUsd = () => ledger().reduce((s, e) => s + e.usd, 0)
export const dayTotalUsd = () => {
  const today = new Date().toISOString().slice(0, 10)
  return ledger().filter((e) => e.ts.startsWith(today)).reduce((s, e) => s + e.usd, 0)
}
export const cycleTotalUsd = () => processTotalUsd

/** Record the cost of one call (append-only ledger). */
export function recordSpend(args: { skill: string; model: string; usage: Usage }): number {
  const usd = priceUsage(args.usage)
  processTotalUsd += usd
  const path = spendLog()
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, JSON.stringify({ ts: new Date().toISOString(), ...args, usd: Number(usd.toFixed(6)) }) + "\n")
  return usd
}

/** Call BEFORE every LLM call. Throws `BudgetExceeded` as soon as a ceiling is reached. */
export function assertBudget(): void {
  const life = num("LIFETIME_BUDGET_USD")
  if (life !== null && lifetimeTotalUsd() >= life)
    throw new BudgetExceeded(`Lifetime budget reached: $${lifetimeTotalUsd().toFixed(2)} ≥ $${life}. Metered path is CLOSED.`)
  const day = num("DAILY_BUDGET_USD")
  if (day !== null && dayTotalUsd() >= day)
    throw new BudgetExceeded(`Daily budget reached: $${dayTotalUsd().toFixed(2)} ≥ $${day}. Clean stop.`)
  const cycle = num("CYCLE_BUDGET_USD")
  if (cycle !== null && processTotalUsd >= cycle)
    throw new BudgetExceeded(`Cycle budget reached: $${processTotalUsd.toFixed(2)} ≥ $${cycle}. Clean stop.`)
}

/** Budget snapshot for digests. */
export function meterStatus() {
  return {
    cycleUsd: Number(processTotalUsd.toFixed(4)),
    todayUsd: Number(dayTotalUsd().toFixed(4)),
    lifetimeUsd: Number(lifetimeTotalUsd().toFixed(4)),
    lifetimeCapUsd: num("LIFETIME_BUDGET_USD"),
  }
}
