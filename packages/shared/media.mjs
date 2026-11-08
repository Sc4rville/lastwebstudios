/**
 * media.mjs · which MEDIA engines (image, video) the boost may use. Shared by the TypeScript
 * (worker, first-site, doctor) and the .mjs scripts (worker/openai-image.mjs, worker/hero-cli.mjs).
 *
 *   LWS_IMAGE = openai | none       default: openai if OPENAI_API_KEY is set, else none
 *     OPENAI_IMAGE_BASE_URL         default https://api.openai.com/v1 (any compatible Images API)
 *     OPENAI_IMAGE_MODEL            default gpt-image-2
 *   LWS_VIDEO = higgsfield | none   default: higgsfield if HIGGSFIELD_API_KEY is set or the `higgsfield` CLI
 *                                   is on the PATH, else none
 *
 * `none` is not a failure: the composer builds with the prospect's real photos, as they are.
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
  if (v) return { engine: "none", why: `LWS_IMAGE=${env.LWS_IMAGE} is unknown (openai | none) → none` }
  if (String(env.OPENAI_API_KEY || "").trim()) return { engine: "openai", why: "OPENAI_API_KEY set" }
  return { engine: "none", why: "neither LWS_IMAGE nor OPENAI_API_KEY" }
}

/** @returns {{ engine: "higgsfield" | "none", why: string }} */
export function videoEngine(env = process.env) {
  const v = String(env.LWS_VIDEO || "").trim().toLowerCase()
  if (v === "higgsfield" || v === "none") return { engine: v, why: `LWS_VIDEO=${v}` }
  if (v) return { engine: "none", why: `LWS_VIDEO=${env.LWS_VIDEO} is unknown (higgsfield | none) → none` }
  if (String(env.HIGGSFIELD_API_KEY || "").trim()) return { engine: "higgsfield", why: "HIGGSFIELD_API_KEY set" }
  if (onPath("higgsfield", env)) return { engine: "higgsfield", why: "the higgsfield CLI is on the PATH" }
  return { engine: "none", why: "no LWS_VIDEO, HIGGSFIELD_API_KEY or higgsfield CLI" }
}
