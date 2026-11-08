/**
 * anthropic · the Claude API (Messages) through @anthropic-ai/sdk 1.x — and any gateway that speaks it.
 *
 *   anthropic             ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN), base api.anthropic.com (or ANTHROPIC_BASE_URL).
 *                         Native structured output (`output_config.format`), cached system prompt.
 *   anthropic-compatible  ANTHROPIC_BASE_URL REQUIRED (Ollama http://127.0.0.1:11434, LM Studio, llama.cpp,
 *                         LiteLLM…), ANTHROPIC_AUTH_TOKEN (Bearer; a local server accepts any
 *                         value). No structured output by default (LWS_STRUCTURED=1 turns it on if the
 *                         server supports it): the JSON is extracted from the text.
 *
 * SDK 1.x / API 2026-10-21: the key goes as `Authorization: Bearer` (no longer `X-Api-Key`); no temperature /
 * top_p / top_k (refused with a 400); adaptive thinking is on by default on the 5.5 models and its tokens count
 * in max_tokens, hence a floor (MIN_MAX_TOKENS) so the JSON is never truncated.
 */
import Anthropic from "@anthropic-ai/sdk"
import type { LlmAdapter, LlmRequest, LlmResponse } from "../types.ts"
import { LlmError } from "../types.ts"
import type { ProviderName } from "../models.ts"

type Env = Record<string, string | undefined>

/** max_tokens floor on the Claude API: thinking (which can't be turned off on Opus 5.5) uses this budget. */
export const MIN_MAX_TOKENS = 4096
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"])

export function anthropicAdapter(kind: "anthropic" | "anthropic-compatible", env: Env = process.env): LlmAdapter {
  const name: ProviderName = kind
  const baseURL = env.ANTHROPIC_BASE_URL?.trim() || undefined
  const apiKey = env.ANTHROPIC_API_KEY?.trim() || undefined
  const authToken = env.ANTHROPIC_AUTH_TOKEN?.trim() || undefined
  if (kind === "anthropic-compatible" && !baseURL) {
    throw new LlmError("LWS_LLM=anthropic-compatible: set ANTHROPIC_BASE_URL (e.g. http://127.0.0.1:11434 for Ollama) and ANTHROPIC_AUTH_TOKEN.", name)
  }
  if (baseURL) { try { new URL(baseURL) } catch { throw new LlmError(`ANTHROPIC_BASE_URL is invalid: "${baseURL.slice(0, 80)}" (expected: http(s)://host:port, e.g. http://127.0.0.1:11434)`, name) } }
  if (kind === "anthropic" && !apiKey && !authToken) {
    throw new LlmError("LWS_LLM=anthropic: ANTHROPIC_API_KEY is missing (platform.claude.com → API keys). Without a key: LWS_LLM=claude-code (your subscription) or a local model (see .env.example).", name)
  }
  // EXPLICIT credentials (never the SDK's implicit chain: `ant` profiles on disk, federation…)
  const client = new Anthropic({
    ...(kind === "anthropic-compatible"
      ? { authToken: authToken ?? apiKey ?? "local" }
      : apiKey ? { apiKey } : { authToken }),
    baseURL: baseURL ?? null,
    // the SDK's built-in backoff on 408/409/429/5xx/network: a prospect must not fail on a transient error
    maxRetries: Number(env.LWS_LLM_RETRIES ?? 4),
  })
  const structured = kind === "anthropic" ? env.LWS_STRUCTURED !== "0" : env.LWS_STRUCTURED === "1"
  const cache = kind === "anthropic" || env.LWS_PROMPT_CACHE === "1"

  return {
    name,
    async complete(req: LlmRequest): Promise<LlmResponse> {
      const content: Anthropic.ContentBlockParam[] = []
      if (req.user) content.push({ type: "text", text: req.user })
      for (const img of req.images ?? []) {
        content.push({ type: "image", source: { type: "base64", media_type: img.mediaType as Anthropic.Base64ImageSource["media_type"], data: img.data } })
      }
      const effort = env[`LWS_EFFORT_${(req.role ?? "").toUpperCase()}`] || env.LWS_EFFORT
      const outputConfig: Anthropic.OutputConfig = {}
      if (structured && req.schema) outputConfig.format = { type: "json_schema", schema: req.schema }
      if (effort && EFFORTS.has(effort)) outputConfig.effort = effort as Anthropic.OutputConfig["effort"]

      let res: Anthropic.Message
      try {
        res = await client.messages.create({
          model: req.model,
          max_tokens: kind === "anthropic" ? Math.max(req.maxTokens, MIN_MAX_TOKENS) : req.maxTokens,
          // the skill's prompt = stable instructions → cached (the same prefix from one prospect to the next)
          system: [{ type: "text", text: req.system, ...(cache ? { cache_control: { type: "ephemeral" as const } } : {}) }],
          messages: [{ role: "user", content }],
          ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
        })
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError) throw new LlmError(`${name}: key refused (401). Check ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN, or switch to the plan (LWS_LLM=claude-code).`, name, 401)
        if (e instanceof Anthropic.PermissionDeniedError) throw new LlmError(`${name}: access denied (403) to the model ${req.model}.`, name, 403)
        if (e instanceof Anthropic.NotFoundError) throw new LlmError(`${name}: model not found "${req.model}" (404). Set LWS_MODEL_${(req.role ?? "FAST").toUpperCase()}=<a model served by ${baseURL ?? "the API"}>.`, name, 404)
        if (e instanceof Anthropic.APIConnectionError) throw new LlmError(`${name}: server unreachable (${baseURL ?? "api.anthropic.com"}): ${e.message}`, name)
        if (e instanceof Anthropic.APIError) throw new LlmError(`${name}: error ${e.status ?? "?"}: ${String(e.message).slice(0, 300)}`, name, e.status)
        throw e
      }
      if (res.stop_reason === "refusal") throw new LlmError(`${name}: the model refused the request (${req.label ?? "skill"}).`, name)
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("")
      if (res.stop_reason === "max_tokens") throw new LlmError(`${name}: answer truncated at max_tokens=${req.maxTokens} (${req.label ?? "skill"}): raise maxTokens.`, name)
      let parsed: unknown
      if (structured && req.schema) { try { parsed = JSON.parse(text) } catch { /* fallback: extraction from the text */ } }
      return {
        provider: name,
        model: res.model ?? req.model,
        text,
        structured: parsed,
        usage: { inputTokens: res.usage?.input_tokens, outputTokens: res.usage?.output_tokens, cacheReadTokens: res.usage?.cache_read_input_tokens ?? undefined, cacheWriteTokens: res.usage?.cache_creation_input_tokens ?? undefined },
        stopReason: res.stop_reason ?? undefined,
      }
    },
  }
}
