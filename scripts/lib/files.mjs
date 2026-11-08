/**
 * scripts/lib/files.mjs · THE list of the repo's CODE files, and their copy into a throwaway folder.
 *
 * One single place knows what "the code" is (and so what can be copied without taking real data along):
 *   - the test runner (test/run.mjs) builds its throwaway workspace from it;
 *   - the sandbox (`npm run sandbox`) sets up its fictional agency from it;
 *   - the open source export (`npm run oss:export`) applies its allowlist to it.
 *
 * Source: `git ls-files --cached --others --exclude-standard` (tracked + new files not ignored); without
 * git (export, archive), a walk of the folder with the same exclusions. Never: `.git`, `node_modules`, `.env*`
 * (except `.env.example`), nor the agency's REAL DATA folders (data/ output/ closing/ sessions/ website/),
 * the night reports (NIGHT/) and the generated folders (.oss-build/ .sandbox/). A deliberate exception: `data/sample/`,
 * the 100 % fictional cast shipped with the product.
 */
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, symlinkSync } from "node:fs"
import { dirname, join } from "node:path"

/** Top-level folders NEVER copied (real data, client deliverables, logs, showcase, reports, generated). */
export const EXCLUDED_TOP = new Set(["data", "output", "closing", "sessions", "website", "NIGHT", ".oss-build", ".sandbox", "node_modules", ".git"])
/** Sub-folders of the excluded folders that ARE part of the (fictional) product and travel with the code. */
export const INCLUDED_UNDER_EXCLUDED = ["data/sample/"]

/** Is a relative path (separator /) part of the copyable code? */
export function isCodePath(rel) {
  const parts = rel.split("/")
  if (parts.includes("node_modules") || parts.includes(".git")) return false
  const base = parts[parts.length - 1] || ""
  if (base.startsWith(".env") && base !== ".env.example") return false
  if (EXCLUDED_TOP.has(parts[0])) return INCLUDED_UNDER_EXCLUDED.some((p) => rel.startsWith(p))
  return true
}

/** Every file of the `root` repo (relative, separator /), before any filter. */
export function listRepoFiles(root) {
  const r = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 })
  if (r.status === 0 && existsSync(join(root, ".git"))) return r.stdout.split("\0").filter(Boolean)
  // no git repo (OSS export, archive): a walk, skipping at once what would never be copied
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

/** The repo's CODE files (present on disk, regular files). */
export function codeFiles(root) {
  return listRepoFiles(root).filter((rel) => {
    if (!isCodePath(rel)) return false
    try { return statSync(join(root, rel)).isFile() } catch { return false } // deleted from disk but still in the index
  })
}

/** Copies `files` (relative to `root`) into `dest`. Returns the number of files copied. */
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

/** Links `root`'s `node_modules` into `dest` (no copy: 300 MB). */
export function linkNodeModules(root, dest) {
  const nm = join(root, "node_modules")
  if (existsSync(nm) && !existsSync(join(dest, "node_modules"))) symlinkSync(nm, join(dest, "node_modules"), "dir")
}
