type Env = NodeJS.ProcessEnv | Record<string, string | undefined>
export type SpendKind = "agent" | "llm" | "image" | "video"
export type SpendEntry = { at: string; day: string; kind: SpendKind; source: string; usd: number; estimated?: boolean; billing?: string; [k: string]: unknown }
export type StopFileState = { on: boolean; reason: string; since: string | null; source: "fichier" }
export type BudgetStatus = {
  day: string; spentUsd: number; capUsd: number | null; jobMaxUsd: number | null; remainingUsd: number | null
  reached: boolean; resetsAt: string; entries: number; byKind: Record<SpendKind, number>
}
export type BuildsStatus = {
  day: string; done: number; cap: number | null; from: "builds" | "budget" | null; left: number | null; reached: boolean
  perBuildUsd: number; estimateUsd: number; resetsAt: string
}
export type BuildEntry = { at: string; day: string; id: string; source: string; simulated?: boolean; [k: string]: unknown }
export const BUILDS_LOG: string
export const DEFAULT_BUILD_USD: number
export function buildUsd(env?: Env): number
export function buildsCap(env?: Env): { cap: number | null; from: "builds" | "budget" | null }
export function recordBuild(e: { id: string; source: string; simulated?: boolean; at?: string; [k: string]: unknown }, o?: { file?: string }): BuildEntry | null
export function readBuilds(day?: string, o?: { file?: string }): BuildEntry[]
export function buildsStatus(nowIso?: string, env?: Env, o?: { file?: string }): BuildsStatus
export const STOP_FILE: string
export const SPEND_LOG: string
export const SPEND_KINDS: readonly SpendKind[]
export const DEFAULT_IMAGE_USD: number
export const DEFAULT_VIDEO_USD: number
export function stopFile(env?: Env): string
export function stopFileState(env?: Env): StopFileState
export function utcDay(iso?: string): string
export function budgetConfig(env?: Env): { capUsd: number | null; jobMaxUsd: number | null }
export function mediaCostUsd(kind: "image" | "video", env?: Env): number
export function recordSpend(e: { kind: SpendKind; source: string; usd: number; estimated?: boolean; billing?: string; at?: string; [k: string]: unknown }, o?: { file?: string }): SpendEntry | null
export function readSpend(day?: string, o?: { file?: string }): SpendEntry[]
export function budgetStatus(nowIso?: string, env?: Env, o?: { file?: string }): BudgetStatus
export function jobBudgetUsd(nowIso?: string, env?: Env, o?: { file?: string }): number | null
export function mediaGate(kind: "image" | "video", env?: Env, nowIso?: string, o?: { file?: string }): { ok: boolean; why: string; costUsd: number }
