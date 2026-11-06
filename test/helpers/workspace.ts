/**
 * workspace.ts · un WORKSPACE JETABLE par test : copie du code (sans données réelles) + fixtures fictives.
 *
 * Tous les chemins du produit sont relatifs au cwd (data/, output/sites/, outreach/sequencer/…). Un test qui
 * lance une CLI ou le cockpit le fait donc DANS un workspace : il y écrit ce qu'il veut, rien ne fuit vers le
 * dépôt. La source copiée est le cwd du process de test, qui est déjà le workspace jetable construit par
 * test/run.mjs (code suivi, 0 donnée réelle, 0 .env). Les gros dossiers en lecture seule (polices, templates,
 * vidéo) sont liés, pas copiés.
 *
 *   const ws = makeWorkspace({ seed: ["agency"] })   // + test/fixtures/workspace/agency/** par-dessus
 *   ws.write("data/x.json", "{}") · ws.read(...) · ws.exists(...) · ws.cleanup()
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

/** Dossiers liés (lecture seule pour les tests, lourds : ~50 Mo de polices et templates). */
const LINKED = ["design/fonts", "design/templates", "video", "ecom", "node_modules"]
/** Jamais copiés, même si présents dans la source. */
const NEVER = new Set(["data", "output", "closing", "sessions", "website", "NIGHT", ".oss-build", ".git"])

export const FIXTURES = resolve(process.cwd(), "test", "fixtures")

export type Workspace = {
  dir: string
  path: (...p: string[]) => string
  write: (rel: string, content: string | Buffer) => string
  read: (rel: string) => string
  json: <T = any>(rel: string) => T
  exists: (rel: string) => boolean
  seed: (name: string) => void
  /** Remplace un dossier LIÉ (lecture seule) par une vraie copie, filtrée : le cockpit refuse de servir à travers
   *  un lien qui sort de sa racine (safeUnder), donc un e2e qui charge les polices de l'UI en a besoin. */
  materialize: (rel: string, keep?: (relPath: string) => boolean) => void
  cleanup: () => void
}

/** Garde-fou : les tests ne tournent que via test/run.mjs (workspace jetable + env assaini). */
export function assertTestEnv(): void {
  if (process.env.LWS_TEST !== "1") throw new Error("lance les tests via `npm test` (test/run.mjs), jamais `node --test` à la racine du dépôt")
  if (process.env.DATABASE_URL && !/@(127\.0\.0\.1|localhost)(:\d+)?\//.test(process.env.DATABASE_URL)) {
    throw new Error("DATABASE_URL non-locale dans l'env de test : refus (jamais la vraie base)")
  }
}

export function makeWorkspace(opts: { seed?: string[] } = {}): Workspace {
  assertTestEnv()
  const src = process.cwd()
  const dir = mkdtempSync(join(tmpdir(), "lws-ws-"))
  for (const e of readdirSync(src, { withFileTypes: true })) {
    if (NEVER.has(e.name) || e.name === "node_modules") continue
    if (e.name.startsWith(".env") && e.name !== ".env.example") continue
    cpSync(join(src, e.name), join(dir, e.name), {
      recursive: true,
      filter: (s) => !LINKED.some((l) => s === join(src, l)),
    })
  }
  for (const l of LINKED) {
    const from = join(src, l)
    if (!existsSync(from)) continue
    mkdirSync(dirname(join(dir, l)), { recursive: true })
    symlinkSync(from, join(dir, l), "dir")
  }
  const ws: Workspace = {
    dir,
    path: (...p) => join(dir, ...p),
    write: (rel, content) => { const f = join(dir, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, content); return f },
    read: (rel) => readFileSync(join(dir, rel), "utf8"),
    json: (rel) => JSON.parse(readFileSync(join(dir, rel), "utf8")),
    exists: (rel) => existsSync(join(dir, rel)),
    seed: (name) => {
      const from = join(FIXTURES, "workspace", name)
      if (!existsSync(from)) throw new Error(`seed inconnu : ${name}`)
      cpSync(from, dir, { recursive: true })
    },
    materialize: (rel, keep = () => true) => {
      const from = join(src, rel), to = join(dir, rel)
      rmSync(to, { recursive: true, force: true })
      mkdirSync(to, { recursive: true })
      cpSync(from, to, { recursive: true, dereference: true, filter: (p) => p === from || keep(p.slice(from.length + 1)) })
    },
    cleanup: () => { if (process.env.LWS_KEEP_WS !== "1") rmSync(dir, { recursive: true, force: true }) },
  }
  for (const s of opts.seed ?? []) ws.seed(s)
  return ws
}
