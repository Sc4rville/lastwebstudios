/**
 * workspace.ts · one THROWAWAY WORKSPACE per test: a copy of the code (no real data) + fictional fixtures.
 *
 * Every product path is relative to the cwd (data/, output/sites/, outreach/sequencer/…). A test that
 * runs a CLI or the cockpit therefore does it INSIDE a workspace: it writes what it wants there, nothing leaks into the
 * repository. The copied source is the test process's cwd, which is already the throwaway workspace built by
 * test/run.mjs (tracked code, 0 real data, 0 .env). The big read-only folders (fonts, templates,
 * video) are linked, not copied.
 *
 *   const ws = makeWorkspace({ seed: ["agency"] })   // + test/fixtures/workspace/agency/** on top
 *   ws.write("data/x.json", "{}") · ws.read(...) · ws.exists(...) · ws.cleanup()
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

/** Linked folders (read-only for the tests, heavy: ~50 MB of fonts and templates). */
const LINKED = ["design/fonts", "design/templates", "video", "ecom", "node_modules"]
/** Never copied, even if present in the source. */
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
  /** Replaces a LINKED (read-only) folder with a real, filtered copy: the cockpit refuses to serve through
   *  a link that leaves its root (safeUnder), so an e2e that loads the UI's fonts needs it. */
  materialize: (rel: string, keep?: (relPath: string) => boolean) => void
  cleanup: () => void
}

/** Guard: the tests only run through test/run.mjs (throwaway workspace + cleaned env). */
export function assertTestEnv(): void {
  if (process.env.LWS_TEST !== "1") throw new Error("run the tests with `npm test` (test/run.mjs), never `node --test` at the repository root")
  if (process.env.DATABASE_URL && !/@(127\.0\.0\.1|localhost)(:\d+)?\//.test(process.env.DATABASE_URL)) {
    throw new Error("non-local DATABASE_URL in the test env: refused (never the real database)")
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
      if (!existsSync(from)) throw new Error(`unknown seed: ${name}`)
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
