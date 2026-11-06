/**
 * cockpit.ts · démarrer le cockpit (backoffice/reviewpipe/serve.ts) dans un workspace, et la liste de TOUTES
 * ses routes GET (lue dans le source, pour qu'une route ajoutée demain soit balayée sans toucher au test).
 */
import { readFileSync } from "node:fs"
import { freePort, startProcess, type Proc } from "./server.ts"

export async function startCockpit(dir: string, env: NodeJS.ProcessEnv = {}, o: { port?: number; readyPath?: string } = {}): Promise<Proc> {
  const port = o.port ?? await freePort()
  return startProcess({
    cmd: process.execPath, args: ["--import", "tsx", "backoffice/reviewpipe/serve.ts"], cwd: dir, port,
    env: { BACKOFFICE_PORT: String(port), BACKOFFICE_HOST: "127.0.0.1", ...env }, readyPath: o.readyPath ?? "/api/run", timeoutMs: 45_000,
  })
}

/** Routes GET du cockpit, avec des paramètres pris sur les fixtures fictives (seed « agency »). */
export function cockpitGetRoutes(site = { id: "orvane-piscines-valmont-sur-lys", date: "2026-10-20-composer" }): string[] {
  const src = readFileSync("backoffice/reviewpipe/serve.ts", "utf8")
  const exact = new Set<string>()
  for (const m of src.matchAll(/path === "(\/[^"]*)"(?!\s*&&\s*req\.method === "POST")/g)) exact.add(m[1])
  const q = `id=${site.id}&date=${site.date}`
  const withParams: Record<string, string> = {
    "/api/score": `/api/score?${q}`, "/api/control": `/api/control?${q}`, "/api/outreach": `/api/outreach?id=${site.id}`,
    "/api/assets": `/api/assets?id=${site.id}`, "/api/notes": "/api/notes?slug=poliform",
  }
  const routes = [...exact].filter((p) => p !== "/events").map((p) => withParams[p] ?? p)
  // préfixes publics/lecture (startsWith) avec un exemple réel
  routes.push(
    `/preview/${site.id}/${site.date}/index.html`, `/thumb/${site.id}/${site.date}`, `/avant/${site.id}`, `/has-avant/${site.id}`,
    `/asset/${site.id}/bassin-1.svg`, `/data/assets/${site.id}/bassin-1.svg`, "/api/invoices/F-0000", "/facture/F-0000",
    "/", "/index.html", "/outreach/", "/sales/", "/app.js", "/app.css", "/billing.html", "/t/c/00000000-0000-0000-0000-000000000000?u=http://127.0.0.1/",
  )
  return [...new Set(routes)]
}
