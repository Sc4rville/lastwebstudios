/**
 * G11 / F-3 (pure computation): the self-hosted tracking's links are SIGNED, unsubscribing follows RFC 8058, the
 * built message is the one that would go out, and `sendMail` NEVER calls the transport without LWS_LIVE_SEND=1.
 * The example agency is French, so the footer asserted here is the French legal text.
 */
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import {
  clickToken, parseClickToken, unsubToken, parseUnsubToken, encodeTid, decodeTid, rewriteLinks, trackConfig, trackingSecret,
  clickUrl, unsubUrl, readableLinks,
} from "../../outreach/tracking/links.ts"
import { buildMessage, sendMail, type Transport } from "../../outreach/scripts/lib/smtp.ts"
import { suspectUa } from "../../outreach/tracking/events.ts"

const SECRET = "secret-de-test-fictif-0123456789abcdef-xyz"
const CFG = { base: "https://cockpit.agence.example", secret: SECRET }
const TID = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e"

describe("signed tokens (HMAC-SHA256, LWS_TRACK_SECRET)", () => {
  test("trackingId ⇄ 22 base64url characters, validated when decoded", () => {
    const e = encodeTid(TID)
    assert.equal(e.length, 22)
    assert.equal(decodeTid(e), TID)
    assert.equal(decodeTid("x".repeat(22)), null, "not a v1-8 UUID")
    assert.equal(decodeTid("abc"), null)
    assert.throws(() => encodeTid("pas-un-uuid"))
  })
  test("click: the token carries the send AND the URL; read back identically", () => {
    const t = clickToken(TID, "https://cal.agence.example/15min?x=1", SECRET)
    const p = parseClickToken(t, SECRET)
    assert.deepEqual(p, { ok: true, trackingId: TID, url: "https://cal.agence.example/15min?x=1" })
  })
  test("FORGED token (another URL, another secret, altered signature) → 403", () => {
    const t = clickToken(TID, "https://cal.agence.example/", SECRET)
    const [id, , sig] = t.split(".")
    const evil = `${id}.${Buffer.from("https://evil.example/").toString("base64url")}.${sig}`
    assert.deepEqual(parseClickToken(evil, SECRET), { ok: false, status: 403, error: "invalid signature" })
    assert.equal((parseClickToken(t, SECRET + "x") as any).status, 403)
    assert.equal((parseClickToken(t.slice(0, -1) + (t.endsWith("A") ? "B" : "A"), SECRET) as any).status, 403)
  })
  test("malformed token (parts, id, non-http URL, too long) → 400", () => {
    for (const bad of ["", "a.b", "a.b.c.d", `${"x".repeat(22)}.aGk.AAAAAAAAAAAAAAAA`, `${encodeTid(TID)}.${Buffer.from("javascript:alert(1)").toString("base64url")}.AAAAAAAAAAAAAAAA`, "z".repeat(4000)]) {
      assert.equal((parseClickToken(bad, SECRET) as any).status, 400, bad.slice(0, 40))
    }
  })
  test("an unsubscribe token is not a click, and the other way round", () => {
    const u = unsubToken(TID, SECRET)
    assert.deepEqual(parseUnsubToken(u, SECRET), { ok: true, trackingId: TID })
    assert.equal(parseClickToken(u, SECRET).ok, false)
    const c = clickToken(TID, "https://a.example/", SECRET)
    assert.equal(parseUnsubToken(c, SECRET).ok, false)
    assert.equal((parseUnsubToken(`${encodeTid(randomUUID())}.${u.split(".")[1]}`, SECRET) as any).status, 403, "another send's signature")
  })
  test("config: TRACK_BASE http(s) + secret ≥ 32 characters, otherwise no tracking", () => {
    assert.equal(trackingSecret({ LWS_TRACK_SECRET: "court" }), null)
    assert.equal(trackConfig({ TRACK_BASE: "https://x.example/", LWS_TRACK_SECRET: SECRET })?.base, "https://x.example")
    assert.equal(trackConfig({ TRACK_BASE: "ftp://x.example", LWS_TRACK_SECRET: SECRET }), null)
    assert.equal(trackConfig({ LWS_TRACK_SECRET: SECRET }), null)
  })
})

