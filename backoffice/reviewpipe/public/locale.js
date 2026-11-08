// locale.js · how the cockpit writes phones, addresses, dates, money and people, by the agency's country.
// One small helper used by Prospects, Sites, Outreach and Billing. The data stays what it is (a French cast stays
// French); the chrome follows the agency.
// until the agency is known : neutral (the browser's language, no country), never another country's dates ; every
// render that writes a date keys on L.locale + L.timezone, so it is rewritten once the agency arrives
export const L = { country: "", locale: (typeof navigator !== "undefined" && navigator.language) || "en-US", currency: "USD", timezone: undefined }
export function setLocale(a) { if (!a) return; L.country = String(a.country || L.country || "").toUpperCase(); L.locale = a.locale || L.locale; L.currency = a.currency || L.currency; L.timezone = a.timezone || undefined }
export const isFR = () => L.country === "FR"
const US_STATES = { alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY" }
/** "Portland, ME 04101" for the US, "Valmont-sur-Lys" for France, "City, Region ZIP" elsewhere. */
export function place(city, region, zip) {
  city = city || ""; region = region || ""; zip = zip || ""
  // the PROSPECT's place decides the shape: a US state is written « Austin, TX 78704 » whatever the agency's country
  const usState = US_STATES[region.toLowerCase()] || (/^[A-Z]{2}$/.test(region) && Object.values(US_STATES).includes(region) ? region : "")
  if (L.country === "US" || usState) { const st = usState || (region.length === 2 ? region.toUpperCase() : region); return [city, [st, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") }
  if (isFR()) return [zip, city].filter(Boolean).join(" ")
  return [city, region, zip].filter(Boolean).join(", ")
}
/** phone as the owner reads it: (555) 010-1234 in the US, 01 99 00 41 52 in France; unknown shapes untouched.
 *  The NUMBER's own shape decides first (a US « (512) 555-0126 » is never regrouped the French way, even before the
 *  agency's country is known), the agency's country only for a bare string of digits. */
export function phone(raw) {
  const s = String(raw || "").trim(); if (!s) return ""
  const d = s.replace(/\D/g, "")
  const nanp = /^\+1[\s.-]?/.test(s) || /^\(?\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}$/.test(s)
  const french = /^\+33/.test(s) || /^0\d([\s.]?\d{2}){4}$/.test(s)
  if (nanp) { const n = d.length === 11 && d[0] === "1" ? d.slice(1) : d; return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : s }
  if (french) { const n = d.length === 11 && d.startsWith("33") ? "0" + d.slice(2) : d; return n.length === 10 ? n.replace(/(\d{2})(?=\d)/g, "$1 ").trim() : s }
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
// every date and hour is written in the AGENCY's time zone (a meeting booked from a laptop in another zone never lands
// at the wrong hour) ; an unknown zone falls back to the browser's
const tz = () => { try { if (L.timezone) { new Intl.DateTimeFormat("en-US", { timeZone: L.timezone }); return { timeZone: L.timezone } } } catch { /* */ } return {} }
export function date(ms, o = {}) { if (!ms) return ""; return new Date(ms).toLocaleDateString(isFR() ? "en-GB" : L.locale, { day: "numeric", month: "short", ...tz(), ...o }) }
export function time(ms) { if (!ms) return ""; return new Date(ms).toLocaleTimeString(isFR() ? "en-GB" : L.locale, { hour: "numeric", minute: "2-digit", hour12: hour12(), ...tz() }) }
export function dateTime(ms) { if (!ms) return ""; return new Date(ms).toLocaleString(isFR() ? "en-GB" : L.locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: hour12(), ...tz() }) }
/** the wall clock of `ms` in the agency's zone : { y, m (1-12), d, h, min, wd (0 = Sunday) } */
export function wall(ms) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short", hour12: false, ...tz() }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), h: Number(parts.hour) % 24, min: Number(parts.minute), wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday) }
}
/** the instant at which the agency's wall clock reads y-m-d h:min (DST-safe : corrected once) */
export function zoned(y, m, d, h, min = 0) {
  const want = Date.UTC(y, m - 1, d, h, min)
  let t = want
  for (let i = 0; i < 2; i++) { const w = wall(t); t += want - Date.UTC(w.y, w.m - 1, w.d, w.h, w.min) }
  return t
}
/** « 2026-11-09T10:00 » (a datetime-local value) for `ms` in the agency's zone, and back */
export const toLocalInput = (ms) => { const w = wall(ms), p = (n) => String(n).padStart(2, "0"); return `${w.y}-${p(w.m)}-${p(w.d)}T${p(w.h)}:${p(w.min)}` }
export const fromLocalInput = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(v || "")); return m ? zoned(+m[1], +m[2], +m[3], +m[4], +m[5]) : 0 }
/** call-time slots, named for the owner: 8–9 am / 12–2 pm / 4–5 pm, or 8h–9h in France */
export function slots() {
  return hour12()
    ? [["matin", "Morning", "8–9 am"], ["midi", "Midday", "12–2 pm"], ["aprem", "Afternoon", "4–5 pm"]]
    : [["matin", "Morning", "8–9 h"], ["midi", "Midday", "12–14 h"], ["aprem", "Afternoon", "16–17 h"]]
}
/** the short name of the agency's time zone at `ms` (« EST », « CET »), the one the meeting chips are in */
export function zoneName(ms = Date.now()) { try { return new Intl.DateTimeFormat(isFR() ? "en-GB" : L.locale, { timeZoneName: "short", ...tz() }).formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName")?.value || "" } catch { return "" } }
export const weekday = (ms, w = "short") => new Date(ms).toLocaleDateString(isFR() ? "en-GB" : L.locale, { weekday: w, ...tz() })
