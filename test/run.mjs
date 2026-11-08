#!/usr/bin/env node
/**
 * test/run.mjs · LE lanceur de la suite de tests (npm test · npm run test:pg · npm run test:e2e).
 *
 * Pourquoi un lanceur maison plutôt que `node --test` direct : TOUS les chemins du code sont relatifs au
 * cwd (data/, output/, outreach/sequencer/…) et le dépôt privé contient de VRAIES données (prospects,
 * sites clients) + parfois un `.env` de prod. Un test lancé depuis la racine pourrait donc lire/écrire du
 * réel, ou parler à la vraie base. Ici, on ne lance JAMAIS les tests dans le dépôt :
 *
 *   1. copie du code SUIVI (scripts/lib/files.mjs : git ls-files + les fichiers neufs non ignorés) dans un workspace
 *      JETABLE, SANS data/ output/ closing/ sessions/ website/ NIGHT/ ni aucun .env (node_modules = lien) ; seul
 *      data/sample/ (le casting fictif du produit) voyage avec le code ;
 *   2. environnement ASSAINI : DATABASE_URL, clés API, jetons, LWS_LIVE_SEND… retirés ; `claude` = un faux
 *      binaire (test/fixtures/bin/claude) en tête du PATH et dans CLAUDE_BIN → aucun appel LLM réel ;
 *   3. `node --import tsx --test` dans ce workspace, puis suppression du workspace.
 *
 * Suites :
 *   (défaut)  test/**\/*.test.ts hors test/pg/ et test/e2e/ · unitaires + intégration hors réseau
 *   --suite pg   test/pg/**  contre un Postgres JETABLE (docker postgres:17-alpine, port aléatoire, sans TLS),
 *                ou LWS_TEST_DATABASE_URL si fourni (loopback uniquement)
 *   --suite e2e  test/e2e/** (Playwright, navigateur headless)
 *
 * Options : --keep (garde le workspace, chemin affiché) · un ou plusieurs filtres (sous-chaîne du chemin).
 *           LWS_SHOTS_DIR=<dossier> (e2e) : les captures d'écran (fictives) y sont écrites, relatif au dépôt.
 */
