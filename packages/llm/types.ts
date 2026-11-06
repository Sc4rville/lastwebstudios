/**
 * types.ts · le contrat commun des 4 adaptateurs LLM (packages/llm/adapters/*).
 *
 * Une requête = un prompt système stable (le prompt.md du skill, mis en cache quand la voie le permet) + un
 * message utilisateur (les blocs d'entrée) + des images facultatives + un schéma JSON facultatif (sortie
 * structurée native quand la voie la propose, sinon extraction du JSON dans le texte).
 */
import type { ModelRole, ProviderName } from "./models.ts"

export type LlmImage = { path: string; mediaType: string; data: string /* base64 */ }

export type JsonSchema = { [key: string]: unknown }

export type LlmRequest = {
  system: string
  user: string
  images?: LlmImage[]
  model: string
  role?: ModelRole
  maxTokens: number
  /** schéma JSON de la sortie attendue (structured outputs) ; absent = JSON extrait du texte */
  schema?: JsonSchema
  /** libellé lisible (journaux, erreurs) */
  label?: string
}

export type LlmUsage = { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; costUsd?: number }

export type LlmResponse = {
  provider: ProviderName
  model: string
  text: string
  /** la sortie structurée native, si la voie l'a fournie et validée */
  structured?: unknown
  usage?: LlmUsage
  stopReason?: string
}

export interface LlmAdapter {
  readonly name: ProviderName
  complete(req: LlmRequest): Promise<LlmResponse>
}

export class LlmError extends Error {
  constructor(message: string, readonly provider: ProviderName, readonly status?: number) {
    super(message)
    this.name = "LlmError"
  }
}
