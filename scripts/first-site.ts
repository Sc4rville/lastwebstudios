/**
 * first-site.ts · `npm run first-site -- <url>` : TON premier vrai site, de bout en bout, sur TON compte.
 *
 *   score (la porte) → parse (Playwright) → fiche (skill structuration, voie LWS_LLM) → compose-batch :
 *   diagnose → asset-boost (coupé par défaut) → composer → filet déterministe (lint + verify) → auto-revue →
 *   beauty-gate aveugle (cap 2) → contre-vérification locale (lint + verify) → rapport first-site.json.
 *
 * Moteur du composer (--engine) :
 *   workflow  l'outil Workflow de Claude Code, exactement comme le worker de la box (agents en parallèle)
 *   local     architecture/orchestration/workflow-local.ts : les MÊMES prompts et schémas, orchestrés ici, un
 *             `claude -p` par agent (abonnement Pro sans « Dynamic workflows », vieille CLI, modèle local)
 *   auto      workflow si la session Claude Code l'expose (sonde d'init), sinon local (défaut)
 *
 * Rien ne part ailleurs : pas de sync vers un bucket ni une base (args.sync=false), boost image/vidéo coupé sauf
 * --boost, aucun mail. Le résultat reste dans output/sites/<id>/<date>-composer/ ; `npm run backoffice` l'affiche.
 *
 * Usage : npm run first-site -- <url> [--name "Orvane Piscines"] [--city Valmont-sur-Lys] [--industry pisciniste]
 *           [--phone …] [--email …] [--id <slug>] [--engine auto|workflow|local] [--boost] [--force]
 *           [--date YYYY-MM-DD] [--pairings <fichier.json>] [--no-preflight]
 *         npm run first-site -- --sample orvane|brisane|lumeo|quillanne [options]
 *           un vieux site FICTIF du casting (data/sample/cast.json), servi sur 127.0.0.1 le temps du run, avec son
 *           nom, sa ville, son métier et ses coordonnées fictives : un premier run sans viser une vraie entreprise.
 */
import { agency } from "../packages/shared/agency.mjs"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { spawn, spawnSync } from "node:child_process"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { slug } from "../leadengine/1_scraping/scripts/util.ts"
import { workflowModels, selectProvider, parseJson } from "../packages/llm/index.ts"
import { planEnv } from "../packages/llm/adapters/claude-code.ts"
import { readableEvent } from "../packages/llm/stream-events.ts"
import { imageEngine, videoEngine } from "../packages/shared/media.mjs"
import { workerClaudeArgs } from "../worker/claude-args.ts"
import { runWorkflowFile, claudeAgentRunner } from "../architecture/orchestration/workflow-local.ts"
import { lineSplitter, textCollector } from "../packages/shared/lines.mjs"
import { serveDir } from "./lib/serve-dir.mjs"

export const WORKFLOW_SCRIPT = "architecture/orchestration/compose-batch.workflow.js"
export const RESULT_TAG = "FIRST_SITE_RESULT="

export type FirstSiteOptions = {
  url: string; name?: string; city?: string; industry?: string; phone?: string; email?: string; id?: string
  engine: "auto" | "workflow" | "local"; boost: boolean; force: boolean; date: string; pairings: string; preflight: boolean
  /** `--sample <nom>` : un vieux site fictif du casting, servi en local (l'url est posée au lancement). */
  sample?: string
}

export function parseArgs(argv: string[]): FirstSiteOptions | null {
  const val = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined }
  const flags = new Set(["--boost", "--force", "--no-preflight"])
  const valued = new Set(["--name", "--city", "--industry", "--phone", "--email", "--id", "--engine", "--date", "--pairings", "--sample"])
  const positional = argv.filter((a, i) => !a.startsWith("--") && !valued.has(argv[i - 1]))
  const sample = val("--sample")
  if (argv.includes("--sample") && (!sample || sample.startsWith("--"))) throw new Error(`--sample : ${SAMPLE_NAMES}`)
  if (sample && positional.length) throw new Error("--sample remplace l'URL : l'un ou l'autre")
  const url = sample ? "" : positional[0]
  if (!sample && (!url || !/^https?:\/\//i.test(url))) return null
  for (const a of argv) if (a.startsWith("--") && !flags.has(a) && !valued.has(a)) throw new Error(`option inconnue : ${a}`)
  const engine = (val("--engine") || "auto") as FirstSiteOptions["engine"]
  if (!["auto", "workflow", "local"].includes(engine)) throw new Error(`--engine ${engine} : auto | workflow | local`)
  const date = val("--date") || new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`--date ${date} : format YYYY-MM-DD`)
  return {
    url, name: val("--name"), city: val("--city"), industry: val("--industry"), phone: val("--phone"), email: val("--email"), id: val("--id"),
    engine, boost: argv.includes("--boost"), force: argv.includes("--force"), date, pairings: val("--pairings") || join("design", "fonts", "pairings.json"),
    preflight: !argv.includes("--no-preflight"), ...(sample ? { sample } : {}),
  }
}

