/**
 * runSkill — LE RUNNER. Fait tourner n'importe quel skill JSON.
 *
 * Un skill = un dossier avec un `prompt.md` (et, facultatif, un `schema.json` : la forme de sa sortie). Ce runner :
 *   1. charge le prompt.md du skill (prompt système, mis en cache quand la voie le permet)
 *   2. y ajoute les blocs d'entrée (la fiche, l'industrie, le texte brut…) et les images éventuelles
 *   3. appelle le modèle par la couche packages/llm (voie choisie par LWS_LLM, modèle par RÔLE)
 *   4. renvoie l'objet JSON de sa réponse (sortie structurée native si la voie la donne, sinon extraite)
 *
 * Voies (cf. packages/llm/provider.ts) : claude-code (défaut, plan-first : `claude -p` sur ton abonnement),
 * anthropic (SDK 1.x, clé API), anthropic-compatible (Ollama, LiteLLM, passerelle), openai-compatible
 * (OpenRouter, Groq, vLLM, OpenAI…). L'historique LLM_VIA=plan|api est toujours compris.
 *
 * Rôles (cf. packages/llm/models.ts) : "smart" (conception), "fast" (extraction), "judge" (vision). Un ID de
 * modèle explicite est encore accepté à la place d'un rôle.
 */
import { agency } from "../shared/agency.mjs"
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { completeJson, type ModelRole, type JsonSchema, type LlmImage } from "../llm/index.ts"

// charge un fichier .env s'il existe (sans dépendance externe)
try {
  process.loadEnvFile()
} catch {
  /* pas de .env, on lira l'environnement directement */
}

/** Le prompt système + le schéma (facultatif) d'un skill. */
export async function loadSkill(skillDir: string): Promise<{ prompt: string; schema?: JsonSchema }> {
  const prompt = await readFile(join(skillDir, "prompt.md"), "utf8")
  const schemaPath = join(skillDir, "schema.json")
  const schema = existsSync(schemaPath) ? (JSON.parse(await readFile(schemaPath, "utf8")) as JsonSchema) : undefined
  return { prompt, schema }
}

/** Chaque entrée devient un bloc étiqueté `## NOM` (texte tel quel, objets en JSON indenté). */
export function inputBlocks(inputs: Record<string, unknown>): string {
  // la langue des contenus générés (agency.config.json › language, pays) : bloc ajouté à TOUT skill s'il ne le donne pas
  const a = agency()
  const withLang = "language" in inputs || "LANGUAGE" in inputs ? inputs : { ...inputs, language: `${a.language} (country ${a.country}). Write every generated text in this language; keep the prospect's own words in their original language when you are told to keep them verbatim.` }
  return Object.entries(withLang)
    .map(([name, value]) => `## ${name.toUpperCase()}\n\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`)
    .join("\n\n")
}

// type MIME d'une image d'après son extension (pour les blocs base64)
export function mediaType(p: string): string {
  const e = p.toLowerCase()
  if (e.endsWith(".jpg") || e.endsWith(".jpeg")) return "image/jpeg"
  if (e.endsWith(".webp")) return "image/webp"
  if (e.endsWith(".gif")) return "image/gif"
  return "image/png"
}

export async function runSkill(
  skillDir: string,
  inputs: Record<string, unknown>,
  role: ModelRole | string = "fast", // extraction par défaut ; "smart" pour la conception, "judge" pour la vision
  maxTokens = 4096, // le filler émet un plan d'édition plus gros → on monte au besoin
  images: string[] = [], // chemins d'images à joindre (feedback visuel : le modèle est multimodal)
): Promise<any> {
  const { prompt, schema } = await loadSkill(skillDir)
  const imgs: LlmImage[] = await Promise.all(images.map(async (p) => ({ path: p, mediaType: mediaType(p), data: (await readFile(p)).toString("base64") })))
  const { json } = await completeJson({
    roleOrModel: role,
    system: prompt,
    user: inputBlocks(inputs),
    images: imgs,
    maxTokens,
    schema,
    label: skillDir.split("/").filter(Boolean).pop(),
  })
  return json
}
