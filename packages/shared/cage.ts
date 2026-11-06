/**
 * cage.ts · LA CAGE 24/7, vue d'ensemble (fichiers + base partagée). Ce qui empêche la machine de faire des
 * dégâts quand personne ne regarde :
 *
 *   1. STOP        l'arrêt d'urgence. Deux sources, la première qui dit « stop » gagne :
 *                    · le fichier `STOP` à la racine (machine locale, ou la box en SSH : `echo raison > STOP`)
 *                    · le drapeau `cage.stop` de la base (posé par le bouton STOP du cockpit, vu par la box)
 *                  Lus par le worker (sort en ≤ 1 tick, tue l'agent en cours), le séquenceur et le warmup (ne
 *                  tickent pas) et le boost média (ne dépense rien).
 *   2. BUDGET      plafond $/jour + registre data/logs/spend.jsonl (cf. ./cage.mjs).
 *   3. DISJONCTEUR bounces / plaintes / désinscriptions au-dessus des seuils de funnel-strategy §6 → plus aucun
 *                  mail ne part, jusqu'au réarmement humain (cf. ./breaker.ts). État : base (`sequencer.breaker`,
 *                  visible du cockpit) + fichier data/sequencer/breaker.json (mode sans base).
 *   4. ENVOI       dry-run sauf config.dryRun === false ET LWS_LIVE_SEND=1 (cf. outreach/scripts/sequencer.ts).
 */
import { existsSync, readFileSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { tryDb, getMeta, setMeta } from "./db.ts"
import { stopFile, stopFileState, budgetStatus, type BudgetStatus } from "./cage.mjs"
import type { BreakerState } from "./breaker.ts"

export { stopFile, stopFileState, budgetStatus, jobBudgetUsd, recordSpend, readSpend, mediaGate, budgetConfig } from "./cage.mjs"

export const STOP_META = "cage.stop"
export const BREAKER_META = "sequencer.breaker"
export const BREAKER_FILE = "data/sequencer/breaker.json"
const SEQ_CONFIG = "outreach/sequencer/config.json"

export type StopState = { on: boolean; reason: string; since: string | null; source: "fichier" | "cockpit" | null; by?: string | null }

/** L'arrêt d'urgence, fichier d'abord (le plus fort : posé à la main sur la machine), puis la base. */
export async function stopState(env: NodeJS.ProcessEnv = process.env): Promise<StopState> {
  const f = stopFileState(env)
  if (f.on) return { on: true, reason: f.reason, since: f.since, source: "fichier" }
  if (tryDb()) {
    try {
      const raw = await getMeta(STOP_META)
      const v = raw ? JSON.parse(raw) : null
      if (v?.on) return { on: true, reason: String(v.reason || "STOP posé depuis le cockpit"), since: v.at || null, source: "cockpit", by: v.by || null }
    } catch { /* méta illisible : on ne bloque pas sur un JSON cassé */ }
  }
  return { on: false, reason: "", since: null, source: null }
}

/**
 * Pose / lève le STOP depuis le cockpit. Avec une base : le drapeau partagé (la box le voit). Sans base (tout sur
 * une machine) : le fichier STOP lui-même. Lever retire aussi le fichier local s'il existe.
 */
export async function setStop(on: boolean, reason = "", by = "cockpit", env: NodeJS.ProcessEnv = process.env): Promise<StopState> {
  const at = new Date().toISOString()
  const why = reason.replace(/[\r\n]+/g, " ").trim().slice(0, 200)
  if (tryDb()) {
    await setMeta(STOP_META, JSON.stringify({ on, reason: why, by, at }))
    if (!on && existsSync(stopFile(env))) await rm(stopFile(env), { force: true })
  } else if (on) {
    await writeFile(stopFile(env), `${why || "STOP posé depuis le cockpit"}\n`)
  } else {
    await rm(stopFile(env), { force: true })
  }
  return stopState(env)
}

/** L'état du disjoncteur : la base (vue partagée) d'abord, puis le fichier local du séquenceur. null = jamais évalué. */
export async function loadBreaker(): Promise<BreakerState | null> {
  if (tryDb()) {
    try { const raw = await getMeta(BREAKER_META); if (raw) return JSON.parse(raw) as BreakerState } catch { /* repli fichier */ }
  }
  try { if (existsSync(BREAKER_FILE)) return JSON.parse(await readFile(BREAKER_FILE, "utf8")) as BreakerState } catch { /* illisible */ }
  return null
}

export async function saveBreaker(s: BreakerState): Promise<void> {
  await mkdir(dirname(BREAKER_FILE), { recursive: true })
  await writeFile(BREAKER_FILE, JSON.stringify(s, null, 2) + "\n")
  if (tryDb()) { try { await setMeta(BREAKER_META, JSON.stringify(s)) } catch { /* best-effort : le fichier fait foi en local */ } }
}

export type SendModeView = { mode: "dry-run" | "réel"; detail: string }

/** Le mode d'envoi tel que la CONFIG le déclare (la seconde clé, LWS_LIVE_SEND, vit sur la machine du séquenceur). */
export function sendModeView(env: NodeJS.ProcessEnv = process.env): SendModeView {
  let dry: unknown = true
  try { dry = JSON.parse(readFileSync(SEQ_CONFIG, "utf8")).dryRun } catch { /* pas de config : dry-run */ }
  if (dry !== false) return { mode: "dry-run", detail: "config.dryRun absent ou true : aucun mail ne part" }
  return env.LWS_LIVE_SEND === "1"
    ? { mode: "réel", detail: "config.dryRun:false + LWS_LIVE_SEND=1 : les mails partent" }
    : { mode: "dry-run", detail: "config.dryRun:false mais LWS_LIVE_SEND=1 absent ici : le séquenceur refuse d'envoyer sans les deux clés" }
}

export type CageStatus = { at: string; stop: StopState; budget: BudgetStatus; breaker: BreakerState | null; send: SendModeView; alerts: string[] }

/** Tout l'état de la cage pour le bandeau du cockpit et la vue Machine. `alerts` vide = rien d'anormal. */
export async function cageStatus(env: NodeJS.ProcessEnv = process.env, now = new Date().toISOString()): Promise<CageStatus> {
  const [stop, breaker] = await Promise.all([stopState(env), loadBreaker()])
  const budget = budgetStatus(now, env)
  const send = sendModeView(env)
  const alerts: string[] = []
  if (stop.on) alerts.push("stop")
  if (breaker?.open) alerts.push("breaker")
  if (budget.reached) alerts.push("budget")
  return { at: now, stop, budget, breaker, send, alerts }
}
