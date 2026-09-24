/**
 * runSkill — THE runner. Runs any skill.
 *
 * A skill = a folder with a `prompt.md`. The runner:
 *   1. loads the skill's prompt (static, reused for every prospect)
 *   2. appends the inputs as labelled blocks (the sheet, the industry, the raw text…)
 *   3. calls the model through any OpenAI-compatible `/chat/completions` endpoint
 *   4. returns the JSON of the answer
 *
 * Offline mode: with no `LLM_API_KEY`, the answer is read from a recorded replay
 * (`<LLM_REPLAY_DIR>/<skill>/<replayKey>.json`). That is how `npm run demo` runs with zero keys.
 *
 * The cage is wired here, because this is the only place money is spent:
 * `assertBudget()` before the call, `recordSpend()` after.
 */
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join, basename } from "node:path"
import { assertBudget, recordSpend } from "./meter.ts"
import { isTaskClass, pickModel, type TaskClass } from "./route.ts"

try {
  process.loadEnvFile() // a .env file if present, no dependency
} catch {
  /* no .env: read the environment directly */
}

export type SkillOptions = {
  /** Task class → model (see route.ts). */
  taskClass?: TaskClass
  maxTokens?: number
  /** Key of the recorded answer used in offline mode (usually the prospect id). */
  replayKey?: string
}

export const llmMode = (): "live" | "replay" => (process.env.LLM_API_KEY ? "live" : "replay")

export async function runSkill(skillDir: string, inputs: Record<string, unknown>, opts: SkillOptions = {}): Promise<any> {
  const skill = basename(skillDir)
  const taskClass = opts.taskClass && isTaskClass(opts.taskClass) ? opts.taskClass : "extract"

  if (llmMode() === "replay") return replay(skill, opts.replayKey)

  const prompt = await readFile(join(skillDir, "prompt.md"), "utf8")
  const user = Object.entries(inputs)
    .map(([name, value]) => `## ${name.toUpperCase()}\n\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`)
    .join("\n\n")

  assertBudget() // the cage: stop BEFORE crossing a ceiling

  const model = pickModel(taskClass)
  const base = (process.env.LLM_BASE_URL || "").replace(/\/$/, "")
  if (!base) throw new Error("LLM_BASE_URL is empty — set it in .env (any OpenAI-compatible endpoint)")
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.LLM_API_KEY}` },
    body: JSON.stringify({
      model,
      max_tokens: opts.maxTokens ?? 4096,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(180_000),
  })
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }

  recordSpend({
    skill,
    model,
    usage: { input_tokens: body.usage?.prompt_tokens, output_tokens: body.usage?.completion_tokens },
  })

  return parseJson(body.choices?.[0]?.message?.content ?? "")
}

async function replay(skill: string, key = "default"): Promise<any> {
  const dir = process.env.LLM_REPLAY_DIR || join("demo", "replay")
  const file = join(dir, skill, `${key}.json`)
  if (!existsSync(file))
    throw new Error(`No LLM_API_KEY and no recorded answer at ${file}. Set LLM_* in .env to run skills live.`)
  console.error(`  [llm] ${skill} ← replay (${file})`)
  return JSON.parse(await readFile(file, "utf8"))
}

/** Recover the JSON even when the model wraps it in prose or ``` fences. */
export function parseJson(text: string): any {
  const cleaned = text.replace(/```json\s*|\s*```/g, "").trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (m) return JSON.parse(m[0])
    throw new Error("Skill answer is not JSON:\n" + text.slice(0, 500))
  }
}
