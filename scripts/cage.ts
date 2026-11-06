/**
 * cage.ts · `npm run cage` : LA CAGE 24/7 depuis un terminal (la box en SSH, un cron, le guide). Même état que le
 * bandeau du cockpit et la vue Machine (packages/shared/cage.ts) : STOP, budget du jour, disjoncteur, mode d'envoi.
 *
 *   npm run cage                      l'état, en clair (exit 0)          · `-- --json` : sortie machine
 *   npm run cage -- stop [raison…]    pose l'arrêt d'urgence (base partagée si DATABASE_URL, sinon fichier STOP)
 *   npm run cage -- resume            lève l'arrêt d'urgence (base + fichier local)
 *   npm run cage -- check             exit 3 si STOP posé (fichier ou cockpit), 0 sinon : c'est ce que
 *                                     architecture/scheduling/run-guarded.sh appelle avant chaque job planifié
 *
 * Le disjoncteur se réarme avec `npm run sequencer -- breaker reset` (ou le cockpit) : un geste humain voulu.
 */
import { fileURLToPath } from "node:url"
import { userInfo } from "node:os"
import { cageStatus, setStop, stopState } from "../packages/shared/cage.ts"
import { closeDb } from "../packages/shared/db.ts"

/** Code de sortie de `check` quand le STOP est posé (le même que le worker : « arrêt voulu », pas une panne). */
export const STOP_EXIT = 3

const usd = (n: number | null | undefined) => (n == null ? "-" : `${n.toFixed(2)} $`)
const pct = (x: number) => `${(Math.round(x * 1000) / 10).toFixed(1)} %`
const who = () => { try { return `cli:${userInfo().username}` } catch { return "cli" } }

async function status(json: boolean): Promise<void> {
  const c = await cageStatus()
  if (json) { console.log(JSON.stringify(c, null, 2)); return }
  const b = c.budget, br = c.breaker
  console.log(c.alerts.length ? `⚠ la cage signale : ${c.alerts.join(", ")}` : "✓ la cage est au calme : rien d'anormal")
  console.log(`  arrêt d'urgence  ${c.stop.on ? `⏹ STOP (${c.stop.source} : ${c.stop.reason})` : "libre"}`)
  console.log(`  budget du jour   ${b.capUsd != null ? `${usd(b.spentUsd)} / ${usd(b.capUsd)}${b.reached ? " · ATTEINT, aucun job avant minuit UTC" : ""}` : `${usd(b.spentUsd)} · sans plafond (pose LWS_BUDGET_USD_DAY)`}`)
  console.log(`                   agents ${usd(b.byKind.agent)} · llm ${usd(b.byKind.llm)} · images ${usd(b.byKind.image)} · vidéos ${usd(b.byKind.video)}`)
  if (br) {
    console.log(`  disjoncteur      ${br.open ? "⛔ OUVERT : aucun mail ne part" : "fermé"} · ${br.counts.sends} envoi(s) depuis ${br.since.slice(0, 10)}`)
    console.log(`                   bounces ${pct(br.rates.bounce)} / ${pct(br.thresholds.bounceRate)} · plaintes ${pct(br.rates.complaint)} / ${pct(br.thresholds.complaintRate)} · désinscriptions ${pct(br.rates.unsub)} / ${pct(br.thresholds.unsubRate)}`)
    for (const r of br.reasons) console.log(`                   · ${r}`)
  } else console.log("  disjoncteur      jamais évalué (aucun tick du séquenceur encore)")
  console.log(`  envoi des mails  ${c.send.mode} · ${c.send.detail}`)
}

async function main(): Promise<number> {
  try { process.loadEnvFile() } catch { /* pas de .env : fichier STOP seul */ }
  const [cmd = "status", ...rest] = process.argv.slice(2).filter((a) => a !== "--json")
  const json = process.argv.includes("--json")
  if (cmd === "status") { await status(json); return 0 }
  if (cmd === "check") {
    const s = await stopState()
    if (s.on) { console.log(`⏹ STOP (${s.source} : ${s.reason}) : rien ne part.`); return STOP_EXIT }
    console.log("✓ pas de STOP")
    return 0
  }
  if (cmd === "stop" || cmd === "resume") {
    const on = cmd === "stop"
    const s = await setStop(on, rest.join(" "), who())
    if (s.on !== on) { console.error("✗ STOP non enregistré (base indisponible ?) : en dernier recours, `echo raison > STOP` à la racine"); return 1 }
    console.log(on
      ? `⏹ STOP posé (${s.source}${s.reason ? ` : ${s.reason}` : ""}). Le worker sort au tick suivant ; séquenceur, warmup, boost média et timers ne font plus rien.`
      : "▶ STOP levé. Séquenceur, warmup et timers reprennent d'eux-mêmes ; relance le worker : systemctl --user restart lws-worker")
    return 0
  }
  console.error(`commande inconnue « ${cmd} ». usage : npm run cage [-- status | stop [raison] | resume | check] [--json]`)
  return 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => { closeDb(); process.exit(code) }).catch((e) => { console.error(`✗ ${(e as Error).message}`); closeDb(); process.exit(1) })
}