const SAMPLE_NAMES = "orvane | brisane | lumeo | quillanne (vieux sites fictifs de data/sample/cast.json)"
export type SampleSite = { id: string; name: string; city?: string; industry: string; phone?: string; email?: string; dir: string }

/** Le vieux site fictif `--sample <nom>` : le prospect du casting dont l'id ou le nom contient <nom>, et qui a un vieux site. */
export function resolveSample(name: string, root = "."): SampleSite {
  const cast = JSON.parse(readFileSync(join(root, "data", "sample", "cast.json"), "utf8")) as { prospects: { id: string; name: string; trade: string; oldSite?: string }[] }
  const q = slug(name)
  const withSite = cast.prospects.filter((p) => p.oldSite && existsSync(join(root, p.oldSite, "index.html")))
  const hits = withSite.filter((p) => p.id === q || p.id.includes(q) || slug(p.name).includes(q))
  if (hits.length !== 1) throw new Error(`--sample ${name} : ${hits.length ? "ambigu" : "inconnu"} · ${SAMPLE_NAMES}`)
  const p = hits[0]
  const sheetPath = join(root, "data", "sample", "data", "prospects", `${p.id}.json`)
  const sheet = existsSync(sheetPath) ? JSON.parse(readFileSync(sheetPath, "utf8")) : {}
  const id = sheet.identity ?? {}
  return { id: p.id, name: id.name || p.name, city: id.city || undefined, industry: sheet.industry || p.trade, phone: id.phone || undefined, email: id.email || undefined, dir: join(root, p.oldSite!) }
}

export function prospectId(o: Pick<FirstSiteOptions, "id" | "name" | "city" | "url">): string {
  if (o.id) { if (!/^[a-z0-9][a-z0-9-]{1,100}$/.test(o.id)) throw new Error(`--id ${o.id} : minuscules, chiffres et tirets`); return o.id }
  if (o.name) return slug([o.name, o.city].filter(Boolean).join("-"))
  return slug(new URL(o.url).hostname.replace(/^www\./, "").replace(/\.[a-z]+$/i, ""))
}

/** Les args du Workflow compose-batch pour UN prospect, sans sync et (par défaut) sans boost. */
export function composeArgs(o: { id: string; date: string; score: number; pairings: unknown[]; boost: boolean; env?: Record<string, string | undefined> }) {
  const env = o.env ?? process.env
  const image = o.boost ? imageEngine(env).engine : "none"
  const video = o.boost ? videoEngine(env).engine : "none"
  return { date: o.date, ids: [o.id], pairings: o.pairings, scores: { [o.id]: o.score }, boost: o.boost && (image !== "none" || video !== "none"), image, video, sync: false, models: workflowModels(env), language: agency(env).language, country: agency(env).country }
}

/** Le prompt de l'agent qui lance l'outil Workflow (moteur « workflow ») : rien d'autre que l'appel. */
export function workflowLauncherPrompt(args: unknown): string {
  return `Tu es lancé par \`npm run first-site\` (headless, aucun humain). Le lead-engine est déjà fait : fiche et capture « avant » existent.
Ta SEULE tâche : appeler l'outil **Workflow** une fois, exactement ainsi, puis attendre son résultat.

Workflow({ scriptPath: "${WORKFLOW_SCRIPT}", args: ${JSON.stringify(args)} })

N'exécute aucune autre étape toi-même (pas de sync, pas de push, pas d'envoi). Quand le Workflow a rendu son résultat, réponds
UNIQUEMENT une ligne : ${RESULT_TAG}<le JSON du résultat du Workflow, sur une seule ligne>`
}

/** Extrait le JSON rendu par le Workflow du texte final de l'agent lanceur. */
export function parseLauncherResult(text: string): any | null {
  const i = text.lastIndexOf(RESULT_TAG)
  if (i < 0) return null
  const rest = text.slice(i + RESULT_TAG.length)
  const start = rest.indexOf("{")
  if (start < 0) return null
  try { return parseJson(rest.slice(start)) } catch { return null }
}

