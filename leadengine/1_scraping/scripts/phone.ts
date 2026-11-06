/**
 * phone.ts — numéros de téléphone, tous pays : repérage dans un texte et normalisation.
 *
 * Avant (2026-11), le lead engine ne reconnaissait que « 0X XX XX XX XX » (FR/BE/CH) : un prospect américain
 * (« (207) 555-0142 »), britannique (« 020 7946 0000 ») ou australien (« 0412 345 678 ») n'avait « aucun téléphone »,
 * et le gate de joignabilité le jetait. Formats acceptés : E.164 (« +1 555 010 4242 », « +44 20 7946 0000 »), plan
 * nord-américain (NANP : US/CA, 10 chiffres avec ou sans parenthèses), Royaume-Uni (0 + 9-10 chiffres), Australie
 * (0 + 9 chiffres), et le format français/belge/suisse historique. Un numéro FR reste rendu tel quel (« 03 53 01 24 68 »).
 */

/** Les motifs, du plus précis au plus général (un seul numéro par appel : `findPhone`). */
const PATTERNS: RegExp[] = [
  /(?:\+33\s?|\b0)[1-9](?:[\s.-]?\d{2}){4}\b/, // FR : 0X XX XX XX XX · +33 X XX XX XX XX
  /(?:\+32\s?|\+41\s?)(?:\(?0\)?\s?)?[1-9](?:[\s.-]?\d{1,3}){3,4}\b/, // BE · CH internationaux
  /(?:\+1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?[2-9]\d{2}[\s.-]?\d{4}\b/, // NANP (US · CA) : (207) 555-0142 · 207.555.0142 · +1 207 555 0142
  /(?:\+44\s?\(?0?\)?|\b0)(?:1\d{2,3}|2\d|3\d{2}|7\d{3}|8\d{2})[\s-]?\d{3,4}[\s-]?\d{3,4}\b/, // UK : 020 7946 0000 · 0161 496 0000 · 07700 900000
  /(?:\+61\s?\(?0?\)?|\b0)(?:[2378][\s-]?\d{4}[\s-]?\d{4}|4\d{2}[\s-]?\d{3}[\s-]?\d{3})\b/, // AU : 0412 345 678 (mobile) · 0X XXXX XXXX (fixe)
  /\+\d{1,3}(?:[\s.-]?\(?\d{1,4}\)?){2,5}\b/, // E.164 générique (autres pays), au moins 8 chiffres vérifiés ci-dessous
]

const digits = (s: string) => s.replace(/\D/g, "")

/** Le premier numéro plausible d'un texte (8 à 15 chiffres), ou undefined. */
export function findPhone(text: string): string | undefined {
  for (const re of PATTERNS) {
    const m = re.exec(text)
    if (!m) continue
    const d = digits(m[0])
    if (d.length >= 8 && d.length <= 15) return m[0].trim()
  }
  return undefined
}

/** Tous les numéros plausibles d'un texte (dédoublonnés sur leurs chiffres). */
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

/** Un texte contient-il un numéro ? (audit : « téléphone visible en texte ») */
export const hasPhone = (text: string): boolean => findPhone(text) !== undefined

/** Chiffres seuls, indicatif international gardé (« +1 555 010 4242 » → « +15550104242 », « 03 53 01 24 68 » → « 0353012468 »). */
export function normalizePhone(raw: string): string {
  const s = raw.trim()
  const d = digits(s)
  return s.startsWith("+") ? `+${d}` : d
}
