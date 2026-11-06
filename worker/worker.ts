/**
 * worker.ts — LE WORKER (maillon « génération autonome », côté box).
 *
 * Tourne EN DAEMON sur la box (Hetzner), à côté du cockpit. Le cockpit (conteneur Coolify) ne peut pas
 * générer lui-même (pas de Claude Code, pas de navigateurs Playwright) : il EMPILE des demandes dans la
 * file `batch_requests` (Supabase). Ce worker les DÉPILE et fait le vrai travail :
 *
 *   1. claim atomique du plus vieux job en attente (FOR UPDATE SKIP LOCKED)
 *   2. génération :
 *        · mode 'composer'      → `claude -p` (Claude Code headless) lit `worker/compose-worker.md` et
 *          orchestre lead-engine + compose-batch (sur-mesure premium). ⇒ tourne SUR LE PLAN (plan-first),
 *          via CLAUDE_CODE_OAUTH_TOKEN — PAS l'API. C'est la voie principale.
 *        · mode 'template-fill' → `npm run pipeline` (template poliform, cheap, API). Voie secondaire.
 *   3. reindexAll() → les sites bâtis apparaissent dans le cockpit (catalogue Supabase partagé)
 *   4. marque le job done / error, journalise.
 *
 * LA CAGE 24/7 (packages/shared/cage.ts) :
 *   · STOP (fichier `STOP` à la racine, ou bouton du cockpit) : plus aucun job pris ; l'agent en cours est
 *     interrompu, son job remis en file ; le worker SORT (code 3, que l'unité systemd ne relance pas).
 *     Reprendre : lever le STOP puis `systemctl --user restart lws-worker`.
 *   · budget $/jour (LWS_BUDGET_USD_DAY) : atteint ⇒ aucun job réclamé jusqu'à minuit UTC. Chaque agent reçoit
 *     `--max-budget-usd` = min(LWS_JOB_MAX_USD, reste du jour). Chaque job inscrit sa dépense (estimation de
 *     Claude Code) au registre data/logs/spend.jsonl, à côté des crédits image/vidéo du boost.
 *
 * PRÉREQUIS sur la box (cf. worker/setup-box.sh) : Node, Claude Code (`claude setup-token` → plan),
 * Playwright + navigateurs, `.env` avec DATABASE_URL (pooler Supabase). Un seul job à la fois par worker.
 *
 * Usage : npm run worker   (ou via systemd : lws-worker.service)
 */
