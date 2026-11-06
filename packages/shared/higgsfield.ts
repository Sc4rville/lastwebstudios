/**
 * higgsfield.ts — wrapper REST de l'API Higgsfield, par CLÉ API (HEADLESS).
 *
 * Pourquoi : le MCP claude.ai est en OAuth (interactif) → impossible sur la box headless.
 * Une clé API marche PARTOUT (local + box) → la box génère tout, fini le split local/VM.
 *
 * Auth  : `Authorization: Bearer $HIGGSFIELD_API_KEY`   (clé depuis cloud.higgsfield.ai → dashboard → API)
 * Base  : https://api.higgsfield.ai   ·  Jobs : POST /v1/generations  →  GET /v1/generations/{id}
 *
 * ⚠ Les noms de modèles/champs marqués « à confirmer » sont calés contre l'API LIVE (probe curl) — l'API
 *   renvoie des erreurs claires sur les champs requis ; on ajuste en une passe au premier test réel.
 *   Pas de nouvelle dépendance : fetch natif (Node ≥ 18).
 */
const BASE = process.env.HIGGSFIELD_API_BASE || "https://api.higgsfield.ai"

function apiKey(): string {
  const k = process.env.HIGGSFIELD_API_KEY
  if (!k) throw new Error("HIGGSFIELD_API_KEY absente du .env — récupère-la sur cloud.higgsfield.ai → dashboard → API, et ajoute-la au .env local ET à la box.")
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

/** Soumet un job et renvoie son id. */
async function submit(body: Record<string, unknown>): Promise<string> {
  const j: any = await api("/v1/generations", { method: "POST", body: JSON.stringify(body) })
  const id = j.id ?? j.job_id ?? j.generation?.id // à confirmer contre l'API live
  if (!id) throw new Error(`Higgsfield: pas d'id de job dans la réponse: ${JSON.stringify(j).slice(0, 200)}`)
  return String(id)
}

/** Poll jusqu'à complétion → renvoie la/les URL(s) de sortie. */
async function poll(id: string, { timeoutMs = 240_000, everyMs = 4000 } = {}): Promise<string> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const j: any = await api(`/v1/generations/${id}`)
    const st = String(j.status ?? j.state ?? "").toLowerCase()
    if (["completed", "succeeded", "done", "success"].includes(st)) {
      const url = j.output_url ?? j.result?.url ?? j.outputs?.[0]?.url ?? j.output?.[0] // à confirmer
      if (!url) throw new Error(`Higgsfield job ${id} fini mais pas d'URL: ${JSON.stringify(j).slice(0, 250)}`)
      return String(url)
    }
    if (["failed", "error", "canceled"].includes(st)) throw new Error(`Higgsfield job ${id} échoué: ${JSON.stringify(j).slice(0, 250)}`)
    await new Promise((r) => setTimeout(r, everyMs))
  }
  throw new Error(`Higgsfield job ${id}: timeout (${timeoutMs}ms)`)
}

// ── API publique (ce que asset-boost / web-cinematics appelleront) ──

/** Génère une image (text-to-image). `refImageUrl` = référence optionnelle (URL publique). → URL de l'image. */
export async function generateImage(o: { prompt: string; model?: string; width?: number; height?: number; aspectRatio?: string; seed?: number; refImageUrl?: string }): Promise<string> {
  const id = await submit({ task: "text-to-image", model: o.model ?? "soul", prompt: o.prompt, width: o.width, height: o.height, aspect_ratio: o.aspectRatio, seed: o.seed, input_image: o.refImageUrl })
  return poll(id)
}

/** Image-to-video. start + (optionnel) END frame → vrai mouvement interpolé (Kling). URLs PUBLIQUES requises. → URL de la vidéo. */
export async function imageToVideo(o: { startImageUrl: string; endImageUrl?: string; prompt: string; model?: string; aspectRatio?: string; duration?: number; seed?: number }): Promise<string> {
  const id = await submit({ task: "image-to-video", model: o.model ?? "kling3_0", prompt: o.prompt, input_image: o.startImageUrl, end_image: o.endImageUrl, aspect_ratio: o.aspectRatio ?? "16:9", duration: o.duration ?? 5, seed: o.seed }) // end_image à confirmer
  return poll(id, { timeoutMs: 360_000 })
}

/** Upscale (image ou vidéo) → URL upscalée. */
export async function upscale(o: { inputUrl: string; kind?: "image" | "video" }): Promise<string> {
  const id = await submit({ task: o.kind === "video" ? "upscale-video" : "upscale-image", input_image: o.inputUrl }) // tasks à confirmer
  return poll(id)
}

/** Télécharge une URL de sortie vers un fichier local. */
export async function download(url: string, destPath: string): Promise<void> {
  const { writeFile, mkdir } = await import("node:fs/promises")
  const { dirname } = await import("node:path")
  const r = await fetch(url)
  if (!r.ok) throw new Error(`download ${url} → ${r.status}`)
  await mkdir(dirname(destPath), { recursive: true })
  await writeFile(destPath, Buffer.from(await r.arrayBuffer()))
}
