/**
 * qualify.ts — QUALIFIES every prospect through the French government API (company.ts): active/closed + size + revenue.
 * Goal: keep/call only REAL good prospects (we stop working on struck-off companies).
 * Writes the result to the DB (columns added idempotently) → scoring and the cockpit use it.
 *
 *   npm run qualify            # all
 *   npm run qualify -- roanne  # filter by id substring
 */
import { getDb, closeDb } from "../../../packages/shared/db.ts"
import { lookupCompany } from "./company.ts"

try { process.loadEnvFile() } catch { /* no .env: we read the environment */ }
const filter = process.argv[2] || ""
if (!process.env.DATABASE_URL) {
  console.error("✗ DATABASE_URL is missing: qualify reads and updates the prospects table (set it in .env, see npm run db:init).")
  console.error("  To qualify ONE company without a database: npm run company -- \"<name>\" [town] [postcode]")
  process.exit(1)
}
const db = getDb()

// idempotent columns (like the `love` pattern): registry = status + size + revenue, dated
for (const ddl of [
  "ALTER TABLE prospects ADD COLUMN IF NOT EXISTS company_active boolean",
  "ALTER TABLE prospects ADD COLUMN IF NOT EXISTS company_siren text",
  "ALTER TABLE prospects ADD COLUMN IF NOT EXISTS company_ca bigint",
  "ALTER TABLE prospects ADD COLUMN IF NOT EXISTS company_employees int",
  "ALTER TABLE prospects ADD COLUMN IF NOT EXISTS company_checked_at bigint",
]) { try { await db.prepare(ddl).run() } catch (e) { /* already there */ } }

const rows = (await db.prepare("SELECT id, name, city FROM prospects ORDER BY id").all()) as { id: string; name: string; city: string | null }[]
const targets = rows.filter((r) => !filter || r.id.includes(filter))
console.log(`${targets.length} prospect(s) to qualify (government API recherche-entreprises)…\n`)

let actif = 0, cesse = 0, inconnu = 0, withCa = 0
const dead: string[] = []
const CONC = 2 // the government API caps at ~7 req/s → 2 spaced workers (+ 429 retry in company.ts)
const queue = [...targets]
const now = Date.now()
async function worker(): Promise<void> {
  for (;;) {
    const p = queue.shift(); if (!p) return
    await new Promise((r) => setTimeout(r, 160)) // gentle throttle
    // name missing in the DB → fallback derived from the id (slug → words), without the most common town suffix
    const nm = (p.name && p.name.trim()) || p.id.replace(/-/g, " ")
    const info = await lookupCompany(nm, { city: p.city || "" })
    if (info.status === "actif") actif++; else if (info.status === "cessé") { cesse++; dead.push(`${p.id} (${info.nom})`) } else inconnu++
    if (info.ca != null) withCa++
    try {
      await db.prepare("UPDATE prospects SET company_active=?, company_siren=?, company_ca=?, company_employees=?, company_checked_at=? WHERE id=?")
        .run(info.status === "inconnu" ? null : info.active, info.siren, info.ca, info.employees, now, p.id)
    } catch { /* */ }
    const tag = info.status === "actif" ? "✓" : info.status === "cessé" ? "✗ CLOSED" : "?"
    if (info.status !== "actif" || info.ca != null) console.log(`  ${tag} ${p.id}${info.ca != null ? ` · revenue ${(info.ca / 1000) | 0}k€` : ""}`)
  }
}
await Promise.all(Array.from({ length: CONC }, () => worker()))

console.log(`\n── QUALIFICATION ──`)
console.log(`✓ active: ${actif}   ✗ closed: ${cesse}   ? unknown: ${inconnu}   · revenue known: ${withCa}/${targets.length}`)
if (dead.length) console.log(`\n⚠ DO NOT CALL AGAIN (struck off / closed):\n  ${dead.join("\n  ")}`)
closeDb()
process.exit(0)
