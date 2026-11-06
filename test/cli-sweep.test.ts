/**
 * BALAYAGE DES CLIs (G1) : chaque `npm run <cli>` lancé SANS argument dans un workspace vide (pas de .env,
 * pas de base, pas de clé, réseau sortant coupé par un proxy mort) doit répondre proprement : un usage ou
 * un message clair, jamais une SyntaxError ni une pile d'exception. C'est exactement ce que voit un inconnu
 * qui clone le dépôt et tape une commande.
 */
import { describe, test, before, after } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { makeWorkspace, type Workspace } from "./helpers/workspace.ts"
import { npmRun } from "./helpers/proc.ts"

// serveurs / démons / actions sur la machine : couverts ailleurs (cockpit, start.sh) ou volontairement exclus
const SKIP: Record<string, string> = {
  "backoffice": "serveur (couvert par test/cockpit et test/ops)",
  "backoffice:serve": "serveur (couvert par test/cockpit)",
  "share": "ouvre un tunnel public cloudflared : jamais en test",
  "calendar": "serveur + git + xdg-open",
  "docs": "serveur de docs",
  "sales": "serveur de vente",
  "hooks": "modifie la config git",
  "sandbox": "serveur (l'agence fictive) : couvert par test/sandbox.test.ts (--check)",
  "oss:export": "construit l'export open source : couvert par test/oss/export.test.ts",
  "test": "harnais", "test:pg": "harnais", "test:e2e": "harnais", "typecheck": "harnais",
}
// signature d'un plantage (pas d'un refus propre)
const CRASH = /SyntaxError|ReferenceError|TypeError:|Cannot find module|ERR_MODULE_NOT_FOUND|ERR_UNKNOWN_FILE_EXTENSION|Unhandled|^\s+at .+:\d+:\d+\)?$/m

const scripts = Object.keys(JSON.parse(readFileSync("package.json", "utf8")).scripts as Record<string, string>).filter((s) => !SKIP[s])

describe("chaque CLI sans argument répond proprement (usage ou message, jamais un crash)", { concurrency: 4 }, () => {
  let ws: Workspace
  before(() => { ws = makeWorkspace() })
  after(() => ws?.cleanup())
  const env = {
    // réseau sortant coupé : fetch (Node ≥ 24 avec NODE_USE_ENV_PROXY) passe par un proxy mort
    NODE_USE_ENV_PROXY: "1", HTTP_PROXY: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9", NO_PROXY: "127.0.0.1,localhost",
    BACKOFFICE_PORT: "1", LWS_NO_OPEN: "1",
  }
  for (const name of scripts) {
    test(`npm run ${name}`, async () => {
      const r = await npmRun(ws.dir, name, [], { env, timeoutMs: 60_000 })
      assert.equal(r.timedOut, false, `${name} ne rend pas la main (60 s) :\n${r.out.slice(-800)}`)
      assert.doesNotMatch(r.out, CRASH, `${name} plante :\n${r.out.slice(-1500)}`)
      assert.ok(r.out.trim().length > 0, `${name} ne dit rien`)
    })
  }
})