import { spawn, execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { readdirSync, existsSync, writeFileSync, rmSync, statSync } from "node:fs"
import { hostname } from "node:os"
import { join } from "node:path"
import {
  claimNextBatch, getBatch, markBatchDone, markBatchError, appendBatchLog, reclaimStaleBatches, requeueBatch, type BatchRow,
} from "../packages/shared/batch.ts"
import { reindexAll, pruneGeneration } from "../packages/shared/reindex.ts"
import { closeDb, setMeta } from "../packages/shared/db.ts"
import { syncTree, storageReady } from "../packages/shared/storage.ts"
import { composerPrompt, editPrompt, researchPrompt } from "./prompts.ts"
import { composerDirs, markBuilding, settleBuilding, reapIncomplete as reapMarked } from "./building.ts"
import { readableEvent } from "../packages/llm/stream-events.ts"
import { planEnv, bareRisk } from "../packages/llm/adapters/claude-code.ts"
import { claudeAuth } from "../packages/llm/claude-code-status.ts"
import { coachModel } from "../packages/llm/models.ts"
import { workerClaudeArgs } from "./claude-args.ts"
import { stopState, budgetStatus, jobBudgetUsd, recordSpend } from "../packages/shared/cage.ts"
import { lineSplitter } from "../packages/shared/lines.mjs"

try { process.loadEnvFile() } catch { /* pas de .env : on lit l'environnement (DATABASE_URL, token plan) */ }

if (!process.env.DATABASE_URL) {
  console.error("✗ DATABASE_URL manquant — pose-le dans .env (pooler Supabase, cf. docs/DEPLOY.md).")
  process.exit(1)
}

const WORKER_ID = `${process.env.WORKER_NAME || hostname()}#${process.pid}`
const POLL_MS = Number(process.env.WORKER_POLL_MS) || 15_000
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude"
// Arguments des agents (`--allowedTools …`, noms d'outils à jour) : ./claude-args.ts. Surchargeable : WORKER_CLAUDE_ARGS.
const CLAUDE_ARGS = workerClaudeArgs()
// à quelle fréquence l'agent en cours vérifie l'arrêt d'urgence (fichier + base)
const STOP_POLL_MS = Number(process.env.WORKER_STOP_POLL_MS) || 5_000
/** Code de sortie sur STOP : l'unité systemd porte `RestartPreventExitStatus=3` (pas de relance en boucle). */
const STOP_EXIT_CODE = 3

// `--bare` (qui deviendra le défaut de `-p` dans une future version de Claude Code) ne lit NI le login du plan
// NI CLAUDE_CODE_OAUTH_TOKEN, et ne charge NI les skills NI CLAUDE.md : le composer échouerait à chaque job.
// On refuse de démarrer plutôt que d'échouer job après job.
const BARE = bareRisk(CLAUDE_ARGS)
if (BARE) {
  console.error(`✗ ${BARE} : Claude Code n'y lit ni le login du plan ni CLAUDE_CODE_OAUTH_TOKEN, ni les skills du dépôt.`)
  console.error("  Retire-le (WORKER_CLAUDE_ARGS / CLAUDE_CODE_SIMPLE). Si une version de Claude Code l'impose par défaut, épingle la version précédente (cf. npm run doctor).")
  process.exit(1)
}

// plan-first : les agents tournent sur le plan. On RETIRE ANTHROPIC_API_KEY de leur environnement (en -p, Claude
// Code utilise toujours une clé API présente AVANT le plan → facturation API, ou échec si la clé est morte).
// WORKER_PLAN_STRICT=0 garde la clé (ancien comportement : agents facturés à l'API si une clé est posée).
const agentEnv = (extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  process.env.WORKER_PLAN_STRICT === "0" ? { ...process.env, ...extra } : { ...planEnv(process.env), ...extra }

// qui paie les agents : le plan (clé API retirée de leur env, défaut) ou l'API (WORKER_PLAN_STRICT=0 + clé)
const BILLING = process.env.WORKER_PLAN_STRICT === "0" && process.env.ANTHROPIC_API_KEY ? "api" : "plan"

let stopping = false
process.on("SIGTERM", () => { stopping = true })
process.on("SIGINT", () => { stopping = true })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Les prompts (composer / édition / recherche) sont construits dans ./prompts.ts : le texte venu d'un humain
// (commentaire) y est injecté DÉLIMITÉ comme donnée, les paramètres de batch validés (F-1).

// readableEvent (stream-json → une ligne lisible) : packages/llm/stream-events.ts, partagé avec first-site.

/** Lance une commande, relaie stdout/stderr dans le journal du batch. `translate` = transforme chaque
 * ligne (ex: stream-json → lisible) ; renvoie "" pour ignorer une ligne. Résout le code de sortie. */
type RunResult = { code: number; limited: boolean; resetText: string; tokens: number; costUsd: number; stopped: boolean; budgetHit: boolean }

function runStreamed(
  cmd: string, args: string[], env: NodeJS.ProcessEnv, batchId: number, stdin?: string,
  translate?: (line: string) => string,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: process.cwd(), env, stdio: ["pipe", "pipe", "pipe"] })
    // ARRÊT D'URGENCE pendant le job : STOP posé → on interrompt l'agent (SIGTERM, puis SIGKILL après 10 s)
    let stopped = false, budgetHit = false
    const stopWatch = setInterval(async () => {
      if (stopped) return
      const st = await stopState().catch(() => null)
      if (!st?.on) return
      stopped = true
      appendBatchLog(batchId, `⏹ STOP (${st.source} : ${st.reason}) : agent interrompu, job remis en file`)
      try { child.kill("SIGTERM") } catch { /* déjà parti */ }
      setTimeout(() => { try { child.kill("SIGKILL") } catch { /* */ } }, 10_000).unref()
    }, STOP_POLL_MS)
    let tail = "" // throttle : on n'écrit pas CHAQUE ligne en DB (trop d'UPDATE), on agrège un peu
    let flush: ReturnType<typeof setTimeout> | null = null
    let limited = false, resetText = "" // limite de session du plan détectée ?
    let tokens = 0, costUsd = 0 // MESURE RÉELLE : l'évènement `result` de claude -p porte l'usage + le coût $ (cumul session, sous-agents inclus)
    const onLine = (raw: string) => {
      if (/(session|usage) limit|hit your (session|usage) limit/i.test(raw)) { limited = true; resetText = raw }
      if (/max[_ -]?budget/i.test(raw)) budgetHit = true // l'agent a touché son --max-budget-usd
      if (raw.includes('"type":"result"')) {
        try { const j = JSON.parse(raw); if (j.type === "result") {
          const u = j.usage || {}; tokens = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
          if (typeof j.total_cost_usd === "number") costUsd = j.total_cost_usd
        } } catch { /* ligne pas JSON */ }
      }
      const line = translate ? translate(raw) : raw
      if (!line) return // ligne filtrée (bruit)
      console.log(`[batch ${batchId}] ${line}`)
      tail += line + "\n"
      if (!flush) flush = setTimeout(() => { const t = tail; tail = ""; flush = null; appendBatchLog(batchId, t.trimEnd()) }, 1200)
    }
    // une ligne (et un caractère UTF-8) coupée entre deux lectures du tube est recollée : sinon l'évènement `result`
    // à cheval sur deux morceaux est perdu, et sa dépense avec (registre de la cage sous-compté)
    const nonEmpty = (l: string) => { if (l) onLine(l) }
    const out = lineSplitter(nonEmpty), errLines = lineSplitter(nonEmpty)
    child.stdout?.on("data", (buf: Buffer) => out.push(buf))
    child.stderr?.on("data", (buf: Buffer) => { if (!translate) errLines.push(buf) }) // en mode stream-json, stderr = bruit
    child.on("error", (e) => { clearInterval(stopWatch); appendBatchLog(batchId, `✗ spawn ${cmd}: ${e.message}`); resolve({ code: -1, limited, resetText, tokens, costUsd, stopped, budgetHit }) })
    child.on("close", (code) => {
      clearInterval(stopWatch)
      out.end(); errLines.end()
      if (flush) { clearTimeout(flush); appendBatchLog(batchId, tail.trimEnd()) }
      resolve({ code: code ?? -1, limited, resetText, tokens, costUsd, stopped, budgetHit })
    })
    if (stdin !== undefined) { child.stdin?.write(stdin); child.stdin?.end() }
  })
}

