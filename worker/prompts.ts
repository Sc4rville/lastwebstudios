/**
 * prompts.ts · builds the prompts of the worker's agents (composer, edit, research).
 *
 * SECURITY (F-1, audit 2026-10-24): any text that comes from a human or a web page (a comment from the cockpit
 * or Telegram, a batch's parameters) lands in the prompt of a `claude -p` that has tools (Bash,
 * Write…) on the box. So it is injected as FENCED DATA: dedicated tags, an explicit instruction not to
 * run it (see worker/edit-worker.md), inner tags neutralised, bounded length, control
 * characters removed. A batch's parameters are validated (restricted vocabulary) before injection.
 */
import { agency } from "../packages/shared/agency.mjs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { parseControl } from "../packages/shared/control.ts"
import type { BatchRow } from "../packages/shared/batch.ts"
import { workflowModels } from "../packages/llm/models.ts"
import { imageEngine, videoEngine } from "../packages/shared/media.mjs"
import { preferencesBlock, fencePrefs, promptPreferences, type PromptPref } from "../learning/scripts/taste.ts"
import { ANGLES } from "../learning/scripts/words.ts"

export const COMMENT_TAG = "commentaire_operateur"
export const MAX_PROMPT_COMMENT = 4000

const today = () => new Date().toISOString().slice(0, 10)

/** The comment, cleaned and bounded, ready to go BETWEEN the tags (no tag can escape from it). */
export function fenceComment(raw: string): string {
  let t = String(raw || "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
  t = t.replace(new RegExp(`</?\\s*${COMMENT_TAG}[^>]*>`, "gi"), "[tag removed]")
  if (t.length > MAX_PROMPT_COMMENT) t = t.slice(0, MAX_PROMPT_COMMENT) + "\n[… cut]"
  return t.trim()
}

// a batch's parameters injected into the composer prompt: restricted vocabulary, otherwise refused
const SAFE_PARAM = /^[\p{L}\p{N} ._/,-]{1,120}$/u
const safeParam = (v: string | null | undefined, fallback: string) => (v == null || v === "" ? fallback : SAFE_PARAM.test(v) ? v : "(value refused: characters not allowed)")
const SAFE_ID = /^[a-z0-9._-]{1,120}$/i

/** Engines and models passed to the compose-batch Workflow (the Workflow script does not read the environment). */
export function composeEngines(env: Record<string, string | undefined> = process.env) {
  const image = imageEngine(env).engine
  const video = videoEngine(env).engine
  return { models: workflowModels(env), image, video, boost: image !== "none" || video !== "none" }
}

/**
 * The composer agent's prompt: the batch's parameters injected into worker/compose-worker.md. `prefs` = the owner's active
 * preferences (learning/scripts/taste.ts, D6) : shown as fenced data, and passed as JSON to the Workflow's args.
 */
export async function composerPrompt(b: BatchRow, root = ".", env: Record<string, string | undefined> = process.env, prefs?: PromptPref[]): Promise<string> {
  const tpl = await readFile(join(root, "worker", "compose-worker.md"), "utf8")
  const taste = fencePrefs(prefs ?? await promptPreferences(root))
  // RERUN: params_json.ids = EXISTING prospects to re-compose (a selection in the cockpit)
  let ids: string[] = []
  try { if (b.params_json) ids = ((JSON.parse(b.params_json).ids as string[]) || []).filter((x) => typeof x === "string" && SAFE_ID.test(x)) } catch { /* malformed params_json */ }
  const eng = composeEngines(env)
  return tpl
    .replaceAll("{{DATE}}", today())
    .replaceAll("{{INDUSTRY}}", safeParam(b.industry, "(default seed)"))
    .replaceAll("{{LIMIT}}", b.lim ? String(Math.trunc(Number(b.lim)) || "(the whole seed)") : "(the whole seed)")
    .replaceAll("{{SEED}}", safeParam(b.seed, "(default)"))
    .replaceAll("{{FORCE}}", b.force_flag ? "yes (gate ignored)" : "no")
    .replaceAll("{{BATCH_ID}}", String(b.id))
    .replaceAll("{{IDS}}", ids.length ? ids.join(", ") : "(none · NEW prospects chosen automatically)")
    .replaceAll("{{MODELS}}", JSON.stringify(eng.models))
    .replaceAll("{{LANGUAGE}}", agency().language)
    .replaceAll("{{COUNTRY}}", agency().country)
    .replaceAll("{{IMAGE}}", eng.image)
    .replaceAll("{{VIDEO}}", eng.video)
    .replaceAll("{{BOOST}}", String(eng.boost))
    // a function as replacement : a `$&` in a preference's words never re-injects the template
    .replaceAll("{{PREFERENCES}}", () => JSON.stringify(taste.map((p) => ({ id: p.id, text: p.text }))))
    .replaceAll("{{TASTE}}", () => preferencesBlock(taste, { role: "list" }) || "(no preference yet: the owner has not given feedback on a site)")
}

/** The prompt of the agent that EDITS a composer site: the control.md comment, FENCED as data; the owner's
 *  active preferences as fenced data too (D6). */
export async function editPrompt(id: string, date: string, root = ".", prefs?: PromptPref[]): Promise<string> {
  const tpl = await readFile(join(root, "worker", "edit-worker.md"), "utf8")
  const sitePath = join("output", "sites", id, date)
  let comment = ""
  try { comment = parseControl(await readFile(join(root, sitePath, "control.md"), "utf8")).comment } catch { /* no control.md */ }
  // replacement in ONE pass (a function): a `$&` or a `{{…}}` in the comment cannot re-inject anything
  const taste = preferencesBlock(fencePrefs(prefs ?? await promptPreferences(root)), { role: "edit" }) || "(no preference yet)"
  const vars: Record<string, string> = { ID: id, DATE: date, SITE_PATH: sitePath, COMMENT: fenceComment(comment) || "(empty comment)", PREFERENCES: taste }
  return tpl.replace(/\{\{(ID|DATE|SITE_PATH|COMMENT|PREFERENCES)\}\}/g, (_m, k: string) => vars[k])
}

/** The prompt of a prospect's RESEARCH agent (validated id). */
export async function researchPrompt(id: string, root = ".", opening?: string | null): Promise<string> {
  if (!SAFE_ID.test(id)) throw new Error(`invalid prospect id: ${JSON.stringify(id).slice(0, 60)}`)
  const tpl = await readFile(join(root, "worker", "research-worker.md"), "utf8")
  // the call opening this lead was given (learning/scripts/words.ts : each in turn, then the one that gets meetings)
  const a = opening ? ANGLES.call.find((x) => x.key === opening) : undefined
  const line = a ? `Open the call script with this opening, ${a.label}: ${a.brief} (the agency compares call openings and leans on the one that gets meetings; keep everything else of the script).` : "(no particular opening: the agency's usual one)"
  return tpl.replaceAll("{{ID}}", id).replaceAll("{{OPENING}}", () => line)
}
