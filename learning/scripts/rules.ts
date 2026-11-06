/**
 * Learning — le LECTEUR de règles, consommé par le scoring (`score.ts`).
 * C'est l'unique point où `leadengine/2_scoring` lit `learning/rules` (cf. ARCHITECTURE § dépendances).
 *
 * INVARIANT DE SÛRETÉ : aucune règle (fichier absent / illisible / vide) → `{}` → le scoring tourne sur
 * ses baselines humaines, à l'identique. La boucle ne peut JAMAIS casser la porte, seulement l'affiner.
 */
import { readFile } from "node:fs/promises"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type { LearnedRules } from "../../leadengine/2_scoring/scripts/model.ts"

const RULES_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "rules", "rules.json")

let cache: LearnedRules | undefined // un seul I/O par process

/** Charge les règles apprises. Tolère tout : pas de fichier, JSON cassé, champs manquants → `{}`. */
export async function loadRules(): Promise<LearnedRules> {
  if (cache) return cache
  try {
    const raw = JSON.parse(await readFile(RULES_PATH, "utf8"))
    cache = { industries: raw?.industries ?? {}, signals: raw?.signals ?? {} }
  } catch {
    cache = {}
  }
  return cache
}
