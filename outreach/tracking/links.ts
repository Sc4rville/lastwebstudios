/**
 * links.ts · the SIGNED LINKS of the self-hosted tracking (click + one-click unsubscribe). Pure computation, no I/O.
 *
 * Replaces the Supabase edge function (never versioned, answering 402 since the quota freeze): the cockpit serves
 * `/t/c/<token>` and `/t/u/<token>` itself (see ./endpoint.ts). Fixes F-3 (open redirect + forgeable
 * events): the destination URL is IN the token and signed (HMAC-SHA256, LWS_TRACK_SECRET), so the
 * cockpit only redirects to URLs it put in an email itself, and nobody can fabricate a
 * click or an unsubscribe for a send they do not know.
 *
 *   clic          {TRACK_BASE}/t/c/<id22>.<url en base64url>.<signature 16>
 *   unsubscribe    {TRACK_BASE}/t/u/<id22>.<signature 16>
 *
 * `id22` = the send's trackingId (UUID v4, sends.jsonl) in base64url (22 characters), validated when decoded.
 * The signature carries a type prefix ("c" or "u"): a click token is not an unsubscribe.
 *
 * Settings: TRACK_BASE (the cockpit's public URL, https in production) + LWS_TRACK_SECRET (≥ 32 characters, e.g.
 * `openssl rand -base64 48`). If either is missing → no link is rewritten, unsubscribing by replying "STOP" +
 * the mailto header only (the earlier behaviour), and the cockpit answers 404 on /t/ (without a secret).
 */
import { createHmac, timingSafeEqual } from "node:crypto"

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const MAX_URL = 2000
export const MAX_TOKEN = 3000
const SIG_LEN = 16

export type TrackConfig = { base: string; secret: string }

/** The signing secret, or null if missing / too short (32 characters minimum). */
export function trackingSecret(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): string | null {
  const s = (env.LWS_TRACK_SECRET || "").trim()
  return s.length >= 32 ? s : null
}

/** The cockpit's public URL (no trailing /), or null if absent or not http(s). */
export function trackBase(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): string | null {
  const b = (env.TRACK_BASE || "").trim().replace(/\/+$/, "")
  return /^https?:\/\/[^/\s]+/.test(b) ? b : null
}

/** Base + secret, or null: tracking is on only when BOTH are set. */
export function trackConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): TrackConfig | null {
  const base = trackBase(env), secret = trackingSecret(env)
  return base && secret ? { base, secret } : null
}

const b64u = (b: Buffer) => b.toString("base64url")

/** UUID → 22 base64url characters. */
export function encodeTid(uuid: string): string {
  if (!UUID_RE.test(uuid)) throw new Error(`trackingId invalide : ${uuid}`)
  return b64u(Buffer.from(uuid.replace(/-/g, ""), "hex"))
}

/** 22 base64url characters → UUID, or null if it is not a valid v1-8 UUID. */
export function decodeTid(s: string): string | null {
  if (!/^[A-Za-z0-9_-]{22}$/.test(s)) return null
  const hex = Buffer.from(s, "base64url").toString("hex")
  if (hex.length !== 32) return null
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  return UUID_RE.test(uuid) ? uuid.toLowerCase() : null
}

export function sign(secret: string, msg: string): string {
  return createHmac("sha256", secret).update(msg).digest("base64url").slice(0, SIG_LEN)
}

function sigOk(secret: string, msg: string, sig: string): boolean {
  const want = Buffer.from(sign(secret, msg)), got = Buffer.from(sig)
  return want.length === got.length && timingSafeEqual(want, got)
}

const isHttpUrl = (u: string) => { try { const x = new URL(u); return (x.protocol === "http:" || x.protocol === "https:") && !!x.hostname } catch { return false } }

export function clickToken(trackingId: string, url: string, secret: string): string {
  if (!isHttpUrl(url) || url.length > MAX_URL) throw new Error("invalid click URL (http/https, ≤ 2000 characters)")
  const tid = trackingId.toLowerCase()
  return `${encodeTid(tid)}.${b64u(Buffer.from(url, "utf8"))}.${sign(secret, `c\n${tid}\n${url}`)}`
}

export function unsubToken(trackingId: string, secret: string): string {
  const tid = trackingId.toLowerCase()
  return `${encodeTid(tid)}.${sign(secret, `u\n${tid}`)}`
}

export type Parsed<T> = ({ ok: true } & T) | { ok: false; status: 400 | 403; error: string }

