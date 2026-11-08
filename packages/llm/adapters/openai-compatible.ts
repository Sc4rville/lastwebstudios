/**
 * openai-compatible · any Chat Completions server (OpenAI, OpenRouter, Groq, Together, vLLM, Ollama,
 * LM Studio, llama.cpp server…). One `fetch`, no SDK: the lowest common denominator.
 *
 *   OPENAI_BASE_URL  default https://api.openai.com/v1 (Ollama: http://127.0.0.1:11434/v1)
 *   OPENAI_API_KEY   Bearer; optional for a local server
 *   OPENAI_MODEL / LWS_MODEL / LWS_MODEL_<ROLE>   the model (required, see models.ts)
 *
 * Images as `image_url` (base64 data URL). Structured output: `response_format: json_schema`; if the server
 * refuses it (400), we resend without it, once. Same for `max_tokens` vs `max_completion_tokens` (OpenAI's
 * reasoning models only accept the latter). 429 and 5xx: 3 tries with backoff.
 */
import type { LlmAdapter, LlmRequest, LlmResponse } from "../types.ts"
import { LlmError } from "../types.ts"

type Env = Record<string, string | undefined>
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function openaiCompatibleAdapter(env: Env = process.env): LlmAdapter {
  const base = (env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "")
  try { new URL(base) } catch { throw new LlmError(`OPENAI_BASE_URL is invalid: "${base.slice(0, 80)}" (expected: http(s)://host:port/v1)`, "openai-compatible") }
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
          throw new LlmError(`openai-compatible: server unreachable (${base}): ${lastErr}`, "openai-compatible")
        }
        const txt = await res.text()
        if (res.ok) {
          let j: any
          try { j = JSON.parse(txt) } catch { throw new LlmError(`openai-compatible: the answer is not JSON: ${txt.slice(0, 300)}`, "openai-compatible", res.status) }
          const choice = j.choices?.[0]
          const text = typeof choice?.message?.content === "string" ? choice.message.content
            : Array.isArray(choice?.message?.content) ? choice.message.content.map((p: any) => p?.text ?? "").join("") : ""
          if (choice?.finish_reason === "length") throw new LlmError(`openai-compatible: answer truncated at ${req.maxTokens} tokens (${req.label ?? "skill"}): raise maxTokens.`, "openai-compatible")
          let structured: unknown
          if (format) { try { structured = JSON.parse(text) } catch { /* fallback: extraction from the text */ } }
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
        if (res.status === 401 || res.status === 403) throw new LlmError(`openai-compatible: key refused (${res.status}) by ${base}. Check OPENAI_API_KEY.`, "openai-compatible", res.status)
        if (res.status === 404) throw new LlmError(`openai-compatible: ${base}/chat/completions or the model "${req.model}" was not found (404): ${txt.slice(0, 200)}`, "openai-compatible", 404)
        if ((res.status === 429 || res.status >= 500) && attempt < 4) {
          const ra = Number(res.headers.get("retry-after"))
          await sleep(Number.isFinite(ra) && res.headers.get("retry-after") !== null ? Math.min(ra, 60) * 1000 : 700 * 2 ** attempt)
          continue
        }
        throw new LlmError(`openai-compatible: error ${lastErr}`, "openai-compatible", res.status)
      }
      throw new LlmError(`openai-compatible: failed after several tries: ${lastErr}`, "openai-compatible")
    },
  }
}
