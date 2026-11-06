/**
 * G14 : `npm run sandbox` monte l'agence FICTIVE en une commande, sans .env ni clé : base embarquée (PGlite),
 * schéma, casting, histoire jouée par les vrais process, cockpit ; `--check` vérifie chaque vue puis tout s'arrête.
 * < 90 s, rien d'écrit hors de son dossier, aucun process laissé derrière.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { tsx } from "./helpers/proc.ts"
import { parseArgs, readCast, SANDBOX_MARK } from "../scripts/sandbox.ts"

test("casting : 8 prospects, 3 métiers, tous les étages du funnel, 100 % fictif", () => {
  const cast = readCast(process.cwd())
  assert.ok(cast.prospects.length >= 8)
  assert.deepEqual([...new Set(cast.prospects.map((p) => p.trade))].sort(), ["cuisiniste", "menuisier", "pisciniste"])
  for (const s of ["trouvé", "noté", "en build", "en séquence", "en appel", "gagné", "perdu"]) assert.ok(cast.prospects.some((p) => p.stage === s), s)
  assert.ok(cast.prospects.filter((p) => p.site && existsSync(join(p.site.from, "site", "index.html"))).length >= 2, "au moins 2 sites construits (vrais runs)")
  assert.equal(cast.agency, "agency.config.example.json")
})

test("options : base distante refusée, --dir protégé", () => {
  assert.throws(() => parseArgs(["--db", "postgres://u:p@db.example.com:5432/x"]), /boucle locale/)
  assert.doesNotThrow(() => parseArgs(["--db", "postgres://lws:lws@127.0.0.1:5432/lws"]))
  assert.throws(() => parseArgs(["--nope"]), /option inconnue/)
})

test("un --dir non vide qui n'est pas une sandbox n'est jamais vidé", async () => {
  const d = mkdtempSync(join(tmpdir(), "lws-notsandbox-"))
  writeFileSync(join(d, "precieux.txt"), "ne pas effacer")
  try {
    const r = await tsx(process.cwd(), "scripts/sandbox.ts", ["--check", "--dir", d], { timeoutMs: 30_000 })
    assert.notEqual(r.code, 0)
    assert.match(r.out, /n'est pas une sandbox/)
    assert.ok(existsSync(join(d, "precieux.txt")))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test("npm run sandbox -- --check : cockpit peuplé (sites, compare, pipeline, call panel, email, strip, cage) en < 90 s, sans .env", { timeout: 180_000 }, async () => {
  const parent = mkdtempSync(join(tmpdir(), "lws-sandbox-"))
  const dir = join(parent, "sb")
  const before = existsSync("data") ? readdirSync("data").sort() : []
  try {
    assert.equal(existsSync(".env"), false)
    const r = await tsx(process.cwd(), "scripts/sandbox.ts", ["--check", "--json", "--quiet", "--dir", dir], { timeoutMs: 170_000 })
    assert.equal(r.code, 0, r.out.slice(-3000))
    const rep = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")))
    assert.ok(rep.ok, JSON.stringify(rep.checks, null, 1))
    assert.ok(rep.ms < 90_000, `${rep.ms} ms`)
    const views = rep.checks.map((c: any) => c.view)
    for (const v of ["rail (sites construits)", "prospects page (found, why picked, good fit, status)", "automatic toggle", "find prospects (brief understood, job queued)", "brief: « surprise me » → a mix of trades", "jobs strip (built-in engine)", "outreach (kanban)", "outreach (to call)", "call panel (phone, script, insights)", "outreach (steps)", "after approval (automation)", "email tab (sequences, dry-run)", "cage sheet (STOP, budget, breaker)", "page /", "page /billing.html", "old /outreach/ link → /#pipeline"]) assert.ok(views.includes(v), v)
    assert.ok(views.filter((v: string) => v.startsWith("compare ")).length >= 2)
    // tout est resté dans le dossier de la sandbox ; le dépôt (ici le workspace de test) n'a rien reçu
    assert.ok(existsSync(join(dir, SANDBOX_MARK)))
    assert.ok(readdirSync(join(dir, "data/sequencer/outbox")).length >= 4, "chaque mail du dry-run est un .eml")
    assert.equal(existsSync(join(dir, "data/sequencer/transport.jsonl")), false, "aucun appel au transport mail")
    assert.deepEqual(existsSync("data") ? readdirSync("data").sort() : [], before)
    // aucun process laissé : le cockpit ne répond plus
    await assert.rejects(fetch(rep.url + "/api/run", { signal: AbortSignal.timeout(3000) }))
  } finally { rmSync(parent, { recursive: true, force: true }) }
})
