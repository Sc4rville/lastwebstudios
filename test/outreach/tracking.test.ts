/**
 * G11 / F-3 (calcul pur) : les liens du tracking auto-hébergé sont SIGNÉS, la désinscription suit RFC 8058, le
 * message construit est celui qui partirait, et `sendMail` n'appelle JAMAIS le transport sans LWS_LIVE_SEND=1.
 */
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import {
  clickToken, parseClickToken, unsubToken, parseUnsubToken, encodeTid, decodeTid, rewriteLinks, trackConfig, trackingSecret,
  clickUrl, unsubUrl,
} from "../../outreach/tracking/links.ts"
import { buildMessage, sendMail, type Transport } from "../../outreach/scripts/lib/smtp.ts"
import { suspectUa } from "../../outreach/tracking/events.ts"

const SECRET = "secret-de-test-fictif-0123456789abcdef-xyz"
const CFG = { base: "https://cockpit.agence.example", secret: SECRET }
const TID = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e"

describe("jetons signés (HMAC-SHA256, LWS_TRACK_SECRET)", () => {
  test("trackingId ⇄ 22 caractères base64url, validé au décodage", () => {
    const e = encodeTid(TID)
    assert.equal(e.length, 22)
    assert.equal(decodeTid(e), TID)
    assert.equal(decodeTid("x".repeat(22)), null, "pas un UUID v1-8")
    assert.equal(decodeTid("abc"), null)
    assert.throws(() => encodeTid("pas-un-uuid"))
  })
  test("clic : le jeton porte l'envoi ET l'URL ; relu à l'identique", () => {
    const t = clickToken(TID, "https://cal.agence.example/15min?x=1", SECRET)
    const p = parseClickToken(t, SECRET)
    assert.deepEqual(p, { ok: true, trackingId: TID, url: "https://cal.agence.example/15min?x=1" })
  })
  test("jeton FORGÉ (autre URL, autre secret, signature altérée) → 403", () => {
    const t = clickToken(TID, "https://cal.agence.example/", SECRET)
    const [id, , sig] = t.split(".")
    const evil = `${id}.${Buffer.from("https://evil.example/").toString("base64url")}.${sig}`
    assert.deepEqual(parseClickToken(evil, SECRET), { ok: false, status: 403, error: "signature invalide" })
    assert.equal((parseClickToken(t, SECRET + "x") as any).status, 403)
    assert.equal((parseClickToken(t.slice(0, -1) + (t.endsWith("A") ? "B" : "A"), SECRET) as any).status, 403)
  })
  test("jeton mal formé (parties, id, URL non http, trop long) → 400", () => {
    for (const bad of ["", "a.b", "a.b.c.d", `${"x".repeat(22)}.aGk.AAAAAAAAAAAAAAAA`, `${encodeTid(TID)}.${Buffer.from("javascript:alert(1)").toString("base64url")}.AAAAAAAAAAAAAAAA`, "z".repeat(4000)]) {
      assert.equal((parseClickToken(bad, SECRET) as any).status, 400, bad.slice(0, 40))
    }
  })
  test("un jeton de désinscription ne vaut pas clic, et inversement", () => {
    const u = unsubToken(TID, SECRET)
    assert.deepEqual(parseUnsubToken(u, SECRET), { ok: true, trackingId: TID })
    assert.equal(parseClickToken(u, SECRET).ok, false)
    const c = clickToken(TID, "https://a.example/", SECRET)
    assert.equal(parseUnsubToken(c, SECRET).ok, false)
    assert.equal((parseUnsubToken(`${encodeTid(randomUUID())}.${u.split(".")[1]}`, SECRET) as any).status, 403, "signature d'un autre envoi")
  })
  test("config : TRACK_BASE http(s) + secret ≥ 32 caractères, sinon pas de tracking", () => {
    assert.equal(trackingSecret({ LWS_TRACK_SECRET: "court" }), null)
    assert.equal(trackConfig({ TRACK_BASE: "https://x.example/", LWS_TRACK_SECRET: SECRET })?.base, "https://x.example")
    assert.equal(trackConfig({ TRACK_BASE: "ftp://x.example", LWS_TRACK_SECRET: SECRET }), null)
    assert.equal(trackConfig({ LWS_TRACK_SECRET: SECRET }), null)
  })
})

