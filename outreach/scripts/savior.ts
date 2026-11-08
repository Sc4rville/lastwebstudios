/**
 * savior.ts · GENERATES the FIRST EMAIL ("the savior email", Pool B of the cold sequence).
 *
 * The perfect prospecting email: a personal hook (from the diagnose brief), the personal demo as
 * reciprocity, social proof (the agency's team), the guarantee that removes the risk, an easy meeting (Cal.com
 * + phone). ZERO reference to complaints (it stands on its own). Runs on the PLAN (runSkill).
 *
 * Writes `data/savior/<id>.json`. Used by the sequencer (step "mail-parfait"). Mechanical + 1 LLM call, zero sending.
 *
 * CLI : npm run savior -- <id>
 */
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { runSkill } from "../../packages/utils/run-skill.ts"
import { brandFacts } from "../../packages/shared/agency.mjs"

const PROSPECTS = "data/prospects"
const OUT_DIR = "data/savior"

async function main() {
  const id = process.argv.slice(2).find((a) => !a.startsWith("-"))
  if (!id) { console.error("usage: npm run savior -- <id>"); process.exit(1) }

  const fichePath = join(PROSPECTS, `${id}.json`)
  if (!existsSync(fichePath)) { console.error(`prospect record not found: ${fichePath}`); process.exit(1) }
  const fiche = JSON.parse(await readFile(fichePath, "utf8"))
  const brand = brandFacts() // agency.config.json (name, sender, team, offer, guarantee, links)
  const brief = fiche?.brief ?? {}

  // the WOW of the perfect email = OUR showcase site (the team, packages, past work). NOT the personal demo (= message 4).
  try { process.loadEnvFile() } catch { /* no .env */ }
  const siteUrl = brand.portfolioUrl

  // the opening of this first email (learning/scripts/words.ts) : each in turn, then leaning on the one that gets
  // replies, bounded ; recorded with the email so its replies are counted for it
  const { pickAngle, angleStats, emailAngles, ANGLES } = await import("../../learning/scripts/words.ts")
  const { loadOutcomes } = await import("../../learning/scripts/learn.ts")
  const pick = pickAngle("email", id, angleStats("email", emailAngles(), (await loadOutcomes()).outcomes))

  const inputs = {
    opening: ANGLES.email.find((a) => a.key === pick.angle)!.brief,
    business: fiche?.identity?.name ?? id,
    ville: fiche?.identity?.city ?? "",
    metier: fiche?.industry ?? "",
    services: (fiche?.content?.services ?? []).join(", "),
    angle: brief?.angle ?? "",
    moves: (brief?.moves ?? []).join(" · "),
    problemes: (brief?.problems ?? []).join("\n"),
    expediteur: brand.expediteur,
    studio: brand.studio,
    equipe: brand.team,
    offre: brand.offer,
    garantie: brand.garantie,
    "lien site": siteUrl,
    "lien rdv": brand.calcomUrl,
    telephone: brand.phone,
  }

  console.log(`→ writing the first email for ${inputs.business}…`)
  const out = await runSkill(".claude/skills/generate-savior", inputs, "smart", 4096)
  if (!out?.subject || !out?.body) throw new Error("invalid LLM output (expected {subject, body}):\n" + JSON.stringify(out).slice(0, 500))

  // DETERMINISTIC safety net: the LLM slips in em dashes despite the instruction, so they are banned in code (the team's rule).
  // an em dash (U+2014) / en dash (U+2013) surrounded by spaces or tabs becomes a comma; line breaks are kept.
  const noDash = (s: string) => String(s).replace(/[ \t]*[\u2014\u2013][ \t]*/g, ", ").replace(/ ,/g, ",").replace(/,\s*,/g, ",")
  const record = { prospectId: id, business: inputs.business, generatedAt: new Date().toISOString(), senderName: brand.senderName, subject: noDash(out.subject), body: noDash(out.body), siteUrl, angle: pick.angle, angleWhy: pick.why }
  await mkdir(OUT_DIR, { recursive: true })
  const dst = join(OUT_DIR, `${id}.json`)
  await writeFile(dst, JSON.stringify(record, null, 2))

  console.log(`✅ ${dst}`)
  console.log(`\n· FIRST EMAIL · subject: "${out.subject}"  (signed ${brand.senderName})`)
  console.log(out.body)
}

main().catch((e) => { console.error(e); process.exit(1) })
