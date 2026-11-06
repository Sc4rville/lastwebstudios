/**
 * models.ts · LA source unique des modèles (aucun autre fichier ne cite un ID de modèle Claude).
 *
 * Le produit raisonne en RÔLES, pas en IDs :
 *
 *   smart  · conception et écriture : composer, filler, edit, audit cyber, coach, mail parfait (savior)
 *   fast   · extraction et tri à fort volume : structuration de la fiche, personas
 *   judge  · jugement visuel (vision requise) : porte visuelle du scoring, diagnose, auto-revue, beauty-gate
 *
 * Défauts (gamme du 24/10/2026, vérifiée sur platform.claude.com/docs/en/about-claude/models/overview) :
 *   smart = Claude Opus 5.5 · fast = Claude Haiku 5.5 · judge = Claude Sonnet 5.5
 *
 * Sur le chemin PLAN (`claude -p`, LWS_LLM=claude-code) on passe l'ALIAS (opus / haiku / sonnet) : il suit la
 * version de Claude Code installée et passe toujours à `--model`. Une CLI ancienne résout donc un alias vers un
 * modèle plus ancien : `npm run doctor` le montre ; `claude update` ou LWS_MODEL_<RÔLE>=<id> le règlent.
 *
 * Surcharges (verbatim, n'importe quel fournisseur) :
 *   LWS_MODEL_SMART / LWS_MODEL_FAST / LWS_MODEL_JUDGE   un modèle par rôle
 *   LWS_MODEL                                             un seul modèle pour tous les rôles (ex. un modèle local)
 *   OPENAI_MODEL (openai-compatible) · ANTHROPIC_MODEL (anthropic-compatible) : repli si rien d'autre n'est posé
 *   COACH_MODEL                                           historique, coach seulement (prioritaire sur smart)
 */

export type ModelRole = "smart" | "fast" | "judge"
export const ROLES: readonly ModelRole[] = ["smart", "fast", "judge"] as const

export type ProviderName = "claude-code" | "codex" | "anthropic" | "anthropic-compatible" | "openai-compatible"

/** IDs de l'API Claude (Messages) pour chaque rôle. */
export const DEFAULT_MODELS: Readonly<Record<ModelRole, string>> = {
  smart: "claude-opus-5-5",
  fast: "claude-haiku-5-5",
  judge: "claude-sonnet-5-5",
}

/** Alias Claude Code (`claude --model <alias>`), chemin plan. */
export const PLAN_ALIASES: Readonly<Record<ModelRole, string>> = { smart: "opus", fast: "haiku", judge: "sonnet" }

/** Qui utilise quel rôle (affiché par `npm run doctor`, tenu à jour avec les appelants). */
export const ROLE_USES: Readonly<Record<ModelRole, string>> = {
  smart: "composer, filler, edit, audit cyber, coach, mail parfait",
  fast: "structuration de la fiche, personas",
  judge: "porte visuelle, diagnose, auto-revue, beauty-gate (vision)",
}

export function isRole(x: unknown): x is ModelRole {
  return x === "smart" || x === "fast" || x === "judge"
}

type Env = Record<string, string | undefined>
const nonEmpty = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined)

export type ResolvedModel = { model: string; source: string }

/**
 * Le modèle d'un rôle pour un fournisseur donné, avec sa provenance (pour le doctor et les messages d'erreur).
 * Lève si un fournisseur tiers n'a aucun modèle configuré (un serveur local ne connaît pas les IDs Claude).
 */
export function resolveModel(role: ModelRole, provider: ProviderName, env: Env = process.env): ResolvedModel {
  const key = `LWS_MODEL_${role.toUpperCase()}`
  const perRole = nonEmpty(env[key])
  if (perRole) return { model: perRole, source: key }
  const all = nonEmpty(env.LWS_MODEL)
  if (all) return { model: all, source: "LWS_MODEL" }
  if (provider === "claude-code") return { model: PLAN_ALIASES[role], source: "alias Claude Code (défaut)" }
  // Codex : aucun ID OpenAI deviné ici ; vide = le modèle par défaut de la CLI (config.toml de l'opérateur)
  if (provider === "codex") return { model: "", source: "défaut de la CLI Codex (pose LWS_MODEL_<RÔLE> pour choisir)" }
  if (provider === "openai-compatible") {
    const m = nonEmpty(env.OPENAI_MODEL)
    if (m) return { model: m, source: "OPENAI_MODEL" }
    throw new Error(`LWS_LLM=openai-compatible : aucun modèle pour le rôle « ${role} ». Pose ${key}=<modèle> (ou LWS_MODEL / OPENAI_MODEL pour tous les rôles).`)
  }
  if (provider === "anthropic-compatible") {
    const m = nonEmpty(env.ANTHROPIC_MODEL)
    if (m) return { model: m, source: "ANTHROPIC_MODEL" }
    // une passerelle (LiteLLM, proxy d'entreprise) vers Claude comprend les IDs Claude ; un serveur local non
    return { model: DEFAULT_MODELS[role], source: "défaut Claude (pose LWS_MODEL pour un modèle local)" }
  }
  return { model: DEFAULT_MODELS[role], source: "défaut" }
}

/** Un rôle OU un ID explicite (appelant historique) → le modèle à envoyer. */
export function modelFor(roleOrModel: ModelRole | string, provider: ProviderName, env: Env = process.env): string {
  if (isRole(roleOrModel)) return resolveModel(roleOrModel, provider, env).model
  return roleOrModel
}

/** Les trois modèles, tels que le Workflow compose-batch les reçoit dans `args.models` (chemin Claude Code). */
export function workflowModels(env: Env = process.env): Record<ModelRole, string> {
  return {
    smart: resolveModel("smart", "claude-code", env).model,
    fast: resolveModel("fast", "claude-code", env).model,
    judge: resolveModel("judge", "claude-code", env).model,
  }
}

/** Modèle du coach (claude -p) : COACH_MODEL historique, sinon le rôle smart. */
export function coachModel(env: Env = process.env): string {
  return nonEmpty(env.COACH_MODEL) ?? resolveModel("smart", "claude-code", env).model
}
