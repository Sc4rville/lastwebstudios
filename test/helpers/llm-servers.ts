/**
 * llm-servers.ts · FAKE local LLM servers (127.0.0.1, random port): Anthropic's Messages API and OpenAI's
 * Chat Completions API, faithful enough to prove the adapters' contract (headers, body, images,
 * structured output, errors). Every request is recorded (method, path, headers, JSON body).
 *
 *   const s = await fakeMessages({ reply: (body) => ({ text: '{"ok":true}' }) })
 *   s.url  →  ANTHROPIC_BASE_URL     ·    s.calls[0].headers.authorization  ·  await s.close()
 */
import { createServer, type IncomingHttpHeaders } from "node:http"

export type Call = { method: string; path: string; headers: IncomingHttpHeaders; body: any }
export type FakeServer = { url: string; calls: Call[]; close: () => Promise<void> }

type Reply = { status?: number; json?: unknown; headers?: Record<string, string> }

async function start(handle: (call: Call) => Reply | Promise<Reply>): Promise<FakeServer> {
  const calls: Call[] = []
  const server = createServer(async (req, res) => {
    let raw = ""
    for await (const c of req) raw += c
    let body: any = raw
    try { body = raw ? JSON.parse(raw) : null } catch { /* non-JSON body (multipart…) */ }
    const call: Call = { method: req.method || "GET", path: (req.url || "/").split("?")[0], headers: req.headers, body }
    calls.push(call)
    const r = await handle(call)
    res.writeHead(r.status ?? 200, { "content-type": "application/json", ...(r.headers ?? {}) })
    res.end(JSON.stringify(r.json ?? {}))
  })
  const port = await new Promise<number>((ok) => server.listen(0, "127.0.0.1", () => { const a = server.address(); ok(typeof a === "object" && a ? a.port : 0) }))
  return { url: `http://127.0.0.1:${port}`, calls, close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(() => ok()) }) }
}

export type MessagesReply = { text?: string; status?: number; error?: { type: string; message: string }; stop_reason?: string; thinking?: boolean }

/** Fake `POST /v1/messages` (+ `GET /v1/models`). `reply(body, n)` decides the answer to the n-th call. */
export function fakeMessages(o: { reply?: (body: any, n: number) => MessagesReply } = {}): Promise<FakeServer> {
  let n = 0
  return start((call) => {
    if (call.method === "GET" && call.path === "/v1/models") return { json: { data: [{ id: "claude-sonnet-5-5", type: "model" }], has_more: false } }
    if (call.method !== "POST" || call.path !== "/v1/messages") return { status: 404, json: { type: "error", error: { type: "not_found_error", message: "route" } } }
    const r = o.reply ? o.reply(call.body, ++n) : { text: "{}" }
    if (r.status && r.status >= 400) return { status: r.status, json: { type: "error", error: r.error ?? { type: "api_error", message: "fake" } } }
    const content: any[] = []
    if (r.thinking) content.push({ type: "thinking", thinking: "", signature: "fake" })
    content.push({ type: "text", text: r.text ?? "{}" })
    return {
      json: {
        id: `msg_fake_${n}`, type: "message", role: "assistant", model: call.body?.model ?? "fake", content,
        stop_reason: r.stop_reason ?? "end_turn", stop_sequence: null, stop_details: null,
        usage: { input_tokens: 120, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    }
  })
}

export type ChatReply = { text?: string; status?: number; error?: string; finish_reason?: string; headers?: Record<string, string> }

/** Faux `POST /v1/chat/completions` (+ `GET /v1/models`). */
export function fakeChat(o: { reply?: (body: any, n: number) => ChatReply } = {}): Promise<FakeServer> {
  let n = 0
  return start((call) => {
    if (call.method === "GET" && call.path === "/v1/models") return { json: { object: "list", data: [{ id: "fake-small", object: "model" }] } }
    if (call.method !== "POST" || call.path !== "/v1/chat/completions") return { status: 404, json: { error: { message: "route" } } }
    const r = o.reply ? o.reply(call.body, ++n) : { text: "{}" }
    if (r.status && r.status >= 400) return { status: r.status, headers: r.headers, json: { error: { message: r.error ?? "fake", type: "invalid_request_error" } } }
    return {
      json: {
        id: `chatcmpl-fake-${n}`, object: "chat.completion", model: call.body?.model ?? "fake",
        choices: [{ index: 0, finish_reason: r.finish_reason ?? "stop", message: { role: "assistant", content: r.text ?? "{}" } }],
        usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
      },
    }
  })
}

/** The canonical (fictional) answer of the structuration skill, as a model would return it. */
export const STRUCTURATION_JSON = JSON.stringify({
  identity: { phone: "03 53 01 24 68", email: "contact@orvane-piscines.example", zone: "Vallée de la Lys" },
  content: {
    tagline: "Votre piscine, notre savoir-faire depuis 1998",
    about: "Orvane Piscines construit et rénove des piscines familiales dans la vallée de la Lys.",
    services: ["construction de piscines", "rénovation de bassins", "spas et abris", "entretien saisonnier"],
    brands: ["Aquaclair"],
  },
})
