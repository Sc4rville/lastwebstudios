/**
 * Structuring (3_parsing) — a wrapper around the `structuration` skill.
 *
 * Reads the raw data/raw/<id>.json, runs the skill (through the runner),
 * assembles the prospect sheet (identity + content + assets + score) → data/prospects/<id>.json.
 *
 * Export: structureFiche(id, industry, identity, score)
 * CLI usage: npm run structure -- <id> <industry> [city]
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

/* validating the LLM output: an "empty" structuring (services:[] + about = a raw dump) must
   NEVER pass for a clean sheet (a real case: the site's raw text copied as is). Dump = long, multi-line, not written up. */
function structureOk(out: any): { ok: boolean; why: string } {
  const services = out?.content?.services ?? []
  const about = String(out?.content?.about ?? "")
  if (!services.length && !about) return { ok: false, why: "empty content (no services, no about)" }
  if (!services.length) return { ok: false, why: "no services" }
  if (about.length > 1200 && (about.match(/\n/g)?.length ?? 0) > 12) return { ok: false, why: "about = a raw dump, not written up" }
  return { ok: true, why: "" }
}

export async function structureFiche(
  id: string,
  industry: string,
  identity: Identity,
  score: Score,
) {
  const raw = JSON.parse(await readFile(join("data", "raw", `${id}.json`), "utf8"))

  // FIT GATE at the sheets' door: a chain/franchise NEVER becomes a sheet, even when it comes in through
  // a hand-made seed (the scrape filter had let ixina in through that door).
  const chains = INDUSTRIES[normalizeIndustry(industry)]?.chains
  if (isChain(identity.name || id, raw.url ?? "", chains)) {
    throw new Error(`${id}: chain/franchise detected (${identity.name || id}) — off target, sheet refused`)
  }

  // TAXONOMY: the sheet writes ONLY the canonical vocabulary (single source: industries.ts)
  const ind = normalizeIndustry(industry)
  if (ind && !isKnownIndustry(ind)) console.warn(`⚠ ${id}: trade "${ind}" is not in INDUSTRIES → generic baselines (wire it in industries.ts)`)

  let out = await runSkill(".claude/skills/structuration", {
    industrie: ind,
    "texte brut": raw.text,
  })
  // weak output → ONE retry with a corrective instruction; still weak → the sheet is flagged, never silent
  let check = structureOk(out)
  if (!check.ok) {
    console.warn(`⚠ ${id}: weak structuring (${check.why}) → retry`)
    out = await runSkill(".claude/skills/structuration", {
      industrie: ind,
      "texte brut": raw.text,
      consigne: `The previous pass failed: ${check.why}. REQUIREMENTS: content.services = 3-8 REAL services taken from the text; content.about = 2-4 WRITTEN sentences (not a copy-paste of the raw text).`,
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
    ...(check.ok ? {} : { structureIssue: check.why }), // visible on the sheet → re-structure before compose
  }

  await mkdir(join("data", "prospects"), { recursive: true })
  await writeFile(join("data", "prospects", `${id}.json`), JSON.stringify(fiche, null, 2))
  if (!check.ok) console.warn(`⚠ ${id}: sheet written with structureIssue="${check.why}"`)
  return fiche
}

// --- CLI ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [id, industry, city = ""] = process.argv.slice(2)
  if (!id || !industry) {
    console.error("usage: npm run structure -- <id> <industry> [city]")
    process.exit(1)
  }
  console.log(`→ structuring ${id} (LLM call, way ${selectProvider().name})…`)
  await structureFiche(id, industry, { name: id, city }, {
    value: 0,
    tier: "cold",
    reasons: ["scoring non lancé (run direct)"],
  })
  console.log(`✓ wrote data/prospects/${id}.json`)
}
