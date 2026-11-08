/**
 * agency.mjs · THE AGENCY'S IDENTITY, in a single file: `agency.config.json` at the root of the repo.
 *
 * Everything that speaks ON BEHALF of the agency reads it here, never hard-coded: the emails' legal footer
 * (smtp.ts), the SMTP verifier's HELO, the lead engine's User-Agents (sources, emails, score), the invoices'
 * seller (invoices.ts), the brand facts of the perfect email (savior.ts), the drafts' signature, the default storage
 * bucket. Changing agency = changing this file.
 *
 * Resolution: `LWS_AGENCY_CONFIG` (path) › `agency.config.json` › `agency.config.example.us.json` (the FICTIONAL US agency
 * shipped with the product) › the neutral values below. Missing keys fall back on the neutral values: a
 * partial file is enough. Plain JS (+ agency.d.mts) so TypeScript and .mjs files can both import it.
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const AGENCY_FILE = "agency.config.json"
/** the default demo studio (D1: English first) ; the French one is agency.config.example.json (`npm run sandbox -- --country FR`) */
export const AGENCY_EXAMPLE = "agency.config.example.us.json"

/** The repo's root (this module lives in packages/shared/). */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")

/** NEUTRAL values (no real agency): what is left when the file says nothing. The French defaults are kept as they are. */
export const NEUTRAL = Object.freeze({
  name: "Mon agence web",
  /** the agency's country (ISO 3166-1 alpha-2): company registry (SIRENE if FR), the emails' legal footer
   *  (LCEN/GDPR in FR, CAN-SPAM in the US, CASL in CA…), phone formats, the TLDs the lead engine guesses */
  country: "FR",
  /** language of the GENERATED content (BCP-47): sites, emails, call scripts. The playbooks stay in French. */
  language: "fr",
  locale: "fr-FR",
  currency: "EUR",
  timezone: "Europe/Paris",
  /** postal address (required for a real send in the US: CAN-SPAM); fallback: invoice.seller.address */
  postalAddress: "",
  slug: "agence",
  website: "",
  contactEmail: "",
  phone: "",
  calendarUrl: "",
  http: {
    userAgent: "lws-leadengine/1.0",
    crawlerUserAgent: "Mozilla/5.0 (compatible; lws/1.0)",
  },
  mail: {
    senderName: "Mon agence web",
    signature: "Mon agence web",
    legalIdentity: "Mon agence web",
    heloDomain: "localhost",
  },
  brand: {
    expediteur: "",
    team: "",
    offer: "",
    garantie: "",
  },
  invoice: { seller: {} },
  storage: { bucket: "lws-assets" },
  /** the team's operators (short ids): who made which call in the CRM */
  operators: [],
  /** lead engine: `searchFallback` = look for a company's site on DuckDuckGo, then Bing (HTML result
   *  pages) when the guessed domain doesn't answer. OPT-IN: reading result pages by program breaks the
   *  search engines' terms of use; without it, only the "guessed domain + DNS" route runs. */
  leadengine: { searchFallback: false },
  /** outreach: `competitorClaims` = the sentences the draft (draft.ts) may say about a NAMED competitor. Empty by
   *  default: no "competitor" line is written. A claim about an identifiable third party must be true and
   *  verifiable (misleading commercial practices, French Consumer Code L121-2). */
  outreach: { competitorClaims: [] },
})

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v)
function merge(base, over) {
  const out = { ...base }
  for (const [k, v] of Object.entries(over || {})) {
    if (k.startsWith("_")) continue
    out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v
  }
  return out
}

/** The config file in use (absolute path) or null. */
export function agencyFile(env = process.env, root = REPO) {
  if (env.LWS_AGENCY_CONFIG) return isAbsolute(env.LWS_AGENCY_CONFIG) ? env.LWS_AGENCY_CONFIG : resolve(root, env.LWS_AGENCY_CONFIG)
  for (const f of [AGENCY_FILE, AGENCY_EXAMPLE]) if (existsSync(join(root, f))) return join(root, f)
  return null
}

const cache = new Map()
/** after the cockpit writes agency.config.json: re-read on the next call */
export function clearAgencyCache() { cache.clear() }

/** The agency (neutral values + file). Cached by file path. */
export function agency(env = process.env, root = REPO) {
  const file = agencyFile(env, root)
  if (cache.has(file)) return cache.get(file)
  let raw = {}
  if (file) {
    try { raw = JSON.parse(readFileSync(file, "utf8")) } catch (e) { throw new Error(`${file}: invalid JSON (${e.message})`) }
  }
  const a = merge(NEUTRAL, raw)
  // the obvious derived values, so a minimal file (just "name") stays consistent
  if (!raw.mail?.senderName) a.mail.senderName = a.name
  if (!raw.mail?.signature) a.mail.signature = a.name
  if (!raw.mail?.legalIdentity) a.mail.legalIdentity = a.name
  a.country = String(a.country || "FR").toUpperCase()
  a.language = String(raw.language || LANGUAGES[a.country] || NEUTRAL.language).toLowerCase() // without `language`, the country's
  if (!raw.locale) a.locale = LOCALES[a.country] ?? `${a.language}-${a.country}`
  if (!raw.currency) a.currency = CURRENCIES[a.country] ?? "EUR"
  if (!raw.timezone) a.timezone = TIMEZONES[a.country] ?? "UTC"
  a.source = file
  cache.set(file, a)
  return a
}

const LANGUAGES = { FR: "fr", BE: "fr", CH: "fr", US: "en", GB: "en", CA: "en", AU: "en", IE: "en", NZ: "en" }
const LOCALES = { FR: "fr-FR", BE: "fr-BE", CH: "fr-CH", US: "en-US", GB: "en-GB", CA: "en-CA", AU: "en-AU", IE: "en-IE", NZ: "en-NZ" }
const CURRENCIES = { FR: "EUR", BE: "EUR", IE: "EUR", CH: "CHF", US: "USD", GB: "GBP", CA: "CAD", AU: "AUD", NZ: "NZD" }
const TIMEZONES = { FR: "Europe/Paris", BE: "Europe/Brussels", CH: "Europe/Zurich", IE: "Europe/Dublin", US: "America/New_York", GB: "Europe/London", CA: "America/Toronto", AU: "Australia/Sydney", NZ: "Pacific/Auckland" }

/** The agency's postal address: `postalAddress`, else the invoice seller's if it is filled in (not a <…> placeholder). */
export function postalAddress(env = process.env, root = REPO) {
  const a = agency(env, root)
  const pick = (v) => (typeof v === "string" && v.trim() && !/[<>]/.test(v) ? v.trim() : "")
  return pick(a.postalAddress) || pick(a.invoice?.seller?.address)
}

/** Countries where the public company registry is wired in (SIRENE / recherche-entreprises). Elsewhere: no registry. */
export const REGISTRY_COUNTRIES = Object.freeze(["FR"])
export function hasCompanyRegistry(env = process.env, root = REPO) {
  return REGISTRY_COUNTRIES.includes(agency(env, root).country)
}

/** The perfect email's brand facts (the generate-savior skill). */
export function brandFacts(env = process.env, root = REPO) {
  const a = agency(env, root)
  return {
    senderName: a.mail.senderName,
    expediteur: a.brand.expediteur || a.mail.senderName.split(/[·,-]/)[0].trim(),
    studio: a.name,
    team: a.brand.team,
    offer: a.brand.offer,
    garantie: a.brand.garantie,
    portfolioUrl: a.website,
    phone: a.phone,
    calcomUrl: a.calendarUrl,
  }
}
