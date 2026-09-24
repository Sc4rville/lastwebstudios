/**
 * Industry baselines — the human PRIOR of the scoring model.
 *
 * Per industry, three 0–100 baselines:
 *   leverage   does a better website change the game for this trade? (does it sell through images?)
 *   value      what a deal is worth to the studio, relative to the other trades
 *   expansion  future potential (booking, e-commerce, recurring work)
 *
 * The learning loop never overwrites these: it applies small, bounded deltas on top (see learning/).
 * This public table is an illustrative subset — the private radar covers far more trades.
 */

export type IndustryProfile = { label: string; leverage: number; value: number; expansion: number }

export const INDUSTRIES: Record<string, IndustryProfile> = {
  "kitchen-designer": { label: "kitchen design", leverage: 80, value: 75, expansion: 40 },
  "ironworker": { label: "architectural metalwork", leverage: 82, value: 72, expansion: 40 },
  "cabinetmaker": { label: "bespoke joinery", leverage: 78, value: 70, expansion: 38 },
  "pool-builder": { label: "pool building", leverage: 90, value: 95, expansion: 55 },
  "landscape-architect": { label: "landscape design", leverage: 85, value: 80, expansion: 45 },
  "wedding-venue": { label: "wedding venue", leverage: 90, value: 75, expansion: 58 },
}

/** Aliases → canonical key. Every lookup goes through here: a legacy key must never silently fall back. */
const ALIASES: Record<string, string> = {
  cuisiniste: "kitchen-designer",
  kitchen: "kitchen-designer",
  ferronnier: "ironworker",
  metallier: "ironworker",
  metalwork: "ironworker",
  menuisier: "cabinetmaker",
  joinery: "cabinetmaker",
  pisciniste: "pool-builder",
  piscine: "pool-builder",
  paysagiste: "landscape-architect",
}

export function normalizeIndustry(key = ""): string {
  const k = key.trim().toLowerCase()
  return ALIASES[k] ?? k
}

export const isKnownIndustry = (key: string) => normalizeIndustry(key) in INDUSTRIES
export const industryProfile = (key: string): IndustryProfile | undefined => INDUSTRIES[normalizeIndustry(key)]
