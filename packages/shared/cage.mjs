/**
 * cage.mjs · LA CAGE 24/7, partie « fichiers » (aucune base, aucun réseau) : l'arrêt d'urgence STOP et le
 * registre de dépense. Partagé par le TypeScript (worker, séquenceur, cockpit, warmup) et les scripts .mjs du
 * boost média (worker/openai-image.mjs, worker/hero-cli.mjs). La partie base (STOP posé depuis le cockpit,
 * disjoncteur partagé) est dans ./cage.ts.
 *
 *   STOP                      fichier à la racine du dépôt (le cwd des services). Tant qu'il existe : le worker
 *                             ne prend plus rien et s'arrête, le séquenceur et le warmup ne tickent pas, le boost
 *                             média ne dépense rien. Sa 1re ligne (optionnelle) = la raison. Autre chemin :
 *                             LWS_STOP_FILE. Poser : `echo "raison" > STOP` · lever : `rm STOP`.
 *   data/logs/spend.jsonl     une ligne par dépense : { at, day, kind, source, usd, estimated, billing, … }
 *                             kind = agent (claude -p du worker) | llm (skills) | image | video
 *   LWS_BUDGET_USD_DAY        plafond $ par jour UTC, toutes dépenses comprises (absent ou 0 : pas de plafond)
 *   LWS_JOB_MAX_USD           plafond $ d'UN job agent (passé en --max-budget-usd), borné par le reste du jour
 *   LWS_IMAGE_USD / LWS_VIDEO_USD   coût estimé d'une image / d'une vidéo, faute de prix renvoyé par le
 *                             fournisseur (défauts PRUDENTS, à caler sur ta facture : 0,25 $ et 1,50 $)
 *
 * Sur l'abonnement Claude (`claude -p` sur le plan), le coût d'un job est l'ESTIMATION de Claude Code
 * (`total_cost_usd`) : ce n'est pas de l'argent facturé mais du quota. Le registre le note (`billing: "plan"`)
 * et le plafond le compte quand même : c'est ce qui empêche une boucle de brûler la semaine de quota en une nuit.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs"
import { dirname } from "node:path"

export const STOP_FILE = "STOP"
export const SPEND_LOG = "data/logs/spend.jsonl"
export const SPEND_KINDS = ["agent", "llm", "image", "video"]
export const DEFAULT_IMAGE_USD = 0.25
export const DEFAULT_VIDEO_USD = 1.5

/** @param {Record<string, string | undefined>} env */
export function stopFile(env = process.env) { return env.LWS_STOP_FILE || STOP_FILE }

/**
 * L'arrêt d'urgence posé par FICHIER. Lecture synchrone et bon marché (appelée à chaque tick et pendant un job).
 * @returns {{ on: boolean, reason: string, since: string | null, source: "fichier" }}
 */
export function stopFileState(env = process.env) {
  const f = stopFile(env)
  if (!existsSync(f)) return { on: false, reason: "", since: null, source: "fichier" }
  let reason = "", since = null
  try { reason = readFileSync(f, "utf8").split("\n")[0].trim().slice(0, 200) } catch { /* illisible : STOP quand même */ }
  try { since = statSync(f).mtime.toISOString() } catch { /* */ }
  return { on: true, reason: reason || "fichier STOP présent", since, source: "fichier" }
}

export const utcDay = (iso = new Date().toISOString()) => String(iso).slice(0, 10)

/** @param {string | undefined} v */
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null }

/** @returns {{ capUsd: number | null, jobMaxUsd: number | null }} */
export function budgetConfig(env = process.env) {
  return { capUsd: num(env.LWS_BUDGET_USD_DAY), jobMaxUsd: num(env.LWS_JOB_MAX_USD) }
}

/** coût estimé d'un média (image/vidéo) quand le fournisseur ne renvoie pas de prix. @param {"image"|"video"} kind */
export function mediaCostUsd(kind, env = process.env) {
  return kind === "image" ? (num(env.LWS_IMAGE_USD) ?? DEFAULT_IMAGE_USD) : (num(env.LWS_VIDEO_USD) ?? DEFAULT_VIDEO_USD)
}

