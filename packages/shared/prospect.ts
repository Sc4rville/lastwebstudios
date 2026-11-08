/**
 * ProspectSheet — THE pipeline's CONTRACT.
 *
 * Produced by: leadengine  (sources → scraping → scoring)
 * Consumed by: design      (template-fill: filler → demo site)
 *
 * The two blocks NEVER talk to each other directly: the leadengine writes a
 * ProspectSheet to `data/prospects/`, design reads it. This file is therefore
 * the only thing the two blocks share. We keep it stable and minimal.
 *
 * Pilot rule: the target ALWAYS has an existing site (weak/dated). That's our
 * buyer. No site → dropped upstream, never reaches this point.
 */

/** A LOCAL file path (media are downloaded; the contract only carries paths). */
type LocalPath = string

export type Tier = "hot" | "warm" | "cold"

/**
 * The prospect's industry = THE SWITCH KEY for the design block and the scoring.
 *
 * SINGLE SOURCE OF TRUTH: the keys of `INDUSTRIES` (leadengine/1_scraping/scripts/industries.ts).
 * The old TS union here was a FAKE contract: the JSON went around it and 3 diverging vocabularies
 * circulated (sheets, industries.ts, design/) → 1/3 of the portfolio scored on generic baselines.
 * Every write goes through `normalizeIndustry()` (industries.ts); here we type it broadly + document it.
 */
export type Industry = string // a canonical INDUSTRIES key — normalised by normalizeIndustry()

export type ProspectSheet = {
  /** A stable, readable identifier. E.g. "orvane-piscines-valmont-sur-lys". */
  id: string

  /** Industry → decides which trade profile the filler reads. */
  industry: Industry

  /** Who the business is. */
  identity: {
    name: string
    city: string
    /** Service area if known. E.g. "Grand Lyon". */
    zone?: string
    phone?: string
    email?: string
    /** Opening hours as free text for the pilot. E.g. "Lun–Sam 9h–19h". */
    hours?: string
  }

  /** The normalised content, ready to be rewritten/shown by the creative side. */
  content: {
    /** Tagline / value proposition. */
    tagline?: string
    /** About / story (tradesperson, years, showroom). */
    about?: string
    /** Services offered. E.g. ["cuisine sur mesure", "pose", "plan 3D"]. */
    services: string[]
    /** Brands carried (appliances, suppliers) — common with kitchen designers. */
    brands?: string[]
  }

  /** The collected media, local. */
  assets: {
    logo?: LocalPath
    /** Photos of past work — the material for the demo site's gallery. */
    photos: LocalPath[]
    /** A video of past work (optional) — hero/section. Can be added from the station; the filler
     * knows how to inject it (<video> hero). Backward compatible: absent on existing sheets. */
    video?: { src: LocalPath; poster?: LocalPath }
  }

  /** The current site (always present: it's the target's prerequisite). */
  existing: {
    url: string
    /** Full-page screenshot of the current site = the "before" argument. */
    screenshot?: LocalPath
  }

  /** Opportunity score — MINIMAL for the pilot (site quality only). */
  score: {
    /** 0–100. */
    value: number
    tier: Tier
    /** The score's readable reasons (stored French codes, see model.ts). E.g. ["pas responsive", "pas de HTTPS"]. */
    reasons: string[]
  }

  /**
   * Diagnosis brief — produced by `/diagnose`, consumed by `/composer`: the creative DIRECTION
   * aimed at THIS prospect (what it is, what's wrong with its current site, the angle, the moves).
   * Optional: absent until `/diagnose` has run. The composer then asks for it. Typed here so
   * the composer's hard dependency no longer rests on a field written "by hand" outside the contract.
   */
  brief?: {
    beauty_before?: { score?: number; why?: string }
    what?: string
    problems?: string[]
    angle?: string
    moves?: string[]
  }
}
