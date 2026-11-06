/**
 * G11 · LE FILM DEVIENT VRAI (en dry-run, sans base) : les boucles que le code ne fermait pas, de bout en bout,
 * avec les vrais process (cockpit + séquenceur) sur un workspace fictif.
 *
 *   enroll ⇒ tick J0 : .eml complet (lien de clic signé, List-Unsubscribe https + mailto, List-Unsubscribe-Post)
 *   ⇒ le prospect clique (GET du lien, sans auth) ⇒ 302 vers l'URL du mail + évènement `click`
 *   ⇒ tick J+3 : l'étape gatée `demo-perso` est DÉBLOQUÉE (et envoyée en dry-run)
 *   ⇒ il répond (faux lecteur de réponses) ⇒ tick : `replied` + Hot Lead + issue `reply` au learning
 *   ⇒ un autre se désinscrit en 1 clic (POST RFC 8058) ⇒ tick : `dropped`
 *   + F-3 : jeton forgé ⇒ 4xx, `?u=https://evil.example` ⇒ 4xx, désinscription seulement en POST, corps plafonné
 *   + 0 appel au transport SMTP sans LWS_LIVE_SEND=1 (transport simulé qui journalise chaque appel)
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { makeWorkspace, type Workspace } from "./helpers/workspace.ts"
import { tsx } from "./helpers/proc.ts"
import { freePort, type Proc } from "./helpers/server.ts"
import { startCockpit } from "./helpers/cockpit.ts"
import { parseClickToken } from "../outreach/tracking/links.ts"

const ORVANE = "orvane-piscines-valmont-sur-lys"
const BRISANE = "atelier-brisane-menuiserie-sornac-le-haut"
const SECRET = "secret-de-test-fictif-funnel-0123456789abcdef"
const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
const PASS = "mot-de-passe-fictif"

function funnelWs(): Workspace {
  const ws = makeWorkspace({ seed: ["agency"] })
  const cfg = JSON.parse(ws.read("outreach/sequencer/config.json"))
  cfg.inboxes = { A: [{ email: "a1@agence.example", throttlePerDay: 8 }], B: [{ email: "b1@agence.example", throttlePerDay: 8 }] }
  ws.write("outreach/sequencer/config.json", JSON.stringify(cfg, null, 2))
  const mail = (subject: string, link: string) => JSON.stringify({ senderName: "Camille (fictive)", subject, body: `Bonjour,\n\nJ'ai refait votre page d'accueil, l'aperçu est ici : ${link}\n\nUn créneau de 15 min ? https://cal.agence.example/15min\n\nCamille` })
  ws.write(`data/savior/${ORVANE}.json`, mail("Une idée pour votre site", "https://demo.agence.example/orvane/"))
  ws.write(`data/demo/${ORVANE}.json`, mail("La démo de votre nouveau site", "https://demo.agence.example/orvane/video"))
  ws.write(`data/savior/${BRISANE}.json`, mail("Une idée pour votre atelier", "https://demo.agence.example/brisane/"))
  return ws
}

/** Décode un .eml (corps en base64) → { headers, text }. */
function readEml(raw: string): { headers: Record<string, string>; text: string } {
  const [head, body] = raw.split("\r\n\r\n")
  const headers: Record<string, string> = {}
  for (const l of head.split("\r\n")) { const i = l.indexOf(": "); headers[l.slice(0, i)] = l.slice(i + 2) }
  return { headers, text: Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8") }
}
const outbox = (ws: Workspace) => (ws.exists("data/sequencer/outbox") ? readdirSync(ws.path("data/sequencer/outbox")).sort() : [])
const lines = (ws: Workspace, f: string) => (ws.exists(f) ? ws.read(f).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [])

test("funnel du film en dry-run : clic signé → escalade débloquée → réponse = Hot Lead ; désinscription 1-clic ; F-3 ; 0 appel SMTP", { timeout: 180_000 }, async () => {
  const ws = funnelWs()
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const env = { TRACK_BASE: base, LWS_TRACK_SECRET: SECRET, LWS_MAIL_TRANSPORT: "simulated", LWS_REPLY_READER: "file" }
  let cockpit: Proc | null = null
  const seq = (args: string[]) => tsx(ws.dir, "outreach/scripts/sequencer.ts", args, { env })
  try {
    // le cockpit en mode « partagé » (mot de passe) : /api/* exige l'auth, /t/* est public
    cockpit = await startCockpit(ws.dir, { LWS_TRACK_SECRET: SECRET, BACKOFFICE_PASSWORD: PASS }, { port })
    const auth = { authorization: "Basic " + Buffer.from(`lws:${PASS}`).toString("base64") }

    // ── J0 : inscription + mail parfait (dry-run) ──
    assert.equal((await seq(["enroll", `${ORVANE},${BRISANE}`, "--now", "2026-10-24T08:00:00.000Z"])).code, 0)
    const j0 = await seq(["tick", "--now", "2026-10-24T09:00:00.000Z"])
    assert.equal(j0.code, 0, j0.out)
    assert.match(j0.stdout, /DRY-RUN → \[mail-parfait\] de b1@agence\.example → orvane/)
    assert.match(j0.stdout, /2 lien\(s\) suivi\(s\), désinscription 1-clic/)
    const sends0 = lines(ws, "data/sequencer/sends.jsonl")
    assert.equal(sends0.length, 2)
    const sOrv = sends0.find((s) => s.prospectId === ORVANE), sBri = sends0.find((s) => s.prospectId === BRISANE)
    assert.ok(sOrv.tracked && sOrv.dryRun)
    const emlOrv = readEml(ws.read(`data/sequencer/outbox/${outbox(ws).find((f) => f.includes(sOrv.trackingId))}`))
    assert.equal(emlOrv.headers.To, "contact@orvane-piscines.example")
    assert.equal(emlOrv.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click")
    assert.match(emlOrv.headers["List-Unsubscribe"], new RegExp(`^<${base}/t/u/[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{16}>, <mailto:b1@agence\\.example\\?subject=Desabonnement>$`))
    assert.doesNotMatch(emlOrv.text, /https:\/\/demo\.agence\.example/, "le lien du mail est réécrit")
    const clickLink = emlOrv.text.match(new RegExp(`${base}/t/c/[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]{16}`))![0]
    assert.deepEqual(parseClickToken(clickLink.split("/t/c/")[1], SECRET), { ok: true, trackingId: sOrv.trackingId, url: "https://demo.agence.example/orvane/" })

    // ── F-3 : l'endpoint ne redirige que vers ce qu'il a signé ──
    const get = (u: string, o: RequestInit = {}) => fetch(u, { redirect: "manual", ...o, headers: { "user-agent": BROWSER, ...(o.headers || {}) } })
    assert.equal((await get(`${base}/t/c/${sOrv.trackingId}?u=https://evil.example/`)).status, 400, "ancien format ?u= : refusé")
    const [tid, , sig] = clickLink.split("/t/c/")[1].split(".")
    const forged = await get(`${base}/t/c/${tid}.${Buffer.from("https://evil.example/").toString("base64url")}.${sig}`)
    assert.equal(forged.status, 403, "jeton forgé")
    assert.equal(forged.headers.get("location"), null)
    assert.equal((await get(clickLink, { method: "HEAD" })).status, 302, "HEAD : redirige sans compter")
    assert.equal((await get(clickLink, { method: "POST" })).status, 405)
    assert.equal(lines(ws, "data/sequencer/events.jsonl").length, 0, "rien d'enregistré par les requêtes invalides ni par HEAD")
    assert.equal((await get(`${base}/api/sequences`)).status, 401, "les API restent protégées")

    // ── le prospect CLIQUE (2 h après l'envoi, vrai navigateur) ──
    const click = await fetch(clickLink, { redirect: "manual", headers: { "user-agent": BROWSER } })
    assert.equal(click.status, 302)
    assert.equal(click.headers.get("location"), "https://demo.agence.example/orvane/")
    const ev1 = lines(ws, "data/sequencer/events.jsonl")
    assert.equal(ev1.length, 1)
    assert.equal(ev1[0].type, "click"); assert.equal(ev1[0].trackingId, sOrv.trackingId); assert.equal(ev1[0].suspect, undefined)
    // un scanner de liens (passerelle mail) suit le même lien : compté « suspect », ignoré par l'escalade
    await fetch(clickLink, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (compatible; Barracuda Sentinel)" } })
    assert.equal(lines(ws, "data/sequencer/events.jsonl")[1].suspect, true)
    // l'horloge simulée du séquenceur (--now) : le clic a lieu le lendemain du mail
    const evs = lines(ws, "data/sequencer/events.jsonl").map((e) => ({ ...e, at: "2026-10-25T11:00:00.000Z" }))
    ws.write("data/sequencer/events.jsonl", evs.map((e) => JSON.stringify(e)).join("\n") + "\n")

    // ── l'autre prospect se DÉSINSCRIT en 1 clic (RFC 8058) ──
    const emlBri = readEml(ws.read(`data/sequencer/outbox/${outbox(ws).find((f) => f.includes(sBri.trackingId))}`))
    const unsubLink = emlBri.headers["List-Unsubscribe"].match(/<(http[^>]+)>/)![1]
    const page = await get(unsubLink)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /<form method="post"><input type="hidden" name="List-Unsubscribe" value="One-Click">/)
    assert.equal(lines(ws, "data/sequencer/events.jsonl").filter((e) => e.type === "unsub").length, 0, "GET ne désinscrit personne (scanners)")
    const post = (body: string) => fetch(unsubLink, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body })
    assert.equal((await post("autre=chose")).status, 400)
    assert.equal((await post("x=" + "a".repeat(2000))).status, 413, "corps plafonné")
    const done = await post("List-Unsubscribe=One-Click")
    assert.equal(done.status, 200, "public : sans mot de passe")
    assert.match(await done.text(), /C'est noté/)
    assert.equal(lines(ws, "data/sequencer/events.jsonl").filter((e) => e.type === "unsub").length, 1)
    // l'horloge simulée (--now) : la désinscription aussi est datée AVANT le tick J+3 (le tick ignore, à raison,
    // tout évènement postérieur à son `now` ; sans ceci le test dépend de la date réelle d'exécution)
    const evs2 = lines(ws, "data/sequencer/events.jsonl").map((e) => (e.type === "unsub" ? { ...e, at: "2026-10-26T10:00:00.000Z" } : e))
    ws.write("data/sequencer/events.jsonl", evs2.map((e) => JSON.stringify(e)).join("\n") + "\n")

    // ── J+3 : l'escalade gatée au clic est DÉBLOQUÉE pour Orvane ; Brisane sort ──
    const j3 = await seq(["tick", "--now", "2026-10-27T09:30:00.000Z"])
    assert.equal(j3.code, 0, j3.out)
    assert.match(j3.stdout, /📬 évènements : 1 clic\(s\), 0 réponse\(s\), 1 sortie\(s\), 1 clic\(s\) de scanner ignoré\(s\)/)
    assert.match(j3.stdout, /DRY-RUN → \[demo-perso\] de b1@agence\.example → orvane/)
    let st = ws.json<any[]>("data/sequencer/state.json")
    const orv = st.find((s) => s.prospectId === ORVANE), bri = st.find((s) => s.prospectId === BRISANE)
    assert.equal(orv.step, 2); assert.equal(orv.status, "active"); assert.deepEqual(orv.clicks, ["2026-10-25T11:00:00.000Z"])
    assert.equal(bri.status, "dropped"); assert.equal(bri.stoppedBy.type, "unsub")
    assert.equal(lines(ws, "data/sequencer/sends.jsonl").length, 3)

    // ── J+4 : il RÉPOND (le faux lecteur lit la boîte) ⇒ replied + Hot Lead + learning ──
    ws.write("data/sequencer/inbox.jsonl", [
      { inbox: "b1@agence.example", id: "m1", from: "Orvane Piscines <contact@orvane-piscines.example>".match(/<(.+)>/)![1], subject: "Re: La démo de votre nouveau site", text: "Bonjour Camille, c'est très réussi. Appelez-moi jeudi matin ?", at: "2026-10-28T10:00:00.000Z" },
      { inbox: "b1@agence.example", id: "m2", from: "contact@orvane-piscines.example", subject: "Réponse automatique : absent", text: "", at: "2026-10-28T10:05:00.000Z" },
    ].map((m) => JSON.stringify(m)).join("\n") + "\n")
    const j4 = await seq(["tick", "--now", "2026-10-28T11:00:00.000Z"])
    assert.equal(j4.code, 0, j4.out)
    assert.match(j4.stdout, /📥 lecteur file : 2 message\(s\) lu\(s\), 1 évènement\(s\), 1 ignoré\(s\)/)
    assert.match(j4.stdout, /A RÉPONDU → Hot Lead/)
    st = ws.json<any[]>("data/sequencer/state.json")
    assert.equal(st.find((s) => s.prospectId === ORVANE).status, "replied")
    const outcomes = lines(ws, "data/outcomes.jsonl")
    assert.deepEqual(outcomes.map((o) => [o.id, o.outcome, o.industry]), [[ORVANE, "reply", "pisciniste"]])
    assert.deepEqual([outcomes[0].value, outcomes[0].tier], [83, "hot"], "l'issue porte les features du scoring (fiche)")

    // rejouable : un tick de plus ne double ni la réponse, ni l'issue, ni un envoi
    await seq(["tick", "--now", "2026-10-28T12:00:00.000Z"])
    assert.equal(lines(ws, "data/outcomes.jsonl").length, 1)
    assert.equal(lines(ws, "data/sequencer/sends.jsonl").length, 3)

    // le cockpit le montre (séquences) et la vue Machine le compte
    const sq = await (await fetch(`${base}/api/sequences`, { headers: auth })).json()
    assert.equal(sq.stats.replied, 1); assert.equal(sq.stats.dropped, 1); assert.equal(sq.stats.clicks, 1); assert.equal(sq.stats.unsubs, 1); assert.equal(sq.stats.scannerClicks, 1)
    const mx = await (await fetch(`${base}/api/machine`, { headers: auth })).json()
    const sell = mx.stages.find((s: any) => s.key === "sell")
    assert.equal(sell.count, 2, "enrôlés")
    assert.deepEqual(sell.sub.slice(0, 4).map((x: any) => x.value), [0, 3, 1, 1], "en cours, mails, clics, réponses")
    // les faits parlent avec le NOM de la fiche (« Orvane Piscines »), pas le slug, même sans base
    assert.match(sell.last.text, /^a répondu · Orvane Piscines$/)
    assert.ok(mx.feed.some((f: any) => /Atelier Brisane/.test(f.text)), JSON.stringify(mx.feed.map((f: any) => f.text)))

    // ── et pas UN appel au transport SMTP de tout le funnel (dry-run) ──
    assert.equal(ws.exists("data/sequencer/transport.jsonl"), false)
  } finally { await cockpit?.stop(); ws.cleanup() }
})

test("réel = les deux clés : sans LWS_LIVE_SEND le tick refuse (0 appel au transport) ; avec, 1 appel par mail, identique au .eml", { timeout: 120_000 }, async () => {
  const ws = funnelWs()
  try {
    const cfg = JSON.parse(ws.read("outreach/sequencer/config.json")); cfg.dryRun = false
    ws.write("outreach/sequencer/config.json", JSON.stringify(cfg))
    const env = { TRACK_BASE: "https://cockpit.agence.example", LWS_TRACK_SECRET: SECRET, LWS_MAIL_TRANSPORT: "simulated" }
    await tsx(ws.dir, "outreach/scripts/sequencer.ts", ["enroll", ORVANE, "--now", "2026-10-24T08:00:00.000Z"], { env })
    const refused = await tsx(ws.dir, "outreach/scripts/sequencer.ts", ["tick", "--now", "2026-10-24T09:00:00.000Z"], { env })
    assert.equal(refused.code, 2)
    assert.equal(ws.exists("data/sequencer/transport.jsonl"), false, "0 appel au transport sans LWS_LIVE_SEND=1")
    const live = await tsx(ws.dir, "outreach/scripts/sequencer.ts", ["tick", "--now", "2026-10-24T09:00:00.000Z"], { env: { ...env, LWS_LIVE_SEND: "1" } })
    assert.equal(live.code, 0, live.out)
    assert.match(live.stdout, /🔴 ENVOI RÉEL/)
    const calls = lines(ws, "data/sequencer/transport.jsonl")
    assert.equal(calls.length, 1)
    assert.equal(calls[0].to, "contact@orvane-piscines.example")
    const eml = ws.read(`data/sequencer/outbox/${outbox(ws)[0]}`)
    assert.equal(Buffer.from(calls[0].raw, "base64url").toString("utf8"), eml, "ce qui part = ce que le .eml montre")
    assert.equal(lines(ws, "data/sequencer/sends.jsonl")[0].dryRun, false)
  } finally { ws.cleanup() }
})

test("réel : un envoi qui échoue ne casse pas le tick (les autres partent, code 1) et repart au tick suivant, sans jamais doubler", { timeout: 120_000 }, async () => {
  const ws = funnelWs()
  try {
    const cfg = JSON.parse(ws.read("outreach/sequencer/config.json")); cfg.dryRun = false
    ws.write("outreach/sequencer/config.json", JSON.stringify(cfg))
    const env = { TRACK_BASE: "https://cockpit.agence.example", LWS_TRACK_SECRET: SECRET, LWS_MAIL_TRANSPORT: "simulated", LWS_LIVE_SEND: "1" }
    const seq = (args: string[], extra: Record<string, string> = {}) => tsx(ws.dir, "outreach/scripts/sequencer.ts", args, { env: { ...env, ...extra } })
    await seq(["enroll", `${ORVANE},${BRISANE}`, "--now", "2026-10-24T08:00:00.000Z"])
    // la passerelle refuse le mail de Brisane (panne simulée) : Orvane part quand même
    const t1 = await seq(["tick", "--now", "2026-10-24T09:00:00.000Z"], { LWS_SIMULATED_FAIL: "brisane" })
    assert.equal(t1.code, 1, "un échec d'envoi = tick en code 1 (le wrapper et l'alerte systemd le voient)")
    assert.match(t1.out, /✗ atelier-brisane-menuiserie-sornac-le-haut : envoi « mail-parfait » échoué \(échec simulé/)
    assert.match(t1.stdout, /1 envoi\(s\), .* 1 échec\(s\) d'envoi/)
    let st = ws.json<any[]>("data/sequencer/state.json")
    assert.equal(st.find((x) => x.prospectId === ORVANE).step, 1)
    assert.deepEqual([st.find((x) => x.prospectId === BRISANE).step, st.find((x) => x.prospectId === BRISANE).status], [0, "active"], "rien n'avance pour l'échec")
    assert.equal(lines(ws, "data/sequencer/sends.jsonl").length, 1, "l'échec n'est pas tracé comme un envoi")
    // la panne passe : Brisane part au tick suivant, Orvane n'est PAS renvoyé
    const t2 = await seq(["tick", "--now", "2026-10-24T10:00:00.000Z"])
    assert.equal(t2.code, 0, t2.out)
    const calls = lines(ws, "data/sequencer/transport.jsonl")
    assert.deepEqual(calls.map((c) => c.to).sort(), ["bonjour@atelier-brisane.example", "contact@orvane-piscines.example"])
    assert.equal(lines(ws, "data/sequencer/sends.jsonl").length, 2)
    st = ws.json<any[]>("data/sequencer/state.json")
    assert.deepEqual(st.map((x) => x.step), [1, 1])
  } finally { ws.cleanup() }
})

test("CLI : bounce et plainte sortent le prospect et comptent au disjoncteur ; `breaker` et `breaker reset`", { timeout: 60_000 }, async () => {
  const ws = funnelWs()
  try {
    const seq = (args: string[]) => tsx(ws.dir, "outreach/scripts/sequencer.ts", args)
    await seq(["enroll", `${ORVANE},${BRISANE}`, "--now", "2026-10-24T08:00:00.000Z"])
    await seq(["tick", "--now", "2026-10-24T09:00:00.000Z"])
    const b = await seq(["bounce", BRISANE, "--now", "2026-10-24T10:00:00.000Z"])
    assert.match(b.stdout, /🛑 atelier-brisane-menuiserie-sornac-le-haut → dropped .* compté au disjoncteur/)
    const c = await seq(["complaint", ORVANE, "--now", "2026-10-24T10:05:00.000Z"])
    assert.equal(c.code, 0)
    assert.deepEqual(lines(ws, "data/sequencer/events.jsonl").map((e) => [e.type, e.source]), [["bounce", "cli"], ["complaint", "cli"]])
    await seq(["tick", "--now", "2026-10-24T11:00:00.000Z"])
    assert.match((await seq(["breaker"])).stdout, /disjoncteur : ⛔ OUVERT · 2 envoi\(s\) .* bounces 1 · plaintes 1/)
    assert.match((await seq(["breaker", "reset", "--now", "2026-10-24T12:00:00.000Z"])).stdout, /disjoncteur réarmé/)
    assert.match((await seq(["breaker"])).stdout, /disjoncteur : ✓ fermé/)
  } finally { ws.cleanup() }
})
