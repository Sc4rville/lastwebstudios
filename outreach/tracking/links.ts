/**
 * links.ts · les LIENS SIGNÉS du tracking auto-hébergé (clic + désinscription 1-clic). Calcul pur, sans I/O.
 *
 * Remplace l'edge function Supabase (jamais versionnée, en 402 depuis le gel du quota) : le cockpit sert
 * lui-même `/t/c/<jeton>` et `/t/u/<jeton>` (cf. ./endpoint.ts). Corrige F-3 (redirection ouverte + évènements
 * forgeables) : l'URL de destination est DANS le jeton et signée (HMAC-SHA256, LWS_TRACK_SECRET), donc le
 * cockpit ne redirige que vers des URL qu'il a lui-même mises dans un mail, et personne ne peut fabriquer un
 * clic ou une désinscription pour un envoi qu'il ne connaît pas.
 *
 *   clic          {TRACK_BASE}/t/c/<id22>.<url en base64url>.<signature 16>
 *   désinscription {TRACK_BASE}/t/u/<id22>.<signature 16>
 *
 * `id22` = le trackingId de l'envoi (UUID v4, sends.jsonl) en base64url (22 caractères), validé au décodage.
 * La signature porte un préfixe de type (« c » ou « u ») : un jeton de clic ne vaut pas désinscription.
 *
 * Réglages : TRACK_BASE (URL publique du cockpit, https en prod) + LWS_TRACK_SECRET (≥ 32 caractères, ex.
 * `openssl rand -base64 48`). L'un des deux manque → aucun lien réécrit, désinscription par réponse « STOP » +
 * en-tête mailto seulement (le comportement d'avant), et le cockpit répond 404 sur /t/ (sans secret).
 */
import { createHmac, timingSafeEqual } from "node:crypto"

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const MAX_URL = 2000
export const MAX_TOKEN = 3000
const SIG_LEN = 16

export type TrackConfig = { base: string; secret: string }

/** Le secret de signature, ou null s'il manque / est trop court (32 caractères minimum). */
export function trackingSecret(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): string | null {
  const s = (env.LWS_TRACK_SECRET || "").trim()
  return s.length >= 32 ? s : null
}

/** L'URL publique du cockpit (sans / final), ou null si absente ou pas en http(s). */
export function trackBase(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): string | null {
  const b = (env.TRACK_BASE || "").trim().replace(/\/+$/, "")
  return /^https?:\/\/[^/\s]+/.test(b) ? b : null
}

/** Base + secret, ou null : le tracking n'est actif que si les DEUX sont posés. */
export function trackConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): TrackConfig | null {
  const base = trackBase(env), secret = trackingSecret(env)
  return base && secret ? { base, secret } : null
}

const b64u = (b: Buffer) => b.toString("base64url")

/** UUID → 22 caractères base64url. */
export function encodeTid(uuid: string): string {
  if (!UUID_RE.test(uuid)) throw new Error(`trackingId invalide : ${uuid}`)
  return b64u(Buffer.from(uuid.replace(/-/g, ""), "hex"))
}

/** 22 caractères base64url → UUID, ou null si ce n'est pas un UUID v1-8 valide. */
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
  if (!isHttpUrl(url) || url.length > MAX_URL) throw new Error("URL de clic invalide (http/https, ≤ 2000 caractères)")
  const tid = trackingId.toLowerCase()
  return `${encodeTid(tid)}.${b64u(Buffer.from(url, "utf8"))}.${sign(secret, `c\n${tid}\n${url}`)}`
}

export function unsubToken(trackingId: string, secret: string): string {
  const tid = trackingId.toLowerCase()
  return `${encodeTid(tid)}.${sign(secret, `u\n${tid}`)}`
}

export type Parsed<T> = ({ ok: true } & T) | { ok: false; status: 400 | 403; error: string }

/** Décode et VÉRIFIE un jeton de clic. 400 = forme invalide, 403 = signature fausse (forgé). */
export function parseClickToken(token: string, secret: string): Parsed<{ trackingId: string; url: string }> {
  if (!token || token.length > MAX_TOKEN) return { ok: false, status: 400, error: "jeton absent ou trop long" }
  const parts = token.split(".")
  if (parts.length !== 3) return { ok: false, status: 400, error: "jeton mal formé" }
  const tid = decodeTid(parts[0])
  if (!tid) return { ok: false, status: 400, error: "identifiant d'envoi invalide" }
  if (!/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]{16}$/.test(parts[2])) return { ok: false, status: 400, error: "jeton mal formé" }
  const url = Buffer.from(parts[1], "base64url").toString("utf8")
  if (!isHttpUrl(url) || url.length > MAX_URL) return { ok: false, status: 400, error: "destination invalide" }
  if (!sigOk(secret, `c\n${tid}\n${url}`, parts[2])) return { ok: false, status: 403, error: "signature invalide" }
  return { ok: true, trackingId: tid, url }
}

export function parseUnsubToken(token: string, secret: string): Parsed<{ trackingId: string }> {
  if (!token || token.length > 100) return { ok: false, status: 400, error: "jeton absent ou trop long" }
  const parts = token.split(".")
  if (parts.length !== 2) return { ok: false, status: 400, error: "jeton mal formé" }
  const tid = decodeTid(parts[0])
  if (!tid || !/^[A-Za-z0-9_-]{16}$/.test(parts[1])) return { ok: false, status: 400, error: "jeton mal formé" }
  if (!sigOk(secret, `u\n${tid}`, parts[1])) return { ok: false, status: 403, error: "signature invalide" }
  return { ok: true, trackingId: tid }
}

export const clickUrl = (cfg: TrackConfig, trackingId: string, url: string) => `${cfg.base}/t/c/${clickToken(trackingId, url, cfg.secret)}`
export const unsubUrl = (cfg: TrackConfig, trackingId: string) => `${cfg.base}/t/u/${unsubToken(trackingId, cfg.secret)}`

// une URL dans du TEXTE BRUT : jusqu'au premier blanc / chevron / guillemet ; la ponctuation finale est rendue au texte
const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"'`]+/g
const TRAILING = /[.,;:!?)\]}»”’]+$/

/**
 * Réécrit chaque lien http(s) d'un mail texte en lien de clic signé. Les liens déjà suivis (vers TRACK_BASE/t/)
 * et ceux qui ne passent pas la validation restent tels quels. Renvoie aussi la liste des destinations.
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
