/**
 * provider.ts · WHICH LLM way for the JSON skills (structuring, visual gate, filler, perfect email…).
 *
 *   LWS_LLM=claude-code           `claude -p` (headless Claude Code) on YOUR Claude subscription. Default (plan-first).
 *   LWS_LLM=codex                 `codex exec` (OpenAI's Codex CLI) on YOUR ChatGPT subscription (codex login).
 *   LWS_LLM=anthropic             the Claude API through @anthropic-ai/sdk 1.x (ANTHROPIC_API_KEY, billed per token).
 *   LWS_LLM=anthropic-compatible  any server that speaks the Messages API: Ollama, LM Studio, llama.cpp,
 *                                 LiteLLM, a company gateway (ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN).
 *   LWS_LLM=openai-compatible     any Chat Completions server: OpenAI, OpenRouter, Groq, vLLM,
 *                                 Ollama, LM Studio (OPENAI_BASE_URL + OPENAI_API_KEY + OPENAI_MODEL).
 *
 * Without LWS_LLM: the legacy LLM_VIA (plan → claude-code, api → anthropic) is honoured; otherwise an explicit
 * base URL picks the way (OPENAI_BASE_URL → openai-compatible; ANTHROPIC_BASE_URL outside api.anthropic.com →
 * anthropic-compatible); otherwise claude-code. An ANTHROPIC_API_KEY alone NO LONGER switches to the API
 * (plan-first): that takes LWS_LLM=anthropic. The composer (agents) always goes through Claude Code; Claude Code
 * reads ANTHROPIC_BASE_URL itself, so a gateway or a local server works on that side too.
 */
import type { ProviderName } from "./models.ts"

export const PROVIDERS: readonly ProviderName[] = ["claude-code", "codex", "anthropic", "anthropic-compatible", "openai-compatible"] as const

type Env = Record<string, string | undefined>
export type ProviderChoice = { name: ProviderName; why: string }

const ANTHROPIC_HOST = /(^|\.)anthropic\.com$/i

function hostOf(url: string): string {
  try { return new URL(url).hostname } catch { return "" }
}

export function isProvider(x: string): x is ProviderName {
  return (PROVIDERS as readonly string[]).includes(x)
}

export function selectProvider(env: Env = process.env): ProviderChoice {
  const explicit = (env.LWS_LLM || "").trim().toLowerCase()
  if (explicit) {
    if (isProvider(explicit)) return { name: explicit, why: `LWS_LLM=${explicit}` }
    throw new Error(`LWS_LLM=${env.LWS_LLM} is unknown. Values: ${PROVIDERS.join(" | ")}`)
  }
  const via = (env.LLM_VIA || "").trim().toLowerCase()
  if (via === "plan") return { name: "claude-code", why: "LLM_VIA=plan (legacy)" }
  if (via === "api") return { name: "anthropic", why: "LLM_VIA=api (legacy)" }
  if (env.OPENAI_BASE_URL?.trim()) return { name: "openai-compatible", why: "OPENAI_BASE_URL set (LWS_LLM not set)" }
  const base = env.ANTHROPIC_BASE_URL?.trim()
  if (base && !ANTHROPIC_HOST.test(hostOf(base))) return { name: "anthropic-compatible", why: "ANTHROPIC_BASE_URL outside anthropic.com (LWS_LLM not set)" }
  return { name: "claude-code", why: "default: Claude Code on your subscription (plan-first)" }
}
