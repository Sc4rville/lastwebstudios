/**
 * skills.ts — lecture du « cerveau » : les skills (.claude/skills/) et les idées (docs/skillstash.md).
 *
 * Mécanique pure (pas de LLM). Alimente le panneau « brain » : le funnel idées → en test → actifs.
 * Écriture (feedback, brouillon, promotion) côté serve.ts.
 */
import { readFile, readdir, stat } from "node:fs/promises"
import { existsSync, statSync } from "node:fs"
import { join } from "node:path"

export const SKILLS_DIR = ".claude/skills"
const STASH = "docs/skillstash.md"

export interface SkillInfo {
  name: string
  status: "test" | "active"
  kind: "skill" | "prompt"
  desc: string
  feedback: string // demande de changement en attente (boucle « commentaire » des skills)
  mtime: number
}

// --- mini-parseur de frontmatter YAML simple (clé: valeur sur une ligne) ---
function frontmatter(text: string): { fm: Record<string, string>; body: string } {
  if (!text.startsWith("---")) return { fm: {}, body: text }
  const end = text.indexOf("\n---", 3)
  if (end < 0) return { fm: {}, body: text }
  const block = text.slice(3, end)
  const body = text.slice(end + 4)
  const fm: Record<string, string> = {}
  for (const line of block.split("\n")) {
    const m = line.match(/^([a-z0-9_-]+)\s*:\s*(.*)$/i)
    if (m) fm[m[1].toLowerCase()] = m[2].trim()
  }
  return { fm, body }
}

function firstMeaningfulLine(body: string): string {
  for (const raw of body.split("\n")) {
    const l = raw.trim()
    if (!l || l.startsWith("#") || l.startsWith(">") || l.startsWith("---") || l.startsWith("<!--")) continue
    return l.replace(/\*\*/g, "").replace(/[`*]/g, "").slice(0, 160)
  }
  // sinon le 1er titre
  const h = body.match(/^#+\s+(.+)$/m)
  return h ? h[1].replace(/[`*]/g, "").slice(0, 160) : ""
}

/** Scanne .claude/skills/ → un descriptif par skill (statut test/actif, desc, feedback en attente). */
export async function readSkills(): Promise<SkillInfo[]> {
  if (!existsSync(SKILLS_DIR)) return []
  const out: SkillInfo[] = []
  for (const name of await readdir(SKILLS_DIR)) {
    try {
      const dir = join(SKILLS_DIR, name)
      if (!safeStatIsDir(dir)) continue
      const skillPath = join(dir, "SKILL.md")
      const promptPath = join(dir, "prompt.md")
      const kind: "skill" | "prompt" = existsSync(skillPath) ? "skill" : existsSync(promptPath) ? "prompt" : "skill"
      const file = kind === "skill" && existsSync(skillPath) ? skillPath : existsSync(promptPath) ? promptPath : skillPath
      if (!existsSync(file)) continue
      const text = await readFile(file, "utf8")
      const { fm, body } = frontmatter(text)
      const fbPath = join(dir, "feedback.md")
      const feedback = existsSync(fbPath) ? (await readFile(fbPath, "utf8")).trim() : ""
      out.push({
        name: fm.name || name,
        status: fm.status === "test" ? "test" : "active",
        kind,
        desc: fm.description || firstMeaningfulLine(body),
        feedback,
        mtime: (await stat(file)).mtimeMs,
      })
    } catch {
      /* un dossier de skill cassé/supprimé en cours de scan ne casse pas tout le brain */
    }
  }
  // en test d'abord, puis alpha
  out.sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === "test" ? -1 : 1))
  return out
}

function safeStatIsDir(p: string): boolean {
  try { return statSync(p).isDirectory() } catch { return false }
}

export interface StashIdea {
  idea: string // libellé complet
  slug: string // nom de skill candidat (pour drafter)
  signal: string
  note: string
  category: string
  drafted: boolean // un skill du même nom existe déjà ?
}

const CATEGORY_RULES: [RegExp, string][] = [
  [/scor|gate|porte|beaut/i, "scoring"],
  [/fill|template|nav|animat|site|impeccable|polish|design/i, "design"],
  [/doc|status|ton|README/i, "docs"],
  [/video|explainer|hyperframe/i, "video"],
  [/review|skill|loop|lws|draft/i, "loop"],
  [/scrap|annuaire|lead|prospect|data/i, "data"],
]
function categorize(text: string): string {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(text)) return cat
  return "divers"
}

/** Parse le tableau de docs/skillstash.md → les idées de skills en attente. */
export async function readStash(): Promise<StashIdea[]> {
  if (!existsSync(STASH)) return []
  const text = await readFile(STASH, "utf8")
  const ideas: StashIdea[] = []
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("|")) continue
    const cells = line.split("|").map((c) => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1)
    if (cells.length < 3) continue
    const [idea, signal, note] = cells
    if (/^id[ée]e$/i.test(idea) || /^-+$/.test(idea)) continue // en-tête / séparateur
    const slugMatch = idea.match(/`([^`]+)`/)
    const slug = (slugMatch ? slugMatch[1] : idea.split(/[\s(]/)[0])
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    ideas.push({
      idea: idea.replace(/`/g, ""),
      slug,
      signal,
      note,
      category: categorize(`${idea} ${signal} ${note}`),
      drafted: existsSync(join(SKILLS_DIR, slug)),
    })
  }
  return ideas
}
