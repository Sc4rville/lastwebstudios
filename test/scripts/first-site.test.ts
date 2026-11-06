/**
 * G10 : `npm run first-site -- <url>` enchaîne score → parse → fiche → diagnose → compose → beauty-gate sur le vieux
 * site FICTIF « Orvane Piscines » servi en local, boost coupé, sans sync. Ici avec le faux `claude` (moteurs local
 * et workflow) ; le vrai run sur le plan est consigné dans NIGHT/LOG.md (WP2) et son résultat dans examples/.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { cpSync, readFileSync } from "node:fs"
import { parseArgs, prospectId, composeArgs, parseLauncherResult, workflowLauncherPrompt, RESULT_TAG, resolveSample } from "../../scripts/first-site.ts"
import { serveDir as serveSample, resolveInside } from "../../scripts/lib/serve-dir.mjs"
import { serveDir, type Http } from "../helpers/server.ts"
import { makeWorkspace, FIXTURES, type Workspace } from "../helpers/workspace.ts"
import { npmRun } from "../helpers/proc.ts"

const ID = "orvane-piscines-valmont-sur-lys"

test("arguments : URL obligatoire, options validées, id lisible", () => {
  assert.equal(parseArgs([]), null)
  assert.equal(parseArgs(["pas-une-url"]), null)
  assert.throws(() => parseArgs(["http://x.example", "--engin", "local"]), /option inconnue/)
  assert.throws(() => parseArgs(["http://x.example", "--engine", "turbo"]), /auto \| workflow \| local/)
  assert.throws(() => parseArgs(["http://x.example", "--date", "24/10"]), /YYYY-MM-DD/)
  const o = parseArgs(["http://127.0.0.1:1/", "--name", "Orvane Piscines", "--city", "Valmont-sur-Lys", "--boost"])!
  assert.equal(o.engine, "auto")
  assert.equal(o.boost, true)
  assert.equal(prospectId(o), ID)
  assert.equal(prospectId({ url: "https://www.vieux-site.example/accueil" }), "vieux-site")
  assert.throws(() => prospectId({ url: "http://x", id: "../etc" }), /minuscules/)
})

test("--sample : un vieux site FICTIF du casting remplace l'URL (README : premier run sans viser une vraie entreprise)", async () => {
  const o = parseArgs(["--sample", "orvane", "--engine", "local"])!
  assert.equal(o.sample, "orvane")
  assert.equal(o.url, "")
  assert.throws(() => parseArgs(["--sample"]), /orvane \| brisane/)
  assert.throws(() => parseArgs(["--sample", "orvane", "http://x.example"]), /l'un ou l'autre/)
  const want: Record<string, [string, string]> = { orvane: [ID, "pisciniste"], brisane: ["atelier-brisane-sornac-le-haut", "menuisier"], lumeo: ["cuisines-lumeo-vereuil", "cuisiniste"], quillanne: ["bassins-de-quillanne-quillanne-sur-orme", "pisciniste"] }
  for (const [name, [id, industry]] of Object.entries(want)) {
    const s = resolveSample(name)
    assert.equal(s.id, id)
    assert.equal(s.industry, industry)
    assert.ok(readFileSync(join(s.dir, "index.html"), "utf8").length > 200, `${name} : vieux site présent`)
    if (s.email) assert.match(s.email, /\.example$/, "coordonnées fictives seulement")
  }
  assert.equal(resolveSample("Orvane Piscines").city, "Valmont-sur-Lys")
  assert.throws(() => resolveSample("doralis"), /inconnu/) // trouvé, sans vieux site
  assert.throws(() => resolveSample("zzz"), /inconnu/)
  // le serveur : la boucle locale, le dossier servi et rien d'autre
  const s = resolveSample("brisane")
  const srv = await serveSample(s.dir)
  try {
    assert.match(srv.url, /^http:\/\/127\.0\.0\.1:\d+\/$/)
    const home = await fetch(srv.url)
    assert.equal(home.status, 200)
    assert.match(home.headers.get("content-type") || "", /text\/html/)
    for (const evil of ["/../../package.json", "/..%2f..%2fpackage.json", "/%2e%2e/%2e%2e/agency.config.json", "/%00", "/index.html%00.png"]) {
      const r = await fetch(srv.url.replace(/\/$/, "") + evil)
      assert.equal(r.status, 404, evil)
    }
    assert.equal((await fetch(srv.url, { method: "POST" })).status, 405)
    assert.equal(await resolveInside(s.dir, "/../../package.json"), null)
  } finally { await srv.close() }
})

test("args du Workflow : sans sync, boost coupé par défaut (image/vidéo none), modèles par rôle", () => {
  const a = composeArgs({ id: ID, date: "2026-10-24", score: 83, pairings: [{ display: "Host Grotesk" }], boost: false, env: { OPENAI_API_KEY: "sk", HIGGSFIELD_API_KEY: "hf" } })
  assert.deepEqual({ sync: a.sync, boost: a.boost, image: a.image, video: a.video }, { sync: false, boost: false, image: "none", video: "none" })
  assert.deepEqual(a.models, { smart: "opus", fast: "haiku", judge: "sonnet" })
  assert.deepEqual(a.scores, { [ID]: 83 })
  const b = composeArgs({ id: ID, date: "2026-10-24", score: 83, pairings: [], boost: true, env: { OPENAI_API_KEY: "sk", PATH: "" } })
  assert.deepEqual({ boost: b.boost, image: b.image, video: b.video }, { boost: true, image: "openai", video: "none" })
  const p = workflowLauncherPrompt(a)
  assert.match(p, /Workflow\(\{ scriptPath: "architecture\/orchestration\/compose-batch\.workflow\.js", args: \{.*"sync":false/)
  assert.deepEqual(parseLauncherResult(`blabla\n${RESULT_TAG}{"passed":[{"id":"x"}],"failed":[]} fin`), { passed: [{ id: "x" }], failed: [] })
  assert.equal(parseLauncherResult("rien"), null)
})

let site: Http
let ws: Workspace
before(async () => { site = await serveDir(join(FIXTURES, "sites", "orvane-piscines")); ws = makeWorkspace() })
after(async () => { ws?.cleanup(); await site?.close() })

const ARGS = (date: string, ...extra: string[]) => [`${site.url}/`, "--name", "Orvane Piscines", "--city", "Valmont-sur-Lys", "--industry", "pisciniste", "--phone", "03 53 01 24 68", "--date", date, ...extra]
const calls = (log: string) => readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l))

test("moteur local : site construit, contre-vérifié (lint + verify), gate PASS journalisé, rien n'est synchronisé", { timeout: 240_000 }, async () => {
  const log = ws.path("claude-local.log")
  const r = await npmRun(ws.dir, "first-site", ARGS("2026-10-24", "--engine", "local"), { env: { FAKE_CLAUDE_LOG: log, ANTHROPIC_API_KEY: "sk-ant-ne-doit-pas-passer" }, timeoutMs: 230_000 })
  assert.equal(r.code, 0, r.out.slice(-3000))
  assert.match(r.stdout, /\[1\/6\] score/)
  assert.match(r.stdout, /\[6\/6\] verdict du beauty-gate aveugle\n\s+PASS en 1 tour/)
  const dir = `output/sites/${ID}/2026-10-24-composer`
  assert.ok(ws.exists(`${dir}/index.html`))
  assert.ok(ws.exists(`${dir}/_after.png`) && ws.exists(`${dir}/_after.mobile.png`), "captures desktop + mobile du verify")
  const rep = ws.json(`${dir}/first-site.json`)
  assert.equal(rep.engine, "local")
  assert.equal(rep.provider, "claude-code")
  assert.ok(rep.steps.score.value > 0)
  assert.equal(rep.gate.pass, true)
  assert.equal(rep.gate.verdict.margin, "much")
  assert.equal(rep.lint.clean, true)
  assert.equal(rep.lint.dashCount, 0)
  assert.equal(rep.verify.clean, true)
  assert.equal(rep.verify.mobile.overflowX, false)
  assert.equal(rep.compose.args.sync, false)
  assert.ok(ws.exists(`data/prospects/${ID}.json`) && ws.exists(`data/assets/${ID}/avant.png`))
  const cs = calls(log)
  assert.ok(cs.every((c) => c.env.ANTHROPIC_API_KEY === false), "plan-first : aucune clé API dans aucun claude -p")
  assert.ok(!cs.some((c) => /sync-site\.ts/.test(c.stdin)), "aucun agent de synchro")
  const assets = cs.find((c) => /Maillon ASSET-BOOST/.test(c.stdin))
  assert.match(assets.stdin, /IMAGE : \*\*AUCUN\*\*/)
  const structure = cs.find((c) => /## TEXTE BRUT/.test(c.stdin))
  assert.ok(structure.argv.includes("--json-schema"), "la fiche passe en sortie structurée (schema.json du skill)")
})

