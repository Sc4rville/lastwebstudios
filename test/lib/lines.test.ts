/**
 * Test blitz (24/10) · lire la sortie d'un process enfant sans la casser (packages/shared/lines.mjs).
 *
 * Bug trouvé : le worker découpait chaque morceau du tube avec `toString().split("\n")`. Une ligne JSON à cheval sur
 * deux morceaux devenait deux moitiés illisibles : l'évènement `result` de `claude -p` (coût, jetons) était perdu et
 * le registre de dépense de la cage sous-comptait. Ailleurs, `toString()` par morceau changeait un « é » coupé en « �� »
 * (fiche, verdict du coach, corps POST du cockpit). Ici : propriétés sur des découpages aléatoires (graine fixe),
 * et un garde-fou de source pour que le motif ne revienne pas.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { lineSplitter, textCollector } from "../../packages/shared/lines.mjs"

/** PRNG déterministe (mulberry32) : un échec se rejoue à l'identique. */
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

/** Découpe un Buffer en morceaux de 1 à `max` octets, au hasard (coupe donc en plein caractère UTF-8). */
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

test("lineSplitter : mêmes lignes, quel que soit le découpage du tube (500 découpages aléatoires, UTF-8 de 1 à 4 octets)", () => {
  const text = LINES.join("\n") + "\n"
  const buf = Buffer.from(text, "utf8")
  const rand = rng(20261024)
  for (let round = 0; round < 500; round++) {
    const got: string[] = []
    const s = lineSplitter((l) => got.push(l))
    for (const c of chunks(buf, rand, 1 + (round % 40))) s.push(c)
    s.end()
    assert.deepEqual(got, LINES, `découpage n°${round}`)
    assert.ok(!got.join("").includes("�"), "aucun caractère de remplacement")
  }
})

test("lineSplitter : CRLF retiré, dernière ligne sans retour livrée à end(), rien après end(), chaînes acceptées", () => {
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
  // un « é » dont les deux octets arrivent séparément
  const e: string[] = []
  const t = lineSplitter((l) => e.push(l))
  const b = Buffer.from("é\n", "utf8")
  t.push(b.subarray(0, 1)); t.push(b.subarray(1)); t.end()
  assert.deepEqual(e, ["é"])
})

test("lineSplitter : une ligne JSON de 300 Ko (un Write du composer) arrive entière, en morceaux de 64 Ko comme un vrai tube", () => {
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

test("textCollector : décode une fois (aucun « � » quel que soit le découpage) ; borné, il garde la FIN sans caractère coupé", () => {
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
  assert.ok(text.endsWith(kept), "la fin de la sortie est gardée")
  assert.ok(!kept.includes("�"), "la coupe de début de fenêtre ne laisse pas de demi-caractère")
})

test("garde-fou : aucun lecteur de process du produit ne décode ni ne découpe un morceau du tube isolément", () => {
  // le code du produit copié dans le workspace (hors tests et skill tiers « impeccable ») ; le vérificateur SMTP
  // (sock.on) tamponne déjà ses réponses jusqu'à la ligne finale
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
  assert.ok(files.includes("worker/worker.ts") && files.includes("packages/llm/adapters/claude-code.ts"), "le balayage voit le produit")
  const bad: string[] = []
  for (const f of files) {
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      const onData = /\.on\(["']data["']/.test(line) && !/\bsock\.on\(/.test(line)
      // `on("data", (b) => (x += b.toString()))`, `on("data", b => out += b)` : décodage morceau par morceau
      if (onData && (/\.toString\(/.test(line) || /\+=\s*\w+\s*\)?\s*$/.test(line))) bad.push(`${f}:${i + 1}: ${line.trim()}`)
      // `const onData = (buf) => buf.toString().split("\n")…` : une ligne coupée par le tube devient deux moitiés
      if (/=>\s*\w+\.toString\(\)\.split\(/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`)
    })
  }
  assert.deepEqual(bad, [], "utiliser lineSplitter / textCollector (packages/shared/lines.mjs)")
})
