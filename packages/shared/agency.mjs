/**
 * agency.mjs · L'IDENTITÉ DE L'AGENCE, en un seul fichier : `agency.config.json` à la racine du dépôt.
 *
 * Tout ce qui parle AU NOM de l'agence la lit ici, jamais en dur dans le code : le pied légal des mails
 * (smtp.ts), le HELO du vérificateur SMTP, les User-Agent du lead engine (sources, emails, score), le vendeur des
 * factures (invoices.ts), les faits de marque du mail sauveur (savior.ts), la signature des brouillons, le bucket de
 * stockage par défaut. Changer d'agence = changer ce fichier.
 *
 * Résolution : `LWS_AGENCY_CONFIG` (chemin) › `agency.config.json` › `agency.config.example.json` (agence FICTIVE
 * livrée avec le produit) › valeurs neutres ci-dessous. Les clés absentes retombent sur les valeurs neutres : un
 * fichier partiel suffit. En JS pur (+ agency.d.mts) pour être importable par le TypeScript comme par les .mjs.
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const AGENCY_FILE = "agency.config.json"
export const AGENCY_EXAMPLE = "agency.config.example.json"

/** Racine du dépôt (ce module vit dans packages/shared/). */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")

/** Valeurs NEUTRES (aucune agence réelle) : ce qui reste quand le fichier ne dit rien. */
export const NEUTRAL = Object.freeze({
  name: "Mon agence web",
  /** pays de l'agence (ISO 3166-1 alpha-2) : registre d'entreprises (SIRENE si FR), pied légal des mails
   *  (LCEN/RGPD en FR, CAN-SPAM aux US, CASL au CA…), formats de téléphone, TLD devinés par le lead engine */
  country: "FR",
  /** langue des contenus GÉNÉRÉS (BCP-47) : sites, mails, scripts d'appel. Les playbooks restent en français. */
  language: "fr",
  locale: "fr-FR",
  currency: "EUR",
  timezone: "Europe/Paris",
  /** adresse postale (obligatoire pour un envoi réel aux US : CAN-SPAM) ; repli : invoice.seller.address */
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
  /** les opérateurs de l'équipe (identifiants courts) : attribution des appels dans le CRM */
  operators: [],
  /** lead engine : `searchFallback` = chercher le site d'une entreprise dans DuckDuckGo puis Bing (pages HTML de
   *  résultats) quand le domaine deviné ne répond pas. OPT-IN : lire des pages de résultats par programme sort des
   *  conditions d'utilisation des moteurs ; sans lui, seule la voie « domaine deviné + DNS » tourne. */
  leadengine: { searchFallback: false },
  /** outreach : `competitorClaims` = les phrases que le brouillon (draft.ts) peut dire d'un concurrent NOMMÉ. Vide par
   *  défaut : aucune ligne « concurrent » n'est écrite. Une affirmation sur un tiers identifiable doit être vraie et
   *  vérifiable (pratiques commerciales trompeuses, Code de la consommation L121-2). */
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

/** Le fichier de config retenu (chemin absolu) ou null. */
export function agencyFile(env = process.env, root = REPO) {
  if (env.LWS_AGENCY_CONFIG) return isAbsolute(env.LWS_AGENCY_CONFIG) ? env.LWS_AGENCY_CONFIG : resolve(root, env.LWS_AGENCY_CONFIG)
  for (const f of [AGENCY_FILE, AGENCY_EXAMPLE]) if (existsSync(join(root, f))) return join(root, f)
  return null
}

const cache = new Map()

/** L'agence (valeurs neutres + fichier). Mis en cache par chemin de fichier. */
export function agency(env = process.env, root = REPO) {
  const file = agencyFile(env, root)
  if (cache.has(file)) return cache.get(file)
  let raw = {}
  if (file) {
    try { raw = JSON.parse(readFileSync(file, "utf8")) } catch (e) { throw new Error(`${file} : JSON invalide (${e.message})`) }
  }
  const a = merge(NEUTRAL, raw)
  // les dérivés évidents, pour qu'un fichier minimal (juste « name ») reste cohérent
  if (!raw.mail?.senderName) a.mail.senderName = a.name
  if (!raw.mail?.signature) a.mail.signature = a.name
  if (!raw.mail?.legalIdentity) a.mail.legalIdentity = a.name
  a.country = String(a.country || "FR").toUpperCase()
  a.language = String(raw.language || LANGUAGES[a.country] || NEUTRAL.language).toLowerCase() // sans `language`, celle du pays
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

/** L'adresse postale de l'agence : `postalAddress`, sinon celle du vendeur des factures si elle est renseignée (pas un placeholder <…>). */
export function postalAddress(env = process.env, root = REPO) {
  const a = agency(env, root)
  const pick = (v) => (typeof v === "string" && v.trim() && !/[<>]/.test(v) ? v.trim() : "")
  return pick(a.postalAddress) || pick(a.invoice?.seller?.address)
}

/** Pays où le registre public d'entreprises est branché (SIRENE / recherche-entreprises). Ailleurs : aucun registre. */
export const REGISTRY_COUNTRIES = Object.freeze(["FR"])
export function hasCompanyRegistry(env = process.env, root = REPO) {
  return REGISTRY_COUNTRIES.includes(agency(env, root).country)
}

/** Faits de marque du mail sauveur (skill generate-savior). */
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