/** Decodes and VERIFIES a click token. 400 = invalid shape, 403 = wrong signature (forged). */
export function parseClickToken(token: string, secret: string): Parsed<{ trackingId: string; url: string }> {
  if (!token || token.length > MAX_TOKEN) return { ok: false, status: 400, error: "token missing or too long" }
  const parts = token.split(".")
  if (parts.length !== 3) return { ok: false, status: 400, error: "malformed token" }
  const tid = decodeTid(parts[0])
  if (!tid) return { ok: false, status: 400, error: "invalid send id" }
  if (!/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]{16}$/.test(parts[2])) return { ok: false, status: 400, error: "malformed token" }
  const url = Buffer.from(parts[1], "base64url").toString("utf8")
  if (!isHttpUrl(url) || url.length > MAX_URL) return { ok: false, status: 400, error: "invalid destination" }
  if (!sigOk(secret, `c\n${tid}\n${url}`, parts[2])) return { ok: false, status: 403, error: "invalid signature" }
  return { ok: true, trackingId: tid, url }
}

export function parseUnsubToken(token: string, secret: string): Parsed<{ trackingId: string }> {
  if (!token || token.length > 100) return { ok: false, status: 400, error: "token missing or too long" }
  const parts = token.split(".")
  if (parts.length !== 2) return { ok: false, status: 400, error: "malformed token" }
  const tid = decodeTid(parts[0])
  if (!tid || !/^[A-Za-z0-9_-]{16}$/.test(parts[1])) return { ok: false, status: 400, error: "malformed token" }
  if (!sigOk(secret, `u\n${tid}`, parts[1])) return { ok: false, status: 403, error: "invalid signature" }
  return { ok: true, trackingId: tid }
}

export const clickUrl = (cfg: TrackConfig, trackingId: string, url: string) => `${cfg.base}/t/c/${clickToken(trackingId, url, cfg.secret)}`
export const unsubUrl = (cfg: TrackConfig, trackingId: string) => `${cfg.base}/t/u/${unsubToken(trackingId, cfg.secret)}`

// a URL in PLAIN TEXT: up to the first blank / angle bracket / quote; trailing punctuation is given back to the text
const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"'`]+/g
const TRAILING = /[.,;:!?)\]}»”’]+$/

/**
 * Rewrites each http(s) link of a text email as a signed click link. Links already tracked (to TRACK_BASE/t/)
 * and those that fail validation stay as they are. Also returns the list of destinations.
 */
export function rewriteLinks(text: string, trackingId: string, cfg: TrackConfig | null): { text: string; links: string[] } {
  if (!cfg) return { text, links: [] }
  const links: string[] = []
  const out = text.replace(URL_IN_TEXT, (raw) => {
    const trail = raw.match(TRAILING)?.[0] ?? ""
    const url = trail ? raw.slice(0, -trail.length) : raw
    if (url.startsWith(`${cfg.base}/t/`) || !isHttpUrl(url) || url.length > MAX_URL) return raw
    links.push(url)
    return clickUrl(cfg, trackingId, url) + trail
  })
  return { text: out, links }
}

/** a written email, for READING in the Email tab : each tracked click link (`/t/c/<id>.<url in base64url>.<sig>`) shows
 *  its destination, shortened (« larkmoor-plumbing.example (link to the new site) »), and the unsubscribe link says
 *  what it is. The email that goes out keeps the tracked URLs ; this is display only. */
export function readableLinks(text: string, prospectId = ""): string {
  const short = (u: string) => { const s = u.replace(/^https?:\/\//, "").replace(/[?#].*$/, "").replace(/\/+$/, ""); return s.length > 48 ? `${s.slice(0, 46)}…` : s }
  return String(text || "")
    .replace(/(?:https?:\/\/[^\s/]+)?\/t\/c\/[A-Za-z0-9_-]{22}\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]{16}/g, (_all: string, b64: string) => {
      let dest = ""; try { dest = Buffer.from(b64, "base64url").toString("utf8") } catch { return "(link)" }
      if (!/^https?:\/\//.test(dest)) return "(link)"
      const ours = prospectId && dest.toLowerCase().includes(prospectId.toLowerCase().split("-").slice(0, 2).join("-"))
      return `${short(dest)}${ours ? " (link to the new site)" : ""}`
    })
    .replace(/(?:https?:\/\/[^\s/]+)?\/t\/u\/[A-Za-z0-9_.-]+/g, "(unsubscribe link)")
}