/**
 * Inscrit une dépense au registre (append-only). Jamais bloquant : un registre illisible ne casse pas un job.
 * @param {{ kind: string, source: string, usd: number, estimated?: boolean, billing?: string, at?: string, [k: string]: unknown }} e
 * @param {{ file?: string }} [o]
 */
export function recordSpend(e, o = {}) {
  const usd = Number(e.usd)
  if (!Number.isFinite(usd) || usd < 0) return null
  const at = e.at || new Date().toISOString()
  const entry = { ...e, at, day: utcDay(at), kind: SPEND_KINDS.includes(e.kind) ? e.kind : "llm", usd: Math.round(usd * 10000) / 10000 }
  const file = o.file || SPEND_LOG
  try { mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, JSON.stringify(entry) + "\n") } catch { return null }
  return entry
}

/** Les dépenses d'un jour UTC (toutes si `day` absent). @param {string} [day] @param {{ file?: string }} [o] */
export function readSpend(day, o = {}) {
  const file = o.file || SPEND_LOG
  if (!existsSync(file)) return []
  /** @type {any[]} */
  const out = []
  for (const l of readFileSync(file, "utf8").split("\n")) {
    if (!l.trim()) continue
    try { const e = JSON.parse(l); if (!day || e.day === day) out.push(e) } catch { /* ligne cassée : ignorée */ }
  }
  return out
}

/**
 * Où en est le budget du jour. `reached` = le plafond est atteint (aucun job ne doit être réclamé).
 * @param {string} [nowIso] @param {Record<string, string | undefined>} [env] @param {{ file?: string }} [o]
 */
export function budgetStatus(nowIso = new Date().toISOString(), env = process.env, o = {}) {
  const day = utcDay(nowIso)
  const entries = readSpend(day, o)
  /** @type {Record<string, number>} */
  const byKind = { agent: 0, llm: 0, image: 0, video: 0 }
  let spent = 0
  for (const e of entries) { const u = Number(e.usd) || 0; spent += u; byKind[e.kind] = (byKind[e.kind] || 0) + u }
  const round = (/** @type {number} */ n) => Math.round(n * 100) / 100
  const { capUsd, jobMaxUsd } = budgetConfig(env)
  const remaining = capUsd == null ? null : Math.max(0, capUsd - spent)
  const next = new Date(day + "T00:00:00.000Z"); next.setUTCDate(next.getUTCDate() + 1)
  return {
    day, spentUsd: round(spent), capUsd, jobMaxUsd, remainingUsd: remaining == null ? null : round(remaining),
    reached: capUsd != null && spent >= capUsd, resetsAt: next.toISOString(), entries: entries.length,
    byKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, round(v)])),
  }
}

/**
 * Le plafond $ à passer à `claude -p --max-budget-usd` pour un job : min(LWS_JOB_MAX_USD, reste du jour).
 * null = pas de plafond (ni budget du jour, ni plafond par job). 0 = budget épuisé (ne pas lancer).
 */
export function jobBudgetUsd(nowIso = new Date().toISOString(), env = process.env, o = {}) {
  const b = budgetStatus(nowIso, env, o)
  const caps = [b.jobMaxUsd, b.remainingUsd].filter((x) => x != null)
  if (!caps.length) return null
  return Math.max(0, Math.round(Math.min(...caps) * 100) / 100)
}

/**
 * Le boost média a-t-il le droit de dépenser ? Non si STOP, ou si le reste du budget ne couvre pas le coût
 * estimé du média. @param {"image"|"video"} kind
 * @returns {{ ok: boolean, why: string, costUsd: number }}
 */
export function mediaGate(kind, env = process.env, nowIso = new Date().toISOString(), o = {}) {
  const costUsd = mediaCostUsd(kind, env)
  const stop = stopFileState(env)
  if (stop.on) return { ok: false, why: `STOP (${stop.reason})`, costUsd }
  const b = budgetStatus(nowIso, env, o)
  if (b.remainingUsd != null && b.remainingUsd < costUsd) return { ok: false, why: `budget du jour atteint (${b.spentUsd} $ / ${b.capUsd} $)`, costUsd }
  return { ok: true, why: "", costUsd }
}
