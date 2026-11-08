/**
 * batch.ts — queues a batch for the WORKER (the box composes; your computers can be off).
 *
 * It is the CLI entry of `enqueueBatch` (the same as the cockpit's "run batch" button and the
 * Telegram bot's `/batch`). The worker (systemd `lws-worker` on the box) drains the `batch_requests`
 * queue and composes custom sites (composer) or template-fill ones.
 *
 * CLI: npm run batch -- <mode> [n] [--industry <trade>] [--seed <csv>] [--force] [--ids a,b,c]
 *   mode  = composer (default, custom = the standard path) | template-fill
 *   n     = nombre de prospects (LIMIT)
 *   --ids = RERUN: re-compose these EXISTING prospects with the CURRENT composer (skip scrape)
 */
import { fileURLToPath } from "node:url"
import { enqueueBatch, type BatchMode } from "../packages/shared/batch.ts"
import { closeDb } from "../packages/shared/db.ts"

try { process.loadEnvFile() } catch { /* no .env → enqueueBatch throws if DATABASE_URL is missing */ }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
  const valued = new Set(["--industry", "--seed", "--ids"].flatMap((k) => { const i = args.indexOf(k); return i >= 0 ? [i + 1] : [] }))
  const pos = args.filter((a, i) => !a.startsWith("--") && !valued.has(i))
  // the MODE is required: `npm run batch` alone must never queue a real batch by accident
  if (pos[0] !== "composer" && pos[0] !== "template-fill") {
    console.error("usage: npm run batch -- <composer|template-fill> [n] [--industry <trade>] [--seed <csv>] [--force] [--ids a,b,c]")
    process.exit(1)
  }
  if (!process.env.DATABASE_URL) {
    console.error("✗ DATABASE_URL missing: the batch queue lives in the shared database (set it in .env, see npm run db:init).")
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
  console.log(`✓ batch #${row.id} queued (mode=${row.mode}${industry ? ` · industry=${industry}` : ""}${lim ? ` · n=${lim}` : ""}${ids ? ` · ids=${ids.length}` : ""}${force ? " · force" : ""})`)
  console.log("  → the worker (box) takes it. Follow it: the cockpit  ·  npm run telegram  ·  the queue in the cockpit.")
  closeDb()
}
