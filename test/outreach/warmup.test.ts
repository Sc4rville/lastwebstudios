/**
 * G2 / F-5: the warmup sends NOTHING without LWS_LIVE_SEND=1 (no send, no reply, no Gmail rescue, no log)
 * and the report needs DIGEST_TO (no default recipient, never a maintainer's address).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { tsx } from "../helpers/proc.ts"
import { makeWorkspace, type Workspace } from "../helpers/workspace.ts"

const W = "outreach/scripts/warmup.ts"
function wws(): Workspace {
  const ws = makeWorkspace()
  const cfg = JSON.parse(ws.read("outreach/sequencer/config.json"))
  cfg.inboxes = { A: [{ email: "a1@agence.example", throttlePerDay: 8 }], B: [{ email: "b1@agence.example", throttlePerDay: 8 }, { email: "b2@agence.example", throttlePerDay: 8 }] }
  ws.write("outreach/sequencer/config.json", JSON.stringify(cfg))
  return ws
}

test("`npm run warmup` with no argument: dry-run announced, nothing sent or written", async () => {
  const ws = wws()
  try {
    const r = await tsx(ws.dir, W)
    assert.equal(r.code, 0, r.out)
    assert.match(r.stdout, /DRY-RUN/)
    assert.match(r.stdout, /no email goes out/)
    assert.match(r.stdout, /simulated sends/)
    assert.equal(ws.exists("data/warmup"), false, "neither log nor state written in dry-run")
  } finally { ws.cleanup() }
})

test("digest without DIGEST_TO: a clear refusal, no default recipient", async () => {
  const ws = wws()
  try {
    const r = await tsx(ws.dir, W, ["digest"])
    assert.equal(r.code, 1)
    assert.match(r.stderr, /DIGEST_TO missing/)
  } finally { ws.cleanup() }
})

test("digest with DIGEST_TO in dry-run: says who it would have sent it to, does not send", async () => {
  const ws = wws()
  try {
    const r = await tsx(ws.dir, W, ["digest"], { env: { DIGEST_TO: "ops@agence.example" } })
    assert.equal(r.code, 0, r.out)
    assert.match(r.stdout, /NOT sent \(dry-run\): recipient ops@agence\.example/)
    assert.match(r.stdout, /DRY-RUN: b1@agence\.example → ops@agence\.example/)
  } finally { ws.cleanup() }
})

test("`once` without LWS_LIVE_SEND: nothing is sent", async () => {
  const ws = wws()
  try {
    const r = await tsx(ws.dir, W, ["once", "a1@agence.example", "b1@agence.example"])
    assert.equal(r.code, 0, r.out)
    assert.match(r.stdout, /nothing sent \(dry-run\)/)
  } finally { ws.cleanup() }
})

test("unknown command: usage, exit 1", async () => {
  const ws = wws()
  try {
    const r = await tsx(ws.dir, W, ["envoie-tout"])
    assert.equal(r.code, 1)
    assert.match(r.stderr, /usage: npm run warmup/)
  } finally { ws.cleanup() }
})

test("no personal address nor hard-coded mailbox as the digest's recipient/sender", () => {
  const src = readFileSync(W, "utf8")
  const digest = src.slice(src.indexOf("async function digest"), src.indexOf("async function status"))
  assert.doesNotMatch(digest, /@[a-z0-9-]+\.(com|fr|net|org)"/i)
  assert.doesNotMatch(src, /gmail\.com"/)
})

test("REAL warmup (simulated transport): two simultaneous ticks do not exceed today's target (lock), Gmail rescue skipped", { timeout: 90_000 }, async () => {
  // blitz test of 10/24: two ticks read the same log and doubled the day's sends (ramp exceeded)
  const ws = wws()
  try {
    const env = { LWS_LIVE_SEND: "1", LWS_MAIL_TRANSPORT: "simulated", LWS_SIMULATED_DELAY_MS: "150" }
    const [a, b] = await Promise.all([tsx(ws.dir, W, ["tick"], { env }), tsx(ws.dir, W, ["tick"], { env })])
    assert.equal(a.code, 0, a.out); assert.equal(b.code, 0, b.out)
    const log = ws.read("data/warmup/log.jsonl").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "send")
    const perBox = new Map<string, number>()
    for (const e of log) perBox.set(e.from, (perBox.get(e.from) || 0) + 1)
    assert.ok([...perBox.values()].every((n) => n <= 2), `day 1, target 2 per mailbox: ${JSON.stringify([...perBox])}`)
    const sent = ws.read("data/sequencer/transport.jsonl").trim().split("\n").length
    assert.equal(sent, log.length + ws.read("data/warmup/log.jsonl").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "reply").length, "every logged send went through the transport")
    assert.ok(sent <= 6, `${sent} emails for 3 mailboxes × 2`)
    assert.doesNotMatch(a.out + b.out, /rescue|sa-key/, "no Gmail rescue on the simulated transport")
    assert.equal(ws.exists("data/warmup/.lock"), false, "lock released")
  } finally { ws.cleanup() }
})
