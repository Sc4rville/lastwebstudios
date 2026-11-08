/**
 * types.ts · the shared contract of the 4 LLM adapters (packages/llm/adapters/*).
 *
 * A request = a stable system prompt (the skill's prompt.md, cached when the way allows it) + a
 * user message (the input blocks) + optional images + an optional JSON schema (native structured
 * output when the way offers it, otherwise the JSON is extracted from the text).
 */
import type { ModelRole, ProviderName } from "./models.ts"

export type LlmImage = { path: string; mediaType: string; data: string /* base64 */ }

export type JsonSchema = { [key: string]: unknown }

export type LlmRequest = {
  system: string
  user: string
  images?: LlmImage[]
  model: string
  role?: ModelRole
  maxTokens: number
  /** JSON schema of the expected output (structured outputs); absent = JSON extracted from the text */
  schema?: JsonSchema
  /** a readable label (logs, errors) */
  label?: string
}

export type LlmUsage = { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; costUsd?: number }

export type LlmResponse = {
  provider: ProviderName
  model: string
  text: string
  /** the native structured output, if the way provided and validated it */
  structured?: unknown
  usage?: LlmUsage
  stopReason?: string
}

export interface LlmAdapter {
  readonly name: ProviderName
  complete(req: LlmRequest): Promise<LlmResponse>
}

export class LlmError extends Error {
  constructor(message: string, readonly provider: ProviderName, readonly status?: number) {
    super(message)
    this.name = "LlmError"
  }
}
