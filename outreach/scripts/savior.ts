/**
 * savior.ts · GÉNÈRE le MAIL SAUVEUR (« le mail du siècle », Pool B de la séquence cold).
 *
 * Le mail de prospection parfait : hook personnalisé (depuis le brief diagnose), la démo perso en
 * réciprocité, la preuve sociale (l'équipe des 8), la garantie qui tue le risque, un RDV smooth (Cal.com
 * + tél). ZÉRO référence aux plaintes (il se tient seul). Tourne sur le PLAN (runSkill).
 *
 * Écrit `data/savior/<id>.json`. Consommé par le séquenceur (step "sauveur"). Mécanique + 1 appel LLM, zéro envoi.
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
  if (!id) { console.error("usage : npm run savior -- <id>"); process.exit(1) }

  const fichePath = join(PROSPECTS, `${id}.json`)
  if (!existsSync(fichePath)) { console.error(`fiche introuvable : ${fichePath}`); process.exit(1) }
  const fiche = JSON.parse(await readFile(fichePath, "utf8"))
  const brand = brandFacts() // agency.config.json (nom, expéditeur, équipe, offre, garantie, liens)
  const brief = fiche?.brief ?? {}

  // le WOW du mail parfait = NOTRE site vitrine (les 8, packages, réalisations). PAS la démo perso (= message 4).
  try { process.loadEnvFile() } catch { /* pas de .env */ }
  const siteUrl = brand.portfolioUrl

  const inputs = {
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

  console.log(`→ génération du mail sauveur pour ${inputs.business}…`)
  const out = await runSkill(".claude/skills/generate-savior", inputs, "smart", 4096)
  if (!out?.subject || !out?.body) throw new Error("sortie LLM invalide (attendu {subject, body}) :\n" + JSON.stringify(out).slice(0, 500))

  // filet DETERMINISTE : le LLM glisse des tirets cadratins malgre la consigne, on les bannit en dur (regle naly).
  // tiret cadratin (U+2014) / demi-cadratin (U+2013) entoures d'espaces ou tab deviennent une virgule ; retours ligne preserves.
  const noDash = (s: string) => String(s).replace(/[ \t]*[\u2014\u2013][ \t]*/g, ", ").replace(/ ,/g, ",").replace(/,\s*,/g, ",")
  const record = { prospectId: id, business: inputs.business, generatedAt: new Date().toISOString(), senderName: brand.senderName, subject: noDash(out.subject), body: noDash(out.body), siteUrl }
  await mkdir(OUT_DIR, { recursive: true })
  const dst = join(OUT_DIR, `${id}.json`)
  await writeFile(dst, JSON.stringify(record, null, 2))

  console.log(`✅ ${dst}`)
  console.log(`\n· MAIL SAUVEUR · objet : « ${out.subject} »  (signé ${brand.senderName})`)
  console.log(out.body)
}

main().catch((e) => { console.error(e); process.exit(1) })