type Engine = "workflow" | "local"
type ComposeOutcome = { engine: Engine; ms: number; result: any; costUsd?: number; agents?: unknown[]; log: string[] }

function runWorkflowEngine(args: unknown, log: (s: string) => void, timeoutMs: number): Promise<ComposeOutcome> {
  const bin = process.env.CLAUDE_BIN || "claude"
  const base = workerClaudeArgs()
  const cliArgs = [...base, "--output-format", "stream-json", "--verbose", ...(base.includes("--strict-mcp-config") ? [] : ["--strict-mcp-config"])]
  const t0 = Date.now()
  const lines: string[] = []
  return new Promise((resolve, reject) => {
    // le Workflow tourne en arrière-plan de la session : on attend sa fin sans plafond d'inactivité (notre délai borne)
    const child = spawn(bin, cliArgs, { env: { ...planEnv(process.env), CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: "0" }, stdio: ["pipe", "pipe", "pipe"] })
    let final: any = null
    const errOut = textCollector(64_000)
    const timer = setTimeout(() => { log(`✗ délai dépassé (${Math.round(timeoutMs / 60000)} min) : arrêt`); try { child.kill("SIGTERM") } catch { /* */ } }, timeoutMs)
    // lignes et caractères UTF-8 recollés entre deux lectures du tube (sinon le `result` final peut être perdu)
    const out = lineSplitter((line) => {
      if (line.includes('"type":"result"')) { try { final = JSON.parse(line) } catch { /* */ } }
      const r = readableEvent(line)
      if (r) lines.push(r)
      if (r && !r.startsWith("✓ ")) log(`   ${r.slice(0, 160)}`) // le résultat final est relu plus bas, pas répété
    })
    child.stdout.on("data", (b: Buffer) => out.push(b))
    child.stderr.on("data", (b: Buffer) => errOut.push(b))
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`spawn ${bin} : ${e.message}`)) })
    child.on("close", (code) => {
      clearTimeout(timer)
      out.end()
      const err = errOut.text()
      if (!final) return reject(new Error(`claude -p (code ${code}) sans résultat : ${err.slice(-400)}`))
      if (final.is_error || final.subtype !== "success") return reject(new Error(`claude -p a échoué (${final.subtype}) : ${String(final.result ?? "").slice(0, 300)}`))
      resolve({ engine: "workflow", ms: Date.now() - t0, result: parseLauncherResult(String(final.result ?? "")), costUsd: typeof final.total_cost_usd === "number" ? final.total_cost_usd : undefined, log: lines })
    })
    child.stdin.on("error", () => { /* */ })
    child.stdin.write(workflowLauncherPrompt(args))
    child.stdin.end()
  })
}

async function runLocalEngine(args: unknown, log: (s: string) => void): Promise<ComposeOutcome> {
  const lines: string[] = []
  const r = await runWorkflowFile(WORKFLOW_SCRIPT, args, claudeAgentRunner({ log: (s) => { lines.push(s); log(s) } }), { log: (s) => { lines.push(s); log(s) } })
  return { engine: "local", ms: r.ms, result: r.result, costUsd: r.costUsd, agents: r.agents, log: lines }
}

function nodeJson(script: string, args: string[]): { code: number; json: any } {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 180_000, maxBuffer: 16 << 20 })
  let json: any = null
  try { json = JSON.parse(r.stdout) } catch { json = { unreadable: (r.stdout || r.stderr || "").slice(0, 400) } }
  return { code: r.status ?? -1, json }
}

/** La contre-vérification locale (les filets du composer, relancés ici : on ne croit pas l'agent sur parole). */
export function verifySite(dir: string): { lint: any; verify: any; clean: boolean } {
  const index = join(dir, "index.html")
  const lint = nodeJson(join("design", "scripts", "lint.mjs"), [index]).json
  const verify = nodeJson(join("design", "verify", "verify.cjs"), [index, join(dir, "_after.png")]).json
  return { lint, verify, clean: !!lint?.clean && !!verify?.clean && (lint?.dashCount ?? 1) === 0 }
}

const step = (n: number, total: number, s: string) => console.log(`\n[${n}/${total}] ${s}`)
const secs = (ms: number) => `${Math.round(ms / 1000)} s`

