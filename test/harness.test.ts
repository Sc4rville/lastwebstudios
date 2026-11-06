/**
 * Le harnais lui-même : les tests tournent dans un workspace jetable, sans données réelles, sans .env,
 * sans accès à la vraie base ni au vrai modèle. Si l'un de ces filets lâche, tout le reste est suspect.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { makeWorkspace } from "./helpers/workspace.ts"
import { run } from "./helpers/proc.ts"

test("le cwd des tests est un workspace jetable sans données réelles ni .env", () => {
  const cwd = process.cwd()
  assert.notEqual(cwd, process.env.LWS_TEST_ROOT, "les tests ne doivent jamais tourner dans le dépôt")
  for (const d of ["output", "closing", "sessions", "website", "NIGHT", ".oss-build", ".sandbox"]) assert.equal(existsSync(join(cwd, d)), false, `${d}/ ne doit pas être copié`)
  // data/ : seul le casting FICTIF du produit (data/sample/) voyage avec le code, jamais les vraies données
  if (existsSync(join(cwd, "data"))) assert.deepEqual(readdirSync(join(cwd, "data")), ["sample"], "data/ ne contient que data/sample/")
  assert.equal(existsSync(join(cwd, ".env")), false)
  assert.ok(existsSync(join(cwd, "package.json")))
})

test("l'environnement de test est assaini (aucune clé, aucune base distante, aucun envoi)", () => {
  for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "SUPABASE_SERVICE_KEY", "TELEGRAM_BOT_TOKEN", "LWS_LIVE_SEND", "DIGEST_TO", "CLAUDE_CODE_OAUTH_TOKEN"]) {
    assert.equal(process.env[k], undefined, `${k} ne doit pas fuiter dans les tests`)
  }
  if (process.env.DATABASE_URL) assert.match(process.env.DATABASE_URL, /@127\.0\.0\.1:\d+\//, "seule une base locale jetable est permise")
  assert.equal(process.env.LWS_SIRENE, "0")
})

test("`claude` résout vers le faux binaire de test (aucun appel au vrai modèle)", async () => {
  assert.match(String(process.env.CLAUDE_BIN), /test\/fixtures\/bin\/claude$/)
  const r = await run("claude", ["--version"], { cwd: process.cwd() })
  assert.equal(r.code, 0)
  assert.match(r.stdout, /faux binaire de test/)
})

test("un workspace par test : copie isolée, fixtures fictives, nettoyée après", () => {
  const ws = makeWorkspace({ seed: ["agency"] })
  try {
    assert.ok(ws.exists("data/prospects/orvane-piscines-valmont-sur-lys.json"))
    assert.ok(ws.exists("output/sites/orvane-piscines-valmont-sur-lys/2026-10-20-composer/index.html"))
    for (const f of ["orvane-piscines-valmont-sur-lys", "atelier-brisane-menuiserie-sornac-le-haut", "cuisines-lumeo-vereuil"]) {
      const s = ws.json(`data/prospects/${f}.json`)
      assert.match(s._fixture, /FICTIF/)
      assert.ok(!s.identity.email || /\.example$/.test(s.identity.email), "e-mails fictifs en .example uniquement")
    }
    ws.write("data/x.json", "{}")
    assert.equal(existsSync(join(process.cwd(), "data", "x.json")), false, "écrire dans le workspace ne touche pas le cwd")
  } finally { ws.cleanup() }
  assert.equal(existsSync(ws.dir), false)
})

test("package.json déclare engines.node >= 20.12 et les scripts de test", () => {
  const p = JSON.parse(readFileSync("package.json", "utf8"))
  assert.equal(p.engines?.node, ">=20.12")
  for (const s of ["typecheck", "test", "test:pg", "test:e2e", "db:init"]) assert.ok(p.scripts[s], `script ${s}`)
})
