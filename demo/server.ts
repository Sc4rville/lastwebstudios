/**
 * A tiny static server for the demo fixtures (fictional businesses, local only).
 * The pipeline scores and parses them exactly like a real site: over HTTP, with a real browser.
 */
import { createServer, type Server } from "node:http"
import { readFile, stat } from "node:fs/promises"
import { join, normalize, extname, resolve } from "node:path"
import type { AddressInfo } from "node:net"

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".gif": "image/gif",
}

/** Serve `root` on 127.0.0.1. Resolves once listening. */
export function serveStatic(root: string, port = 0): Promise<{ url: string; server: Server }> {
  const base = resolve(root)
  const server = createServer(async (req, res) => {
    try {
      let path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname))
      if (path.endsWith("/")) path += "index.html"
      const file = join(base, path)
      if (!file.startsWith(base)) throw new Error("outside root")
      if ((await stat(file)).isDirectory()) {
        res.writeHead(301, { location: path + "/" }).end()
        return
      }
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" })
      res.end(await readFile(file))
    } catch {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found")
    }
  })
  return new Promise((ok) =>
    server.listen(port, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server })),
  )
}

/** The demo seed, with the fixture server's address filled in. */
export async function demoSeed(fixturesUrl: string): Promise<string> {
  return (await readFile(join("demo", "seed.csv"), "utf8")).replaceAll("{{FIXTURES}}", fixturesUrl)
}