describe("réécriture des liens d'un mail texte", () => {
  test("chaque lien http(s) devient un lien de clic signé ; ponctuation finale et texte intacts", () => {
    const body = "Bonjour,\nVotre aperçu : https://demo.agence.example/orvane/.\nUn créneau ? (https://cal.agence.example/15min) Merci !"
    const r = rewriteLinks(body, TID, CFG)
    assert.deepEqual(r.links, ["https://demo.agence.example/orvane/", "https://cal.agence.example/15min"])
    assert.match(r.text, /^Bonjour,\nVotre aperçu : https:\/\/cockpit\.agence\.example\/t\/c\/[A-Za-z0-9_.-]+\.\nUn créneau \? \(https:\/\/cockpit\.agence\.example\/t\/c\/[A-Za-z0-9_.-]+\) Merci !$/)
    const tokens = [...r.text.matchAll(/https:\/\/cockpit\.agence\.example\/t\/c\/([A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{16})/g)].map((m) => m[1])
    assert.equal(tokens.length, 2)
    assert.deepEqual(tokens.map((t) => (parseClickToken(t, SECRET) as any).url), r.links)
  })
  test("sans config : rien n'est réécrit ; un lien déjà suivi n'est pas ré-emballé", () => {
    assert.deepEqual(rewriteLinks("voir https://a.example", TID, null), { text: "voir https://a.example", links: [] })
    const once = rewriteLinks("https://a.example/x", TID, CFG).text
    assert.equal(rewriteLinks(once, TID, CFG).text, once)
  })
})

describe("le message construit (identique en dry-run et en réel)", () => {
  const opts = { inbox: "b1@agence.example", to: "contact@orvane-piscines.example", subject: "Une idée pour votre site", body: "Bonjour,\nL'aperçu : https://demo.agence.example/orvane/\nCamille", senderName: "Camille (fictive)", trackingId: TID }
  test("en-têtes RFC 8058 : List-Unsubscribe https + mailto, List-Unsubscribe-Post One-Click ; pied légal avec lien", () => {
    const m = buildMessage(opts, CFG)
    assert.equal(m.tracked, true)
    assert.equal(m.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click")
    assert.match(m.headers["List-Unsubscribe"], /^<https:\/\/cockpit\.agence\.example\/t\/u\/[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{16}>, <mailto:b1@agence\.example\?subject=Desabonnement>$/)
    assert.match(m.text, /Pour ne plus être contacté, un clic suffit : https:\/\/cockpit\.agence\.example\/t\/u\//)
    assert.doesNotMatch(m.text, /https:\/\/demo\.agence\.example/, "le lien en clair a été réécrit")
    assert.match(m.rfc822, /\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n/)
    assert.equal(Buffer.from(m.raw, "base64url").toString("utf8"), m.rfc822)
    const bodyPart = m.rfc822.split("\r\n\r\n")[1]
    assert.equal(Buffer.from(bodyPart.replace(/\r\n/g, ""), "base64").toString("utf8"), m.text)
  })
  test("sans tracking : mailto seul, pas de -Post, liens laissés tels quels, « STOP » dans le pied", () => {
    const m = buildMessage(opts, null)
    assert.equal(m.tracked, false)
    assert.equal(m.headers["List-Unsubscribe"], "<mailto:b1@agence.example?subject=Desabonnement>")
    assert.equal(m.headers["List-Unsubscribe-Post"], undefined)
    assert.match(m.text, /https:\/\/demo\.agence\.example\/orvane\//)
    assert.match(m.text, /répondez simplement « STOP »/)
  })
  test("aucune injection d'en-tête par l'objet ou l'expéditeur", () => {
    const m = buildMessage({ ...opts, subject: "Salut\r\nBcc: victime@x.example", senderName: "A\nB" }, CFG)
    assert.doesNotMatch(m.rfc822, /\r\nBcc:/)
    assert.equal(m.rfc822.split("\r\n\r\n")[0].split("\r\n").length, Object.keys(m.headers).length)
  })
})

describe("sendMail : jamais d'appel au transport sans LWS_LIVE_SEND=1", () => {
  const opts = { inbox: "b1@agence.example", to: "contact@orvane-piscines.example", subject: "s", body: "b https://a.example", senderName: "x", trackingId: TID }
  const spy = () => { const calls: any[] = []; const t: Transport = { name: "spy", send: async (inbox, raw, meta) => { calls.push({ inbox, raw, meta }) } }; return { t, calls } }
  test("sans LWS_LIVE_SEND : lève, 0 appel au transport", async () => {
    const { t, calls } = spy()
    for (const env of [{}, { LWS_LIVE_SEND: "true" }, { LWS_LIVE_SEND: "0" }]) {
      await assert.rejects(sendMail(opts, { transport: t, env, cfg: CFG }), /LWS_LIVE_SEND=1 absent/)
    }
    assert.equal(calls.length, 0)
  })
  test("avec LWS_LIVE_SEND=1 : exactement 1 appel, le message porte les liens signés", async () => {
    const { t, calls } = spy()
    const m = await sendMail(opts, { transport: t, env: { LWS_LIVE_SEND: "1" }, cfg: CFG })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].raw, m.raw)
    assert.match(Buffer.from(calls[0].raw, "base64url").toString("utf8"), /List-Unsubscribe-Post/)
  })
})

test("user-agents de scanners de liens repérés (faux clics), vrais navigateurs non", () => {
  for (const ua of ["", "Mozilla/5.0 (compatible; Barracuda Sentinel)", "Microsoft Office SafeLinks", "python-requests/2.32", "curl/8.5.0", "Mozilla/5.0 HeadlessChrome/131"]) assert.equal(suspectUa(ua), true, ua)
  for (const ua of ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36"]) assert.equal(suspectUa(ua), false, ua)
})

test("URL publiques construites à partir de la config", () => {
  assert.match(clickUrl(CFG, TID, "https://a.example/"), /^https:\/\/cockpit\.agence\.example\/t\/c\//)
  assert.match(unsubUrl(CFG, TID), /^https:\/\/cockpit\.agence\.example\/t\/u\//)
})
