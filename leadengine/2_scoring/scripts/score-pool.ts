/**
 * score-pool.ts — scores (a real audit of the site) a POOL of contactable prospects, without writing the sheets.
 * Used to quickly rank a verified batch (valid email) by tier/value, before outreach.
 *
 * Input: the scraped CSV (VERIFY_CSV-like) filtered on the emails of a verification report (valid + catch-all).
 * Usage: npx tsx leadengine/2_scoring/scripts/score-pool.ts <csv> <verified-report.json> [cats=valid,catch-all]
 * Output: data/raw/scored-pool.json (sorted by value) + the tier distribution on screen.
 */
import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { scoreProspect } from "./score.ts"

try { process.loadEnvFile(".env") } catch { /* no .env: the LLM gate is skipped, the deterministic score stays */ }
process.on("unhandledRejection", () => {})
process.on("uncaughtException", (e) => console.warn(`  ⚠ ignored: ${e.message.slice(0, 70)}`))

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
  // dedup by site
  const seen = new Set<string>()
  const pool = rows.filter((r) => { const k = r.website.replace(/\/$/, ""); if (seen.has(k)) return false; seen.add(k); return true })
  console.log(`🎯 scoring ${pool.length} contactable prospects (email ${[...cats].join("+")})…`)

  const results: any[] = []
  const CONC = Number(process.env.SCORE_CONC) || 3 // Playwright + LLM = heavy → low concurrency (10 saturated)
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
  console.log("\n📊 DISTRIBUTION (real audit of the site)")
  console.log(`  🔥 hot  (≥60): ${by("hot")}`)
  console.log(`  🌤️  warm (≥35): ${by("warm")}`)
  console.log(`  🧊 cold (<35): ${by("cold")}`)
  console.log(`  ⚠ errors     : ${by("erreur")}`)
  console.log(`  → contactable + hot/warm = ${by("hot") + by("warm")} prospects READY for outreach`)
  console.log(`  top 5: ${results.filter((r) => r.tier !== "erreur").slice(0, 5).map((r) => `${r.name}(${r.value})`).join(" · ")}`)
  console.log(`  → data/raw/scored-pool.json`)
}
main()
