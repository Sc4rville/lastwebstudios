/**
 * breaker.ts · LE DISJONCTEUR de délivrabilité (calcul pur, sans I/O : testable, partagé séquenceur + cockpit).
 *
 * La règle vient de `docs/funnel-strategy.md` §6 (« la discipline, sinon rien ») : liste vérifiée **bounce < 1 %**,
 * **plainte < 0,1 %**, et « rouge = pause immédiate ». Les désinscriptions n'ont pas de seuil écrit au §6 : 2 % est
 * le seuil retenu ici (au-delà, le ciblage ou le message déplaît ; réglable). Les valeurs vivent dans
 * `outreach/sequencer/config.json` → `breaker` (sinon les défauts ci-dessous).
 *
 * Calcul : sur une fenêtre glissante (7 j par défaut, et jamais avant le dernier réarmement), taux = évènements
 * / max(envois, minSends). Le plancher `minSends` (100) évite qu'UN bounce sur 3 envois coupe tout, mais garde
 * la sévérité voulue sur les plaintes : 1 plainte sur un petit volume = 1 % > 0,1 % → ouvert.
 *
 * VERROUILLÉ : une fois ouvert, il reste ouvert jusqu'à un réarmement HUMAIN (`npm run sequencer -- breaker
 * reset` ou le bouton du cockpit), même si la fenêtre glisse. Un voyant rouge se regarde, il ne s'éteint pas seul.
 */

export type BreakerThresholds = {
  windowDays: number
  minSends: number
  bounceRate: number
  complaintRate: number
  unsubRate: number
}

/** §6 : bounce < 1 %, plainte < 0,1 % ; désinscription : 2 % (pas de seuil écrit au §6). */
export const BREAKER_DEFAULTS: BreakerThresholds = { windowDays: 7, minSends: 100, bounceRate: 0.01, complaintRate: 0.001, unsubRate: 0.02 }

export type BreakerKind = "bounce" | "complaint" | "unsub"
export const BREAKER_KINDS: BreakerKind[] = ["bounce", "complaint", "unsub"]
const LABEL: Record<BreakerKind, string> = { bounce: "bounces", complaint: "plaintes", unsub: "désinscriptions" }
const LIMIT: Record<BreakerKind, keyof BreakerThresholds> = { bounce: "bounceRate", complaint: "complaintRate", unsub: "unsubRate" }

export type BreakerState = {
  open: boolean
  reasons: string[]
  openedAt: string | null
  resetAt: string | null
  evaluatedAt: string
  since: string
  counts: { sends: number; bounce: number; complaint: number; unsub: number }
  rates: { bounce: number; complaint: number; unsub: number }
  thresholds: BreakerThresholds
}

export function breakerThresholds(cfg?: Partial<BreakerThresholds> | null): BreakerThresholds {
  const t = { ...BREAKER_DEFAULTS }
  for (const k of Object.keys(t) as (keyof BreakerThresholds)[]) {
    const v = Number(cfg?.[k])
    if (cfg && cfg[k] !== undefined && Number.isFinite(v) && v >= 0) t[k] = v
  }
  return t
}

const pct = (x: number) => `${(Math.round(x * 1000) / 10).toLocaleString("fr-FR")} %`

/**
 * Évalue le disjoncteur. `sends` = les envois (réels ou simulés : en dry-run, des évènements synthétiques doivent
 * ouvrir le disjoncteur comme en réel), `events` = bounces / plaintes / désinscriptions horodatés.
 */
export function evaluateBreaker(input: {
  sends: { at: string }[]
  events: { type: string; at: string }[]
  now: string
  prev?: BreakerState | null
  thresholds?: Partial<BreakerThresholds> | null
}): BreakerState {
  const t = breakerThresholds(input.thresholds)
  const windowStart = new Date(new Date(input.now).getTime() - t.windowDays * 86_400_000).toISOString()
  const resetAt = input.prev?.resetAt ?? null
  const since = resetAt && resetAt > windowStart ? resetAt : windowStart
  const inWin = (at: string) => typeof at === "string" && at >= since && at <= input.now
  const sends = input.sends.filter((s) => inWin(s.at)).length
  const counts = { sends, bounce: 0, complaint: 0, unsub: 0 }
  for (const e of input.events) if ((BREAKER_KINDS as string[]).includes(e.type) && inWin(e.at)) counts[e.type as BreakerKind]++
  const denom = Math.max(sends, t.minSends, 1)
  const rates = { bounce: counts.bounce / denom, complaint: counts.complaint / denom, unsub: counts.unsub / denom }
  const reasons: string[] = []
  for (const k of BREAKER_KINDS) {
    const limit = t[LIMIT[k]] as number
    if (rates[k] > limit) reasons.push(`${LABEL[k]} ${counts[k]} / ${sends} envoi(s) sur ${t.windowDays} j = ${pct(rates[k])} > ${pct(limit)}`)
  }
  const latched = input.prev?.open === true
  const open = latched || reasons.length > 0
  return {
    open,
    reasons: latched ? [...new Set([...(input.prev?.reasons ?? []), ...reasons])] : reasons,
    openedAt: latched ? input.prev?.openedAt ?? input.now : open ? input.now : null,
    resetAt,
    evaluatedAt: input.now,
    since,
    counts,
    rates,
    thresholds: t,
  }
}

/** Le réarmement humain : fermé, et la fenêtre repart de maintenant (les incidents d'avant ne comptent plus). */
export function resetBreaker(prev: BreakerState | null, now: string): BreakerState {
  const t = prev?.thresholds ?? BREAKER_DEFAULTS
  return {
    open: false, reasons: [], openedAt: null, resetAt: now, evaluatedAt: now, since: now,
    counts: { sends: 0, bounce: 0, complaint: 0, unsub: 0 }, rates: { bounce: 0, complaint: 0, unsub: 0 }, thresholds: t,
  }
}
