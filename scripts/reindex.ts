// scripts/reindex.ts — réindexe la DB (Supabase) depuis le FILESYSTEM (FS → DB).
// À lancer SUR LA BOX (elle a DATABASE_URL). Fait apparaître au cockpit les sites pull-és depuis git.
//   cd ~/lws && git pull && npm run reindex
try { process.loadEnvFile?.(".env") } catch { /* env déjà dans le shell/systemd */ }
if (!process.env.DATABASE_URL) {
  console.error("✗ DATABASE_URL absente — lance ce script SUR LA BOX (où la clé Supabase est dans .env), pas en local.")
  process.exit(1)
}
const { reindexAll } = await import("../packages/shared/reindex.ts")
const r = await reindexAll()
console.log("✓ reindex terminé:", JSON.stringify(r))
export {}
