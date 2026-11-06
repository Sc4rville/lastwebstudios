/**
 * control.ts — LE format canonique du `control.md` (un seul endroit, plus de dérive).
 *
 * Partagé par : le filler (design/scripts/fill.ts), l'éditeur chirurgical (design/scripts/edit.ts)
 * et la station (backoffice/reviewpipe/). Chaque site généré porte un `control.md` :
 *
 *   # control · <id>
 *
 *   - template : <cat/slug>
 *   - généré   : <YYYY-MM-DD HH:MM> · <s>s
 *   - contenu  : <n textes · m images · k masqués>
 *
 *   ## dernières modif
 *   - <stamp> · <event>            (max 3, la plus récente en haut)
 *
 *   ## commentaire
 *   <!-- aide -->
 *   <texte opérateur + captures ![](fichier)>
 */
import { readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"

export const HELP =
  "<!-- Écris ici ce que tu veux changer sur ce site. `/review` le lit, l'applique en relançant le filler, puis vide cette section. -->"

const H_HIST = "## dernières modif"
const H_COMMENT = "## commentaire"

// ---- horodatage (heure de Paris) ----
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
  history: string[] // lignes "- ..." (max 3)
  comment: string // texte éditable (aide retirée, retours conservés, captures gardées)
  feedback: string // texte normalisé pour le modèle (aide + captures retirées)
  images: string[] // captures référencées ![](fichier)
  hasComment: boolean // un retour opérateur est présent (texte hors aide, ou image)
}

/** Parse le markdown d'un control.md. */
export function parseControl(text: string): Control {
  const histSec = text.split(H_HIST)[1]?.split(H_COMMENT)[0] ?? ""
  const history = histSec.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("- "))

  // le commentaire est la dernière section : tout ce qui suit le 1er marqueur (slice, pas split —
  // sinon un commentaire contenant le littéral « ## commentaire » serait tronqué).
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

/** Lecture d'un control.md sur disque (vide si absent — pas d'erreur au premier build). */
export async function readControl(path: string): Promise<Control> {
  if (!existsSync(path)) return { template: "", generated: "", counts: "", history: [], comment: "", feedback: "", images: [], hasComment: false }
  return parseControl(await readFile(path, "utf8"))
}

/** Écriture COMPLÈTE du control.md (build/rebuild par le filler) : métadonnées + historique + section vide. */
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

/** Réécrit UNIQUEMENT la section `## commentaire` (édition opérateur depuis la station). */
export function writeCommentText(prevText: string, newComment: string): string {
  const body = newComment.replace(/^\s+|\s+$/g, "")
  const section = `${H_COMMENT}\n${HELP}\n${body ? body + "\n" : ""}`
  const idx = prevText.indexOf(H_COMMENT)
  if (idx < 0) return prevText + (prevText.endsWith("\n") ? "\n" : "\n\n") + section
  return prevText.slice(0, idx) + section
}

/** Ajoute une ligne d'historique en PRÉSERVANT le commentaire (polish : ne consomme pas le commentaire). */
export function addHistory(prevText: string, eventLine: string): string {
  const hi = prevText.indexOf(H_HIST)
  const ci = prevText.indexOf(H_COMMENT)
  if (hi < 0 || ci < 0) return prevText // control.md non standard → on ne touche pas
  const head = prevText.slice(0, hi)
  const commentSection = prevText.slice(ci) // "## commentaire …" verbatim
  const history = [eventLine, ...parseControl(prevText).history].slice(0, 3).join("\n")
  return `${head}${H_HIST}\n${history}\n\n${commentSection}`
}

/** Édition chirurgicale : garde les métadonnées verbatim, ajoute une ligne d'historique, vide le commentaire. */
export function bumpHistoryClearComment(prevText: string, eventLine: string): string {
  // en-tête + métadonnées, verbatim. Robuste si `## dernières modif` est absent (sinon split[0]
  // renverrait tout le fichier → on dupliquerait les sections et le commentaire ne serait pas vidé).
  const hi = prevText.indexOf(H_HIST)
  const ci = prevText.indexOf(H_COMMENT)
  let head: string
  if (hi >= 0) head = prevText.slice(0, hi)
  else if (ci >= 0) head = prevText.slice(0, ci)
  else head = prevText.replace(/\s*$/, "") + "\n\n"
  const history = [eventLine, ...parseControl(prevText).history].slice(0, 3).join("\n")
  return `${head}${H_HIST}\n${history}\n\n${H_COMMENT}\n${HELP}\n`
}
