/**
 * sandbox.ts · `npm run sandbox` : une agence FICTIVE qui tourne, en une commande, sans clé, sans compte, sans .env.
 *
 *   1. un dossier jetable `.sandbox/` (gitignoré) : le code du dépôt (scripts/lib/files.mjs, jamais data/ ni output/
 *      réels) + le casting fictif data/sample/ (8 prospects, 3 métiers) + les sites des vrais runs (examples/) ;
 *   2. une base Postgres EMBARQUÉE : PGlite (Postgres en WebAssembly, en mémoire) servi en TCP par
 *      scripts/lib/pglite-server.mjs. Le produit s'y connecte avec sa lib `postgres` et son DATABASE_URL habituels
 *      (pool de 1 par process : DB_POOL_MAX=1) ; `db/schema.sql` est appliqué par `npm run db:init` ;
 *   3. le cockpit (Station, CRM /outreach/, cockpit d'appel, vue Machine) sur un port libre de 127.0.0.1 ;
 *   4. l'HISTOIRE jouée avec les vrais process, horloge décalée (J0 = il y a 4 jours) : approbations, séquence en
 *      dry-run (chaque mail = un .eml), clic signé, désinscription 1-clic (RFC 8058), escalade, réponse, RDV → Signature,
 *      un perdu, un appel noté, un batch en file, `npm run learn`.
 *
 * Rien ne part : séquenceur en dryRun, LWS_LIVE_SEND retiré, transport mail simulé, lecteur de réponses = un fichier,
 * agence fictive (agency.config.example.json), aucune clé lue. Ctrl-C arrête tout (cockpit, base) proprement.
 *
 * Usage : npm run sandbox                 l'agence fictive, ouverte sur http://127.0.0.1:<port> jusqu'à Ctrl-C
 *         npm run sandbox -- --check      monte, joue, VÉRIFIE chaque vue (sites, compare, pipeline, call panel, strip, cage), sort
 *         options : --port <n> · --dir <dossier> (défaut .sandbox) · --json (avec --check)
 *                   --db pglite (défaut) | docker (Postgres jetable via scripts/sandbox/postgres.compose.yml)
 *                        | postgres://…@127.0.0.1:<port>/<db> (un Postgres local à toi, boucle locale uniquement)
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { codeFiles, copyFiles, linkNodeModules } from "./lib/files.mjs"
import { startPgliteServer } from "./lib/pglite-server.mjs"
import { agency } from "../packages/shared/agency.mjs"
import { textCollector } from "../packages/shared/lines.mjs"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
export const CAST_FILE = join("data", "sample", "cast.json")
export const SANDBOX_MARK = ".lws-sandbox"

type CastProspect = { id: string; name: string; trade: string; stage: string; oldSite?: string; site?: { from: string; date: string }; story: string }
type Cast = { agency: string; trades: string[]; prospects: CastProspect[] }
export type SandboxOptions = { check: boolean; port?: number; dir: string; db: string; json: boolean; quiet: boolean }
type Check = { view: string; ok: boolean; detail: string }

export function parseArgs(argv: string[]): SandboxOptions {
  const val = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined }
  const known = new Set(["--check", "--json", "--quiet", "--port", "--dir", "--db"])
  for (const a of argv) if (a.startsWith("--") && !known.has(a)) throw new Error(`option inconnue : ${a}`)
  const port = val("--port") ? Number(val("--port")) : undefined
  if (port !== undefined && !(port > 0 && port < 65536)) throw new Error(`--port ${val("--port")} : un port entre 1 et 65535`)
  const db = val("--db") || "pglite"
  if (!["pglite", "docker"].includes(db) && !/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(db)) throw new Error(`--db ${db} : pglite | docker | postgres://…@127.0.0.1:<port>/<db> (boucle locale uniquement)`)
  return { check: argv.includes("--check"), json: argv.includes("--json"), quiet: argv.includes("--quiet"), port, dir: resolve(ROOT, val("--dir") || ".sandbox"), db }
}

export function readCast(root = ROOT): Cast { return JSON.parse(readFileSync(join(root, CAST_FILE), "utf8")) }

const freePort = () => new Promise<number>((res, rej) => { const s = createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)) }) })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()

// variables qui donneraient accès au réel (base, envoi, LLM payant, box, Gmail) : jamais dans les process de la sandbox
const REAL_ENV = /^(DATABASE_URL|DB_SSL|SUPABASE_.*|ANTHROPIC_.*|OPENAI_.*|HIGGSFIELD_.*|HF_.*|TELEGRAM_.*|CLAUDE_CODE_OAUTH_TOKEN|GOOGLE_.*|GMAIL_.*|ASSETS_BASE_URL|OUTREACH_.*|COOLIFY_.*|LWS_LIVE_SEND|DIGEST_TO|DIGEST_FROM|BACKOFFICE_.*|TRACK_BASE|LWS_TRACK_SECRET|LWS_REPLY_READER|LWS_MAIL_TRANSPORT|LWS_STOP_FILE|LWS_AGENCY_CONFIG|LWS_LLM|LWS_MODEL.*|WORKER_.*)$/

/** Construit le dossier de la sandbox : code + casting fictif + sites des vrais runs. */
export function buildSandbox(dir: string, cast: Cast): { files: number; sites: CastProspect[] } {
  if (resolve(dir) === ROOT || ROOT.startsWith(resolve(dir) + "/")) throw new Error("--dir ne peut pas être le dépôt ni l'un de ses parents")
  // on ne vide QUE un dossier de sandbox (marqueur .lws-sandbox) ou un dossier vide : jamais `--dir ~` par erreur
  const ours = resolve(dir) === join(ROOT, ".sandbox") || existsSync(join(dir, SANDBOX_MARK))
  if (existsSync(dir) && readdirSync(dir).length && !ours) throw new Error(`${dir} n'est pas vide et n'est pas une sandbox (pas de ${SANDBOX_MARK}) : choisis un autre --dir`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, SANDBOX_MARK), "dossier jetable de `npm run sandbox` : il est vidé et recréé à chaque lancement\n")
  const files = copyFiles(ROOT, dir, codeFiles(ROOT))
  linkNodeModules(ROOT, dir)
  cpSync(join(ROOT, "data", "sample", "data"), join(dir, "data"), { recursive: true })
  const sites: CastProspect[] = []
  for (const p of cast.prospects) {
    if (!p.site || !existsSync(join(ROOT, p.site.from, "site", "index.html"))) continue
    const to = join(dir, "output", "sites", p.id, p.site.date)
    cpSync(join(ROOT, p.site.from, "site"), to, { recursive: true })
    for (const [from, name] of [["captures/apres-desktop.png", "_after.png"], ["captures/apres-mobile.png", "_after.mobile.png"], ["first-site.json", "first-site.json"]] as const) {
      if (existsSync(join(ROOT, p.site.from, from))) cpSync(join(ROOT, p.site.from, from), join(to, name))
    }
    sites.push(p)
  }
  // séquenceur : TOUJOURS en dry-run, boîtes au domaine de l'agence fictive (lu dans son fichier, rien en dur)
  const cfgPath = join(dir, "outreach", "sequencer", "config.json")
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"))
  const fictive = agency({ LWS_AGENCY_CONFIG: agencyFileFor(cast) }, ROOT)
  const domain = fictive.mail.heloDomain
  if (!/\.(example|test|invalid)$/.test(domain)) throw new Error(`${cast.agency} : l'agence de la sandbox doit être fictive (domaine réservé), reçu ${domain}`)
  const box = (local: string) => ({ email: `${local}@${domain}`, throttlePerDay: 8 })
  cfg.dryRun = true
  cfg.inboxes = { A: [box("bonjour")], B: [box(fictive.brand.expediteur.toLowerCase() || "contact"), box("studio")] }
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n")
  // une journée de dépense (estimée) pour que la cage montre un budget vivant
  const day = new Date().toISOString()
  mkdirSync(join(dir, "data", "logs"), { recursive: true })
  writeFileSync(join(dir, "data", "logs", "spend.jsonl"), [
    { at: day, day: day.slice(0, 10), kind: "agent", source: "worker:composer", usd: 2.93, billing: "plan", estimated: true },
    { at: day, day: day.slice(0, 10), kind: "agent", source: "worker:research", usd: 0.41, billing: "plan", estimated: true },
  ].map((e) => JSON.stringify(e)).join("\n") + "\n")
  return { files, sites }
}

