/**
 * Structure (3_parsing) — wrapper of the `structuration` skill (an LLM call, task class "extract").
 *
 * Reads the raw capture data/raw/<id>.json, lets the skill turn free text into structured content,
 * then assembles the ProspectSheet (identity + content + assets + score) → data/prospects/<id>.json.
 * Mechanical facts (nav labels, headings, media paths, score) are never delegated to the model.
 *
 * Export : structureSheet(id, industry, identity, score)     CLI : npm run structure -- <id> <industry>
 */
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { runSkill } from "../../../packages/utils/llm.ts"
import type { ProspectSheet, Score } from "../../../packages/shared/prospect.ts"
import type { Raw } from "./parse.ts"

export async function structureSheet(
  id: string,
  industry: string,
  identity: { name: string; city: string; email?: string },
  score: Score,
): Promise<ProspectSheet> {
  const raw: Raw = JSON.parse(await readFile(join("data", "raw", `${id}.json`), "utf8"))
  const out = await runSkill("skills/structuration", { industry, "raw text": raw.text }, { taskClass: "extract", replayKey: id })

  const sheet: ProspectSheet = {
    id,
    industry,
    identity: { ...identity, ...(out.identity ?? {}) },
    content: {
      services: [],
      ...(out.content ?? {}),
      ...(raw.nav.length ? { nav: raw.nav } : {}),
      ...(raw.sections.length ? { sections: raw.sections } : {}),
    },
    assets: { logo: raw.logo, photos: raw.photos },
    existing: { url: raw.url, screenshot: raw.screenshot },
    score,
  }
  await mkdir(join("data", "prospects"), { recursive: true })
  await writeFile(join("data", "prospects", `${id}.json`), JSON.stringify(sheet, null, 2))
  return sheet
}

// --- CLI ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [id, industry] = process.argv.slice(2)
  if (!id || !industry) {
    console.error("usage: npm run structure -- <id> <industry>")
    process.exit(1)
  }
  await structureSheet(id, industry, { name: id, city: "" }, { value: 0, tier: "cold", reasons: ["not scored (direct run)"] })
  console.log(`✓ data/prospects/${id}.json`)
}
