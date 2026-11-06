// locale.js · how the cockpit writes phones, addresses, dates, money and people, by the agency's country.
// One small helper used by Prospects, Sites, Outreach and Billing. The data stays what it is (a French cast stays
// French); the chrome follows the agency.
export const L = { country: "FR", locale: "fr-FR", currency: "EUR", timezone: undefined }
export function setLocale(a) { if (!a) return; L.country = String(a.country || "FR").toUpperCase(); L.locale = a.locale || L.locale; L.currency = a.currency || L.currency; L.timezone = a.timezone || undefined }
export const isFR = () => L.country === "FR"
const US_STATES = { alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY" }
/** "Portland, ME 04101" for the US, "Valmont-sur-Lys" for France, "City, Region ZIP" elsewhere. */
export function place(city, region, zip) {
  city = city || ""; region = region || ""; zip = zip || ""
  if (L.country === "US") { const st = US_STATES[region.toLowerCase()] || (region.length === 2 ? region.toUpperCase() : region); return [city, [st, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") }
  if (isFR()) return [zip, city].filter(Boolean).join(" ")
  return [city, region, zip].filter(Boolean).join(", ")
}
/** phone as the owner reads it: (555) 010-1234 in the US, 01 99 00 41 52 in France; unknown shapes untouched. */
export function phone(raw) {
  const s = String(raw || "").trim(); if (!s) return ""
  const d = s.replace(/\D/g, "")
  if (L.country === "US" || L.country === "CA") {
    const n = d.length === 11 && d[0] === "1" ? d.slice(1) : d
    if (n.length === 10 && !/^[01]/.test(n)) return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` // NANP only; a foreign number stays as written
    return s
  }
  if (isFR()) { const n = d.length === 11 && d.startsWith("33") ? "0" + d.slice(2) : d; if (n.length === 10) return n.replace(/(\d{2})(?=\d)/g, "$1 ").trim() }
  return s
}
export const telHref = (raw) => "tel:" + String(raw || "").replace(/[^\d+]/g, "")
/** the person you ask for on the phone */
export const owner = () => "the owner"
export function money(n) { try { return new Intl.NumberFormat(L.locale, { style: "currency", currency: L.currency, maximumFractionDigits: 0 }).format(Number(n) || 0) } catch { return `${Number(n) || 0} ${L.currency}` } }
export function money2(n) { try { return new Intl.NumberFormat(L.locale, { style: "currency", currency: L.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0) } catch { return `${(Number(n) || 0).toFixed(2)} ${L.currency}` } }
const hour12 = () => !isFR() && !/^(de|fr|es|it|nl|pt|pl|sv|da|nb|fi|cs)/.test(L.locale)
export function date(ms, o = {}) { if (!ms) return ""; return new Date(ms).toLocaleDateString(isFR() ? "en-GB" : L.locale, { day: "numeric", month: "short", ...o }) }
export function dateTime(ms) { if (!ms) return ""; return new Date(ms).toLocaleString(isFR() ? "en-GB" : L.locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: hour12() }) }
/** call-time slots, named for the owner: 8–9 am / 12–2 pm / 4–5 pm, or 8h–9h in France */
export function slots() {
  return hour12()
    ? [["matin", "Morning", "8–9 am"], ["midi", "Midday", "12–2 pm"], ["aprem", "Afternoon", "4–5 pm"]]
    : [["matin", "Morning", "8–9 h"], ["midi", "Midday", "12–14 h"], ["aprem", "Afternoon", "16–17 h"]]
}
export const weekday = (ms) => new Date(ms).toLocaleDateString(isFR() ? "en-GB" : L.locale, { weekday: "short" })
