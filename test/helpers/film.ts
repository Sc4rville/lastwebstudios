/**
 * film.ts · JOUE LE FILM dans un workspace fictif, avec les vrais process, pour peupler la Station (vue Machine,
 * captures) : 2 approuvés, une séquence qui part, un clic signé, l'escalade débloquée, une réponse lue par le
 * faux lecteur, une désinscription 1-clic, RDV → Signature (won), un perdu (lost), `npm run learn`.
 * Horloge : le passé récent (J0 = il y a 4 jours), pour que « dernier évènement » se lise naturellement.
 * Avec base (dbUrl) : tout passe par l'API du cockpit et la base ; sans base : séquenceur + learn:record seuls.
 */
import { readdirSync } from "node:fs"
import postgres from "postgres"
import type { Workspace } from "./workspace.ts"
import { tsx, npmRun } from "./proc.ts"

export const ORVANE = "orvane-piscines-valmont-sur-lys"
export const BRISANE = "atelier-brisane-menuiserie-sornac-le-haut"
export const FILM_SECRET = "secret-de-test-fictif-film-0123456789abcdef"

const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()

export function filmWorkspaceSetup(ws: Workspace): void {
  const cfg = JSON.parse(ws.read("outreach/sequencer/config.json"))
  cfg.inboxes = { A: [{ email: "a1@agence.example", throttlePerDay: 8 }], B: [{ email: "b1@agence.example", throttlePerDay: 8 }] }
  ws.write("outreach/sequencer/config.json", JSON.stringify(cfg, null, 2))
  const mail = (subject: string, link: string) => JSON.stringify({ senderName: "Camille (fictive)", subject, body: `Bonjour,\n\nJ'ai refait votre page d'accueil, l'aperçu : ${link}\n\nCamille` })
  ws.write(`data/savior/${ORVANE}.json`, mail("Une idée pour votre site", "https://demo.agence.example/orvane/"))
  ws.write(`data/demo/${ORVANE}.json`, mail("La démo de votre nouveau site", "https://demo.agence.example/orvane/video"))
  ws.write(`data/savior/${BRISANE}.json`, mail("Une idée pour votre atelier", "https://demo.agence.example/brisane/"))
}

export async function playFilm(o: { ws: Workspace; base: string; dbUrl?: string }): Promise<void> {
  const { ws, base, dbUrl } = o
  const env = { TRACK_BASE: base, LWS_TRACK_SECRET: FILM_SECRET, LWS_REPLY_READER: "file", LWS_MAIL_TRANSPORT: "simulated", ...(dbUrl ? { DATABASE_URL: dbUrl, DB_SSL: "disable" } : {}) }
  const must = async (p: Promise<{ code: number; out: string }>, what: string) => { const r = await p; if (r.code !== 0) throw new Error(`${what} : ${r.out.slice(-800)}`) }
  const post = async (path: string, body: unknown) => {
    const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`)
  }
  const sql = dbUrl ? postgres(dbUrl, { ssl: false, max: 1, onnotice: () => {} }) : null
  try {
    if (dbUrl) {
      await post("/api/love", { id: ORVANE, date: "2026-10-20-composer", love: 3 })
      await post("/api/status", { id: ORVANE, date: "2026-10-20-composer", status: "approved" })
      await post("/api/love", { id: BRISANE, date: "2026-10-18", love: 1 })
      await post("/api/status", { id: BRISANE, date: "2026-10-18", status: "approved" })
    }
    const seq = (args: string[]) => tsx(ws.dir, "outreach/scripts/sequencer.ts", args, { env })
    await must(seq(["enroll", `${ORVANE},${BRISANE}`, "--now", ago(97)]), "enroll")
    await must(seq(["tick", "--now", ago(96)]), "tick J0")
    // le prospect clique le lien signé de son mail (le lendemain, à l'horloge du film)
    const sends = ws.read("data/sequencer/sends.jsonl").trim().split("\n").map((l) => JSON.parse(l))
    const emlOf = (pid: string) => {
      const s = sends.find((x) => x.prospectId === pid)
      const raw = ws.read(`data/sequencer/outbox/${readdirSync(ws.path("data/sequencer/outbox")).find((f) => f.includes(s.trackingId))}`)
      const [head, body] = raw.split("\r\n\r\n")
      return { head, text: Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8") }
    }
    const link = emlOf(ORVANE).text.match(new RegExp(`${base}/t/c/[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]{16}`))![0]
    const r = await fetch(link, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148" } })
    if (r.status !== 302) throw new Error(`clic → ${r.status}`)
    // l'horloge du film : le clic le lendemain du mail, la désinscription de l'autre le surlendemain
    const setAt = async (type: string, h: number) => {
      if (sql) { await sql`UPDATE outreach_events SET at = ${Date.now() - h * 3600_000} WHERE type = ${type}`; return }
      const evs = ws.read("data/sequencer/events.jsonl").trim().split("\n").map((l) => JSON.parse(l)).map((e) => (e.type === type ? { ...e, at: ago(h) } : e))
      ws.write("data/sequencer/events.jsonl", evs.map((e) => JSON.stringify(e)).join("\n") + "\n")
    }
    await setAt("click", 70)
    const unsub = emlOf(BRISANE).head.match(/List-Unsubscribe: <(http[^>]+)>/)![1]
    const u = await fetch(unsub, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" })
    if (u.status !== 200) throw new Error(`désinscription → ${u.status}`)
    await setAt("unsub", 50)
    await must(seq(["tick", "--now", ago(20)]), "tick J+3")
    // il répond (lu par le faux lecteur au tick suivant)
    ws.write("data/sequencer/inbox.jsonl", JSON.stringify({ inbox: "b1@agence.example", id: "f1", from: "contact@orvane-piscines.example", subject: "Re: La démo de votre nouveau site", text: "Bonjour Camille, c'est très réussi. Appelez-moi jeudi.", at: ago(3) }) + "\n")
    await must(seq(["tick", "--now", ago(2)]), "tick réponse")
    if (dbUrl) {
      await post("/api/crm/outcome", { id: ORVANE, outcome: "rdv", rdvAt: Date.now() + 2 * 86400_000, note: "démo jeudi 10 h" })
      for (const stage of ["propal", "signature"]) await post("/api/crm/stage", { id: ORVANE, pipeline: "closing", stage })
      await post("/api/crm/outcome", { id: BRISANE, outcome: "lost", note: "garde son site actuel" })
      await post("/api/batch", { mode: "composer", industry: "pisciniste", limit: 3 })
    } else {
      await must(npmRun(ws.dir, "learn:record", [ORVANE, "won"]), "learn:record won")
      await must(npmRun(ws.dir, "learn:record", [BRISANE, "lost"]), "learn:record lost")
    }
    await must(npmRun(ws.dir, "learn", [], { env }), "learn")
  } finally { await sql?.end({ timeout: 2 }) }
}
