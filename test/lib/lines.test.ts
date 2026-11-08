/**
 * Blitz test (24/10) · reading a child process's output without breaking it (packages/shared/lines.mjs).
 *
 * Bug found: the worker split each piece of the pipe with `toString().split("\n")`. A JSON line straddling
 * two pieces became two unreadable halves: `claude -p`'s `result` event (cost, tokens) was lost and
 * the cage's spend ledger under-counted. Elsewhere, `toString()` per piece turned a split "é" into "��"
 * (sheet, coach's verdict, the cockpit's POST body). Here: properties over random splits (fixed seed),
 * and a source guard so the pattern doesn't come back. The French strings below are fixture text.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { lineSplitter, textCollector } from "../../packages/shared/lines.mjs"

/** Deterministic PRNG (mulberry32): a failure replays identically. */
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

/** Cuts a Buffer into random pieces of 1 to `max` bytes (so it cuts in the middle of UTF-8 characters). */
function chunks(buf: Buffer, rand: () => number, max: number): Buffer[] {
  const out: Buffer[] = []
  for (let i = 0; i < buf.length;) { const n = 1 + Math.floor(rand() * max); out.push(buf.subarray(i, i + n)); i += n }
  return out
}

const LINES = [
  JSON.stringify({ type: "system", subtype: "init", tools: ["Agent", "Write"] }),
  JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Rénovation du bassin, côté été : « déjà prêt » ✓ 🏊" }] } }),
  "",
  "ligne de journal brute — avec un tiret cadratin et des accents : àâçéèêëîïôûùüÿœ",
  JSON.stringify({ type: "result", subtype: "success", result: "terminé, coût réel", total_cost_usd: 1.25, usage: { input_tokens: 120, output_tokens: 40 } }),
]

test("lineSplitter: the same lines whatever the pipe's splitting (500 random splits, UTF-8 of 1 to 4 bytes)", () => {
  const text = LINES.join("\n") + "\n"
  const buf = Buffer.from(text, "utf8")
  const rand = rng(20261024)
  for (let round = 0; round < 500; round++) {
    const got: string[] = []
    const s = lineSplitter((l) => got.push(l))
    for (const c of chunks(buf, rand, 1 + (round % 40))) s.push(c)
    s.end()
    assert.deepEqual(got, LINES, `split no. ${round}`)
    assert.ok(!got.join("").includes("�"), "no replacement character")
  }
})

test("lineSplitter: CRLF removed, a last line without a line break delivered at end(), nothing after end(), strings accepted", () => {
  const got: string[] = []
  const s = lineSplitter((l) => got.push(l))
  s.push("a\r\nb")
  s.push(Buffer.from("\r\n", "utf8"))
  s.push("dernière sans retour")
  assert.deepEqual(got, ["a", "b"])
  s.end()
  assert.deepEqual(got, ["a", "b", "dernière sans retour"])
  s.push("ignoré\n"); s.end()
  assert.equal(got.length, 3)
  // an "é" whose two bytes arrive separately
  const e: string[] = []
  const t = lineSplitter((l) => e.push(l))
  const b = Buffer.from("é\n", "utf8")
  t.push(b.subarray(0, 1)); t.push(b.subarray(1)); t.end()
  assert.deepEqual(e, ["é"])
})

test("lineSplitter: a 300 KB JSON line (a composer Write) arrives whole, in 64 KB pieces like a real pipe", () => {
  const big = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "output/sites/x/index.html", content: "<p>Piscine été ✓</p>".repeat(15_000) } }] } })
  const buf = Buffer.from(big + "\n" + LINES[4] + "\n", "utf8")
  const got: string[] = []
  const s = lineSplitter((l) => got.push(l))
  for (let i = 0; i < buf.length; i += 65_536) s.push(buf.subarray(i, i + 65_536))
  s.end()
  assert.equal(got.length, 2)
  assert.equal(JSON.parse(got[0]).message.content[0].input.content.length, "<p>Piscine été ✓</p>".length * 15_000)
  assert.equal(JSON.parse(got[1]).total_cost_usd, 1.25)
})

test("textCollector: decodes once (no \"�\" whatever the splitting); bounded, it keeps the END without a cut character", () => {
  const text = "Orvane Piscines rénove des bassins — vallée de la Lys, été 2026 🏊\n".repeat(50)
  const buf = Buffer.from(text, "utf8")
  const rand = rng(7)
  for (let round = 0; round < 200; round++) {
    const c = textCollector()
    for (const part of chunks(buf, rand, 9)) c.push(part)
    assert.equal(c.text(), text)
    assert.equal(c.bytes, buf.length)
  }
  const capped = textCollector(1000)
  for (const part of chunks(buf, rng(9), 33)) capped.push(part)
  const kept = capped.text()
  assert.ok(Buffer.byteLength(kept) <= 1000)
  assert.ok(text.endsWith(kept), "the end of the output is kept")
  assert.ok(!kept.includes("�"), "the cut at the start of the window leaves no half character")
})

test("guard: no process reader in the product decodes or splits a piece of the pipe on its own", () => {
  // the product's code copied into the workspace (tests and the third-party "impeccable" skill aside); the SMTP verifier
  // (sock.on) already buffers its answers up to the final line
  const SKIP = new Set(["node_modules", "test", "output", "closing", "website", "data", "sessions", "ecom", "video", "fonts", "templates", ".git", ".oss-build", ".sandbox"])
  const files: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = d === "." ? e.name : `${d}/${e.name}`
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) { if (!SKIP.has(e.name) && p !== ".claude/skills/impeccable") walk(p) }
      else if (/\.(ts|mjs|js|cjs)$/.test(e.name)) files.push(p)
    }
  }
  walk(".")
  assert.ok(files.includes("worker/worker.ts") && files.includes("packages/llm/adapters/claude-code.ts"), "the scan sees the product")
  const bad: string[] = []
  for (const f of files) {
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      const onData = /\.on\(["']data["']/.test(line) && !/\bsock\.on\(/.test(line)
      // `on("data", (b) => (x += b.toString()))`, `on("data", b => out += b)`: decoding piece by piece
      if (onData && (/\.toString\(/.test(line) || /\+=\s*\w+\s*\)?\s*$/.test(line))) bad.push(`${f}:${i + 1}: ${line.trim()}`)
      // `const onData = (buf) => buf.toString().split("\n")…`: a line cut by the pipe becomes two halves
      if (/=>\s*\w+\.toString\(\)\.split\(/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`)
    })
  }
  assert.deepEqual(bad, [], "use lineSplitter / textCollector (packages/shared/lines.mjs)")
})