test("la commande du README : `npm run first-site -- --sample orvane` sert le vieux site fictif, construit, puis coupe le serveur", { timeout: 240_000 }, async () => {
  const log = ws.path("claude-sample.log")
  cpSync(join(process.cwd(), "data", "sample"), ws.path("data", "sample"), { recursive: true }) // livré avec le dépôt (le workspace de test n'a pas de data/)
  const r = await npmRun(ws.dir, "first-site", ["--sample", "orvane", "--engine", "local", "--date", "2026-10-23"], { env: { FAKE_CLAUDE_LOG: log }, timeoutMs: 230_000 })
  assert.equal(r.code, 0, r.out.slice(-3000))
  const served = /servi sur (http:\/\/127\.0\.0\.1:\d+\/)/.exec(r.stdout)?.[1]
  assert.ok(served, r.stdout.slice(0, 600))
  assert.match(r.stdout, new RegExp(`first-site · ${ID} · ${served.replace(/[./]/g, "\\$&")} · pisciniste`))
  const rep = ws.json(`output/sites/${ID}/2026-10-23-composer/first-site.json`)
  assert.equal(rep.gate.pass, true)
  assert.equal(rep.url, served)
  await assert.rejects(fetch(served, { signal: AbortSignal.timeout(2000) }), "le serveur du vieux site est coupé à la fin du run")
})

