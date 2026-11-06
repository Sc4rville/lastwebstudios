/**
 * Test blitz (24/10) · le cockpit sous ENTRÉES HOSTILES, sans base (le mode d'un inconnu qui clone le dépôt).
 *
 * Toutes les routes POST lues dans le source (comme le balayage GET de nodb.test.ts) reçoivent des corps absurdes :
 * vide, JSON cassé, `null`, tableau, chaîne, types faux, ids de traversée (`../../`), unicode de contrôle, champs
 * énormes. Attendu : jamais de 5xx, le serveur répond encore après chaque requête, rien n'est écrit hors du
 * workspace, aucun process n'est lancé par une entrée invalide. `/api/pipeline` est exclu (il lance un vrai scraping
 * réseau, testé ailleurs), comme les routes publiques /t/ (tracking.test.ts).
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { makeWorkspace, type Workspace } from "../helpers/workspace.ts"
import { startCockpit } from "../helpers/cockpit.ts"
import type { Proc } from "../helpers/server.ts"
import { hostileSweep } from "../helpers/hostile.ts"

let ws: Workspace, cockpit: Proc, before0: Set<string>, parent0: Set<string>
const SKIP_DIRS = new Set(["node_modules", "design", "video", "ecom"])
function files(dir: string, root = dir, out = new Set<string>()): Set<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink() || SKIP_DIRS.has(e.name) && dir === root) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) files(p, root, out); else out.add(relative(root, p))
  }
  return out
}
before(async () => {
  ws = makeWorkspace({ seed: ["agency"] })
  before0 = files(ws.dir)
  parent0 = new Set(readdirSync(dirname(ws.dir)))
  cockpit = await startCockpit(ws.dir)
})
after(async () => { await cockpit?.stop(); ws?.cleanup() })

test("balayage hostile : chaque route POST × 9 corps absurdes → jamais de 500, le serveur répond toujours", { timeout: 240_000 }, async () => {
  const { routes, bad } = await hostileSweep(cockpit.url)
  assert.ok(routes >= 35, `seulement ${routes} routes POST trouvées`)
  assert.deepEqual(bad, [])
})

test("rien n'est écrit hors du workspace ; aucun fichier au nom d'une traversée ; aucun job lancé par une entrée invalide", async () => {
  assert.deepEqual([...new Set(readdirSync(dirname(ws.dir)))].filter((f) => !parent0.has(f) && /passwd|agency\.config|x\.json/.test(f)), [])
  const now = files(ws.dir)
  const created = [...now].filter((f) => !before0.has(f))
  const suspicious = created.filter((f) => /passwd|\.\.|\u0000/.test(f))
  assert.deepEqual(suspicious, [], `créés : ${created.join(", ")}`)
  // les fichiers de l'agence et des fiches n'ont pas été réécrits par une traversée
  assert.doesNotMatch(ws.read("agency.config.json"), /pendingGmail|"status"/)
  for (const f of created) assert.ok(statSync(ws.path(f)).size < 20_000_000)
  assert.doesNotMatch(cockpit.output(), /npm run (edit|fill|demo|outreach)/, "aucune CLI lancée sur une entrée invalide")
})

test("corps de 17 Mo : refusé sans planter le serveur", { timeout: 60_000 }, async () => {
  const big = JSON.stringify({ id: "orvane-piscines-valmont-sur-lys", text: "x".repeat(17_000_000) })
  const r = await fetch(cockpit.url + "/api/love", { method: "POST", headers: { "content-type": "application/json" }, body: big, signal: AbortSignal.timeout(30_000) }).then((x) => x.status).catch(() => -1)
  assert.ok(r === -1 || (r >= 400 && r < 500), `statut ${r}`)
  assert.equal(await fetch(cockpit.url + "/api/run").then((x) => x.status), 200, "toujours vivant")
})
