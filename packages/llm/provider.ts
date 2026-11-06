/**
 * provider.ts · QUELLE voie LLM pour les skills JSON (structuration, porte visuelle, filler, mail parfait…).
 *
 *   LWS_LLM=claude-code           `claude -p` (Claude Code headless) sur TON abonnement Claude. Défaut (plan-first).
 *   LWS_LLM=codex                 `codex exec` (Codex CLI d'OpenAI) sur TON abonnement ChatGPT (codex login).
 *   LWS_LLM=anthropic             API Claude via @anthropic-ai/sdk 1.x (ANTHROPIC_API_KEY, facturé au token).
 *   LWS_LLM=anthropic-compatible  n'importe quel serveur qui parle l'API Messages : Ollama, LM Studio, llama.cpp,
 *                                 LiteLLM, passerelle d'entreprise (ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN).
 *   LWS_LLM=openai-compatible     n'importe quel serveur Chat Completions : OpenAI, OpenRouter, Groq, vLLM,
 *                                 Ollama, LM Studio (OPENAI_BASE_URL + OPENAI_API_KEY + OPENAI_MODEL).
 *
 * Sans LWS_LLM : l'historique LLM_VIA (plan → claude-code, api → anthropic) est respecté ; sinon une base d'URL
 * explicite désigne la voie (OPENAI_BASE_URL → openai-compatible ; ANTHROPIC_BASE_URL hors api.anthropic.com →
 * anthropic-compatible) ; sinon claude-code. Une clé ANTHROPIC_API_KEY seule ne fait PLUS basculer sur l'API
 * (plan-first) : il faut LWS_LLM=anthropic. Le composer (agents) passe toujours par Claude Code ; Claude Code lit
 * lui-même ANTHROPIC_BASE_URL, donc une passerelle ou un serveur local marchent aussi de ce côté.
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
    throw new Error(`LWS_LLM=${env.LWS_LLM} inconnu. Valeurs : ${PROVIDERS.join(" | ")}`)
  }
  const via = (env.LLM_VIA || "").trim().toLowerCase()
  if (via === "plan") return { name: "claude-code", why: "LLM_VIA=plan (historique)" }
  if (via === "api") return { name: "anthropic", why: "LLM_VIA=api (historique)" }
  if (env.OPENAI_BASE_URL?.trim()) return { name: "openai-compatible", why: "OPENAI_BASE_URL posé (LWS_LLM absent)" }
  const base = env.ANTHROPIC_BASE_URL?.trim()
  if (base && !ANTHROPIC_HOST.test(hostOf(base))) return { name: "anthropic-compatible", why: "ANTHROPIC_BASE_URL hors anthropic.com (LWS_LLM absent)" }
  return { name: "claude-code", why: "défaut (plan-first : Claude Code sur ton abonnement)" }
}