test("moteur workflow : l'outil Workflow est appelé avec les args (sync off), sans plafond d'attente en arrière-plan", { timeout: 240_000 }, async () => {
  const log = ws.path("claude-wf.log")
  const r = await npmRun(ws.dir, "first-site", ARGS("2026-10-25", "--engine", "workflow"), { env: { FAKE_CLAUDE_LOG: log }, timeoutMs: 230_000 })
  assert.equal(r.code, 0, r.out.slice(-3000))
  const launcher = calls(log).find((c) => /FIRST_SITE_RESULT=/.test(c.stdin))
  assert.ok(launcher, "le lanceur Workflow a été appelé")
  assert.ok(launcher.argv.includes("Workflow") && launcher.argv.includes("Agent"))
  assert.equal(launcher.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS, "0")
  assert.match(launcher.stdin, /"sync":false/)
  const rep = ws.json(`output/sites/${ID}/2026-10-25-composer/first-site.json`)
  assert.equal(rep.engine, "workflow")
  assert.equal(rep.gate.pass, true)
})

test("auto sans outil Workflow ⇒ moteur local ; juge indécis ⇒ gate FAIL après 2 tours, site gardé et journalisé", { timeout: 240_000 }, async () => {
  const r = await npmRun(ws.dir, "first-site", ARGS("2026-10-26"), { env: { FAKE_CLAUDE_NO_WORKFLOW: "1", FAKE_CLAUDE_JUDGE: "tie" }, timeoutMs: 230_000 })
  assert.equal(r.code, 0, r.out.slice(-3000))
  assert.match(r.stdout, /moteur composer : local \(auto\)/)
  const rep = ws.json(`output/sites/${ID}/2026-10-26-composer/first-site.json`)
  assert.equal(rep.engine, "local")
  assert.equal(rep.gate.pass, false)
  assert.equal(rep.gate.loops, 2)
})

test("préflight bloquant (Claude Code déconnecté) : rien n'est lancé, la réparation est dite", { timeout: 120_000 }, async () => {
  const r = await npmRun(ws.dir, "first-site", ARGS("2026-10-27"), { env: { FAKE_CLAUDE_AUTH: "none" }, timeoutMs: 110_000 })
  assert.equal(r.code, 1)
  assert.match(r.stdout, /manque ⇒ fais : claude auth login/)
  assert.equal(ws.exists(`output/sites/${ID}/2026-10-27-composer`), false)
})
