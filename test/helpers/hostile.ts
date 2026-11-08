/**
 * hostile.ts · sweeps the cockpit with HOSTILE INPUT (blitz test of 24/10): every POST route read from the
 * source × absurd bodies. Shared by test/cockpit/hostile.test.ts (no database) and test/pg/hostile.test.ts (database).
 */
import { readFileSync } from "node:fs"

export function postRoutes(): string[] {
  const src = readFileSync("backoffice/reviewpipe/serve.ts", "utf8")
  const out = new Set<string>()
  for (const m of src.matchAll(/path === "(\/[^"]+)" && req\.method === "POST"/g)) out.add(m[1])
  // routes that also accept POST without saying so in the equality test
  for (const p of ["/api/control", "/api/invoices", "/api/invoice-settings", "/api/notes?slug=../../x", "/api/invoices/../../agency.config", "/api/invoices/2026-001/avoir", "/api/crm"]) out.add(p)
  out.delete("/api/pipeline") // starts a real pipeline (network)
  return [...out]
}

export const TRAVERSAL = "../../../../../../etc/passwd"
export const BODIES: [string, string][] = [
  ["vide", ""],
  ["broken json", "{\"id\":"],
  ["null", "null"],
  ["tableau", "[1,2,3]"],
  ["objet vide", "{}"],
  ["string", "\"orvane\""],
  ["traversal", JSON.stringify({ id: TRAVERSAL, date: "../../x", name: "../../x", slug: "../..", ids: [TRAVERSAL], file: TRAVERSAL, path: TRAVERSAL, src: TRAVERSAL, dir: TRAVERSAL, url: "javascript:alert(1)" })],
  ["wrong types", JSON.stringify({ id: { a: 1 }, date: [1], ids: "pas-un-tableau", love: "beaucoup", status: { x: 1 }, stage: [], items: "x", client: 7, text: { a: 1 }, kind: [], limit: -5, order: "x", note: null, outcome: 42, comment: ["a"] })],
  ["unicode and huge", JSON.stringify({ id: "orvane\u0000‮￿", date: "2026-13-45-composer", text: "é".repeat(200_000), comment: "<script>alert(1)</script>".repeat(1000), name: "\u0000", brief: "x".repeat(50_000) })],
]


/** Each route × each body: the list of faulty answers (5xx other than "no database", lost connection, dead server). */
export async function hostileSweep(baseUrl: string, headers: Record<string, string> = {}): Promise<{ routes: number; bad: string[] }> {
  const routes = postRoutes()
  const bad: string[] = []
  for (const r of routes) {
    for (const [label, body] of BODIES) {
      let status = 0, text = ""
      try {
        const res = await fetch(baseUrl + r, { method: "POST", headers: { "content-type": "application/json", ...headers }, body, signal: AbortSignal.timeout(20_000) })
        status = res.status; text = (await res.text()).slice(0, 160)
      } catch (e) { bad.push(`${r} [${label}] : connexion perdue (${(e as Error).message})`); continue }
      // 503 "no database" = the documented answer of a route that only exists with a database; any other 5xx is a bug
      if (status >= 500 && !(status === 503 && /No database|pas de DB/.test(text))) bad.push(`${status} ${r} [${label}] ${text}`)
    }
    const alive = await fetch(baseUrl + "/api/run", { headers, signal: AbortSignal.timeout(10_000) }).then((x) => x.status).catch(() => 0)
    if (alive !== 200) { bad.push(`server dead after ${r}`); break }
  }
  return { routes: routes.length, bad }
}
