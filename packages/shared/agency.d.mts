type Env = NodeJS.ProcessEnv | Record<string, string | undefined>
export type Agency = {
  name: string; slug: string; website: string; contactEmail: string; phone: string; calendarUrl: string
  /** ISO 3166-1 alpha-2 (default FR) · BCP-47 language of the generated content (default fr) · locale · currency · time zone */
  country: string; language: string; locale: string; currency: string; timezone: string
  /** postal address (CAN-SPAM in the US); fallback: invoice.seller.address */
  postalAddress: string
  http: { userAgent: string; crawlerUserAgent: string }
  mail: { senderName: string; signature: string; legalIdentity: string; heloDomain: string }
  brand: { expediteur: string; team: string; offer: string; garantie: string }
  invoice: { seller: Record<string, string> }
  storage: { bucket: string }
  operators: string[]
  /** opt-in: DuckDuckGo, then Bing when the guessed domain doesn't answer (the search engines' terms of use) */
  leadengine: { searchFallback: boolean }
  /** sentences the draft may say about a named competitor; empty = no "competitor" line */
  outreach: { competitorClaims: string[] }
  /** the file read (null: neutral values) */
  source: string | null
}
export const AGENCY_FILE: string
export const AGENCY_EXAMPLE: string
export const NEUTRAL: Readonly<Omit<Agency, "source">>
export function agencyFile(env?: Env, root?: string): string | null
export function agency(env?: Env, root?: string): Agency
export function postalAddress(env?: Env, root?: string): string
export const REGISTRY_COUNTRIES: readonly string[]
export function hasCompanyRegistry(env?: Env, root?: string): boolean
export function brandFacts(env?: Env, root?: string): {
  senderName: string; expediteur: string; studio: string; team: string; offer: string; garantie: string
  portfolioUrl: string; phone: string; calcomUrl: string
}

export function clearAgencyCache(): void
