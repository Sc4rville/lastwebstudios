/**
 * phone.ts — phone numbers, every country: spotting them in a text and normalising them.
 *
 * Before (2026-11), the lead engine only recognised "0X XX XX XX XX" (FR/BE/CH): an American prospect
 * ("(207) 555-0142"), a British one ("020 7946 0000") or an Australian one ("0412 345 678") had "no phone",
 * and the reachability gate dropped it. Accepted formats: E.164 ("+1 555 010 4242", "+44 20 7946 0000"), the North
 * American plan (NANP: US/CA, 10 digits with or without parentheses), the United Kingdom (0 + 9-10 digits), Australia
 * (0 + 9 digits), and the historical French/Belgian/Swiss format. A FR number is returned as written ("03 53 01 24 68").
 */

/** The patterns, most precise first (one number per call: `findPhone`). */
const PATTERNS: RegExp[] = [
  /(?:\+33\s?|\b0)[1-9](?:[\s.-]?\d{2}){4}\b/, // FR : 0X XX XX XX XX · +33 X XX XX XX XX
  /(?:\+32\s?|\+41\s?)(?:\(?0\)?\s?)?[1-9](?:[\s.-]?\d{1,3}){3,4}\b/, // BE · CH international
  /(?:\+1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?[2-9]\d{2}[\s.-]?\d{4}\b/, // NANP (US · CA) : (207) 555-0142 · 207.555.0142 · +1 207 555 0142
  /(?:\+44\s?\(?0?\)?|\b0)(?:1\d{2,3}|2\d|3\d{2}|7\d{3}|8\d{2})[\s-]?\d{3,4}[\s-]?\d{3,4}\b/, // UK : 020 7946 0000 · 0161 496 0000 · 07700 900000
  /(?:\+61\s?\(?0?\)?|\b0)(?:[2378][\s-]?\d{4}[\s-]?\d{4}|4\d{2}[\s-]?\d{3}[\s-]?\d{3})\b/, // AU : 0412 345 678 (mobile) · 0X XXXX XXXX (landline)
  /\+\d{1,3}(?:[\s.-]?\(?\d{1,4}\)?){2,5}\b/, // generic E.164 (other countries), at least 8 digits, checked below
]

const digits = (s: string) => s.replace(/\D/g, "")

/** The first plausible number in a text (8 to 15 digits), or undefined. */
export function findPhone(text: string): string | undefined {
  for (const re of PATTERNS) {
    const m = re.exec(text)
    if (!m) continue
    const d = digits(m[0])
    if (d.length >= 8 && d.length <= 15) return m[0].trim()
  }
  return undefined
}

/** Every plausible number in a text (deduplicated on their digits). */
export function findPhones(text: string): string[] {
  const out: string[] = [], seen = new Set<string>()
  for (const re of PATTERNS) {
    for (const m of text.matchAll(new RegExp(re.source, "g"))) {
      const d = digits(m[0])
      if (d.length < 8 || d.length > 15 || seen.has(d)) continue
      seen.add(d); out.push(m[0].trim())
    }
  }
  return out
}

/** Does a text contain a number? (audit: "phone visible as text") */
export const hasPhone = (text: string): boolean => findPhone(text) !== undefined

/** Digits only, international prefix kept ("+1 555 010 4242" → "+15550104242", "03 53 01 24 68" → "0353012468"). */
export function normalizePhone(raw: string): string {
  const s = raw.trim()
  const d = digits(s)
  return s.startsWith("+") ? `+${d}` : d
}
