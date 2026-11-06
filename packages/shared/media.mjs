/**
 * media.mjs · quels moteurs MÉDIA (image, vidéo) le boost a le droit d'utiliser. Partagé par le TypeScript
 * (worker, first-site, doctor) et les scripts .mjs (worker/openai-image.mjs, worker/hero-cli.mjs).
 *
 *   LWS_IMAGE = openai | none       défaut : openai si OPENAI_API_KEY est posée, sinon none
 *     OPENAI_IMAGE_BASE_URL         défaut https://api.openai.com/v1 (toute API Images compatible)
 *     OPENAI_IMAGE_MODEL            défaut gpt-image-2
 *   LWS_VIDEO = higgsfield | none   défaut : higgsfield si HIGGSFIELD_API_KEY est posée ou la CLI `higgsfield`
 *                                   est dans le PATH, sinon none
 *
 * `none` n'est pas une panne : le composer construit avec les vraies photos du prospect, telles quelles.
 */
import { existsSync } from "node:fs"
import { delimiter, join } from "node:path"

export const IMAGE_ENGINES = ["openai", "none"]
export const VIDEO_ENGINES = ["higgsfield", "none"]
export const DEFAULT_IMAGE_MODEL = "gpt-image-2"
export const DEFAULT_IMAGE_BASE_URL = "https://api.openai.com/v1"

/** @param {string} bin @param {NodeJS.ProcessEnv} env */
export function onPath(bin, env = process.env) {
  for (const dir of String(env.PATH || "").split(delimiter)) {
    if (dir && existsSync(join(dir, bin))) return true
  }
  return false
}

/** @returns {{ engine: "openai" | "none", why: string }} */
export function imageEngine(env = process.env) {
  const v = String(env.LWS_IMAGE || "").trim().toLowerCase()
  if (v === "openai" || v === "none") return { engine: v, why: `LWS_IMAGE=${v}` }
  if (v) return { engine: "none", why: `LWS_IMAGE=${env.LWS_IMAGE} inconnu (openai | none) → none` }
  if (String(env.OPENAI_API_KEY || "").trim()) return { engine: "openai", why: "OPENAI_API_KEY posée" }
  return { engine: "none", why: "ni LWS_IMAGE ni OPENAI_API_KEY" }
}

/** @returns {{ engine: "higgsfield" | "none", why: string }} */
export function videoEngine(env = process.env) {
  const v = String(env.LWS_VIDEO || "").trim().toLowerCase()
  if (v === "higgsfield" || v === "none") return { engine: v, why: `LWS_VIDEO=${v}` }
  if (v) return { engine: "none", why: `LWS_VIDEO=${env.LWS_VIDEO} inconnu (higgsfield | none) → none` }
  if (String(env.HIGGSFIELD_API_KEY || "").trim()) return { engine: "higgsfield", why: "HIGGSFIELD_API_KEY posée" }
  if (onPath("higgsfield", env)) return { engine: "higgsfield", why: "CLI higgsfield dans le PATH" }
  return { engine: "none", why: "ni LWS_VIDEO, ni HIGGSFIELD_API_KEY, ni CLI higgsfield" }
}