export async function firstSite(o: FirstSiteOptions): Promise<number> {
  const T = 6
  const t0 = Date.now()
  const id = prospectId(o)
  const industry = o.industry || ""
  const report: Record<string, any> = { id, url: o.url, date: o.date, startedAt: new Date().toISOString(), steps: {} }
  console.log(`▶ first-site · ${id} · ${o.url}${industry ? ` · ${industry}` : ""}`)

  // 0 ── préflight : ce que doctor juge bloquant pour un premier site (pas de base requise)
  let engine: Engine = o.engine === "auto" ? "local" : o.engine
  if (o.preflight) {
    const { runDoctor, formatReport } = await import("./doctor.ts")
    const d = await runDoctor({ target: "first-site", offline: false, env: process.env, cwd: process.cwd() })
    if (!d.ok) { console.log(formatReport(d)); return 1 }
    const wf = d.checks.find((c) => c.id === "workflow")
    if (o.engine === "auto") engine = wf?.status === "ok" ? "workflow" : "local"
    console.log(`✓ préflight (npm run doctor -- --for first-site) · voie LLM ${d.provider} · moteur composer : ${engine}${o.engine === "auto" ? " (auto)" : ""}`)
  }
  report.engine = engine
  report.provider = selectProvider().name

  // 1 ── la porte
  step(1, T, "score (la porte)")
  const { scoreProspect } = await import("../leadengine/2_scoring/scripts/score.ts")
  let t = Date.now()
  const score = await scoreProspect(id, o.url, { industry, name: o.name, city: o.city, phone: o.phone, email: o.email })
  mkdirSync(join("data", "raw"), { recursive: true })
  writeFileSync(join("data", "raw", `${id}.score.json`), JSON.stringify(score, null, 2))
  report.steps.score = { ms: Date.now() - t, value: score.value, tier: score.tier, reasons: score.reasons.slice(0, 4) }
  console.log(`   ${score.value}/100 (${score.tier}) en ${secs(Date.now() - t)}${score.accroche ? ` · accroche : ${score.accroche}` : ""}`)
  for (const r of score.reasons.slice(0, 4)) console.log(`   - ${r}`)
  if (score.tier === "cold" && !o.force) {
    console.log("→ JETÉ par la porte (pas une cible). --force pour construire quand même.")
    return 1
  }

  // 2 ── parse
  step(2, T, "parse (Playwright : capture « avant », photos, logo, texte)")
  const { parsePage } = await import("../leadengine/3_parsing/scripts/parse.ts")
  t = Date.now()
  const raw = await parsePage(id, o.url)
  report.steps.parse = { ms: Date.now() - t, photos: raw.photos.length, logo: !!raw.logo, textChars: raw.text.length }
  console.log(`   ${raw.photos.length} photo(s), logo ${raw.logo ? "oui" : "non"}, ${raw.text.length} caractères en ${secs(Date.now() - t)}`)

  // 3 ── fiche
  step(3, T, `fiche (skill structuration, voie ${report.provider})`)
  const { structureFiche } = await import("../leadengine/3_parsing/scripts/structure.ts")
  t = Date.now()
  const fiche = await structureFiche(id, industry, { name: o.name || id, city: o.city || "", phone: o.phone }, score)
  report.steps.structure = { ms: Date.now() - t, services: fiche.content?.services?.length ?? 0, issue: (fiche as any).structureIssue ?? null }
  console.log(`   ${fiche.content?.services?.length ?? 0} service(s)${(fiche as any).structureIssue ? ` · ⚠ ${(fiche as any).structureIssue}` : ""} en ${secs(Date.now() - t)}`)

  // 4 ── compose (diagnose → boost → composer → filet → auto-revue → beauty-gate)
  const pairingsDoc = JSON.parse(readFileSync(o.pairings, "utf8"))
  const pairings = Array.isArray(pairingsDoc) ? pairingsDoc : pairingsDoc.pairings
  if (!Array.isArray(pairings) || !pairings.length) throw new Error(`${o.pairings} : aucun tableau « pairings »`)
  const args = composeArgs({ id, date: o.date, score: score.value, pairings, boost: o.boost })
  report.compose = { args: { ...args, pairings: `${pairings.length} paire(s) de ${o.pairings}` } }
  step(4, T, `compose (moteur ${engine} · boost ${args.boost ? `image ${args.image} / vidéo ${args.video}` : "coupé"} · modèles ${JSON.stringify(args.models)})`)
  const log = (s: string) => console.log(s)
  const outcome = engine === "workflow"
    ? await runWorkflowEngine(args, log, Number(process.env.LWS_FIRST_SITE_TIMEOUT_MS ?? 120 * 60_000))
    : await runLocalEngine(args, log)
  report.steps.compose = { ms: outcome.ms, engine: outcome.engine, planEstimateUsd: outcome.costUsd ?? null, agents: outcome.agents ?? null }
  report.workflowResult = outcome.result
  console.log(`   compose en ${secs(outcome.ms)}${outcome.costUsd != null ? ` · estimation Claude Code ${outcome.costUsd.toFixed(2)} $ (sur le plan : quota, pas de facture)` : ""}`)

  // 5 ── contre-vérification locale
  step(5, T, "contre-vérification (lint.mjs + verify.cjs desktop/mobile)")
  const dir = join("output", "sites", id, `${o.date}-composer`)
  if (!existsSync(join(dir, "index.html"))) {
    console.log(`✗ pas de site : ${dir}/index.html absent`)
    report.ok = false
    report.totalMs = Date.now() - t0
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "first-site.json"), JSON.stringify(report, null, 2))
    return 1
  }
  const net = verifySite(dir)
  report.lint = { clean: net.lint?.clean ?? false, dashCount: net.lint?.dashCount ?? null, problems: net.lint?.problems ?? null }
  report.verify = { clean: net.verify?.clean ?? false, desktop: net.verify?.desktop ?? null, mobile: net.verify?.mobile ?? null }
  console.log(`   lint : ${report.lint.clean ? "propre" : "à revoir"} (${report.lint.dashCount ?? "?"} tiret(s) cadratin/demi) · verify : ${report.verify.clean ? "propre" : "à revoir"}`)

  // 6 ── verdict du beauty-gate
  step(6, T, "verdict du beauty-gate aveugle")
  const r = outcome.result
  const gate = r?.passed?.find((x: any) => x.id === id) ?? r?.failed?.find((x: any) => x.id === id) ?? null
  report.gate = gate ? { pass: !!r.passed?.some((x: any) => x.id === id), loops: gate.loops ?? null, font: gate.font ?? null, verdict: gate.verdict ?? null, why: gate.why ?? null } : { pass: null, note: "résultat du Workflow illisible : voir control.md du site" }
  console.log(`   ${report.gate.pass === true ? "PASS" : report.gate.pass === false ? "FAIL" : "inconnu"}${gate?.loops ? ` en ${gate.loops} tour(s)` : ""}${gate?.font ? ` · police ${gate.font}` : ""}`)
  if (gate?.verdict?.reasons) for (const x of gate.verdict.reasons.slice(0, 4)) console.log(`   - ${x}`)

  report.totalMs = Date.now() - t0
  report.ok = net.clean
  writeFileSync(join(dir, "first-site.json"), JSON.stringify(report, null, 2))
  console.log(`\n${net.clean ? "✓" : "⚠"} ${dir}/index.html en ${Math.round(report.totalMs / 60000)} min · rapport ${dir}/first-site.json`)
  console.log("  Voir l'avant/après : npm run backoffice")
  return net.clean ? 0 : 2
}

