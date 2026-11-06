/**
 * Test blitz (24/10) · le plafond d'évènements par envoi (CAPS.perTracking = 20) TIENT sous une rafale de clics
 * simultanés sur le même lien signé (scanner de passerelle, robot, rejeu). Avant : « compter puis écrire » laissait
 * passer toute la rafale (chaque requête voyait < 20). Sans base ici (fichier events.jsonl) ; avec base :
 * test/pg/tracking-flood.test.ts.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { makeWorkspace, type Workspace } from "../helpers/workspace.ts"
import { startCockpit } from "../helpers/cockpit.ts"
import { clickToken } from "../../outreach/tracking/links.ts"
import type { Proc } from "../helpers/server.ts"

const SECRET = "secret-de-test-fictif-rafale-0123456789abcdef"
let ws: Workspace, cockpit: Proc
before(async () => { ws = makeWorkspace({ seed: ["agency"] }); cockpit = await startCockpit(ws.dir, { LWS_TRACK_SECRET: SECRET }) })
after(async () => { await cockpit?.stop(); ws?.cleanup() })

test("rafale de 80 clics simultanés sur un même lien : 302 pour tous, au plus 20 évènements écrits", { timeout: 60_000 }, async () => {
  const tid = randomUUID()
  const token = clickToken(tid, "https://cal.agence.example/15min", SECRET)
  const codes = await Promise.all(Array.from({ length: 80 }, () => fetch(`${cockpit.url}/t/c/${token}`, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (rafale de test)" } }).then((r) => r.status)))
  assert.ok(codes.every((c) => c === 302), codes.join(","))
  const lines = ws.read("data/sequencer/events.jsonl").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.trackingId === tid)
  assert.ok(lines.length <= 20, `${lines.length} évènements écrits pour un plafond de 20`)
  assert.equal(lines.length, 20)
})
