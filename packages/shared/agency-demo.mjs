/**
 * agency-demo.mjs · what in an agency config still belongs to a demo studio (the fictional ones shipped as
 * agency.config.example*.json) : the name, the sender, the phone, the addresses on a reserved .example domain, the
 * offer copied from the demo, the <…> invoice placeholders. Read by the cockpit's Settings (it lists what is left to
 * make yours) and by `npm run doctor` (it keeps warning until nothing is left). Plain words, no config keys.
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export const EXAMPLE_FILES = ["agency.config.example.json", "agency.config.example.us.json"]

/** the shipped demo agencies, parsed (missing or broken files are skipped) */
export function readExamples(root = process.cwd()) {
  const out = []
  for (const f of EXAMPLE_FILES) { try { const p = join(root, f); if (existsSync(p)) out.push(JSON.parse(readFileSync(p, "utf8"))) } catch { /* */ } }
  return out
}

const reserved = (v) => /\.(example|invalid|test)\b/i.test(String(v || ""))
const placeholder = (v) => /<[^>]+>/.test(String(v || ""))
const get = (o, path) => path.split(".").reduce((x, k) => (x && typeof x === "object" ? x[k] : undefined), o)

/**
 * The fields of `cfg` that are still a demo's, as { key, label, why } in the owner's words (most visible first).
 * why = "demo" : the field equals the same field of a shipped example (untouched) ; "placeholder" : the owner typed
 * something, but on a reserved domain (an .example address reaches nobody) or a <…> placeholder. Empty when the agency
 * is fully the owner's.
 */
export function demoLeftovers(cfg, examples = readExamples()) {
  if (!cfg || typeof cfg !== "object") return []
  const out = []
  const add = (key, label, why = "demo") => { if (!out.some((x) => x.label === label)) out.push({ key, label, why }) }
  const same = (path) => { const v = get(cfg, path); return typeof v === "string" && v.trim() !== "" && examples.some((e) => get(e, path) === v) }
  if (same("name")) add("name", "Agency name")
  if (same("brand.expediteur") || same("mail.senderName")) add("firstName", "Your first name (the sender)")
  if (same("phone")) add("phone", "Phone")
  if (same("contactEmail")) add("contactEmail", "Email"); else if (reserved(cfg.contactEmail)) add("contactEmail", "Email", "placeholder")
  if (same("website")) add("website", "Website"); else if (reserved(cfg.website)) add("website", "Website", "placeholder")
  if (reserved(get(cfg, "mail.heloDomain"))) add("contactEmail", "Email", "placeholder")
  if (reserved(cfg.calendarUrl)) add("calendarUrl", "Booking link", "placeholder")
  if (same("brand.team")) add("brand", "Agency paragraph")
  if (same("brand.offer")) add("offer", "What you offer")
  if (same("brand.garantie")) add("guarantee", "Your promise")
  if (same("postalAddress")) add("postalAddress", "Postal address")
  const seller = get(cfg, "invoice.seller") || {}
  if (Object.values(seller).some((v) => placeholder(v) || reserved(v))) add("invoice", "Invoice details (Billing › Your business)", "placeholder")
  return out
}

/** the demo copy of each shipped studio, by country, as the Settings form shows it : switching country swaps the fields
 *  still holding the old demo's text for the new demo's (never a field the owner wrote) */
export function demoCopyByCountry(examples = readExamples()) {
  const out = {}
  for (const e of examples) {
    const c = String(e?.country || "").toUpperCase(); if (!c || out[c]) continue
    out[c] = { name: e.name || "", firstName: get(e, "brand.expediteur") || "", brand: get(e, "brand.team") || "", offer: get(e, "brand.offer") || "", guarantee: get(e, "brand.garantie") || "", phone: e.phone || "", contactEmail: e.contactEmail || "", website: e.website || "", language: e.language || "", currency: e.currency || "", timezone: e.timezone || "" }
  }
  return out
}
