/**
 * prompts.ts · construction des prompts des agents du worker (composer, édition, recherche).
 *
 * SÉCURITÉ (F-1, audit 2026-10-24) : tout texte venu d'un humain ou d'une page web (commentaire du cockpit
 * ou de Telegram, paramètres d'un batch) arrive dans le prompt d'un `claude -p` qui a des outils (Bash,
 * Write…) sur la box. Il est donc injecté comme DONNÉE DÉLIMITÉE : balises dédiées, consigne explicite de ne
 * pas l'exécuter (cf. worker/edit-worker.md), balises internes neutralisées, longueur bornée, caractères de
 * contrôle retirés. Les paramètres d'un batch sont validés (vocabulaire restreint) avant injection.
 */
import { agency } from "../packages/shared/agency.mjs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { parseControl } from "../packages/shared/control.ts"
import type { BatchRow } from "../packages/shared/batch.ts"
import { workflowModels } from "../packages/llm/models.ts"
import { imageEngine, videoEngine } from "../packages/shared/media.mjs"

export const COMMENT_TAG = "commentaire_operateur"
export const MAX_PROMPT_COMMENT = 4000

const today = () => new Date().toISOString().slice(0, 10)

/** Le commentaire, nettoyé et borné, prêt à être placé ENTRE les balises (aucune balise ne peut s'en échapper). */
export function fenceComment(raw: string): string {
  let t = String(raw || "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
  t = t.replace(new RegExp(`</?\\s*${COMMENT_TAG}[^>]*>`, "gi"), "[balise retirée]")
  if (t.length > MAX_PROMPT_COMMENT) t = t.slice(0, MAX_PROMPT_COMMENT) + "\n[… coupé]"
  return t.trim()
}

// paramètres d'un batch injectés dans le prompt composer : vocabulaire restreint, sinon refusé
const SAFE_PARAM = /^[\p{L}\p{N} ._/,-]{1,120}$/u
const safeParam = (v: string | null | undefined, fallback: string) => (v == null || v === "" ? fallback : SAFE_PARAM.test(v) ? v : "(valeur refusée : caractères non autorisés)")
const SAFE_ID = /^[a-z0-9._-]{1,120}$/i

/** Moteurs et modèles passés au Workflow compose-batch (le script Workflow ne lit pas l'environnement). */
export function composeEngines(env: Record<string, string | undefined> = process.env) {
  const image = imageEngine(env).engine
  const video = videoEngine(env).engine
  return { models: workflowModels(env), image, video, boost: image !== "none" || video !== "none" }
}

/** Prompt de l'agent composer : paramètres du batch injectés dans worker/compose-worker.md. */
export async function composerPrompt(b: BatchRow, root = ".", env: Record<string, string | undefined> = process.env): Promise<string> {
  const tpl = await readFile(join(root, "worker", "compose-worker.md"), "utf8")
  // RERUN : params_json.ids = prospects EXISTANTS à re-composer (sélection couleur dans le cockpit)
  let ids: string[] = []
  try { if (b.params_json) ids = ((JSON.parse(b.params_json).ids as string[]) || []).filter((x) => typeof x === "string" && SAFE_ID.test(x)) } catch { /* params_json mal formé */ }
  const eng = composeEngines(env)
  return tpl
    .replaceAll("{{DATE}}", today())
    .replaceAll("{{INDUSTRY}}", safeParam(b.industry, "(seed par défaut)"))
    .replaceAll("{{LIMIT}}", b.lim ? String(Math.trunc(Number(b.lim)) || "(tout le seed)") : "(tout le seed)")
    .replaceAll("{{SEED}}", safeParam(b.seed, "(défaut)"))
    .replaceAll("{{FORCE}}", b.force_flag ? "oui (porte ignorée)" : "non")
    .replaceAll("{{BATCH_ID}}", String(b.id))
    .replaceAll("{{IDS}}", ids.length ? ids.join(", ") : "(aucun · sélection auto des prospects NEUFS)")
    .replaceAll("{{MODELS}}", JSON.stringify(eng.models))
    .replaceAll("{{LANGUAGE}}", agency().language)
    .replaceAll("{{COUNTRY}}", agency().country)
    .replaceAll("{{IMAGE}}", eng.image)
    .replaceAll("{{VIDEO}}", eng.video)
    .replaceAll("{{BOOST}}", String(eng.boost))
}

/** Prompt de l'agent d'ÉDITION d'un site composer : le commentaire de control.md, DÉLIMITÉ comme donnée. */
export async function editPrompt(id: string, date: string, root = "."): Promise<string> {
  const tpl = await readFile(join(root, "worker", "edit-worker.md"), "utf8")
  const sitePath = join("output", "sites", id, date)
  let comment = ""
  try { comment = parseControl(await readFile(join(root, sitePath, "control.md"), "utf8")).comment } catch { /* pas de control.md */ }
  // remplacement en UN passage (fonction) : un `$&` ou un `{{…}}` dans le commentaire ne peut rien réinjecter
  const vars: Record<string, string> = { ID: id, DATE: date, SITE_PATH: sitePath, COMMENT: fenceComment(comment) || "(commentaire vide)" }
  return tpl.replace(/\{\{(ID|DATE|SITE_PATH|COMMENT)\}\}/g, (_m, k: string) => vars[k])
}

/** Prompt de l'agent de RECHERCHE d'un prospect (id validé). */
export async function researchPrompt(id: string, root = "."): Promise<string> {
  if (!SAFE_ID.test(id)) throw new Error(`id de prospect invalide : ${JSON.stringify(id).slice(0, 60)}`)
  const tpl = await readFile(join(root, "worker", "research-worker.md"), "utf8")
  return tpl.replaceAll("{{ID}}", id)
}
