/**
 * scripts/lib/serve-dir.mjs · a tiny static file server, on the loopback, on a free port.
 *
 * Serves a FICTIONAL dated site from the cast (data/sample/sites/<x>/, test/fixtures/sites/orvane-piscines/) so that
 * `npm run first-site -- --sample <name>` works first time without targeting a real business or installing a
 * separate server. Read only, GET/HEAD only, never outside the served folder (normalised paths, symbolic
 * links refused), 127.0.0.1 only.
 *
 *   const s = await serveDir("data/sample/sites/atelier-brisane")   // → { url, port, close() }
 */
import { createServer } from "node:http"
import { createReadStream } from "node:fs"
import { lstat, realpath } from "node:fs/promises"
import { extname, join, resolve, sep } from "node:path"

const TYPES = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8", ".mp4": "video/mp4",
}

/** The file to serve for a URL path, or null if it leaves the folder, does not exist or is a link. */
export async function resolveInside(rootDir, urlPath) {
  const root = await realpath(resolve(rootDir))
  let p
  try { p = decodeURIComponent(String(urlPath || "/").split("?")[0].split("#")[0]) } catch { return null }
  if (p.includes("\0")) return null
  const target = resolve(root, "." + (p.startsWith("/") ? p : "/" + p))
  if (target !== root && !target.startsWith(root + sep)) return null
  try {
    let st = await lstat(target)
    if (st.isSymbolicLink()) return null
    if (st.isDirectory()) {
      const index = join(target, "index.html")
      st = await lstat(index)
      return st.isFile() ? index : null
    }
    return st.isFile() ? target : null
  } catch { return null }
}

/** Starts the server on 127.0.0.1 (a free port if port = 0). */
export function serveDir(rootDir, { port = 0 } = {}) {
  const server = createServer(async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); res.end(); return }
    const file = await resolveInside(rootDir, req.url)
    if (!file) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); res.end("404"); return }
    res.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" })
    if (req.method === "HEAD") { res.end(); return }
    createReadStream(file).on("error", () => res.destroy()).pipe(res)
  })
  return new Promise((ok, ko) => {
    server.on("error", ko)
    server.listen(port, "127.0.0.1", () => {
      const p = server.address().port
      ok({ port: p, url: `http://127.0.0.1:${p}/`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()) }) })
    })
  })
}
