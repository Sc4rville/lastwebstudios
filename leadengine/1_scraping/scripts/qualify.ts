/**
 * qualify.ts — QUALIFIE tous les prospects via l'API gouv (company.ts) : actif/cessé + taille + CA.
 * But : ne garder/appeler que de VRAIS bons prospects (on arrête de bosser des boîtes radiées).
 * Écrit le résultat dans la DB (colonnes ajoutées en idempotent) → le scoring et le cockpit s'en servent.
 *
 *   npm run qualify            # tous
 *   npm run qualify -- roanne  # filtre par sous-chaîne d'id
 */
import { getDb, closeDb } from "../../../packages/shared/db.ts"
import { lookupCompany } from "./company.ts"

try { process.loadEnvFile() } catch { /* pas de .env : on lit l'environnement */ }
const filter = process.argv[2] || ""
if (!process.env.DATABASE_URL) {
  console.error("✗ DATABASE_URL manquant : qualify lit et met à jour la table prospects (pose-le dans .env, cf. npm run db:init).")
  console.error("  Pour qualifier UNE entreprise sans base : npm run company -- \"<nom>\" [ville] [code postal]")
  process.exit(1)
}
const db = getDb()

// colonnes idempotentes (comme le pattern `love`) : registre = état + taille + CA, daté
for (const ddl of [
  "ALTER TABLE prospects ADD COLUMN IF NOT EXISTS company_active boolean",
  "ALTER TABLE prospects ADD COLUMN IF NOT EXISTS company_siren text",
  "ALTER TABLE prospects ADD COLUMN IF NOT EXISTS company_ca bigint",
  "ALTER TABLE prospects ADD COLUMN IF NOT EXISTS company_employees int",
  "ALTER TABLE prospects ADD COLUMN IF NOT EXISTS company_checked_at bigint",
]) { try { await db.prepare(ddl).run() } catch (e) { /* déjà là */ } }

const rows = (await db.prepare("SELECT id, name, city FROM prospects ORDER BY id").all()) as { id: string; name: string; city: string | null }[]
const targets = rows.filter((r) => !filter || r.id.includes(filter))
console.log(`${targets.length} prospect(s) à qualifier (API gouv recherche-entreprises)…\n`)

let actif = 0, cesse = 0, inconnu = 0, withCa = 0
const dead: string[] = []
const CONC = 2 // l'API gouv plafonne ~7 req/s → 2 workers espacés (+ retry 429 dans company.ts)
const queue = [...targets]
const now = Date.now()
async function worker(): Promise<void> {
  for (;;) {
    const p = queue.shift(); if (!p) return
    await new Promise((r) => setTimeout(r, 160)) // throttle doux
    // nom manquant en DB → fallback dérivé de l'id (slug → mots), sans le suffixe-ville le plus courant
    const nm = (p.name && p.name.trim()) || p.id.replace(/-/g, " ")
    const info = await lookupCompany(nm, { city: p.city || "" })
    if (info.status === "actif") actif++; else if (info.status === "cessé") { cesse++; dead.push(`${p.id} (${info.nom})`) } else inconnu++
    if (info.ca != null) withCa++
    try {
      await db.prepare("UPDATE prospects SET company_active=?, company_siren=?, company_ca=?, company_employees=?, company_checked_at=? WHERE id=?")
        .run(info.status === "inconnu" ? null : info.active, info.siren, info.ca, info.employees, now, p.id)
    } catch { /* */ }
    const tag = info.status === "actif" ? "✓" : info.status === "cessé" ? "✗ CESSÉ" : "?"
    if (info.status !== "actif" || info.ca != null) console.log(`  ${tag} ${p.id}${info.ca != null ? ` · CA ${(info.ca / 1000) | 0}k€` : ""}`)
  }
}
await Promise.all(Array.from({ length: CONC }, () => worker()))

console.log(`\n── QUALIFICATION ──`)
console.log(`✓ actifs : ${actif}   ✗ cessés : ${cesse}   ? inconnus : ${inconnu}   · CA dispo : ${withCa}/${targets.length}`)
if (dead.length) console.log(`\n⚠ À NE PLUS APPELER (radiés/cessés) :\n  ${dead.join("\n  ")}`)
closeDb()
process.exit(0)
