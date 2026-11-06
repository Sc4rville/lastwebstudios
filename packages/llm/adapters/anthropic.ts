/**
 * anthropic · API Claude (Messages) via @anthropic-ai/sdk 1.x — et toute passerelle qui la parle.
 *
 *   anthropic             ANTHROPIC_API_KEY (ou ANTHROPIC_AUTH_TOKEN), base api.anthropic.com (ou ANTHROPIC_BASE_URL).
 *                         Sortie structurée native (`output_config.format`), prompt système mis en cache.
 *   anthropic-compatible  ANTHROPIC_BASE_URL OBLIGATOIRE (Ollama http://127.0.0.1:11434, LM Studio, llama.cpp,
 *                         LiteLLM…), ANTHROPIC_AUTH_TOKEN (Bearer ; un serveur local accepte n'importe quelle
 *                         valeur). Pas de sortie structurée par défaut (LWS_STRUCTURED=1 pour l'activer si le
 *                         serveur la gère) : le JSON est extrait du texte.
 *
 * SDK 1.x / API 2026-10-21 : la clé part en `Authorization: Bearer` (plus `X-Api-Key`) ; pas de temperature /
 * top_p / top_k (refusés en 400) ; réflexion adaptative active par défaut sur les 5.5 et ses jetons comptent
 * dans max_tokens, d'où un plancher (MIN_MAX_TOKENS) pour ne jamais tronquer le JSON.
 */
import Anthropic from "@anthropic-ai/sdk"
import type { LlmAdapter, LlmRequest, LlmResponse } from "../types.ts"
import { LlmError } from "../types.ts"
import type { ProviderName } from "../models.ts"

type Env = Record<string, string | undefined>

/** Plancher de max_tokens sur l'API Claude : la réflexion (non désactivable sur Opus 5.5) consomme ce budget. */
export const MIN_MAX_TOKENS = 4096
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"])

export function anthropicAdapter(kind: "anthropic" | "anthropic-compatible", env: Env = process.env): LlmAdapter {
  const name: ProviderName = kind
  const baseURL = env.ANTHROPIC_BASE_URL?.trim() || undefined
  const apiKey = env.ANTHROPIC_API_KEY?.trim() || undefined
  const authToken = env.ANTHROPIC_AUTH_TOKEN?.trim() || undefined
  if (kind === "anthropic-compatible" && !baseURL) {
    throw new LlmError("LWS_LLM=anthropic-compatible : pose ANTHROPIC_BASE_URL (ex. http://127.0.0.1:11434 pour Ollama) et ANTHROPIC_AUTH_TOKEN.", name)
  }
  if (baseURL) { try { new URL(baseURL) } catch { throw new LlmError(`ANTHROPIC_BASE_URL invalide : « ${baseURL.slice(0, 80)} » (attendu : http(s)://hôte:port, ex. http://127.0.0.1:11434)`, name) } }
  if (kind === "anthropic" && !apiKey && !authToken) {
    throw new LlmError("LWS_LLM=anthropic : ANTHROPIC_API_KEY manquante (platform.claude.com → API keys). Sans clé : LWS_LLM=claude-code (ton abonnement) ou un modèle local (cf. .env.example).", name)
  }
  // identifiants EXPLICITES (jamais la chaîne implicite du SDK : profils `ant` sur disque, fédération…)
  const client = new Anthropic({
    ...(kind === "anthropic-compatible"
      ? { authToken: authToken ?? apiKey ?? "local" }
      : apiKey ? { apiKey } : { authToken }),
    baseURL: baseURL ?? null,
    // backoff intégré du SDK sur 408/409/429/5xx/réseau : un prospect ne doit pas échouer sur une erreur transitoire
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
          // le prompt du skill = instructions stables → mises en cache (préfixe identique d'un prospect à l'autre)
          system: [{ type: "text", text: req.system, ...(cache ? { cache_control: { type: "ephemeral" as const } } : {}) }],
          messages: [{ role: "user", content }],
          ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
        })
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError) throw new LlmError(`${name} : clé refusée (401). Vérifie ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN, ou passe sur le plan (LWS_LLM=claude-code).`, name, 401)
        if (e instanceof Anthropic.PermissionDeniedError) throw new LlmError(`${name} : accès refusé (403) au modèle ${req.model}.`, name, 403)
        if (e instanceof Anthropic.NotFoundError) throw new LlmError(`${name} : modèle introuvable « ${req.model} » (404). Pose LWS_MODEL_${(req.role ?? "FAST").toUpperCase()}=<modèle servi par ${baseURL ?? "l'API"}>.`, name, 404)
        if (e instanceof Anthropic.APIConnectionError) throw new LlmError(`${name} : serveur injoignable (${baseURL ?? "api.anthropic.com"}) : ${e.message}`, name)
        if (e instanceof Anthropic.APIError) throw new LlmError(`${name} : erreur ${e.status ?? "?"} : ${String(e.message).slice(0, 300)}`, name, e.status)
        throw e
      }
      if (res.stop_reason === "refusal") throw new LlmError(`${name} : le modèle a refusé la requête (${req.label ?? "skill"}).`, name)
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("")
      if (res.stop_reason === "max_tokens") throw new LlmError(`${name} : réponse tronquée à max_tokens=${req.maxTokens} (${req.label ?? "skill"}) : monte maxTokens.`, name)
      let parsed: unknown
      if (structured && req.schema) { try { parsed = JSON.parse(text) } catch { /* repli : extraction dans le texte */ } }
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