/** Tous les sites composer qui ont un index.html (clé "id/dir") — pour repérer les NOUVEAUX d'un batch. */
function composerSites(): Set<string> {
  const out = new Set<string>()
  const base = "output/sites"
  if (!existsSync(base)) return out
  for (const id of readdirSync(base)) {
    let dates: string[] = []
    try { dates = readdirSync(join(base, id)) } catch { continue }
    for (const d of dates) if (/-composer$/.test(d) && existsSync(join(base, id, d, "index.html"))) out.add(`${id}/${d}`)
  }
  return out
}

/** Pousse les médias d'un site composé vers le bucket Storage (local, VM et salesport lisent la même
 *  source — fini le rsync, et la VM sert enfin les hero.mp4 gitignorés). Marqueur `.storaged` → idempotent. */
async function storageSync(site: string): Promise<void> {
  if (!storageReady()) return // pas de clé → on reste FS-only (zéro régression)
  const [id, date] = site.split("/")
  const dir = join("output", "sites", id, date)
  const marker = join(dir, ".storaged")
  if (existsSync(marker)) return
  // RÉSILIENT : un upload flaky ne doit pas laisser un site invisible en silence → 3 essais, puis on
  // LOGUE FORT (pas un warning noyé). Le marqueur `.storaged` n'est posé qu'en cas de succès → un échec
  // sera repris au prochain storageBackfill (démarrage) ou healStuckSites (idle).
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const n = await syncTree(dir, `sites/${id}/${date}`)
      writeFileSync(marker, ""); if (n > 0) console.log(`☁️  ${site} → bucket (${n} fichiers)`)
      return
    } catch (e) {
      console.warn(`storageSync ${site} (essai ${attempt}/3): ${(e as Error).message}`)
      if (attempt < 3) await sleep(2000)
      else console.error(`🚨 storageSync ${site} ÉCHEC après 3 essais — site PAS dans le bucket (sera repris au backfill)`)
    }
  }
}

/** Backfill : pousse vers le bucket tous les sites composer pas encore syncés (au démarrage du worker).
 *  Idempotent (marqueur `.storaged`) → la première boucle migre l'existant, les suivantes ne refont rien. */
async function storageBackfill(): Promise<void> {
  if (!storageReady()) return
  const sites = [...composerSites()].filter((s) => !existsSync(join("output", "sites", ...s.split("/"), ".storaged")))
  if (!sites.length) return
  console.log(`☁️  backfill Storage : ${sites.length} site(s) à pousser…`)
  for (const s of sites) await storageSync(s)
}

