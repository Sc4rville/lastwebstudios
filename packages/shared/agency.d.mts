type Env = NodeJS.ProcessEnv | Record<string, string | undefined>
export type Agency = {
  name: string; slug: string; website: string; contactEmail: string; phone: string; calendarUrl: string
  /** ISO 3166-1 alpha-2 (défaut FR) · langue BCP-47 des contenus générés (défaut fr) · locale · devise · fuseau */
  country: string; language: string; locale: string; currency: string; timezone: string
  /** adresse postale (CAN-SPAM aux US) ; repli : invoice.seller.address */
  postalAddress: string
  http: { userAgent: string; crawlerUserAgent: string }
  mail: { senderName: string; signature: string; legalIdentity: string; heloDomain: string }
  brand: { expediteur: string; team: string; offer: string; garantie: string }
  invoice: { seller: Record<string, string> }
  storage: { bucket: string }
  operators: string[]
  /** opt-in : DuckDuckGo puis Bing quand le domaine deviné ne répond pas (conditions d'utilisation des moteurs) */
  leadengine: { searchFallback: boolean }
  /** phrases que le brouillon peut dire d'un concurrent nommé ; vide = pas de ligne « concurrent » */
  outreach: { competitorClaims: string[] }
  /** le fichier lu (null : valeurs neutres) */
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