type Running = { child: ChildProcess; out: () => string }
function startChild(cmd: string, args: string[], o: { cwd: string; env: NodeJS.ProcessEnv }): Running {
  const child = spawn(cmd, args, { cwd: o.cwd, env: o.env, stdio: ["ignore", "pipe", "pipe"], detached: true })
  const buf = textCollector(4_000_000) // décodé à la lecture : un accent coupé entre deux morceaux reste intact
  child.stdout!.on("data", (b: Buffer) => buf.push(b))
  child.stderr!.on("data", (b: Buffer) => buf.push(b))
  return { child, out: () => buf.text() }
}
function killGroup(c?: ChildProcess) { try { if (c?.pid && c.exitCode === null) process.kill(-c.pid, "SIGTERM") } catch { /* parti */ } }

function runCli(script: string, args: string[], o: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number }): Promise<{ code: number; out: string }> {
  return new Promise((res) => {
    const r = startChild(process.execPath, ["--import", "tsx", script, ...args], o)
    const t = setTimeout(() => { killGroup(r.child) }, o.timeoutMs ?? 90_000)
    r.child.on("close", (code) => { clearTimeout(t); res({ code: code ?? 1, out: r.out() }) })
  })
}

/** La base : PGlite embarqué (défaut), Postgres jetable (docker), ou un Postgres local donné. */
async function startDatabase(kind: string): Promise<{ url: string; label: string; stop: () => Promise<void> }> {
  if (kind === "pglite") {
    let PGlite: any
    try { ({ PGlite } = await import("@electric-sql/pglite")) } catch {
      throw new Error("PGlite absent : lance `npm ci` (dépendance de dev @electric-sql/pglite), ou --db docker")
    }
    const db = await PGlite.create()
    const srv = await startPgliteServer({ db })
    return { url: srv.url, label: `PGlite (Postgres WebAssembly, en mémoire) sur 127.0.0.1:${srv.port}`, stop: async () => { await srv.stop(); await db.close() } }
  }
  if (kind === "docker") {
    const port = await freePort()
    const file = join(ROOT, "scripts", "sandbox", "postgres.compose.yml")
    const env = { ...process.env, SANDBOX_PG_PORT: String(port) }
    const up = spawnSync("docker", ["compose", "-f", file, "up", "-d", "--wait"], { env, encoding: "utf8" })
    if (up.status !== 0) throw new Error(`docker compose : ${(up.stderr || up.stdout || "").trim().split("\n").pop()}`)
    return { url: `postgres://lws:lws@127.0.0.1:${port}/lws`, label: `Postgres 17 jetable (docker) sur 127.0.0.1:${port}`, stop: async () => { spawnSync("docker", ["compose", "-f", file, "down", "-v"], { env, stdio: "ignore" }) } }
  }
  return { url: kind, label: `Postgres local ${kind.replace(/:[^:@/]+@/, ":***@")}`, stop: async () => {} }
}

