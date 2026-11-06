/**
 * endpoint.ts · l'endpoint PUBLIC du tracking, servi par le cockpit (backoffice/reviewpipe/serve.ts) sous /t/.
 * Pas d'authentification (il est cliqué depuis les boîtes des prospects), donc tout est vérifié ici (F-3) :
 *
 *   GET  /t/c/<jeton>   clic : jeton signé (HMAC) qui porte l'envoi ET l'URL → évènement `click` + 302 vers
 *                       CETTE URL seulement. Jeton forgé → 403, mal formé → 400, ?u=… ignoré (plus de
 *                       redirection ouverte). HEAD → 302 sans évènement (les scanners sondent en HEAD).
 *                       User-agent de scanner (passerelle mail, antivirus) → évènement marqué `suspect`.
 *   GET  /t/u/<jeton>   désinscription, étape 1 : page de CONFIRMATION avec un bouton. RIEN n'est enregistré
 *                       (un scanner de liens qui suit le lien ne désinscrit personne).
 *   POST /t/u/<jeton>   désinscription, étape 2 : RFC 8058 « List-Unsubscribe=One-Click » (le bouton natif de
 *                       Gmail / Yahoo) ou le formulaire de la page → évènement `unsub` → le séquenceur sort le
 *                       prospect au tick suivant. Corps plafonné à 1 Ko.
 *
 * Plafonds d'évènements : cf. ./events.ts (CAPS). Sans LWS_TRACK_SECRET → 404 (non configuré, rien n'est suivi).
 */
import type { IncomingMessage, ServerResponse } from "node:http"
import { parseClickToken, parseUnsubToken, trackingSecret } from "./links.ts"
import { recordEvent, suspectUa, type OutreachEvent } from "./events.ts"
import { textCollector } from "../../packages/shared/lines.mjs"

const HDR = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" }
const MAX_BODY = 1024

function page(res: ServerResponse, code: number, title: string, body: string): void {
  res.writeHead(code, { "Content-Type": "text/html; charset=utf-8", ...HDR, "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" })
  res.end(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>
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

/** Traite une requête /t/… ; `path` = url.pathname. Ne lève jamais. */
export async function handleTracking(req: IncomingMessage, res: ServerResponse, path: string, deps: TrackingDeps = {}): Promise<void> {
  const secret = trackingSecret(deps.env ?? process.env)
  const m = /^\/t\/([cu])\/([^/]*)$/.exec(path)
  if (!m) return text(res, 404, "lien inconnu")
  // sans secret, aucun jeton n'est vérifiable : on ne redirige ni n'enregistre rien (404, jamais de redirection aveugle)
  if (!secret) return text(res, 404, "tracking non configuré (TRACK_BASE + LWS_TRACK_SECRET)")
  const [, kind, token] = m
  const method = req.method || "GET"

  if (kind === "c") {
    if (method !== "GET" && method !== "HEAD") return text(res, 405, "méthode non autorisée")
    const p = parseClickToken(decode(token), secret)
    if (!p.ok) return text(res, p.status, p.error)
    if (method === "GET") {
      const ua = String(req.headers["user-agent"] || "")
      try {
        const r = await recordEvent({ type: "click", source: "track", trackingId: p.trackingId, url: p.url, ua, suspect: suspectUa(ua) })
        deps.onEvent?.(r.event, r.stored)
      } catch { /* jamais bloquer la redirection pour un souci d'écriture */ }
    }
    res.writeHead(302, { Location: p.url, ...HDR })
    res.end()
    return
  }

  // désinscription
  const p = parseUnsubToken(decode(token), secret)
  if (!p.ok) return text(res, p.status, p.error)
  if (method === "GET" || method === "HEAD") {
    return page(res, 200, "Se désinscrire", `<h1 style="font-size:20px">Ne plus recevoir nos messages ?</h1>
<p>Un clic et c'est fait : vous ne recevrez plus aucun message de notre part.</p>
<form method="post"><input type="hidden" name="List-Unsubscribe" value="One-Click">
<button type="submit" style="font:inherit;padding:10px 18px;border:0;border-radius:6px;background:#222;color:#fff;cursor:pointer">Me désinscrire</button></form>`)
  }
  if (method !== "POST") return text(res, 405, "méthode non autorisée")
  const body = await readSmallBody(req)
  if (body === null) return text(res, 413, "corps trop gros")
  const form = new URLSearchParams(body)
  if (form.get("List-Unsubscribe") !== "One-Click") return text(res, 400, "attendu : List-Unsubscribe=One-Click (RFC 8058)")
  try {
    const r = await recordEvent({ type: "unsub", source: "track", trackingId: p.trackingId, ua: String(req.headers["user-agent"] || "") })
    deps.onEvent?.(r.event, r.stored)
  } catch { /* la page confirme quand même ; le prospect peut aussi répondre « STOP » */ }
  return page(res, 200, "Désinscription confirmée", `<h1 style="font-size:20px">C'est noté.</h1><p>Vous ne recevrez plus de messages de notre part. Désolé pour le dérangement, et bonne continuation.</p>`)
}
