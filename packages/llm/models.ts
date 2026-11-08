/**
 * models.ts · THE single source of models (no other file names a Claude model ID).
 *
 * The product thinks in ROLES, not IDs:
 *
 *   smart  · design and writing: composer, filler, edit, cyber audit, coach, perfect email (savior)
 *   fast   · high-volume extraction and sorting: structuring the prospect sheet, personas
 *   judge  · visual judgement (vision required): the scoring's visual gate, diagnose, self-review, beauty-gate
 *
 * Defaults (the 24/10/2026 line-up, checked on platform.claude.com/docs/en/about-claude/models/overview):
 *   smart = Claude Opus 5.5 · fast = Claude Haiku 5.5 · judge = Claude Sonnet 5.5
 *
 * On the PLAN path (`claude -p`, LWS_LLM=claude-code) we pass the ALIAS (opus / haiku / sonnet): it follows the
 * installed Claude Code version and is always accepted by `--model`. An old CLI therefore resolves an alias to an
 * older model: `npm run doctor` shows it; `claude update` or LWS_MODEL_<ROLE>=<id> fixes it.
 *
 * Overrides (verbatim, any provider):
 *   LWS_MODEL_SMART / LWS_MODEL_FAST / LWS_MODEL_JUDGE   one model per role
 *   LWS_MODEL                                             a single model for every role (e.g. a local model)
 *   OPENAI_MODEL (openai-compatible) · ANTHROPIC_MODEL (anthropic-compatible): fallback when nothing else is set
 *   COACH_MODEL                                           legacy, coach only (wins over smart)
 */

export type ModelRole = "smart" | "fast" | "judge"
export const ROLES: readonly ModelRole[] = ["smart", "fast", "judge"] as const

export type ProviderName = "claude-code" | "codex" | "anthropic" | "anthropic-compatible" | "openai-compatible"

/** Claude API (Messages) IDs for each role. */
export const DEFAULT_MODELS: Readonly<Record<ModelRole, string>> = {
  smart: "claude-opus-5-5",
  fast: "claude-haiku-5-5",
  judge: "claude-sonnet-5-5",
}

/** Claude Code aliases (`claude --model <alias>`), plan path. */
export const PLAN_ALIASES: Readonly<Record<ModelRole, string>> = { smart: "opus", fast: "haiku", judge: "sonnet" }

/** Who uses which role (shown by `npm run doctor`, kept in step with the callers). */
export const ROLE_USES: Readonly<Record<ModelRole, string>> = {
  smart: "composer, filler, edit, cyber audit, coach, perfect email",
  fast: "structuring the prospect sheet, personas",
  judge: "visual gate, diagnose, self-review, beauty-gate (vision)",
}

export function isRole(x: unknown): x is ModelRole {
  return x === "smart" || x === "fast" || x === "judge"
}

type Env = Record<string, string | undefined>
const nonEmpty = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined)

export type ResolvedModel = { model: string; source: string }

/**
 * A role's model for a given provider, with where it comes from (for the doctor and the error messages).
 * Throws if a third-party provider has no model configured (a local server doesn't know the Claude IDs).
 */
export function resolveModel(role: ModelRole, provider: ProviderName, env: Env = process.env): ResolvedModel {
  const key = `LWS_MODEL_${role.toUpperCase()}`
  const perRole = nonEmpty(env[key])
  if (perRole) return { model: perRole, source: key }
  const all = nonEmpty(env.LWS_MODEL)
  if (all) return { model: all, source: "LWS_MODEL" }
  if (provider === "claude-code") return { model: PLAN_ALIASES[role], source: "Claude Code alias, default" }
  // Codex: no OpenAI ID guessed here; empty = the CLI's default model (the operator's config.toml)
  if (provider === "codex") return { model: "", source: "the Codex CLI default; set LWS_MODEL_<ROLE> to choose" }
  if (provider === "openai-compatible") {
    const m = nonEmpty(env.OPENAI_MODEL)
    if (m) return { model: m, source: "OPENAI_MODEL" }
    throw new Error(`LWS_LLM=openai-compatible: no model for the "${role}" role. Set ${key}=<model> (or LWS_MODEL / OPENAI_MODEL for every role).`)
  }
  if (provider === "anthropic-compatible") {
    const m = nonEmpty(env.ANTHROPIC_MODEL)
    if (m) return { model: m, source: "ANTHROPIC_MODEL" }
    // a gateway (LiteLLM, a company proxy) to Claude understands the Claude IDs; a local server doesn't
    return { model: DEFAULT_MODELS[role], source: "Claude default; set LWS_MODEL for a local model" }
  }
  return { model: DEFAULT_MODELS[role], source: "default" }
}

/** A role OR an explicit ID (legacy caller) → the model to send. */
export function modelFor(roleOrModel: ModelRole | string, provider: ProviderName, env: Env = process.env): string {
  if (isRole(roleOrModel)) return resolveModel(roleOrModel, provider, env).model
  return roleOrModel
}

/** The three models, as the compose-batch Workflow receives them in `args.models` (Claude Code path). */
export function workflowModels(env: Env = process.env): Record<ModelRole, string> {
  return {
    smart: resolveModel("smart", "claude-code", env).model,
    fast: resolveModel("fast", "claude-code", env).model,
    judge: resolveModel("judge", "claude-code", env).model,
  }
}

/** The coach's model (claude -p): the legacy COACH_MODEL, else the smart role. */
export function coachModel(env: Env = process.env): string {
  return nonEmpty(env.COACH_MODEL) ?? resolveModel("smart", "claude-code", env).model
}
