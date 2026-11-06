/**
 * score-pool.ts — score (audit réel du site) un POOL de prospects contactables, sans générer les fiches.
 * Sert à classer rapidement un lot vérifié (email valide) par tier/valeur, avant l'outreach.
 *
 * Entrée : le CSV scrapé (VERIFY_CSV-like) filtré sur les emails d'un rapport de vérif (valid + catch-all).
 * Usage : npx tsx leadengine/2_scoring/scripts/score-pool.ts <csv> <verified-report.json> [cats=valid,catch-all]
 * Sortie : data/raw/scored-pool.json (trié par valeur) + distribution des tiers à l'écran.
 */
import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { scoreProspect } from "./score.ts"

try { process.loadEnvFile(".env") } catch { /* pas de .env : la porte LLM sera sautée, le score déterministe reste */ }
process.on("unhandledRejection", () => {})
process.on("uncaughtException", (e) => console.warn(`  ⚠ ignorée : ${e.message.slice(0, 70)}`))

type Row = { name: string; city: string; website: string; phone: string; industry: string; email: string }

function parseCsv(text: string): Row[] {
  const lines = text.split("\n").slice(1).filter(Boolean)
  return lines.map((ln) => {
    const c = ln.split(",")
    const email = (ln.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0] || "").toLowerCase()
    return { name: c[0] || "", city: c[1] || "", website: c[2] || "", phone: c[3] || "", industry: c[4] || "", email }
  })
}
const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)

async function main() {
  const [csvPath, reportPath, catsArg] = process.argv.slice(2)
  if (!csvPath || !reportPath) { console.error("usage: score-pool <csv> <verified-report.json> [cats]"); process.exit(1) }
  const cats = new Set((catsArg || "valid,catch-all").split(","))
  const report: { email: string; category: string }[] = JSON.parse(await readFile(reportPath, "utf8"))
  const okEmails = new Set(report.filter((r) => cats.has(r.category)).map((r) => r.email.toLowerCase()))
  const rows = parseCsv(await readFile(csvPath, "utf8")).filter((r) => r.website && okEmails.has(r.email))
  // dédup par site
  const seen = new Set<string>()
  const pool = rows.filter((r) => { const k = r.website.replace(/\/$/, ""); if (seen.has(k)) return false; seen.add(k); return true })
  console.log(`🎯 scoring de ${pool.length} prospects contactables (email ${[...cats].join("+")})…`)

  const results: any[] = []
  const CONC = Number(process.env.SCORE_CONC) || 3 // Playwright + LLM = lourd → concurrence basse (10 saturait)
  let i = 0, done = 0
  async function worker() {
    while (i < pool.length) {
      const r = pool[i++]
      const id = slug(`${r.name}-${r.city}`) || slug(r.website)
      try {
        const s = await scoreProspect(id, r.website, { industry: r.industry, phone: r.phone, email: r.email, name: r.name, city: r.city })
        results.push({ id, name: r.name, city: r.city, url: r.website, email: r.email, industry: r.industry, tier: s.tier, value: s.value })
      } catch (e) { results.push({ id, name: r.name, url: r.website, email: r.email, tier: "erreur", value: 0, err: (e as Error).message.slice(0, 60) }) }
      if (++done % 20 === 0) console.log(`  ${done}/${pool.length}…`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, pool.length) }, worker))

  results.sort((a, b) => b.value - a.value)
  await writeFile("data/raw/scored-pool.json", JSON.stringify(results, null, 2))
  const by = (t: string) => results.filter((r) => r.tier === t).length
  console.log("\n📊 DISTRIBUTION (audit réel du site)")
  console.log(`  🔥 hot  (≥60) : ${by("hot")}`)
  console.log(`  🌤️  warm (≥35) : ${by("warm")}`)
  console.log(`  🧊 cold (<35) : ${by("cold")}`)
  console.log(`  ⚠ erreurs     : ${by("erreur")}`)
  console.log(`  → contactables + hot/warm = ${by("hot") + by("warm")} prospects PRÊTS pour l'outreach`)
  console.log(`  top 5 : ${results.filter((r) => r.tier !== "erreur").slice(0, 5).map((r) => `${r.name}(${r.value})`).join(" · ")}`)
  console.log(`  → data/raw/scored-pool.json`)
}
main()