/** Reap : supprime les chantiers composer INTERROMPUS, c'est-à-dire seulement les dossiers que le worker a
 *  lui-même marqués `.lws-building` (cf. ./building.ts), restés sans index.html ni `.reviewing`, marqueur
 *  immobile depuis 15 min. Un dossier non marqué (versionné, d'une autre machine) n'est JAMAIS supprimé.
 *  Purge aussi la ligne en base. Lancé quand le worker est idle. */
async function reapIncomplete(): Promise<number> {
  return (await reapMarked(join("output", "sites"), { prune: pruneGeneration })).length
}

/** Heal : SYMÉTRIQUE de reapIncomplete. Un site composé (index.html présent) mais resté coincé en
 *  `.reviewing` = finalisation du coach INTERROMPUE (worker tué, limite de session, upload flaky). Or le
 *  reindex re-gate tout site avec `.reviewing` (present=0) → le site fini devient INVISIBLE au cockpit, sans
 *  alerte (le bug stylroc du 22/06). Si `.reviewing` est VIEUX (le coach ne dépasse jamais ~15 min), on
 *  conclut à une finalisation morte → on PUBLIE : retire `.reviewing` + (re)pousse au bucket. « un site fini
 *  ne doit JAMAIS rester invisible ». Lancé à l'idle, comme reapIncomplete. */
async function healStuckSites(): Promise<number> {
  const base = "output/sites"; if (!existsSync(base)) return 0
  const STUCK_MS = 15 * 60 * 1000
  let n = 0
  for (const id of readdirSync(base)) {
    let dates: string[] = []; try { dates = readdirSync(join(base, id)) } catch { continue }
    for (const d of dates) {
      if (!/-composer$/.test(d)) continue
      const dir = join(base, id, d), rev = join(dir, ".reviewing")
      if (!existsSync(join(dir, "index.html")) || !existsSync(rev)) continue
      let age = Infinity; try { age = Date.now() - statSync(rev).mtimeMs } catch { /* */ }
      if (age < STUCK_MS) continue                              // coach probablement en cours → on laisse
      try { rmSync(rev, { force: true }) } catch { /* */ }       // finalisation morte → on publie
      try { await storageSync(`${id}/${d}`) } catch { /* */ }    // garantir que le bucket a le site
      console.log(`🩹 heal: ${id}/${d} débloqué (.reviewing vieux de ${Math.round(age / 60000)} min)`)
      n++
    }
  }
  return n
}

/** Le métier d'un prospect (pour que le coach lise le bon playbook). */
async function siteIndustry(id: string): Promise<string> {
  try { const p = JSON.parse(await readFile(join("data", "prospects", `${id}.json`), "utf8")); return p.industry || "" } catch { return "" }
}

/** GARDE post-composition : le coach (worker/coach.mjs) regarde le rendu SERVI d'un site et boucle ses
 *  correctifs au composer. Sa sortie est streamée au journal du batch préfixée « 🔎 coach » → le cockpit
 *  détecte la phase coach (jauge violette). Ne casse jamais le batch (erreurs avalées). */
function runCoach(batchId: number, id: string, date: string, industry: string): Promise<void> {
  return new Promise((resolve) => {
    const args = ["worker/coach.mjs", id, date]
    if (industry) args.push("--industry", industry)
    // le coach lance lui-même `claude -p` (plan) : modèle du rôle smart (packages/llm/models.ts), sauf COACH_MODEL
    const child = spawn("node", args, { cwd: process.cwd(), env: { ...process.env, COACH_MODEL: coachModel() }, stdio: ["ignore", "pipe", "pipe"] })
    let tail = ""; let flush: ReturnType<typeof setTimeout> | null = null
    const onLine = (raw: string) => {
      const s = raw.trim(); if (!s) return
      const line = `🔎 coach · ${s.slice(0, 140)}`
      console.log(`[batch ${batchId}] ${line}`)
      tail += line + "\n"
      if (!flush) flush = setTimeout(() => { const t = tail; tail = ""; flush = null; appendBatchLog(batchId, t.trimEnd()) }, 1200)
    }
    const out = lineSplitter(onLine), errLines = lineSplitter(onLine)
    child.stdout?.on("data", (buf: Buffer) => out.push(buf)); child.stderr?.on("data", (buf: Buffer) => errLines.push(buf))
    child.on("close", () => { out.end(); errLines.end(); if (flush) { clearTimeout(flush); appendBatchLog(batchId, tail.trimEnd()) } resolve() })
    child.on("error", (e) => { appendBatchLog(batchId, `🔎 coach: spawn KO ${e.message}`); resolve() })
  })
}

