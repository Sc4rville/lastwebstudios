/**
 * Structuration (3_parsing) — wrapper du skill `structuration`.
 *
 * Lit le brut data/raw/<id>.json, fait tourner le skill (via le runner),
 * assemble la fiche (identité + contenu + assets + score) → data/prospects/<id>.json.
 *
 * Export : structureFiche(id, industry, identity, score)
 * Usage CLI : npm run structure -- <id> <industry> [city]
 */
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { runSkill } from "../../../packages/utils/run-skill.ts"
import { selectProvider } from "../../../packages/llm/provider.ts"
import type { Score } from "../../2_scoring/scripts/score.ts"
import { normalizeIndustry, isKnownIndustry, INDUSTRIES } from "../../1_scraping/scripts/industries.ts"
import { isChain } from "../../1_scraping/scripts/util.ts"

type Identity = { name: string; city: string; phone?: string }

/* validation de la sortie LLM : une structuration « vide » (services:[] + about = dump brut) ne doit
   JAMAIS passer pour une fiche propre (cas réel : texte brut du site recopié tel quel). Dump = long, multi-lignes, non rédigé. */
function structureOk(out: any): { ok: boolean; why: string } {
  const services = out?.content?.services ?? []
  const about = String(out?.content?.about ?? "")
  if (!services.length && !about) return { ok: false, why: "content vide (ni services ni about)" }
  if (!services.length) return { ok: false, why: "services vides" }
  if (about.length > 1200 && (about.match(/\n/g)?.length ?? 0) > 12) return { ok: false, why: "about = dump brut non rédigé" }
  return { ok: true, why: "" }
}

export async function structureFiche(
  id: string,
  industry: string,
  identity: Identity,
  score: Score,
) {
  const raw = JSON.parse(await readFile(join("data", "raw", `${id}.json`), "utf8"))

  // GATE FIT à l'entrée des fiches : une chaîne/franchise ne devient JAMAIS une fiche, même entrée par
  // un seed manuel (le filtre du scrape avait laissé passer ixina par cette porte).
  const chains = INDUSTRIES[normalizeIndustry(industry)]?.chains
  if (isChain(identity.name || id, raw.url ?? "", chains)) {
    throw new Error(`${id} : chaîne/franchise détectée (${identity.name || id}) — hors cible, fiche refusée`)
  }

  // TAXONOMIE : la fiche n'écrit QUE le vocabulaire canonique (source unique : industries.ts)
  const ind = normalizeIndustry(industry)
  if (ind && !isKnownIndustry(ind)) console.warn(`⚠ ${id} : métier "${ind}" hors table INDUSTRIES → baselines génériques (à câbler)`)

  let out = await runSkill(".claude/skills/structuration", {
    industrie: ind,
    "texte brut": raw.text,
  })
  // sortie faible → UN retry avec consigne corrective ; toujours faible → fiche marquée, jamais silencieux
  let check = structureOk(out)
  if (!check.ok) {
    console.warn(`⚠ ${id} : structuration faible (${check.why}) → retry`)
    out = await runSkill(".claude/skills/structuration", {
      industrie: ind,
      "texte brut": raw.text,
      consigne: `La passe précédente a échoué : ${check.why}. EXIGENCES : content.services = 3-8 services RÉELS extraits du texte ; content.about = 2-4 phrases RÉDIGÉES (pas un copier-coller du texte brut).`,
    })
    check = structureOk(out)
  }

  const fiche = {
    id,
    industry: ind,
    identity: { ...identity, ...(out.identity ?? {}) },
    content: out.content ?? { services: [] },
    assets: { logo: raw.logo, photos: raw.photos ?? [] },
    existing: { url: raw.url, screenshot: raw.screenshot },
    score,
    ...(check.ok ? {} : { structureIssue: check.why }), // visible en fiche → re-structurer avant compose
  }

  await mkdir(join("data", "prospects"), { recursive: true })
  await writeFile(join("data", "prospects", `${id}.json`), JSON.stringify(fiche, null, 2))
  if (!check.ok) console.warn(`⚠ ${id} : fiche écrite avec structureIssue="${check.why}"`)
  return fiche
}

// --- CLI ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [id, industry, city = ""] = process.argv.slice(2)
  if (!id || !industry) {
    console.error("usage: npm run structure -- <id> <industry> [city]")
    process.exit(1)
  }
  console.log(`→ structuration de ${id} (appel LLM, voie ${selectProvider().name})…`)
  await structureFiche(id, industry, { name: id, city }, {
    value: 0,
    tier: "cold",
    reasons: ["scoring non lancé (run direct)"],
  })
  console.log(`✓ écrit data/prospects/${id}.json`)
}