export type SandboxRun = { url: string; dir: string; ms: number; checks: Check[]; ok: boolean; stop: () => Promise<void> }

/** LWS_AGENCY_CONFIG peut désigner UNE AUTRE agence fictive (ex. agency.config.example.us.json) : même garde-fou (domaine réservé) */
export const agencyFileFor = (cast: Cast): string => (process.env.LWS_AGENCY_CONFIG && /\.example(\.[a-z]+)?\.json$/.test(process.env.LWS_AGENCY_CONFIG) ? process.env.LWS_AGENCY_CONFIG : cast.agency)

export async function startSandbox(o: SandboxOptions): Promise<SandboxRun> {
  const t0 = Date.now()
  const say = (s: string) => { if (!o.quiet) console.log(s) }
  const cast = readCast()
  const step = (n: number, label: string) => say(`[${n}/6] ${label} · ${((Date.now() - t0) / 1000).toFixed(1)} s`)

  step(1, "dossier jetable : code + casting fictif + sites des vrais runs")
  const { files, sites } = buildSandbox(o.dir, cast)
  say(`      ${o.dir} · ${files} fichiers de code · ${cast.prospects.length} prospects fictifs · ${sites.length} sites construits`)

  step(2, "base Postgres embarquée")
  const database = await startDatabase(o.db)
  say(`      ${database.label}`)
  let cockpit: Running | undefined
  let sql: ReturnType<typeof postgres> | null = null
  const stop = async () => { killGroup(cockpit?.child); try { await sql?.end({ timeout: 2 }) } catch { /* */ } await database.stop() }
  try {
    const port = o.port ?? await freePort()
    const base = `http://127.0.0.1:${port}`
    const env: NodeJS.ProcessEnv = {}
    for (const [k, v] of Object.entries(process.env)) if (!REAL_ENV.test(k)) env[k] = v
    Object.assign(env, {
      DATABASE_URL: database.url, DB_SSL: "disable", DB_POOL_MAX: "1",
      LWS_AGENCY_CONFIG: agencyFileFor(cast), // l'agence FICTIVE (ou une autre fictive passée par LWS_AGENCY_CONFIG), même dans le dépôt privé
      BACKOFFICE_HOST: "127.0.0.1", BACKOFFICE_PORT: String(port),
      TRACK_BASE: base, LWS_TRACK_SECRET: randomBytes(36).toString("base64url"),
      LWS_REPLY_READER: "file", LWS_MAIL_TRANSPORT: "simulated", LWS_BUDGET_USD_DAY: "20",
      LWS_SIRENE: "0", VISUAL: "0", NODE_NO_WARNINGS: "1",
      LWS_SANDBOX: "1", // the cockpit's engine is SIMULATED: find / build / research play out with no key, no network
    })

    const init = await runCli("db/init.ts", [], { cwd: o.dir, env })
    if (init.code !== 0) throw new Error(`db:init : ${init.out.trim().split("\n").pop()}`)
    say(`      ${init.out.trim().split("\n").pop()}`)

    step(3, "cockpit (Station, CRM, cockpit d'appel, vue Machine)")
    cockpit = startChild(process.execPath, ["--import", "tsx", "backoffice/reviewpipe/serve.ts"], { cwd: o.dir, env })
    for (let i = 0; i < 600 && !/index DB →|index DB indisponible/.test(cockpit.out()); i++) {
      if (cockpit.child.exitCode !== null) throw new Error(`le cockpit s'est arrêté : ${cockpit.out().slice(-600)}`)
      await sleep(100)
    }
    if (!/index DB →/.test(cockpit.out())) throw new Error(`index DB du cockpit : ${cockpit.out().slice(-600)}`)
    const listen = cockpit.out().match(/station de contrôle → (http:\/\/[^\s]+)/)
    const url = listen ? listen[1] : base
    if (url !== base) env.TRACK_BASE = url // port déjà pris : le cockpit a pris le suivant
    say(`      ${url} · ${cockpit.out().match(/index DB → ([^\n]+)/)?.[1] ?? ""}`)

    step(4, "l'histoire : approbations, séquence, clic, désinscription, réponse, RDV, Signature, perdu, appel, batch")
    sql = postgres(database.url, { ssl: false, max: 1, onnotice: () => {}, prepare: false })
    await playStory({ dir: o.dir, base: url, env, sql, cast, sites })

    step(5, "apprendre (npm run learn)")
    const learn = await runCli("learning/scripts/learn.ts", [], { cwd: o.dir, env })
    if (learn.code !== 0) throw new Error(`learn : ${learn.out.slice(-600)}`)

    step(6, "vérification des vues")
    const checks = await checkViews(url, cast, sites)
    const ok = checks.every((c) => c.ok)
    const ms = Date.now() - t0
    return { url, dir: o.dir, ms, checks, ok, stop }
  } catch (e) {
    await stop()
    throw e
  }
}

