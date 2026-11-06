/**
 * Radar d'industries (1_scraping) — LE CHOIX DES CIBLES, rendu INTELLIGENT.
 *
 * Le problème : « quelles verticales attaquer » décidait du CA possible, et c'était choisi À LA MAIN.
 * Le radar SCORE les métiers eux-mêmes (pas les prospects) sur 4 dimensions et sort une liste RANGÉE :
 *   • VALEUR-TICKET   ce qu'ils peuvent nous payer (baseline `value` de industries.ts)
 *   • WEB-DÉCISIF     un beau site change-t-il la donne ? (baseline `lever`)
 *   • TAM VENDABLE    indépendants francophonie × (1 − densité de franchises). ← la leçon piscine.
 *   • RÉCURRENT       entretien / saisonnier / patients fidèles → CA qui s'empile.
 *
 * SOURCE UNIQUE : tout vient de `industries.ts` (un métier = une entrée, scrapable + scoré + dims radar).
 * Zéro LLM, instantané, transparent. S'AFFINE seul : lit les règles apprises (`learning/`) → la
 * conversion réelle d'un métier ajuste son rang.
 *
 * Usage : npm run radar              (classe tout l'univers + écrit design/industries/RADAR.md)
 *         npm run radar -- <métier>  (le détail d'un métier)
 */
import { writeFile, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { INDUSTRIES, type Industry } from "./industries.ts"
import { loadRules } from "../../../learning/scripts/rules.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const MD_PATH = join(ROOT, "design", "industries", "RADAR.md") // le classement, en md lisible (généré)

// défauts pour les dimensions radar non renseignées sur une entrée
const DEF = { tam: 3000, franchised: 15, recurring: 30, ticket: "?" }
// Poids : TICKET et WEB-DÉCISIF dominent (notre business = gros panier × vendu par l'image).
const W = { value: 0.45, web: 0.33, tam: 0.12, recurring: 0.10 } as const
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))
const tamScore = (sellable: number) => clamp((Math.log10(sellable + 1) / Math.log10(20000)) * 100)

export type Scored = {
  key: string; label: string; ticket: string
  tam: number; franchised: number; recurring: number
  value: number; web: number; sellableTam: number
  score: number; tier: "prioritaire" | "ok" | "éviter"; scrapable: boolean; why: string
}

const tierOf = (s: number) => (s >= 73 ? "prioritaire" : s >= 55 ? "ok" : "éviter") as Scored["tier"]

/** Score un métier de `industries.ts`. `valueDelta` = ajustement appris (conversion réelle) ; 0 par défaut. */
export function scoreIndustry(key: string, ind: Industry, valueDelta = 0): Scored {
  const value = clamp((ind.value ?? 60) + valueDelta)
  const web = clamp(ind.lever ?? 60)
  const tam = ind.tam ?? DEF.tam
  const franchised = ind.franchised ?? DEF.franchised
  const recurring = ind.recurring ?? DEF.recurring
  const ticket = ind.ticket ?? DEF.ticket
  const sellableTam = Math.round(tam * (1 - franchised / 100))
  const score = clamp(W.value * value + W.web * web + W.tam * tamScore(sellableTam) + W.recurring * recurring)
  const scrapable = (ind.osm?.length ?? 0) > 0 || (ind.naf?.length ?? 0) > 0
  const why = `ticket ${value} · web ${web} · vivier ${sellableTam.toLocaleString("fr")} indép. (${franchised}% franchisé) · récurrent ${recurring}`
  return { key, label: ind.label, ticket, tam, franchised, recurring, value, web, sellableTam, score, tier: tierOf(score), scrapable, why }
}

/** Classe TOUT industries.ts, en appliquant les ajustements appris (learning) si présents. */
export async function rankIndustries(): Promise<Scored[]> {
  const rules = await loadRules()
  return Object.entries(INDUSTRIES)
    .map(([key, ind]) => scoreIndustry(key, ind, rules.industries?.[key]?.value ?? 0))
    .sort((a, b) => b.score - a.score)
}

const ICON = { prioritaire: "🎯", ok: "✅", éviter: "⚠️ " } as const

