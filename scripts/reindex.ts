// scripts/reindex.ts — reindexes the DB (Supabase) from the FILESYSTEM (FS → DB).
// Run it ON THE BOX (it has DATABASE_URL). Makes the sites pulled from git show up in the cockpit.
//   cd ~/lws && git pull && npm run reindex
try { process.loadEnvFile?.(".env") } catch { /* env already in the shell/systemd */ }
if (!process.env.DATABASE_URL) {
  console.error("✗ DATABASE_URL missing — run this script ON THE BOX (where the Supabase key is in .env), not locally.")
  process.exit(1)
}
const { reindexAll } = await import("../packages/shared/reindex.ts")
const r = await reindexAll()
console.log("✓ reindex done:", JSON.stringify(r))
export {}