describe("rewriting the links of a text email", () => {
  test("each http(s) link becomes a signed click link; trailing punctuation and text untouched", () => {
    const body = "Bonjour,\nVotre aperçu : https://demo.agence.example/orvane/.\nUn créneau ? (https://cal.agence.example/15min) Merci !"
    const r = rewriteLinks(body, TID, CFG)
    assert.deepEqual(r.links, ["https://demo.agence.example/orvane/", "https://cal.agence.example/15min"])
    assert.match(r.text, /^Bonjour,\nVotre aperçu : https:\/\/cockpit\.agence\.example\/t\/c\/[A-Za-z0-9_.-]+\.\nUn créneau \? \(https:\/\/cockpit\.agence\.example\/t\/c\/[A-Za-z0-9_.-]+\) Merci !$/)
    const tokens = [...r.text.matchAll(/https:\/\/cockpit\.agence\.example\/t\/c\/([A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{16})/g)].map((m) => m[1])
    assert.equal(tokens.length, 2)
    assert.deepEqual(tokens.map((t) => (parseClickToken(t, SECRET) as any).url), r.links)
  })
  test("without config: nothing is rewritten; an already tracked link is not wrapped again", () => {
    assert.deepEqual(rewriteLinks("voir https://a.example", TID, null), { text: "voir https://a.example", links: [] })
    const once = rewriteLinks("https://a.example/x", TID, CFG).text
    assert.equal(rewriteLinks(once, TID, CFG).text, once)
  })
})

describe("the built message (identical in dry-run and for real)", () => {
  const opts = { inbox: "b1@agence.example", to: "contact@orvane-piscines.example", subject: "Une idée pour votre site", body: "Bonjour,\nL'aperçu : https://demo.agence.example/orvane/\nCamille", senderName: "Camille (fictive)", trackingId: TID }
  test("RFC 8058 headers: List-Unsubscribe https + mailto, List-Unsubscribe-Post One-Click; legal footer with the link", () => {
    const m = buildMessage(opts, CFG)
    assert.equal(m.tracked, true)
    assert.equal(m.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click")
    assert.match(m.headers["List-Unsubscribe"], /^<https:\/\/cockpit\.agence\.example\/t\/u\/[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{16}>, <mailto:b1@agence\.example\?subject=Desabonnement>$/)
    assert.match(m.text, /Pour ne plus être contacté, un clic suffit : https:\/\/cockpit\.agence\.example\/t\/u\//)
    assert.doesNotMatch(m.text, /https:\/\/demo\.agence\.example/, "the plain link was rewritten")
    assert.match(m.rfc822, /\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n/)
    assert.equal(Buffer.from(m.raw, "base64url").toString("utf8"), m.rfc822)
    const bodyPart = m.rfc822.split("\r\n\r\n")[1]
    assert.equal(Buffer.from(bodyPart.replace(/\r\n/g, ""), "base64").toString("utf8"), m.text)
  })
  test("without tracking: mailto only, no -Post, links left as they are, « STOP » in the footer", () => {
    const m = buildMessage(opts, null)
    assert.equal(m.tracked, false)
    assert.equal(m.headers["List-Unsubscribe"], "<mailto:b1@agence.example?subject=Desabonnement>")
    assert.equal(m.headers["List-Unsubscribe-Post"], undefined)
    assert.match(m.text, /https:\/\/demo\.agence\.example\/orvane\//)
    assert.match(m.text, /répondez simplement « STOP »/)
  })
  test("no header injection through the subject or the sender", () => {
    const m = buildMessage({ ...opts, subject: "Salut\r\nBcc: victime@x.example", senderName: "A\nB" }, CFG)
    assert.doesNotMatch(m.rfc822, /\r\nBcc:/)
    assert.equal(m.rfc822.split("\r\n\r\n")[0].split("\r\n").length, Object.keys(m.headers).length)
  })
})

describe("sendMail: never a call to the transport without LWS_LIVE_SEND=1", () => {
  const opts = { inbox: "b1@agence.example", to: "contact@orvane-piscines.example", subject: "s", body: "b https://a.example", senderName: "x", trackingId: TID }
  const spy = () => { const calls: any[] = []; const t: Transport = { name: "spy", send: async (inbox, raw, meta) => { calls.push({ inbox, raw, meta }) } }; return { t, calls } }
  test("without LWS_LIVE_SEND: throws, 0 calls to the transport", async () => {
    const { t, calls } = spy()
    for (const env of [{}, { LWS_LIVE_SEND: "true" }, { LWS_LIVE_SEND: "0" }]) {
      await assert.rejects(sendMail(opts, { transport: t, env, cfg: CFG }), /LWS_LIVE_SEND=1 absent/)
    }
    assert.equal(calls.length, 0)
  })
  test("with LWS_LIVE_SEND=1: exactly 1 call, the message carries the signed links", async () => {
    const { t, calls } = spy()
    const m = await sendMail(opts, { transport: t, env: { LWS_LIVE_SEND: "1" }, cfg: CFG })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].raw, m.raw)
    assert.match(Buffer.from(calls[0].raw, "base64url").toString("utf8"), /List-Unsubscribe-Post/)
  })
})

test("link scanners' user agents spotted (fake clicks), real browsers not", () => {
  for (const ua of ["", "Mozilla/5.0 (compatible; Barracuda Sentinel)", "Microsoft Office SafeLinks", "python-requests/2.32", "curl/8.5.0", "Mozilla/5.0 HeadlessChrome/131"]) assert.equal(suspectUa(ua), true, ua)
  for (const ua of ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36"]) assert.equal(suspectUa(ua), false, ua)
})

test("public URLs built from the config", () => {
  assert.match(clickUrl(CFG, TID, "https://a.example/"), /^https:\/\/cockpit\.agence\.example\/t\/c\//)
  assert.match(unsubUrl(CFG, TID), /^https:\/\/cockpit\.agence\.example\/t\/u\//)
})

test("the Email tab reads a written email with each tracked link shown as where it goes, never the raw token", () => {
  const tid = randomUUID()
  const site = "https://larkmoor-plumbing.sites.example/"
  const body = `Hi Dana,\n\nHere it is: ${clickUrl(CFG, tid, site)}\n\nAnd our work: ${clickUrl(CFG, tid, "https://harbor-pine.example/work")}`
  const shown = readableLinks(body, "larkmoor-plumbing-round-rock")
  assert.doesNotMatch(shown, /\/t\/c\//)
  assert.match(shown, /Here it is: larkmoor-plumbing\.sites\.example \(link to the new site\)/)
  assert.match(shown, /And our work: harbor-pine\.example\/work$/)
  assert.equal(readableLinks(`one click is enough: ${unsubUrl(CFG, tid)} (or reply "STOP")`), 'one click is enough: (unsubscribe link) (or reply "STOP")')
})
