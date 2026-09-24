/**
 * ProspectSheet — THE contract of the pipeline.
 *
 * Written by : leadengine (scoring → parsing → structuration)
 * Read by    : design     (compose → polish → verify) and distribution
 *
 * The blocks never call each other: the lead engine writes a sheet to `data/prospects/<id>.json`,
 * the design engine reads it. This file is the only thing they share, so it stays small and stable.
 *
 * Pilot rule: a target ALWAYS has an existing (weak, dated) website. That is the buyer.
 * No website → discarded upstream, never reaches this contract.
 */

/** A LOCAL file path, relative to `data/`. Media are downloaded; the contract only carries paths. */
type LocalPath = string

export type Tier = "hot" | "warm" | "cold"

/** Five weighted axes of the scoring model (see leadengine/2_scoring/scripts/model.ts). */
export type Axes = { need: number; leverage: number; value: number; reachability: number; expansion: number }

/** Free signals read in the raw HTML — persisted so the learning loop can measure their lift. */
export type Signals = {
  gallery?: boolean
  quoteCta?: boolean
  social?: boolean
  premium?: boolean
  multiSite?: boolean
  ecommerce?: boolean
  booking?: boolean
  blog?: boolean
}

export type Score = {
  /** 0–100. */
  value: number
  tier: Tier
  /** Human-readable reasons. E.g. ["not responsive (no viewport)", "no HTTPS"]. */
  reasons: string[]
  axes?: Axes
  signals?: Signals
  /** Proxy used to SORT the queue: value × P(need) × P(reachable). 0–100. */
  expectedValue?: number
  /** Enough material on the current site to build a demo from it? */
  feasible?: boolean
}

export type ProspectSheet = {
  /** Stable, readable id. E.g. "atelier-braise-toulouse". */
  id: string
  /** Routing key of the design engine: industry → profile + template. */
  industry: string

  identity: {
    name: string
    city: string
    zone?: string
    email?: string
    hours?: string
    since?: number
  }

  /** Normalised content, extracted from the prospect's OWN site — never invented. */
  content: {
    tagline?: string
    about?: string
    services: string[]
    /** Detailed offers, when the current site lists them. */
    offers?: { title: string; detail: string; material?: string; leadTime?: string }[]
    /** Key figures the business states about itself. */
    facts?: { value: string; unit?: string; label: string }[]
    /** How they work, step by step. */
    process?: { title: string; detail: string }[]
    /** Past projects they mention. */
    projects?: string[]
    /** Real navigation labels of the current site. */
    nav?: string[]
    /** h1–h3 headings, in document order. */
    sections?: string[]
  }

  assets: {
    logo?: LocalPath
    photos: LocalPath[]
  }

  /** The current site — always present, it is the prerequisite of a target. */
  existing: {
    url: string
    /** Full-page screenshot of the current site: the "before" of the pitch. */
    screenshot?: LocalPath
  }

  score: Score
}
