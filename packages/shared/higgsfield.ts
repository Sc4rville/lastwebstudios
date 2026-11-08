/**
 * higgsfield.ts — a REST wrapper for the Higgsfield API, with an API KEY (HEADLESS).
 *
 * Why: the claude.ai MCP uses OAuth (interactive) → impossible on the headless box.
 * An API key works EVERYWHERE (local + box) → the box generates everything, no more local/VM split.
 *
 * Auth : `Authorization: Bearer $HIGGSFIELD_API_KEY`   (key from cloud.higgsfield.ai → dashboard → API)
 * Base : https://api.higgsfield.ai   ·  Jobs: POST /v1/generations  →  GET /v1/generations/{id}
 *
 * ⚠ The model/field names marked "to confirm" are set against the LIVE API (curl probe) — the API
 *   returns clear errors on required fields; adjust in one pass at the first real test.
 *   No new dependency: native fetch (Node ≥ 18).
 */
const BASE = process.env.HIGGSFIELD_API_BASE || "https://api.higgsfield.ai"

function apiKey(): string {
  const k = process.env.HIGGSFIELD_API_KEY
  if (!k) throw new Error("HIGGSFIELD_API_KEY is missing from .env — get it from cloud.higgsfield.ai → dashboard → API, and add it to the local .env AND to the box.")
  return k
}

async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(BASE + path, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json", ...(init.headers || {}) },
  })
  if (!r.ok) throw new Error(`Higgsfield ${init.method || "GET"} ${path} → ${r.status} ${await r.text().catch(() => "")}`)
  return r.json() as Promise<T>
}

/** Submits a job and returns its id. */
async function submit(body: Record<string, unknown>): Promise<string> {
  const j: any = await api("/v1/generations", { method: "POST", body: JSON.stringify(body) })
  const id = j.id ?? j.job_id ?? j.generation?.id // to confirm against the live API
  if (!id) throw new Error(`Higgsfield: no job id in the answer: ${JSON.stringify(j).slice(0, 200)}`)
  return String(id)
}

/** Polls until completion → returns the output URL(s). */
async function poll(id: string, { timeoutMs = 240_000, everyMs = 4000 } = {}): Promise<string> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const j: any = await api(`/v1/generations/${id}`)
    const st = String(j.status ?? j.state ?? "").toLowerCase()
    if (["completed", "succeeded", "done", "success"].includes(st)) {
      const url = j.output_url ?? j.result?.url ?? j.outputs?.[0]?.url ?? j.output?.[0] // to confirm
      if (!url) throw new Error(`Higgsfield job ${id} finished but no URL: ${JSON.stringify(j).slice(0, 250)}`)
      return String(url)
    }
    if (["failed", "error", "canceled"].includes(st)) throw new Error(`Higgsfield job ${id} failed: ${JSON.stringify(j).slice(0, 250)}`)
    await new Promise((r) => setTimeout(r, everyMs))
  }
  throw new Error(`Higgsfield job ${id}: timeout (${timeoutMs}ms)`)
}

// ── public API (what asset-boost / web-cinematics will call) ──

/** Generates an image (text-to-image). `refImageUrl` = an optional reference (public URL). → the image's URL. */
export async function generateImage(o: { prompt: string; model?: string; width?: number; height?: number; aspectRatio?: string; seed?: number; refImageUrl?: string }): Promise<string> {
  const id = await submit({ task: "text-to-image", model: o.model ?? "soul", prompt: o.prompt, width: o.width, height: o.height, aspect_ratio: o.aspectRatio, seed: o.seed, input_image: o.refImageUrl })
  return poll(id)
}

/** Image-to-video. start + (optional) END frame → real interpolated motion (Kling). PUBLIC URLs required. → the video's URL. */
export async function imageToVideo(o: { startImageUrl: string; endImageUrl?: string; prompt: string; model?: string; aspectRatio?: string; duration?: number; seed?: number }): Promise<string> {
  const id = await submit({ task: "image-to-video", model: o.model ?? "kling3_0", prompt: o.prompt, input_image: o.startImageUrl, end_image: o.endImageUrl, aspect_ratio: o.aspectRatio ?? "16:9", duration: o.duration ?? 5, seed: o.seed }) // end_image to confirm
  return poll(id, { timeoutMs: 360_000 })
}

/** Upscale (image or video) → the upscaled URL. */
export async function upscale(o: { inputUrl: string; kind?: "image" | "video" }): Promise<string> {
  const id = await submit({ task: o.kind === "video" ? "upscale-video" : "upscale-image", input_image: o.inputUrl }) // tasks to confirm
  return poll(id)
}

/** Downloads an output URL to a local file. */
export async function download(url: string, destPath: string): Promise<void> {
  const { writeFile, mkdir } = await import("node:fs/promises")
  const { dirname } = await import("node:path")
  const r = await fetch(url)
  if (!r.ok) throw new Error(`download ${url} → ${r.status}`)
  await mkdir(dirname(destPath), { recursive: true })
  await writeFile(destPath, Buffer.from(await r.arrayBuffer()))
}