// --- CLI ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile() } catch { /* pas de .env : l'environnement seul */ }
  let opts: FirstSiteOptions | null = null
  try { opts = parseArgs(process.argv.slice(2)) } catch (e) { console.error(`✗ ${(e as Error).message}`); process.exit(1) }
  if (!opts) {
    console.error("usage: npm run first-site -- <url du vieux site> [--name \"Nom\"] [--city Ville] [--industry métier]")
    console.error("         [--engine auto|workflow|local] [--boost] [--force] [--date YYYY-MM-DD] [--pairings fichier.json]")
    console.error("       npm run first-site -- --sample orvane   (un vieux site FICTIF du casting, servi en local)")
    console.error("  Vérifie d'abord ta machine : npm run doctor -- --for first-site")
    process.exit(1)
  }
  let server: { url: string; close: () => Promise<void> } | null = null
  try {
    if (opts.sample) {
      const s = resolveSample(opts.sample)
      server = await serveDir(s.dir)
      opts = { ...opts, url: server.url, id: opts.id ?? s.id, name: opts.name ?? s.name, city: opts.city ?? s.city, industry: opts.industry ?? s.industry, phone: opts.phone ?? s.phone, email: opts.email ?? s.email }
      console.log(`▶ --sample ${opts.sample} : vieux site fictif « ${s.name} » (${s.dir}) servi sur ${server.url}`)
    }
    const code = await firstSite(opts)
    await server?.close()
    process.exit(code)
  } catch (e) { await server?.close().catch(() => {}); console.error(`✗ first-site : ${(e as Error).message.split("\n").slice(0, 3).join("\n")}`); process.exit(1) }
}
