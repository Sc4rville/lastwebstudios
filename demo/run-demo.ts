/**
 * npm run demo — the whole pipeline, end to end, offline, on three FICTIONAL prospects:
 *
 *   Atelier Braise      a dated site          → scored, parsed, structured, rebuilt, verified, packaged
 *   Studio Nord         a modern site         → dropped at the gate (it costs one fetch)
 *   Menuiserie Fantôme  a dead site           → kept for a manual build (nothing to rebuild from)
 *
 * Skills are answered from demo/replay/ when no LLM key is configured, so it runs with zero secrets.
 */
import { serveStatic, demoSeed } from "./server.ts"
import { parseCsv, runPipeline } from "../architecture/orchestration/run.ts"

const { url, server } = await serveStatic("demo")
try {
  const rows = parseCsv(await demoSeed(url))
  const result = await runPipeline({ rows })
  if (result.built) console.log("\n→ npm run preview   to open the demo and the before/after page\n")
  process.exitCode = result.built === 1 ? 0 : 1
} finally {
  server.close()
}
