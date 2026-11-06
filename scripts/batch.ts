/**
 * batch.ts — empile un batch sur le WORKER (la box compose ; tes PC peuvent être éteints).
 *
 * C'est l'entrée CLI de `enqueueBatch` (le même que le bouton « run batch » du cockpit et le
 * `/batch` du bot Telegram). Le worker (systemd `lws-worker` sur la box) draine la file
 * `batch_requests` et compose en sur-mesure (composer) ou en template-fill.
 *
 * CLI : npm run batch -- <mode> [n] [--industry <métier>] [--seed <csv>] [--force] [--ids a,b,c]
 *   mode  = composer (défaut, sur-mesure = voie standard) | template-fill
 *   n     = nombre de prospects (LIMIT)
 *   --ids = RERUN : re-composer ces prospects EXISTANTS avec le composer ACTUEL (skip scrape)
 */
import { fileURLToPath } from "node:url"
import { enqueueBatch, type BatchMode } from "../packages/shared/batch.ts"
import { closeDb } from "../packages/shared/db.ts"

try { process.loadEnvFile() } catch { /* pas de .env → enqueueBatch lèvera si DATABASE_URL manque */ }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
  const valued = new Set(["--industry", "--seed", "--ids"].flatMap((k) => { const i = args.indexOf(k); return i >= 0 ? [i + 1] : [] }))
  const pos = args.filter((a, i) => !a.startsWith("--") && !valued.has(i))
  // le MODE est obligatoire : `npm run batch` seul ne doit jamais empiler un vrai batch par accident
  if (pos[0] !== "composer" && pos[0] !== "template-fill") {
    console.error("usage: npm run batch -- <composer|template-fill> [n] [--industry <métier>] [--seed <csv>] [--force] [--ids a,b,c]")
    process.exit(1)
  }
  if (!process.env.DATABASE_URL) {
    console.error("✗ DATABASE_URL manquant : la file des batchs vit dans la base partagée (pose-le dans .env, cf. npm run db:init).")
    process.exit(1)
  }
  const mode: BatchMode = pos[0]
  const lim = pos[1] ? Number(pos[1]) : null
  const industry = flag("--industry") || null
  const seed = flag("--seed") || null
  const idsRaw = flag("--ids")
  const ids = idsRaw ? idsRaw.split(",").map((s) => s.trim()).filter(Boolean) : null
  const force = args.includes("--force")
  const row = await enqueueBatch({ mode, lim, industry, seed, ids, force, requestedBy: "pipe-cli", note: "via /pipe" })
  console.log(`✓ batch #${row.id} empilé (mode=${row.mode}${industry ? ` · industry=${industry}` : ""}${lim ? ` · n=${lim}` : ""}${ids ? ` · ids=${ids.length}` : ""}${force ? " · force" : ""})`)
  console.log("  → le worker (box) le prend en charge. Suivi : cockpit /  ·  npm run telegram  ·  la file dans le cockpit.")
  closeDb()
}