/** Arguments d'un agent `claude -p` : la liste d'outils + le plafond $ du job (min(LWS_JOB_MAX_USD, reste du jour)). */
function agentArgs(): string[] {
  const cap = jobBudgetUsd()
  return [...CLAUDE_ARGS, ...(cap != null && cap > 0 ? ["--max-budget-usd", String(cap)] : []), "--output-format", "stream-json", "--verbose"]
}

/** Inscrit au registre la dépense d'un agent (estimation de Claude Code, `total_cost_usd`). */
function spend(b: BatchRow, r: RunResult): void {
  if (!r.costUsd && !r.tokens) return
  recordSpend({ kind: "agent", source: `worker:${b.mode}`, usd: r.costUsd || 0, tokens: r.tokens, batchId: b.id, billing: BILLING, estimated: BILLING === "plan" })
}

/** Exécute UN batch claimé : génère (composer ou template-fill) → reindex → marque le résultat. */
async function runBatch(b: BatchRow): Promise<void> {
  const label = `#${b.id} ${b.mode}${b.industry ? ` · ${b.industry}` : ""}${b.lim ? ` · ${b.lim}` : ""} (par ${b.requested_by || "?"})`
  console.log(`▶ batch ${label}`)
  await appendBatchLog(b.id, `▶ démarré par ${WORKER_ID} — mode ${b.mode}`)
  const t0 = Date.now()
  // sites composer existants AVANT le run → on saura lesquels sont NEUFS (à passer au coach après).
  const beforeSites = b.mode === "composer" ? composerSites() : new Set<string>()

  // plan-first : par défaut, le pipeline (lead-engine + fill) tourne SUR LE PLAN (claude -p), pas l'API.
  // Indispensable quand le crédit API est à zéro. Surchargeable par WORKER_LLM_VIA=api.
  const LLM_VIA = process.env.WORKER_LLM_VIA || "plan"

  let res: RunResult
  if (b.mode === "research") {
    // RECHERCHE auto (à l'approbation) ou manuelle (bouton « résoudre ») : pour chaque id, un agent
    // claude -p résout les contacts manquants + lance /account-research → brief + script d'appel,
    // persistés dans la DB partagée (crm_leads / outreach). Idempotent, borné, sans coach ni reindex lourd.
    let ids: string[] = []
    try { ids = (JSON.parse(b.params_json || "{}").ids as string[]) || [] } catch { /* params_json mal formé */ }
    if (!ids.length) { await markBatchError(b.id, "research : params_json {ids} manquant"); return }
    const env = agentEnv({ LLM_VIA })
    res = { code: 0, limited: false, resetText: "", tokens: 0, costUsd: 0, stopped: false, budgetHit: false }
    for (const id of ids) {
      await appendBatchLog(b.id, `🔬 recherche + script d'appel : ${id}`)
      const prompt = await researchPrompt(id)
      const r = await runStreamed(CLAUDE_BIN, agentArgs(), env, b.id, prompt, readableEvent)
      spend(b, r)
      res.tokens += r.tokens; res.costUsd += r.costUsd
      if (r.limited || r.stopped) { res = { ...r, tokens: res.tokens, costUsd: res.costUsd }; break } // limite / STOP → gérés plus bas
      if (r.code !== 0) { res.code = r.code; res.budgetHit ||= r.budgetHit } // garde le dernier échec (best-effort par prospect)
    }
  } else if (b.mode === "edit") {
    // FEEDBACK d'un site, SUR LA BOX. Site COMPOSER (bespoke) → agent claude -p qui édite le HTML/CSS
    // directement (l'éditeur chirurgical ne marche que sur le template-fill, il lui faut un inventaire).
    // Site template-fill → `npm run edit` (surgical). Cible {id,date} dans params_json.
    let id = "", date = ""
    try { const p = JSON.parse(b.params_json || "{}"); id = p.id; date = p.date } catch { /* */ }
    if (!id || !date) { await markBatchError(b.id, "edit : params_json {id,date} manquant"); return }
    const isComposer = /-composer$/.test(date)
    await appendBatchLog(b.id, `✍️ feedback sur ${id} / ${date}${isComposer ? " (bespoke → agent)" : " (surgical)"}`)
    if (isComposer) {
      const env = agentEnv({ LLM_VIA })
      const prompt = await editPrompt(id, date)
      res = await runStreamed(CLAUDE_BIN, agentArgs(), env, b.id, prompt, readableEvent)
      spend(b, res)
    } else {
      res = await runStreamed("npm", ["run", "edit", "--", id, date], { ...process.env, LLM_VIA }, b.id)
    }
  } else if (b.mode === "template-fill") {
    // voie cheap/déterministe : npm run pipeline avec l'env du batch (sur le plan par défaut)
    const env: NodeJS.ProcessEnv = { ...process.env, PIPELINE_JSON: "1", LLM_VIA }
    if (b.seed) env.SEED = b.seed
    if (b.lim) env.LIMIT = String(b.lim)
    if (b.force_flag) env.FORCE = "1"
    res = await runStreamed("npm", ["run", "pipeline"], env, b.id)
  } else {
    // voie premium (composer) : un agent Claude Code headless, SUR LE PLAN (login claude.ai ou
    // CLAUDE_CODE_OAUTH_TOKEN). L'agent relance lui-même le lead-engine (`npm run pipeline DESIGN=0`), dont la
    // structuration passe par runSkill → voie LWS_LLM (claude-code par défaut, donc le plan aussi). La clé API
    // est retirée de l'env (agentEnv) : plan PUR par défaut. WORKER_PLAN_STRICT=0 = ancien comportement.
    const env = agentEnv({ LLM_VIA }) // l'agent ET son sous-pipeline sur le plan
    const prompt = await composerPrompt(b)
    // stream-json + verbose → l'agent émet TOUS ses évènements (outils, fichiers, sous-agents) qu'on
    // traduit en progression lisible dans le journal du batch (transparence : voir l'agent travailler).
    const args = agentArgs()
    // MARQUEUR DE CHANTIER : chaque dossier composer créé pendant CE run porte `.lws-building` (rafraîchi
    // toutes les 10 s) tant qu'il n'a pas d'index.html → seul ce qui est marqué pourra être nettoyé à l'idle.
    const sitesBase = join("output", "sites")
    const before = composerDirs(sitesBase)
    const mark = () => { try { markBuilding(sitesBase, before, { batchId: b.id, worker: WORKER_ID }) } catch { /* best-effort */ } }
    const beat = setInterval(mark, 10_000)
    try { res = await runStreamed(CLAUDE_BIN, args, env, b.id, prompt, readableEvent); spend(b, res) }
    finally {
      clearInterval(beat)
      mark()
      const { unfinished } = settleBuilding(sitesBase, before)
      if (unfinished.length) await appendBatchLog(b.id, `🚧 ${unfinished.length} chantier(s) sans index.html (marqués .lws-building, nettoyés à l'idle s'ils ne bougent plus) : ${unfinished.join(", ")}`)
    }
  }

  // STOP pendant le job : on ne publie rien, le job repart en file (il reprendra au redémarrage du worker)
  if (res.stopped) {
    await requeueBatch(b.id, Date.now(), "STOP : job interrompu par l'arrêt d'urgence, repris quand le worker sera relancé")
    console.log(`⏹ batch #${b.id} interrompu par STOP → remis en file`)
    try { await reindexAll() } catch { /* */ }
    return
  }

  // GATE DU COACH (composer) : le coach passe AVANT publication. Les nouveaux sites sont d'abord marqués
  // `.reviewing` (→ reindex les garde NON publiés, « coach en cours », JAMAIS le brouillon), le coach les
  // revoit/corrige, PUIS on retire le marqueur et on republie le résultat vu/corrigé. WORKER_NO_COACH=1 désactive.
  const coachOn = b.mode === "composer" && process.env.WORKER_NO_COACH !== "1"
  const freshSites = coachOn ? [...composerSites()].filter((s) => !beforeSites.has(s)) : []
  for (const s of freshSites) { try { writeFileSync(join("output", "sites", s, ".reviewing"), "") } catch { /* */ } }

  // réindex (les sites frais composer restent GATÉS tant que `.reviewing` est là → pas de brouillon au cockpit)
  let indexed = ""
  try { const r = await reindexAll(); indexed = `${r.generations} générations indexées` }
  catch (e) { indexed = `reindex KO: ${(e as Error).message}` }

  // le GARDE : revoit chaque nouveau site (rendu SERVI) + boucle ses correctifs au composer, PUIS publie
  if (freshSites.length) {
    try {
      // marqueur STABLE par prospect → le cockpit (regex `id`) affiche une carte « génération » qui se remplit
      // par site, MÊME en compo parallèle (avant : phrasing fragile → aucune carte pour les batchs multi).
      await appendBatchLog(b.id, "🎬 " + freshSites.map((s) => "`" + s.split("/")[0] + "`").join(" "))
      await appendBatchLog(b.id, `🔎 coach — ${freshSites.length} site(s) en revue AVANT publication`)
      for (const s of freshSites) {
        const [id, date] = s.split("/")
        await runCoach(b.id, id, date, await siteIndustry(id))
        try { rmSync(join("output", "sites", s, ".reviewing"), { force: true }) } catch { /* */ } // revue finie → publiable
        // curseur custom : DÉSACTIVÉ par défaut (la v1 « sphère creuse » qui traîne fait gadget → à retravailler
        // en skill, cf. [[motion-intentional-no-gimmicks]]). Opt-in CURSOR_INJECT=1 quand la v2 sera prête.
        if (process.env.CURSOR_INJECT === "1") {
          try { execFileSync("node", ["worker/inject-cursor.mjs", join("output", "sites", s)], { stdio: "ignore" }) } catch { /* */ }
        }
        await storageSync(s) // médias (dont hero.mp4) → bucket : la VM les sert même gitignorés
      }
      await reindexAll() // publie les sites vus/corrigés (le coach a pu éditer / marquer 'a-revoir')
    } catch (e) { await appendBatchLog(b.id, `🔎 coach: erreur ${(e as Error).message}`) }
  }

  const ms = Date.now() - t0
  if (res.code === 0) {
    await markBatchDone(b.id, { ok: true, ms, indexed, worker: WORKER_ID, tokens: res.tokens, costUsd: res.costUsd })
    console.log(`✓ batch #${b.id} fait en ${Math.round(ms / 1000)}s — ${indexed} — ${res.tokens ? `${Math.round(res.tokens / 1000)}k tokens · $${res.costUsd.toFixed(2)}` : "usage n/a"}`)
  } else if (res.limited) {
    // LIMITE DE SESSION DU PLAN → on ne FINIT PAS en erreur : on met en PAUSE et on reprendra tout seul
    // après le reset (la génération exclut les sites déjà composés → reprise = seulement ce qui reste).
    const retryAfter = nextReset(res.resetText)
    const when = new Date(retryAfter).toISOString().slice(11, 16)
    const r = await requeueBatch(b.id, retryAfter, `limite de session du plan — reprise auto vers ${when} UTC`)
    console.log(`⏸ batch #${b.id} ${r === "gaveup" ? "abandonné (trop de tentatives)" : `en pause → reprise ${when} UTC`}`)
  } else if (res.budgetHit) {
    await markBatchError(b.id, `plafond $ du job atteint (--max-budget-usd, cf. LWS_JOB_MAX_USD / LWS_BUDGET_USD_DAY) · ${indexed}`)
    console.log(`💸 batch #${b.id} arrêté par son plafond $ — ${indexed}`)
  } else {
    await markBatchError(b.id, `code de sortie ${res.code} (${indexed})`)
    console.log(`✗ batch #${b.id} échec (code ${res.code}) — ${indexed}`)
  }
}

