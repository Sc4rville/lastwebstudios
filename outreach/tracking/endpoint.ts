/**
 * endpoint.ts · the PUBLIC tracking endpoint, served by the cockpit (backoffice/reviewpipe/serve.ts) under /t/.
 * No authentication (it is clicked from the prospects' mailboxes), so everything is checked here (F-3):
 *
 *   GET  /t/c/<token>   click: a signed token (HMAC) that carries the send AND the URL → `click` event + 302 to
 *                       THAT URL only. Forged token → 403, malformed → 400, ?u=… ignored (no more
 *                       open redirect). HEAD → 302 with no event (scanners probe with HEAD).
 *                       A scanner user agent (mail gateway, antivirus) → event marked `suspect`.
 *   GET  /t/u/<token>   unsubscribe, step 1: a CONFIRMATION page with a button. NOTHING is recorded
 *                       (a link scanner that follows the link unsubscribes nobody).
 *   POST /t/u/<token>   unsubscribe, step 2: RFC 8058 "List-Unsubscribe=One-Click" (Gmail's / Yahoo's
 *                       native button) or the page's form → `unsub` event → the sequencer takes the
 *                       prospect out at the next tick. Body capped at 1 KB.
 *
 * The pages speak the agency's language (French for a French-speaking agency, English otherwise): the prospect reads them.
 * Event caps: see ./events.ts (CAPS). Without LWS_TRACK_SECRET → 404 (not configured, nothing is tracked).
 */
import type { IncomingMessage, ServerResponse } from "node:http"
import { parseClickToken, parseUnsubToken, trackingSecret } from "./links.ts"
import { recordEvent, suspectUa, type OutreachEvent } from "./events.ts"
import { textCollector } from "../../packages/shared/lines.mjs"
import { agency } from "../../packages/shared/agency.mjs"

const HDR = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" }
const MAX_BODY = 1024

function page(res: ServerResponse, code: number, title: string, body: string, lang: string): void {
  res.writeHead(code, { "Content-Type": "text/html; charset=utf-8", ...HDR, "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" })
  res.end(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>
<body style="font:16px/1.6 system-ui,-apple-system,sans-serif;max-width:520px;margin:12vh auto;padding:0 24px;color:#222">${body}</body></html>`)
}
const text = (res: ServerResponse, code: number, msg: string) => { res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8", ...HDR }); res.end(msg) }

function readSmallBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const body = textCollector(), state = { over: false }
    req.on("data", (c: Buffer) => { if (state.over) return; body.push(c); if (body.bytes > MAX_BODY) { state.over = true; resolve(null); req.resume() } })
    req.on("end", () => { if (!state.over) resolve(body.text()) })
    req.on("error", () => resolve(null))
  })
}

const decode = (s: string) => { try { return decodeURIComponent(s) } catch { return "" } }

export type TrackingDeps = { onEvent?: (e: OutreachEvent, stored: string) => void; env?: NodeJS.ProcessEnv }

/** the unsubscribe pages, in the agency's language (the prospect reads them) */
const PAGES = {
  fr: { ask: "Se désinscrire", askH: "Ne plus recevoir nos messages ?", askP: "Un clic et c'est fait : vous ne recevrez plus aucun message de notre part.", btn: "Me désinscrire",
    done: "Désinscription confirmée", doneH: "C'est noté.", doneP: "Vous ne recevrez plus de messages de notre part. Désolé pour le dérangement, et bonne continuation." },
  en: { ask: "Unsubscribe", askH: "Stop receiving our messages?", askP: "One click and it's done: you will not receive any more messages from us.", btn: "Unsubscribe me",
    done: "Unsubscribed", doneH: "Done.", doneP: "You will not receive any more messages from us. Sorry for the bother, and all the best." },
}
function pageLang(env: NodeJS.ProcessEnv): "fr" | "en" {
  try { return String(agency(env).language || "").startsWith("fr") ? "fr" : "en" } catch { return "en" }
}

/** Handles a /t/… request; `path` = url.pathname. Never throws. */
export async function handleTracking(req: IncomingMessage, res: ServerResponse, path: string, deps: TrackingDeps = {}): Promise<void> {
  const secret = trackingSecret(deps.env ?? process.env)
  const m = /^\/t\/([cu])\/([^/]*)$/.exec(path)
  if (!m) return text(res, 404, "unknown link")
  // without a secret no token can be verified: nothing is redirected or recorded (404, never a blind redirect)
  if (!secret) return text(res, 404, "tracking not configured (TRACK_BASE + LWS_TRACK_SECRET)")
  const [, kind, token] = m
  const method = req.method || "GET"

  if (kind === "c") {
    if (method !== "GET" && method !== "HEAD") return text(res, 405, "method not allowed")
    const p = parseClickToken(decode(token), secret)
    if (!p.ok) return text(res, p.status, p.error)
    if (method === "GET") {
      const ua = String(req.headers["user-agent"] || "")
      try {
        const r = await recordEvent({ type: "click", source: "track", trackingId: p.trackingId, url: p.url, ua, suspect: suspectUa(ua) })
        deps.onEvent?.(r.event, r.stored)
      } catch { /* never block the redirect over a write problem */ }
    }
    res.writeHead(302, { Location: p.url, ...HDR })
    res.end()
    return
  }

  // unsubscribe
  const p = parseUnsubToken(decode(token), secret)
  if (!p.ok) return text(res, p.status, p.error)
  const lang = pageLang(deps.env ?? process.env), w = PAGES[lang]
  if (method === "GET" || method === "HEAD") {
    return page(res, 200, w.ask, `<h1 style="font-size:20px">${w.askH}</h1>
<p>${w.askP}</p>
<form method="post"><input type="hidden" name="List-Unsubscribe" value="One-Click">
<button type="submit" style="font:inherit;padding:10px 18px;border:0;border-radius:6px;background:#222;color:#fff;cursor:pointer">${w.btn}</button></form>`, lang)
  }
  if (method !== "POST") return text(res, 405, "method not allowed")
  const body = await readSmallBody(req)
  if (body === null) return text(res, 413, "body too large")
  const form = new URLSearchParams(body)
  if (form.get("List-Unsubscribe") !== "One-Click") return text(res, 400, "expected: List-Unsubscribe=One-Click (RFC 8058)")
  try {
    const r = await recordEvent({ type: "unsub", source: "track", trackingId: p.trackingId, ua: String(req.headers["user-agent"] || "") })
    deps.onEvent?.(r.event, r.stored)
  } catch { /* the page confirms anyway; the prospect can also reply "STOP" */ }
  return page(res, 200, w.done, `<h1 style="font-size:20px">${w.doneH}</h1><p>${w.doneP}</p>`, lang)
}
