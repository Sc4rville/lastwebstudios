/**
 * Learning — les types de la boucle (maillon 9). Partagés par `record` (écrit les retours) et
 * `learn` (recalcule les règles). La FORME des règles appartient au scoring (`model.ts`, `LearnedRules`) :
 * la boucle PRODUIT ce que le scoring CONSOMME (cf. ARCHITECTURE § dépendances). Import type-only → zéro
 * couplage runtime, `model.ts` reste pur/testable.
 */
import type { LearnedRules, Axes, Signals } from "../../leadengine/2_scoring/scripts/model.ts"
export type { LearnedRules, Axes, Signals }

/** L'issue d'un prospect contacté. C'est la VÉRITÉ TERRAIN que la boucle apprend. */
export const OUTCOMES = ["sent", "reply", "meeting", "won", "lost"] as const
export type OutcomeKind = (typeof OUTCOMES)[number]

/** Le poids « succès » de chaque issue (0–1). Une réunion vaut mieux qu'une réponse, une vente vaut tout. */
export const OUTCOME_WEIGHT: Record<OutcomeKind, number> = {
  sent: 0, // contacté, pas (encore) de réaction → essai à 0
  reply: 0.3, // il répond → engagement
  meeting: 0.6, // rendez-vous → intérêt réel
  won: 1, // vendu → le signal en or
  lost: 0, // a décliné → essai raté
}

/** Une ligne de `data/outcomes.jsonl` : l'issue + les features qui l'ont prédite (au moment du scoring). */
export type Outcome = {
  id: string
  industry: string
  value?: number
  tier?: string
  axes?: Axes
  signals?: Signals
  outcome: OutcomeKind
  ts: string
}

/** Le fichier de règles sur disque : les règles que lit le scoring + des métadonnées de transparence. */
export type RulesFile = LearnedRules & {
  updatedAt: string
  totalOutcomes: number
  /** prospects distincts = essais (un par prospect, son état final) */
  prospects?: number
  evidence?: unknown // les comptes/taux par métier & signal — pour que la calibration soit lisible, pas une boîte noire
}
