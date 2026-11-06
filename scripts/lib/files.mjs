/**
 * scripts/lib/files.mjs · LA liste des fichiers de CODE du dépôt, et leur copie dans un dossier jetable.
 *
 * Un seul endroit sait ce qui est « le code » (et donc ce qu'on peut copier sans emporter de données réelles) :
 *   - le lanceur de tests (test/run.mjs) y construit son workspace jetable ;
 *   - le bac à sable (`npm run sandbox`) y monte son agence fictive ;
 *   - l'export open source (`npm run oss:export`) y applique sa liste blanche.
 *
 * Source : `git ls-files --cached --others --exclude-standard` (le suivi + les fichiers neufs non ignorés) ; sans
 * git (export, archive), un parcours du dossier avec les mêmes exclusions. Jamais : `.git`, `node_modules`, `.env*`
 * (sauf `.env.example`), ni les dossiers de DONNÉES RÉELLES de l'agence (data/ output/ closing/ sessions/ website/),
 * les rapports de nuit (NIGHT/) et les dossiers générés (.oss-build/ .sandbox/). Exception voulue : `data/sample/`,
 * le casting 100 % fictif livré avec le produit.
 */
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, symlinkSync } from "node:fs"
import { dirname, join } from "node:path"

/** Dossiers de tête JAMAIS copiés (données réelles, livrables clients, journaux, vitrine, rapports, générés). */
export const EXCLUDED_TOP = new Set(["data", "output", "closing", "sessions", "website", "NIGHT", ".oss-build", ".sandbox", "node_modules", ".git"])
/** Sous-dossiers des dossiers exclus qui, eux, sont du produit (fictif) et voyagent avec le code. */
export const INCLUDED_UNDER_EXCLUDED = ["data/sample/"]

/** Un chemin relatif (séparateur /) fait-il partie du code copiable ? */
export function isCodePath(rel) {
  const parts = rel.split("/")
  if (parts.includes("node_modules") || parts.includes(".git")) return false
  const base = parts[parts.length - 1] || ""
  if (base.startsWith(".env") && base !== ".env.example") return false
  if (EXCLUDED_TOP.has(parts[0])) return INCLUDED_UNDER_EXCLUDED.some((p) => rel.startsWith(p))
  return true
}

/** Tous les fichiers du dépôt `root` (relatifs, séparateur /), avant tout filtre. */
export function listRepoFiles(root) {
  const r = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 })
  if (r.status === 0 && existsSync(join(root, ".git"))) return r.stdout.split("\0").filter(Boolean)
  // pas de dépôt git (export OSS, archive) : parcours, en sautant d'emblée ce qui ne serait jamais copié
  const out = []
  const walk = (d) => {
    for (const e of readdirSync(join(root, d), { withFileTypes: true })) {
      const rel = d ? `${d}/${e.name}` : e.name
      if (e.name === "node_modules" || e.name === ".git") continue
      if (e.isDirectory()) { if (d || !EXCLUDED_TOP.has(e.name) || INCLUDED_UNDER_EXCLUDED.some((p) => p.startsWith(rel + "/"))) walk(rel) }
      else if (e.isFile()) out.push(rel)
    }
  }
  walk("")
  return out
}

/** Les fichiers de CODE du dépôt (présents sur disque, fichiers ordinaires). */
export function codeFiles(root) {
  return listRepoFiles(root).filter((rel) => {
    if (!isCodePath(rel)) return false
    try { return statSync(join(root, rel)).isFile() } catch { return false } // supprimé du disque mais encore dans l'index
  })
}

/** Copie `files` (relatifs à `root`) dans `dest`. Renvoie le nombre de fichiers copiés. */
export function copyFiles(root, dest, files) {
  let n = 0
  for (const rel of files) {
    const to = join(dest, rel)
    mkdirSync(dirname(to), { recursive: true })
    cpSync(join(root, rel), to)
    n++
  }
  return n
}

/** Lie `node_modules` de `root` dans `dest` (pas de copie : 300 Mo). */
export function linkNodeModules(root, dest) {
  const nm = join(root, "node_modules")
  if (existsSync(nm) && !existsSync(join(dest, "node_modules"))) symlinkSync(nm, join(dest, "node_modules"), "dir")
}
