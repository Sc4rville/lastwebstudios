/**
 * control.ts — THE canonical format of `control.md` (one place, no more drift).
 *
 * Shared by: the filler (design/scripts/fill.ts), the surgical editor (design/scripts/edit.ts)
 * and the station (backoffice/reviewpipe/). Each generated site carries a `control.md`
 * (its headings and labels are a stored format, French on purpose: « généré » = generated, « contenu » = content,
 * « dernières modif » = latest changes, « commentaire » = comment):
 *
 *   # control · <id>
 *
 *   - template : <cat/slug>
 *   - généré   : <YYYY-MM-DD HH:MM> · <s>s
 *   - contenu  : <n textes · m images · k masqués>
 *
 *   ## dernières modif
 *   - <stamp> · <event>            (max 3, the most recent on top)
 *
 *   ## commentaire
 *   <!-- help -->
 *   <operator's text + screenshots ![](file)>
 */
import { readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"

export const HELP =
  "<!-- Write here what you want changed on this site. `/review` reads it, applies it by running the filler again, then empties this section. -->"

const H_HIST = "## dernières modif"
const H_COMMENT = "## commentaire"

// ---- timestamps (Paris time) ----
export function todayParis(): string {
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date())
}
export function nowStampParis(): string {
  return new Date().toLocaleString("sv-SE", { timeZone: "Europe/Paris" }).slice(0, 16)
}

function field(text: string, label: string): string {
  const m = text.match(new RegExp(`- ${label}\\s*:\\s*(.+)`))
  return m ? m[1].trim() : ""
}

export interface Control {
  template: string
  generated: string
  counts: string
  history: string[] // "- ..." lines (max 3)
  comment: string // editable text (help removed, line breaks kept, screenshots kept)
  feedback: string // text normalised for the model (help + screenshots removed)
  images: string[] // referenced screenshots ![](file)
  hasComment: boolean // an operator's feedback is present (text other than the help, or an image)
}

/** Parses a control.md's markdown. */
export function parseControl(text: string): Control {
  const histSec = text.split(H_HIST)[1]?.split(H_COMMENT)[0] ?? ""
  const history = histSec.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("- "))

  // the comment is the last section: everything after the 1st marker (slice, not split —
  // otherwise a comment holding the literal "## commentaire" would be truncated).
  const ci = text.indexOf(H_COMMENT)
  const raw = ci < 0 ? "" : text.slice(ci + H_COMMENT.length)
  const images: string[] = []
  const re = /!\[[^\]]*\]\(([^)]+)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) images.push(m[1])

  const comment = raw.replace(/<!--[\s\S]*?-->/g, "").replace(/^\s+|\s+$/g, "")
  const feedback = comment.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\s+/g, " ").trim()
  const hasComment = feedback.length > 0 || images.length > 0

  return {
    template: field(text, "template"), generated: field(text, "généré"), counts: field(text, "contenu"),
    history, comment, feedback, images, hasComment,
  }
}

/** Reads a control.md from disk (empty if missing — no error on the first build). */
export async function readControl(path: string): Promise<Control> {
  if (!existsSync(path)) return { template: "", generated: "", counts: "", history: [], comment: "", feedback: "", images: [], hasComment: false }
  return parseControl(await readFile(path, "utf8"))
}

/** FULL write of the control.md (build/rebuild by the filler): metadata + history + an empty section. */
export async function writeControl(
  path: string,
  d: { id: string; tplLabel: string; when: string; durationS: string; counts: string; history: string[] },
): Promise<void> {
  await writeFile(
    path,
    `# control · ${d.id}

- template : ${d.tplLabel}
- généré   : ${d.when} · ${d.durationS}s
- contenu  : ${d.counts}

## dernières modif
${d.history.join("\n")}

## commentaire
${HELP}
`,
  )
}

/** Rewrites ONLY the `## commentaire` section (an operator's edit from the station). */
export function writeCommentText(prevText: string, newComment: string): string {
  const body = newComment.replace(/^\s+|\s+$/g, "")
  const section = `${H_COMMENT}\n${HELP}\n${body ? body + "\n" : ""}`
  const idx = prevText.indexOf(H_COMMENT)
  if (idx < 0) return prevText + (prevText.endsWith("\n") ? "\n" : "\n\n") + section
  return prevText.slice(0, idx) + section
}

/** Adds a history line while KEEPING the comment (polish: doesn't consume the comment). */
export function addHistory(prevText: string, eventLine: string): string {
  const hi = prevText.indexOf(H_HIST)
  const ci = prevText.indexOf(H_COMMENT)
  if (hi < 0 || ci < 0) return prevText // non-standard control.md → don't touch it
  const head = prevText.slice(0, hi)
  const commentSection = prevText.slice(ci) // "## commentaire …" verbatim
  const history = [eventLine, ...parseControl(prevText).history].slice(0, 3).join("\n")
  return `${head}${H_HIST}\n${history}\n\n${commentSection}`
}

/** Surgical edit: keeps the metadata verbatim, adds a history line, empties the comment. */
export function bumpHistoryClearComment(prevText: string, eventLine: string): string {
  // header + metadata, verbatim. Robust if `## dernières modif` is missing (otherwise split[0]
  // would return the whole file → the sections would be duplicated and the comment not emptied).
  const hi = prevText.indexOf(H_HIST)
  const ci = prevText.indexOf(H_COMMENT)
  let head: string
  if (hi >= 0) head = prevText.slice(0, hi)
  else if (ci >= 0) head = prevText.slice(0, ci)
  else head = prevText.replace(/\s*$/, "") + "\n\n"
  const history = [eventLine, ...parseControl(prevText).history].slice(0, 3).join("\n")
  return `${head}${H_HIST}\n${history}\n\n${H_COMMENT}\n${HELP}\n`
}