// Calcule la date de reprise après une limite de session. Lit « resets 3:40am (UTC) » si présent
// (prochaine occurrence UTC), sinon +60 min. Borné à [now+10min, now+6h] : robuste même si le parse rate.
function nextReset(text: string): number {
  const now = Date.now()
  const m = /resets?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text || "")
  let target = now + 60 * 60_000
  if (m) {
    let h = parseInt(m[1], 10); const min = m[2] ? parseInt(m[2], 10) : 0; const ap = (m[3] || "").toLowerCase()
    if (ap === "pm" && h < 12) h += 12
    if (ap === "am" && h === 12) h = 0
    const d = new Date(now); d.setUTCHours(h, min, 0, 0)
    if (d.getTime() <= now) d.setUTCDate(d.getUTCDate() + 1) // déjà passé aujourd'hui → demain
    target = d.getTime() + 2 * 60_000 // petit buffer après le reset
  }
  return Math.min(Math.max(target, now + 10 * 60_000), now + 6 * 60 * 60_000)
}

async function main(): Promise<void> {
  // sur quoi les agents vont-ils tourner ? (l'ancien « plan OFF (API) » s'affichait dès que CLAUDE_CODE_OAUTH_TOKEN
  // manquait, même avec un login claude.ai valide : faux. On lit maintenant `claude auth status`.)
  const auth = claudeAuth(CLAUDE_BIN, process.env.WORKER_PLAN_STRICT === "0" ? process.env : planEnv(process.env))
  const b0 = budgetStatus()
  console.log(`✓ worker lws — ${WORKER_ID} · claude ${auth.version ?? "?"} · ${auth.label} · poll ${POLL_MS}ms · budget ${b0.capUsd != null ? `${b0.spentUsd}/${b0.capUsd} $ aujourd'hui` : "sans plafond (LWS_BUDGET_USD_DAY)"}`)
  if (!auth.installed) console.warn(`⚠ ${CLAUDE_BIN} introuvable : les modes composer / edit / research échoueront (npm run doctor).`)
  else if (!auth.loggedIn) console.warn("⚠ Claude Code n'est pas connecté : `claude auth login` (abonnement) ou `claude setup-token` → CLAUDE_CODE_OAUTH_TOKEN (cf. worker/README.md).")
  // au démarrage : un job resté 'running' (worker tué en plein run) repart en 'error' (pas de zombie)
  try { const n = await reclaimStaleBatches(); if (n) console.log(`⚠ ${n} job(s) zombie nettoyé(s)`) } catch { /* */ }
  // backfill Storage en arrière-plan (ne bloque pas le claim) : pousse l'existant vers le bucket une fois.
  storageBackfill().catch((e) => console.warn(`backfill Storage: ${(e as Error).message}`))

  // `--job <id>` : run ONE job already claimed by the cockpit's built-in engine, then exit (same code path)
  const jobArg = process.argv.indexOf("--job")
  if (jobArg >= 0) {
    const id = Number(process.argv[jobArg + 1])
    const b = await getBatch(id)
    if (!b) { console.error(`✗ job #${id} introuvable`); closeDb(); process.exit(2) }
    try { await runBatch(b) } catch (e) { try { await markBatchError(b.id, (e as Error).message) } catch { /* */ } }
    closeDb(); return
  }
  let exitCode = 0, budgetLogged = ""
  while (!stopping) {
    // heartbeat : the cockpit's built-in engine stays out of the way while a real worker is alive
    await setMeta("worker.heartbeat", JSON.stringify({ id: WORKER_ID, at: Date.now() })).catch(() => {})
    // LA CAGE, à chaque tick : STOP d'abord (on sort), puis le budget du jour (on ne réclame rien)
    const st = await stopState().catch(() => null)
    if (st?.on) {
      console.log(`⏹ STOP (${st.source} : ${st.reason}) — le worker s'arrête, aucun job n'est pris.`)
      console.log(`  Reprendre : ${st.source === "fichier" ? "rm STOP" : "bouton « reprendre » du cockpit"}, puis relancer le worker (systemctl --user restart lws-worker).`)
      exitCode = STOP_EXIT_CODE
      break
    }
    const bs = budgetStatus()
    if (bs.reached) {
      if (budgetLogged !== bs.day) { console.log(`💸 budget du jour atteint : ${bs.spentUsd} $ / ${bs.capUsd} $ → aucun job réclamé jusqu'à ${bs.resetsAt.slice(11, 16)} UTC le ${bs.resetsAt.slice(0, 10)}`); budgetLogged = bs.day }
      await sleep(POLL_MS); continue
    }
    let b: BatchRow | null = null
    try { b = await claimNextBatch(WORKER_ID) }
    catch (e) { console.warn(`⚠ claim KO: ${(e as Error).message}`); await sleep(POLL_MS); continue }

    if (!b) {
      // file vide → ménage des runs interrompus (dossiers composer sans index.html), puis on attend
      try { const r = await reapIncomplete(); if (r) { console.log(`🧹 ${r} dossier(s) interrompu(s) nettoyé(s)`); await reindexAll().catch(() => {}) } } catch { /* */ }
      try { const h = await healStuckSites(); if (h) { console.log(`🩹 ${h} site(s) coincé(s) débloqué(s) → republiés`); await reindexAll().catch(() => {}) } } catch { /* */ }
      await sleep(POLL_MS); continue
    }
    // HEAL AVANT chaque batch (pas seulement à l'idle) : pendant un enchaînement (les 3 batchs de Yann),
    // le worker n'est JAMAIS idle → un site coincé en .reviewing resterait « incomplet » tout l'enchaînement.
    // Ici on débloque les stuck (>15 min) du batch précédent avant de lancer le suivant. « plus jamais ».
    try { const h = await healStuckSites(); if (h) { console.log(`🩹 ${h} site(s) débloqué(s) avant #${b.id}`); await reindexAll().catch(() => {}) } } catch { /* */ }
    try { await runBatch(b) }
    catch (e) { try { await markBatchError(b.id, (e as Error).message) } catch { /* */ } }
  }

  if (!exitCode) console.log("⏹ arrêt demandé — fermeture propre.")
  closeDb()
  if (exitCode) process.exit(exitCode)
}

main().catch((e) => { console.error("✗ worker:", e); closeDb(); process.exit(1) })