/** Le classement, en markdown lisible (artefact indépendant régénéré par `npm run radar`). */
export function renderMd(ranked: Scored[]): string {
  const L: string[] = []
  L.push("# Radar d'industries — quelles verticales attaquer", "")
  L.push("> **Généré par `npm run radar`** (ne pas éditer à la main). Score = ticket × web-décisif ×")
  L.push("> vivier vendable (TAM × (1 − franchises)) × récurrent. Source unique : `industries.ts`.", "")
  L.push(`> ${ranked.length} métiers · ${ranked.filter((r) => r.tier === "prioritaire").length} prioritaires.`, "")
  L.push("> ⚠ Une partie des baselines (ticket/tam/franchise) est **estimée, non vérifiée** (annotations `recherche non")
  L.push("> vérifiée` / `baseline estimée` dans `industries.ts`) → lire les scores comme un ORDRE DE PRIORITÉ, pas des chiffres durs.", "")
  L.push("| # | score | tier | métier | ticket de leur vente | vivier vendable | franchise | état |")
  L.push("|--:|:--:|:--|---|---|--:|--:|:--|")
  ranked.forEach((r, i) => {
    const icon = r.tier === "prioritaire" ? "🎯" : r.tier === "ok" ? "✅" : "⚠️"
    L.push(`| ${i + 1} | **${r.score}** | ${icon} ${r.tier} | ${r.label} | ${r.ticket} | ${r.sellableTam.toLocaleString("fr")} | ${r.franchised}% | ${r.scrapable ? "scrapable" : "à câbler"} |`)
  })
  L.push("", "🎯 prioritaire ≥73 · ✅ ok 55–72 · ⚠️ éviter <55", "")
  const toWire = ranked.filter((r) => !r.scrapable && r.tier !== "éviter")
  if (toWire.length) {
    L.push("## À câbler (premium, pas encore scrapables)", "")
    L.push("Voir le skill `radar-industries` (créer une industrie) : recherche `osm/naf/terms/chains` →", "entrée `industries.ts` + profil `design/industries/<key>.md`.", "")
    for (const r of toWire) L.push(`- **${r.label}** (${r.score}) — ${r.ticket}`)
  } else {
    L.push("✅ **Toutes les verticales rentables sont câblées** (scrapables).")
  }
  return L.join("\n") + "\n"
}

/** Une ligne radar pour un métier (baselines, sans learning) — le nudge affiché au lancement d'un scrape. */
export function radarOneLine(key: string): string | null {
  const ind = INDUSTRIES[key]
  if (!ind) return null
  const r = scoreIndustry(key, ind)
  return `${ICON[r.tier]} radar ${r.score}/100 (${r.tier}) — ${r.why}`
}

// --- CLI ---
if (import.meta.url === `file://${process.argv[1]}`) {
  const ranked = await rankIndustries()
  const one = process.argv[2]

  if (one) {
    const r = ranked.find((x) => x.key === one || x.label.includes(one))
    if (!r) { console.error(`métier inconnu : ${one}. Connus : ${ranked.map((x) => x.key).join(", ")}`); process.exit(1) }
    console.log(`\n${ICON[r.tier]} ${r.label} — ${r.score}/100 (${r.tier})`)
    console.log(`   ticket de leur vente : ${r.ticket}`)
    console.log(`   ${r.why}`)
    console.log(`   ${r.scrapable ? "✅ scrapable : npm run scrape -- " + r.key : "⛔ à câbler dans industries.ts (osm/naf manquants)"}`)
  } else {
    console.log(`\n📡 RADAR D'INDUSTRIES — ${ranked.length} verticales (score = ticket × web-décisif × vivier vendable × récurrent)\n`)
    console.log("  #  score  métier                                        ticket             vivier      état")
    console.log("  ─────────────────────────────────────────────────────────────────────────────────────────────")
    ranked.forEach((r, i) => {
      const rank = String(i + 1).padStart(2)
      const sc = `${ICON[r.tier]}${String(r.score).padStart(2)}`
      const lbl = r.label.slice(0, 44).padEnd(44)
      const tk = r.ticket.slice(0, 18).padEnd(18)
      const tam = `${(r.sellableTam / 1000).toFixed(1)}k`.padStart(6)
      console.log(`  ${rank}  ${sc}  ${lbl} ${tk} ${tam}    ${r.scrapable ? "scrapable" : "à câbler"}`)
    })
    await mkdir(dirname(MD_PATH), { recursive: true })
    await writeFile(MD_PATH, renderMd(ranked))
    console.log(`\n  📄 classement écrit → design/industries/RADAR.md`)
    const toWire = ranked.filter((r) => !r.scrapable && r.tier === "prioritaire")
    console.log("\n  🎯 prioritaire ≥73 · ✅ ok 55–72 · ⚠️ éviter <55")
    if (toWire.length) console.log(`  ➜ À CÂBLER : ${toWire.map((r) => `${r.label} (${r.score})`).join(", ")}`)
    console.log("")
  }
}