import { spawn, spawnSync, execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { codeFiles, copyFiles, linkNodeModules } from "../scripts/lib/files.mjs"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
const suite = args.includes("--suite") ? args[args.indexOf("--suite") + 1] : "unit"
const keep = args.includes("--keep") || process.env.LWS_KEEP_WS === "1"
const filters = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--suite")

// variables qui donneraient accès au réel (base, envoi, LLM payant, box) ou changeraient la voie LLM / les modèles
// d'un test à l'autre (LWS_LLM, LWS_MODEL_*, LLM_VIA…) : retirées de l'env des tests
const SECRET_ENV = /^(DATABASE_URL|SUPABASE_.*|ANTHROPIC_.*|OPENAI_.*|HIGGSFIELD_.*|HF_.*|TELEGRAM_.*|CLAUDE_CODE_OAUTH_TOKEN|GOOGLE_.*|GMAIL_.*|ASSETS_BASE_URL|OUTREACH_.*|COOLIFY_.*|LWS_LIVE_SEND|DIGEST_TO|FIRECRAWL_.*|EXA_.*|ELEVENLABS_.*|REPLICATE_.*|GEMINI_.*|NEBIUS_.*|BACKOFFICE_PASSWORD|TRACK_BASE|LWS_TRACK_SECRET|LWS_BUDGET_USD_DAY|LWS_JOB_MAX_USD|LWS_IMAGE_USD|LWS_VIDEO_USD|LWS_STOP_FILE|LWS_REPLY_READER|LWS_MAIL_TRANSPORT|DB_SSL|LWS_LLM|LWS_MODEL(_.*)?|LWS_IMAGE|LWS_VIDEO|LWS_STRUCTURED|LWS_EFFORT(_.*)?|LWS_CLAUDE_SETTING_SOURCES|LLM_VIA|WORKER_CLAUDE_ARGS|WORKER_PLAN_STRICT|COACH_MODEL|LWS_AGENCY_CONFIG|DB_POOL_MAX|VERIFY_HELO|CLAUDE_CODE_SIMPLE|CLAUDE_CODE_USE_.*|CLAUDE_CONFIG_DIR)$/

/** Construit le workspace jetable : copie du code (scripts/lib/files.mjs : pas de données réelles, pas de .env) + node_modules lié. */
function buildWorkspace() {
  const ws = mkdtempSync(join(tmpdir(), "lws-test-"))
  const files = copyFiles(ROOT, ws, codeFiles(ROOT))
  linkNodeModules(ROOT, ws)
  return { ws, files }
}

function findTests(ws) {
  const dir = join(ws, "test")
  const out = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) { if (e.name !== "fixtures" && e.name !== "helpers") walk(p) }
      else if (e.name.endsWith(".test.ts")) out.push(p)
    }
  }
  if (existsSync(dir)) walk(dir)
  const inSuite = (p) => {
    const rel = relative(dir, p).split(sep)
    if (suite === "pg") return rel[0] === "pg"
    if (suite === "e2e") return rel[0] === "e2e"
    return rel[0] !== "pg" && rel[0] !== "e2e"
  }
  return out.filter(inSuite).filter((p) => !filters.length || filters.some((f) => p.includes(f))).sort()
}

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer()
    s.unref()
    s.on("error", rej)
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)) })
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Postgres jetable (docker), sans TLS, sur 127.0.0.1:<port aléatoire>. Renvoie { url, stop }. */
async function startPostgres() {
  const given = process.env.LWS_TEST_DATABASE_URL
  if (given) {
    const host = new URL(given).hostname
    if (!/^(127\.0\.0\.1|localhost|::1|\[::1\])$/.test(host)) throw new Error(`LWS_TEST_DATABASE_URL doit pointer sur la boucle locale (reçu : ${host})`)
    return { url: given, stop: () => {} }
  }
  const docker = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" })
  if (docker.status !== 0) throw new Error("docker indisponible : lance un Postgres local et pose LWS_TEST_DATABASE_URL=postgres://…@127.0.0.1:<port>/<db>")
  const port = await freePort()
  const name = `lws-test-pg-${process.pid}-${port}`
  execFileSync("docker", ["run", "-d", "--rm", "--name", name, "-e", "POSTGRES_PASSWORD=lws", "-e", "POSTGRES_USER=lws", "-e", "POSTGRES_DB=lws",
    "-p", `127.0.0.1:${port}:5432`, "postgres:17-alpine", "-c", "fsync=off", "-c", "full_page_writes=off"], { stdio: "ignore" })
  const stop = () => { spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" }) }
  for (let i = 0; i < 120; i++) {
    const r = spawnSync("docker", ["exec", name, "pg_isready", "-U", "lws", "-d", "lws", "-h", "127.0.0.1"], { encoding: "utf8" })
    if (r.status === 0) return { url: `postgres://lws:lws@127.0.0.1:${port}/lws`, stop, name }
    await sleep(500)
  }
  stop()
  throw new Error("Postgres jetable : pas prêt après 60 s")
}

async function main() {
  const t0 = Date.now()
  const { ws, files } = buildWorkspace()
  const tests = findTests(ws)
  console.log(`▶ suite ${suite} · ${tests.length} fichier(s) de test · workspace jetable ${ws} (${files} fichiers de code, 0 donnée réelle)`)
  if (!tests.length) { if (!keep) rmSync(ws, { recursive: true, force: true }); console.error("✗ aucun test trouvé"); process.exit(1) }

  const env = {}
  for (const [k, v] of Object.entries(process.env)) if (!SECRET_ENV.test(k)) env[k] = v
  const fakeBin = join(ws, "test", "fixtures", "bin")
  // the tests' agency is the French demo studio (the fixtures, the SIRENE fake, the French mails were written for it) :
  // the private repo's agency.config.json is that studio ; the open source edition ships none and would run on the US
  // one (D1, the product's default), so its workspace gets the same file, as an owner's saved Settings would be (the
  // sandbox still defaults to the US studio : it never reads agency.config.json). A test that checks the default
  // removes it from its own copy (test/cockpit/ai-status).
  if (!existsSync(join(ws, "agency.config.json"))) copyFileSync(join(ws, "agency.config.example.json"), join(ws, "agency.config.json"))
  Object.assign(env, {
    LWS_TEST: "1",
    LWS_TEST_ROOT: ROOT, // le dépôt d'origine, en LECTURE seule (ex. la vitrine website/ pour l'e2e)
    CLAUDE_BIN: join(fakeBin, "claude"),
    PATH: `${fakeBin}:${process.env.PATH || ""}`,
    TZ: "UTC",
    NODE_NO_WARNINGS: "1",
    VISUAL: "0", // jamais le juge visuel LLM en test
    LWS_SIRENE: "0", // recherche-entreprises : jamais l'API réelle (un test qui en a besoin pose LWS_SIRENE=1 + son faux serveur)
    LWS_SIRENE_URL: "http://127.0.0.1:9/disabled",
  })

  let pg = null
  const cleanup = () => { try { pg?.stop() } catch { /* */ } if (!keep) rmSync(ws, { recursive: true, force: true }) }
  process.on("SIGINT", () => { cleanup(); process.exit(130) })
  process.on("SIGTERM", () => { cleanup(); process.exit(143) })

  try {
    if (suite === "pg") {
      pg = await startPostgres()
      env.DATABASE_URL = pg.url
      env.DB_SSL = "disable"
      console.log(`  postgres jetable → ${pg.url.replace(/:[^:@/]+@/, ":***@")}`)
    } else if (suite === "e2e") {
      // l'e2e de la vue Machine joue le film AVEC base si docker est là (sinon : mode disque, testé aussi)
      try {
        pg = await startPostgres()
        env.DATABASE_URL = pg.url
        env.DB_SSL = "disable"
        console.log(`  postgres jetable (e2e) → ${pg.url.replace(/:[^:@/]+@/, ":***@")}`)
      } catch (e) { console.log(`  pas de postgres pour l'e2e (${e.message.split("\n")[0]}) : vue Machine testée en mode disque`) }
    }
    // captures d'écran des e2e (données fictives uniquement) : LWS_SHOTS_DIR=NIGHT/shots npm run test:e2e
    if (process.env.LWS_SHOTS_DIR) env.LWS_SHOTS_DIR = resolve(ROOT, process.env.LWS_SHOTS_DIR)
    const conc = suite === "e2e" ? 1 : Math.max(1, Math.min(4, Number(process.env.LWS_TEST_CONCURRENCY) || 4))
    const code = await new Promise((res) => {
      const child = spawn(process.execPath, ["--import", "tsx", "--test", `--test-concurrency=${conc}`, ...tests], { cwd: ws, env, stdio: "inherit" })
      child.on("close", (c) => res(c ?? 1))
      child.on("error", () => res(1))
    })
    console.log(`${code === 0 ? "✓" : "✗"} suite ${suite} : exit ${code} en ${Math.round((Date.now() - t0) / 1000)} s${keep ? ` · workspace gardé : ${ws}` : ""}`)
    process.exitCode = code
  } catch (e) {
    console.error(`✗ ${e.message}`)
    process.exitCode = 1
  } finally {
    cleanup()
  }
}

main()
