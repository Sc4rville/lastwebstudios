/**
 * runSkill — THE RUNNER. Runs any JSON skill.
 *
 * A skill = a folder with a `prompt.md` (and, optionally, a `schema.json`: the shape of its output). This runner:
 *   1. loads the skill's prompt.md (the system prompt, cached when the way allows it)
 *   2. adds the input blocks (the sheet, the industry, the raw text…) and any images
 *   3. calls the model through the packages/llm layer (way chosen by LWS_LLM, model by ROLE)
 *   4. returns the JSON object of its answer (native structured output if the way gives it, otherwise extracted)
 *
 * Ways (see packages/llm/provider.ts): claude-code (default, plan-first: `claude -p` on your subscription),
 * codex (`codex exec` on a ChatGPT subscription), anthropic (SDK 1.x, API key), anthropic-compatible (Ollama,
 * LiteLLM, a gateway), openai-compatible (OpenRouter, Groq, vLLM, OpenAI…). The legacy LLM_VIA=plan|api is still understood.
 *
 * Roles (see packages/llm/models.ts): "smart" (design), "fast" (extraction), "judge" (vision). An explicit
 * model ID is still accepted instead of a role.
 * The input block names (e.g. "texte brut", "industrie") are the skills' API: they stay as they are.
 */
import { agency } from "../shared/agency.mjs"
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { completeJson, type ModelRole, type JsonSchema, type LlmImage } from "../llm/index.ts"

// loads a .env file if there is one (no external dependency)
try {
  process.loadEnvFile()
} catch {
  /* no .env, the environment is read directly */
}

/** A skill's system prompt + (optional) schema. */
export async function loadSkill(skillDir: string): Promise<{ prompt: string; schema?: JsonSchema }> {
  const prompt = await readFile(join(skillDir, "prompt.md"), "utf8")
  const schemaPath = join(skillDir, "schema.json")
  const schema = existsSync(schemaPath) ? (JSON.parse(await readFile(schemaPath, "utf8")) as JsonSchema) : undefined
  return { prompt, schema }
}

/** Each input becomes a block labelled `## NAME` (text as is, objects as indented JSON). */
export function inputBlocks(inputs: Record<string, unknown>): string {
  // the language of the generated content (agency.config.json › language, country): a block added to EVERY skill that doesn't give it
  const a = agency()
  const withLang = "language" in inputs || "LANGUAGE" in inputs ? inputs : { ...inputs, language: `${a.language} (country ${a.country}). Write every generated text in this language; keep the prospect's own words in their original language when you are told to keep them verbatim.` }
  return Object.entries(withLang)
    .map(([name, value]) => `## ${name.toUpperCase()}\n\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`)
    .join("\n\n")
}

// an image's MIME type from its extension (for the base64 blocks)
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
  role: ModelRole | string = "fast", // extraction by default; "smart" for design, "judge" for vision
  maxTokens = 4096, // the filler emits a bigger edit plan → raise it when needed
  images: string[] = [], // paths of images to attach (visual feedback: the model is multimodal)
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
