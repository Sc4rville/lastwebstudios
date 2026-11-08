/**
 * crowd.ts · a CROWD of fictional prospects (sheet + perfect email) in a workspace, so a sequencer tick
 * lasts long enough for two concurrent processes to overlap (concurrency tests). Made-up data:
 * .example domains, no real business.
 */
import type { Workspace } from "./workspace.ts"

export function crowd(ws: Workspace, n: number): string[] {
  const ids: string[] = []
  for (let i = 1; i <= n; i++) {
    const id = `bassin-fictif-${String(i).padStart(2, "0")}-valmont-sur-lys`
    ids.push(id)
    ws.write(`data/prospects/${id}.json`, JSON.stringify({ _fixture: "FICTIF", id, industry: "pisciniste", identity: { name: `Bassin Fictif ${i}`, city: "Valmont-sur-Lys", email: `contact@bassin-fictif-${i}.example` } }))
    ws.write(`data/savior/${id}.json`, JSON.stringify({ senderName: "Camille (fictive)", subject: `Une idée pour Bassin Fictif ${i}`, body: "Bonjour,\n\nJ'ai refait votre page d'accueil : https://demo.agence.example/\n\nCamille" }))
  }
  return ids
}
