/**
 * packages/llm · LWS's "bring your own model" layer.
 *
 *   selectProvider(env)          which way (claude-code | codex | anthropic | anthropic-compatible | openai-compatible)
 *   resolveModel(role, provider) which model for a role (smart | fast | judge)
 *   adapterFor(provider, env)    the way's adapter
 *   completeJson(req)            one call, the JSON output (native if the way provides it, else extracted from the text)
 *
 * See .env.example (LLM section) and docs/BYO-MODEL.md to plug in Ollama, LiteLLM, OpenRouter, vLLM…
 */
import { selectProvider, type ProviderChoice } from "./provider.ts"
import { resolveModel, modelFor, isRole, type ModelRole, type ProviderName } from "./models.ts"
import { parseJson } from "./json.ts"
import { claudeCodeAdapter } from "./adapters/claude-code.ts"
import { codexAdapter } from "./adapters/codex.ts"
import { anthropicAdapter } from "./adapters/anthropic.ts"
import { openaiCompatibleAdapter } from "./adapters/openai-compatible.ts"
import type { LlmAdapter, LlmRequest, LlmResponse } from "./types.ts"

export * from "./models.ts"
export * from "./types.ts"
export { selectProvider, PROVIDERS, isProvider } from "./provider.ts"
export { parseJson } from "./json.ts"

type Env = Record<string, string | undefined>

export function adapterFor(provider: ProviderName, env: Env = process.env): LlmAdapter {
  switch (provider) {
    case "claude-code": return claudeCodeAdapter(env)
    case "codex": return codexAdapter(env)
    case "anthropic": return anthropicAdapter("anthropic", env)
    case "anthropic-compatible": return anthropicAdapter("anthropic-compatible", env)
    case "openai-compatible": return openaiCompatibleAdapter(env)
  }
}

export type JsonCall = Omit<LlmRequest, "model"> & { roleOrModel: ModelRole | string }

export type JsonResult = { json: any; response: LlmResponse; provider: ProviderChoice; structured: boolean }

/** An LLM call we want a JSON object from: native structured output first, extraction from the text as a fallback. */
export async function completeJson(call: JsonCall, env: Env = process.env): Promise<JsonResult> {
  const provider = selectProvider(env)
  const role = isRole(call.roleOrModel) ? call.roleOrModel : undefined
  const model = role ? resolveModel(role, provider.name, env).model : modelFor(call.roleOrModel, provider.name, env)
  const { roleOrModel: _ignored, ...rest } = call
  const response = await adapterFor(provider.name, env).complete({ ...rest, model, role })
  const native = response.structured
  if (native && typeof native === "object") return { json: native, response, provider, structured: true }
  return { json: parseJson(response.text), response, provider, structured: false }
}
