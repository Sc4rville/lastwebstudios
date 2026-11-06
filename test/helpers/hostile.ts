/**
 * hostile.ts · balayage du cockpit sous ENTRÉES HOSTILES (test blitz du 24/10) : toutes les routes POST lues dans le
 * source × des corps absurdes. Partagé par test/cockpit/hostile.test.ts (sans base) et test/pg/hostile.test.ts (base).
 */
import { readFileSync } from "node:fs"

export function postRoutes(): string[] {
  const src = readFileSync("backoffice/reviewpipe/serve.ts", "utf8")
  const out = new Set<string>()
  for (const m of src.matchAll(/path === "(\/[^"]+)" && req\.method === "POST"/g)) out.add(m[1])
  // routes qui acceptent aussi POST sans le dire dans le test d'égalité
  for (const p of ["/api/control", "/api/invoices", "/api/invoice-settings", "/api/notes?slug=../../x", "/api/invoices/../../agency.config", "/api/invoices/2026-001/avoir", "/api/crm"]) out.add(p)
  out.delete("/api/pipeline") // lance un vrai pipeline (réseau)
  return [...out]
}

export const TRAVERSAL = "../../../../../../etc/passwd"
export const BODIES: [string, string][] = [
  ["vide", ""],
  ["json cassé", "{\"id\":"],
  ["null", "null"],
  ["tableau", "[1,2,3]"],
  ["objet vide", "{}"],
  ["chaîne", "\"orvane\""],
  ["traversée", JSON.stringify({ id: TRAVERSAL, date: "../../x", name: "../../x", slug: "../..", ids: [TRAVERSAL], file: TRAVERSAL, path: TRAVERSAL, src: TRAVERSAL, dir: TRAVERSAL, url: "javascript:alert(1)" })],
  ["types faux", JSON.stringify({ id: { a: 1 }, date: [1], ids: "pas-un-tableau", love: "beaucoup", status: { x: 1 }, stage: [], items: "x", client: 7, text: { a: 1 }, kind: [], limit: -5, order: "x", note: null, outcome: 42, comment: ["a"] })],
  ["unicode et énorme", JSON.stringify({ id: "orvane\u0000‮￿", date: "2026-13-45-composer", text: "é".repeat(200_000), comment: "<script>alert(1)</script>".repeat(1000), name: "\u0000", brief: "x".repeat(50_000) })],
]


/** Chaque route × chaque corps : la liste des réponses fautives (5xx hors « pas de DB », connexion perdue, serveur mort). */
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
      // 503 « pas de DB » = la réponse documentée d'une route qui n'existe qu'avec une base ; tout autre 5xx est un bug
      if (status >= 500 && !(status === 503 && /pas de DB/.test(text))) bad.push(`${status} ${r} [${label}] ${text}`)
    }
    const alive = await fetch(baseUrl + "/api/run", { headers, signal: AbortSignal.timeout(10_000) }).then((x) => x.status).catch(() => 0)
    if (alive !== 200) { bad.push(`serveur mort après ${r}`); break }
  }
  return { routes: routes.length, bad }
}