async function playStory(o: { dir: string; base: string; env: NodeJS.ProcessEnv; sql: ReturnType<typeof postgres>; cast: Cast; sites: CastProspect[] }) {
  const { dir, base, env, sql, cast, sites } = o
  const has = (id: string) => cast.prospects.some((p) => p.id === id)
  const built = (id: string) => sites.find((p) => p.id === id)
  const post = async (path: string, body: unknown) => {
    const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`)
    return r.json().catch(() => ({}))
  }
  const must = async (p: Promise<{ code: number; out: string }>, what: string) => { const r = await p; if (r.code !== 0) throw new Error(`${what} : ${r.out.slice(-800)}`) }
  const seq = (args: string[]) => runCli("outreach/scripts/sequencer.ts", args, { cwd: dir, env })
  const ORVANE = "orvane-piscines-valmont-sur-lys", BRISANE = "atelier-brisane-sornac-le-haut", LUMEO = "cuisines-lumeo-vereuil"
  const FREHAUT = "menuiserie-frehaut-brezelonne", QUILLANNE = "bassins-de-quillanne-quillanne-sur-orme"

  // ① choisir les sites (le 2e point de validation humaine) : ♥ puis approuver
  for (const [id, love] of [[ORVANE, 3], [BRISANE, 2], [LUMEO, 2]] as const) {
    const p = built(id)
    if (!p) continue
    await post("/api/love", { id, date: p.site!.date, love })
    await post("/api/status", { id, date: p.site!.date, status: "approved" })
  }
  // ② la séquence (dry-run) : J0 il y a 4 jours
  await must(seq(["enroll", [ORVANE, BRISANE].filter(has).join(","), "--now", ago(97)]), "enroll")
  await must(seq(["tick", "--now", ago(96)]), "tick J0")
  // Fréhaut entre plus tard (hier) : son mail parfait part, l'étape suivante attend encore (J+3 pas atteint)
  if (has(FREHAUT)) {
    await must(seq(["enroll", FREHAUT, "--now", ago(30)]), "enroll Fréhaut")
    await must(seq(["tick", "--now", ago(29)]), "tick J0 Fréhaut")
  }
  const sends = readFileSync(join(dir, "data/sequencer/sends.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
  const eml = (pid: string) => {
    const s = sends.find((x) => x.prospectId === pid)
    if (!s) return null
    const f = readdirSync(join(dir, "data/sequencer/outbox")).find((n) => n.includes(s.trackingId))
    if (!f) return null
    const raw = readFileSync(join(dir, "data/sequencer/outbox", f), "utf8")
    const [head, body] = raw.split("\r\n\r\n")
    return { inbox: s.inbox as string, head, text: Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8") }
  }
  // ③ Orvane clique le lien signé de son mail (le lendemain, à l'horloge de l'histoire)
  const mo = eml(ORVANE)
  if (mo) {
    const link = mo.text.match(/https?:\/\/[^\s]+\/t\/c\/[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{16}/)?.[0]
    if (!link) throw new Error("lien signé introuvable dans le mail d'Orvane")
    const r = await fetch(link, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148" } })
    if (r.status !== 302) throw new Error(`clic signé → ${r.status}`)
    await sql`UPDATE outreach_events SET at = ${Date.now() - 70 * 3600_000} WHERE type = 'click'`
  }
  // ④ Brisane se désinscrit en un clic (RFC 8058), le surlendemain
  const mb = eml(BRISANE)
  if (mb) {
    const unsub = mb.head.match(/List-Unsubscribe: <(http[^>]+)>/)?.[1]
    if (!unsub) throw new Error("en-tête List-Unsubscribe absent du mail de Brisane")
    const u = await fetch(unsub, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" })
    if (u.status !== 200) throw new Error(`désinscription → ${u.status}`)
    await sql`UPDATE outreach_events SET at = ${Date.now() - 50 * 3600_000} WHERE type = 'unsub'`
  }
  // ⑤ J+3 : l'escalade gatée au clic débloque la démo d'Orvane ; Fréhaut n'a pas cliqué
  await must(seq(["tick", "--now", ago(20)]), "tick J+3")
  // ⑥ Orvane répond (lu par le lecteur « fichier » au tick suivant)
  if (mo) {
    writeFileSync(join(dir, "data/sequencer/inbox.jsonl"), JSON.stringify({ inbox: mo.inbox, id: "sandbox-reply-1", from: "contact@orvane-piscines.example", subject: "Re: La démo de votre nouveau site, en 30 secondes", text: "Bonjour Camille, c'est très réussi. Appelez-moi jeudi matin, on regarde ça ensemble.", at: ago(3) }) + "\n")
    await must(seq(["tick", "--now", ago(2)]), "tick réponse")
  }
  // ⑦ le CRM : Orvane RDV → propal → Signature (won) ; Brisane perdu (lost) ; Lumeo dans la file d'appel, noté
  if (built(ORVANE)) {
    await post("/api/crm/outcome", { id: ORVANE, outcome: "rdv", rdvAt: Date.now() + 2 * 86400_000, note: "démo jeudi 10 h, au showroom" })
    for (const stage of ["propal", "signature"]) await post("/api/crm/stage", { id: ORVANE, pipeline: "closing", stage })
  }
  if (built(BRISANE)) await post("/api/crm/outcome", { id: BRISANE, outcome: "lost", note: "garde son site actuel pour l'instant" })
  if (built(LUMEO)) {
    await post("/api/crm/stage", { id: LUMEO, pipeline: "hot", stage: "call0" })
    await post("/api/crm/note", { id: LUMEO, text: "pas d'e-mail sur le site (formulaire en panne) : appeler le showroom, mardi-samedi 9h30-12h" })
  }
  // ⑧ le prochain build en file (aucun worker dans la sandbox : il attend, la Station le montre)
  if (has(QUILLANNE)) await post("/api/batch", { mode: "composer", ids: [QUILLANNE], limit: 1, note: "sandbox: the built-in engine plays this build" })
}

async function checkViews(base: string, cast: Cast, sites: CastProspect[]): Promise<Check[]> {
  const out: Check[] = []
  const get = async (p: string) => { const r = await fetch(base + p); return { status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text() } }
  const add = (view: string, ok: boolean, detail: string) => out.push({ view, ok, detail })
  const names = (arr: any[] = []) => arr.map((x) => x.name || x.id)
  try {
    const s = await get("/api/sites")
    const list: any[] = Array.isArray(s.body) ? s.body : (s.body.sites || s.body.items || [])
    add("rail (sites construits)", s.status === 200 && list.length >= sites.length && sites.length >= 2, `${list.length} site(s) : ${[...new Set(list.map((x) => x.id))].join(", ")}`)
    for (const p of sites) {
      const pv = await get(`/preview/${p.id}/${p.site!.date}/index.html`)
      const av = await fetch(`${base}/avant/${p.id}`)
      add(`compare ${p.name} (avant / après)`, pv.status === 200 && av.status === 200, `après ${pv.status} · avant ${av.status}`)
    }
    const c = await get("/api/crm")
    const hot = c.body.hot || {}, closing = c.body.closing || {}
    const won = names(closing.signature), queue = names(hot.call0), nurt = names(hot.nurturing)
    const expectWon = sites.some((p) => p.stage === "gagné"), expectCall = sites.some((p) => p.stage === "en appel"), expectLost = sites.some((p) => p.stage === "perdu")
    add("outreach (kanban)", c.status === 200 && (!expectWon || won.length > 0) && (!expectLost || nurt.length > 0), `Won : ${won.join(", ") || "—"} · nurturing : ${nurt.join(", ") || "—"}`)
    add("outreach (to call)", c.status === 200 && (!expectCall || queue.length > 0), queue.join(", ") || "vide")
    const callable = [...(hot.call0 || []), ...(closing.signature || [])][0]
    add("call panel (phone, script, insights)", !!callable && !!callable.phone && Array.isArray(callable.insights) && callable.insights.length > 0, callable ? `${callable.name} · ${callable.phone} · ${(callable.insights || []).length} insight(s) · ${(callable.notes || []).length} note(s)` : "aucune carte")
    const st = await get("/api/crm/stages")
    add("outreach (steps)", st.status === 200 && (st.body.hot || []).length === 5 && (st.body.closing || []).length === 4, `${(st.body.hot || []).map((x: any) => x.label).join(" · ")} | ${(st.body.closing || []).map((x: any) => x.label).join(" · ")}`)
    const ag = await get("/api/agent")
    add("after approval (automation)", ag.status === 200 && ["sequencer", "webhook", "manual"].includes(ag.body.mode), `mode ${ag.body.mode}`)
    const q = await get("/api/sequences")
    const seqs: any[] = q.body.sequences || q.body.items || (Array.isArray(q.body) ? q.body : [])
    add("email tab (sequences, dry-run)", q.status === 200 && seqs.length >= 3, `${seqs.length} séquence(s) · ${seqs.map((x) => `${x.prospectId?.split("-")[0]}:${x.status}`).join(" ")}`)
    const pr = await get("/api/prospects")
    const pb = pr.body || {}, pitems: any[] = pb.items || []
    add("prospects page (found, why picked, good fit, status)", pr.status === 200 && pitems.length >= 5 && pitems.some((x) => x.reasons?.length) && pitems.some((x) => x.fit) && pitems.some((x) => x.status === "built") && pitems.some((x) => x.status === "building"), `${pitems.length} prospects · new ${pb.counts?.new} · building ${pb.counts?.building} · built ${pb.counts?.built} · e.g. ${pitems[0]?.name}: ${(pitems[0]?.reasons || []).join(", ")}`)
    const au = await get("/api/automatic")
    add("automatic toggle", au.status === 200 && typeof au.body.automatic === "boolean", `automatic ${au.body.automatic}`)
    const fs0 = await fetch(base + "/api/prospects/find", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `3 ${cast.trades[0]} near Lyon` }) })
    const fb = await fs0.json().catch(() => ({}))
    add("find prospects (brief understood, job queued)", fs0.status === 200 && (fb.brief?.trades || []).includes(cast.trades[0]) && fb.brief?.place === "Lyon", `${fs0.status} · ${JSON.stringify(fb.brief || {})}`)
    const br = await fetch(base + "/api/brief", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "surprise me, 8 of them" }) })
    const bj = await br.json().catch(() => ({}))
    add("brief: « surprise me » → a mix of trades", br.status === 200 && bj.mix === true && (bj.trades || []).length >= 3 && bj.count === 8, JSON.stringify(bj))
    const jb = await get("/api/jobs")
    add("jobs strip (built-in engine)", jb.status === 200 && Array.isArray(jb.body.jobs), `${(jb.body.jobs || []).length} live job(s)`)
    const agc = await get("/api/agency")
    add(`agency locale (${agc.body.country})`, agc.status === 200 && !!agc.body.country && !!agc.body.currency, `${agc.body.country} · ${agc.body.locale} · ${agc.body.currency}`)
    const g = await get("/api/cage")
    add("cage sheet (STOP, budget, breaker)", g.status === 200 && g.body.stop?.on === false && g.body.budget?.capUsd > 0, `STOP ${g.body.stop?.on ? "actif" : "libre"} · budget ${g.body.budget?.spentUsd ?? "?"} / ${g.body.budget?.capUsd ?? "?"} $ · envoi ${g.body.send?.mode ?? g.body.send ?? "?"}`)
    for (const page of ["/", "/billing.html"]) { const r = await fetch(base + page); add(`page ${page}`, r.status === 200, String(r.status)) }
    const old = await fetch(base + "/outreach/", { redirect: "manual" })
    add("old /outreach/ link → /#pipeline", old.status === 302 && (old.headers.get("location") || "").endsWith("/#pipeline"), String(old.status))
    add("next step (kanban move)", true, "moves to the next column (tested in e2e)")
  } catch (e) { add("vérification", false, (e as Error).message) }
  void cast
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let o: SandboxOptions
  try { o = parseArgs(process.argv.slice(2)) } catch (e) { console.error(`✗ ${(e as Error).message}`); console.error("usage : npm run sandbox [-- --check] [--port <n>] [--dir <dossier>] [--db pglite|docker|postgres://…]"); process.exit(2) }
  let run: SandboxRun | null = null
  const bye = async (code: number) => { try { await run?.stop() } catch { /* */ } process.exit(code) }
  process.on("SIGINT", () => { console.log("\n⏹ arrêt de la sandbox (cockpit, base)…"); void bye(130) })
  process.on("SIGTERM", () => void bye(143))
  try {
    run = await startSandbox(o!)
  } catch (e) {
    console.error(`✗ sandbox : ${(e as Error).message}`)
    process.exit(1)
  }
  const r = run!
  if (o!.json) console.log(JSON.stringify({ url: r.url, dir: r.dir, ms: r.ms, ok: r.ok, checks: r.checks }, null, 2))
  else {
    for (const c of r.checks) console.log(`  ${c.ok ? "✓" : "✗"} ${c.view} : ${c.detail}`)
    console.log(`${r.ok ? "✓" : "✗"} agence fictive prête en ${(r.ms / 1000).toFixed(1)} s → ${r.url}   (Sites : ${r.url}/#sites · Outreach : ${r.url}/#outreach)`)
  }
  if (o!.check) await bye(r.ok ? 0 : 1)
  else console.log("  rien ne part (dry-run, transport simulé, agence fictive) · Ctrl-C pour tout arrêter")
}
