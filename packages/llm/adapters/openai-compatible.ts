/**
 * openai-compatible · n'importe quel serveur Chat Completions (OpenAI, OpenRouter, Groq, Together, vLLM, Ollama,
 * LM Studio, llama.cpp server…). Un `fetch`, pas de SDK : c'est le plus petit dénominateur commun.
 *
 *   OPENAI_BASE_URL  défaut https://api.openai.com/v1 (Ollama : http://127.0.0.1:11434/v1)
 *   OPENAI_API_KEY   Bearer ; facultatif pour un serveur local
 *   OPENAI_MODEL / LWS_MODEL / LWS_MODEL_<RÔLE>   le modèle (obligatoire, cf. models.ts)
 *
 * Images en `image_url` (data URL base64). Sortie structurée : `response_format: json_schema` ; si le serveur
 * la refuse (400), on renvoie sans, une fois. Même chose pour `max_tokens` vs `max_completion_tokens` (les
 * modèles de raisonnement d'OpenAI n'acceptent que le second). 429 et 5xx : 3 essais avec backoff.
 */
import type { LlmAdapter, LlmRequest, LlmResponse } from "../types.ts"
import { LlmError } from "../types.ts"

type Env = Record<string, string | undefined>
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function openaiCompatibleAdapter(env: Env = process.env): LlmAdapter {
  const base = (env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "")
  try { new URL(base) } catch { throw new LlmError(`OPENAI_BASE_URL invalide : « ${base.slice(0, 80)} » (attendu : http(s)://hôte:port/v1)`, "openai-compatible") }
  const key = env.OPENAI_API_KEY?.trim()
  const timeoutMs = Number(env.LWS_LLM_TIMEOUT_MS ?? 600_000)
  return {
    name: "openai-compatible",
    async complete(req: LlmRequest): Promise<LlmResponse> {
      const user = req.images?.length
        ? [{ type: "text", text: req.user }, ...req.images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mediaType};base64,${i.data}` } }))]
        : req.user
      let tokenParam: "max_tokens" | "max_completion_tokens" = env.LWS_OPENAI_TOKEN_PARAM === "max_completion_tokens" ? "max_completion_tokens" : "max_tokens"
      let format = req.schema && env.LWS_STRUCTURED !== "0"
      const body = () => ({
        model: req.model,
        messages: [{ role: "system", content: req.system }, { role: "user", content: user }],
        [tokenParam]: req.maxTokens,
        ...(format ? { response_format: { type: "json_schema", json_schema: { name: "skill_output", schema: req.schema, strict: false } } } : {}),
      })
      let lastErr = ""
      for (let attempt = 1; attempt <= 4; attempt++) {
        let res: Response
        try {
          res = await fetch(`${base}/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
            body: JSON.stringify(body()),
            signal: AbortSignal.timeout(timeoutMs),
          })
        } catch (e) {
          lastErr = (e as Error).message
          if (attempt < 3) { await sleep(500 * 2 ** attempt); continue }
          throw new LlmError(`openai-compatible : serveur injoignable (${base}) : ${lastErr}`, "openai-compatible")
        }
        const txt = await res.text()
        if (res.ok) {
          let j: any
          try { j = JSON.parse(txt) } catch { throw new LlmError(`openai-compatible : réponse non-JSON : ${txt.slice(0, 300)}`, "openai-compatible", res.status) }
          const choice = j.choices?.[0]
          const text = typeof choice?.message?.content === "string" ? choice.message.content
            : Array.isArray(choice?.message?.content) ? choice.message.content.map((p: any) => p?.text ?? "").join("") : ""
          if (choice?.finish_reason === "length") throw new LlmError(`openai-compatible : réponse tronquée à ${req.maxTokens} jetons (${req.label ?? "skill"}) : monte maxTokens.`, "openai-compatible")
          let structured: unknown
          if (format) { try { structured = JSON.parse(text) } catch { /* repli : extraction dans le texte */ } }
          return {
            provider: "openai-compatible",
            model: j.model ?? req.model,
            text,
            structured,
            usage: { inputTokens: j.usage?.prompt_tokens, outputTokens: j.usage?.completion_tokens },
            stopReason: choice?.finish_reason,
          }
        }
        lastErr = `${res.status} ${txt.slice(0, 300)}`
        if (res.status === 400 && format && /response_format|json_schema|structured/i.test(txt)) { format = false; continue }
        if (res.status === 400 && tokenParam === "max_tokens" && /max_completion_tokens/.test(txt)) { tokenParam = "max_completion_tokens"; continue }
        if (res.status === 401 || res.status === 403) throw new LlmError(`openai-compatible : clé refusée (${res.status}) par ${base}. Vérifie OPENAI_API_KEY.`, "openai-compatible", res.status)
        if (res.status === 404) throw new LlmError(`openai-compatible : ${base}/chat/completions ou le modèle « ${req.model} » est introuvable (404) : ${txt.slice(0, 200)}`, "openai-compatible", 404)
        if ((res.status === 429 || res.status >= 500) && attempt < 4) {
          const ra = Number(res.headers.get("retry-after"))
          await sleep(Number.isFinite(ra) && res.headers.get("retry-after") !== null ? Math.min(ra, 60) * 1000 : 700 * 2 ** attempt)
          continue
        }
        throw new LlmError(`openai-compatible : erreur ${lastErr}`, "openai-compatible", res.status)
      }
      throw new LlmError(`openai-compatible : échec après plusieurs essais : ${lastErr}`, "openai-compatible")
    },
  }
}
