/**
 * D6 · the picks and the words, said in plain sentences with their sample sizes : which trades answer (and what the
 * picks do with it, only when the rules really move it), which opening of the first email / of the call gets answers
 * (the next drafts lean on the winner, bounded and explained). Never a claim on fewer than 5.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { pickSentences, tradeStats, MIN_N } from "../../learning/scripts/picks.ts"
import { angleStats, pickAngle, wordsView, leader, draw, callOpener, ANGLES, LEAN, MIN_N as WORDS_MIN } from "../../learning/scripts/words.ts"
import type { Outcome } from "../../learning/scripts/types.ts"

const row = (id: string, industry: string, outcome: Outcome["outcome"], signals: Record<string, boolean> = {}): Outcome => ({ id, industry, outcome, ts: "2026-11-01T10:00:00Z", signals })
const label = (k: string) => ({ "couvreur-zingueur": "Roofer", pisciniste: "Pool builder", plombier: "Plumber" } as Record<string, string>)[k] || k
/** n businesses of a trade, `r` of them replied (one of those met) */
function trade(t: string, n: number, r: number, signals: Record<string, boolean> = {}): Outcome[] {
  const out: Outcome[] = []
  for (let i = 0; i < n; i++) { const id = `${t}-${i}`; out.push(row(id, t, "sent", signals)); if (i < r) out.push(row(id, t, i === 0 ? "meeting" : "reply", signals)) }
  return out
}

test("picks: nothing is claimed on fewer than 5 businesses per trade; it says how many there are and how many it takes", () => {
  const v = pickSentences([...trade("couvreur-zingueur", 4, 3), ...trade("pisciniste", 2, 0)], { industries: { "couvreur-zingueur": { value: 4 } } }, label)
  assert.deepEqual(v.items, [], "4 roofers is not enough to say roofers answer more, nor that they are picked first")
  assert.equal(v.total, 6)
  assert.match(v.note!, /Too early to say which prospects answer best: 6 businesses contacted so far\. I compare a trade once it has 5\./)
  assert.match(pickSentences([], {}, label).note!, /no business has been contacted/)
})

test("picks: trades compared with their sample sizes; « picked first » only when the rules move it", () => {
  const rows = [...trade("couvreur-zingueur", 10, 6), ...trade("pisciniste", 10, 2), ...trade("plombier", 3, 1)]
  const v = pickSentences(rows, { industries: { "couvreur-zingueur": { value: 5 } } }, label)
  assert.equal(v.items[0].sentence, "Roofers answer 3× more often than pool builders (6 of 10 roofers answered, 2 of 10 pool builders).")
  assert.equal(v.items[0].n, 20)
  const first = v.items.find((x) => x.effect === "picked first")!
  assert.equal(first.sentence, "Roofers are picked first now: 6 of 10 answered, 1 meeting.")
  assert.ok(!v.items.some((x) => x.trade === "pisciniste"), "no rule for pool builders: nothing said about their picks")
  assert.match(v.note!, /Not enough yet for plumbers \(3\): 5 each/)
  assert.equal(tradeStats(rows).find((s) => s.trade === "plombier")!.n, 3)
  // a reply logged after a « lost » still counts as answered ; one trial per business
  const once = tradeStats([row("a", "plombier", "sent"), row("a", "plombier", "reply"), row("a", "plombier", "lost"), row("a", "plombier", "reply")])
  assert.deepEqual(once[0], { trade: "plombier", n: 1, replied: 1, meetings: 0, won: 0, lost: 1 })
  // a signal, both sides with enough businesses
  const sig = pickSentences([...trade("plombier", 6, 5, { booking: true }), ...trade("pisciniste", 6, 1)], {}, label)
  assert.ok(sig.items.some((x) => x.sentence === "Businesses whose site has online booking answer more often (5 of 6 with it answered, 1 of 6 without)."))
  assert.equal(MIN_N, 5)
})

test("openings: each in turn until every one has 5 tries, then the winner on at most 6 in 10, each choice explained", () => {
  const none = angleStats("email", {}, [])
  const p0 = pickAngle("email", "acme-austin", none)
  assert.equal(p0.leaning, false)
  assert.match(p0.why, /^Trying each opening in turn \(0 “It's already built”, 0 “More calls from phones”, 0 “Your work deserves it”\): I lean on one once each has 5\.$/)
  assert.equal(pickAngle("email", "acme-austin", none).angle, p0.angle, "the same prospect always gets the same opening")
  // the least tried goes first
  const assigned: Record<string, string> = { a: "built-it", b: "built-it", c: "customers" }
  assert.equal(pickAngle("email", "zz", angleStats("email", assigned, [])).angle, "craft")
  // 5 tries each, « It's already built » gets 4 replies, the others 1 : it leads
  const big: Record<string, string> = {}, rows: Outcome[] = []
  for (const k of ["built-it", "customers", "craft"]) for (let i = 0; i < 5; i++) { const id = `${k}-${i}`; big[id] = k; rows.push(row(id, "plombier", "sent")); if (i < (k === "built-it" ? 4 : 1)) rows.push(row(id, "plombier", "reply")) }
  const stats = angleStats("email", big, rows)
  assert.deepEqual(stats.map((s) => [s.key, s.n, s.wins]), [["built-it", 5, 4], ["customers", 5, 1], ["craft", 5, 1]])
  assert.equal(leader(stats)!.best.key, "built-it")
  let lean = 0
  for (let i = 0; i < 400; i++) if (pickAngle("email", `prospect-${i}`, stats).angle === "built-it") lean++
  assert.ok(lean / 400 > LEAN - 0.08 && lean / 400 < LEAN + 0.08, `the winner gets about ${LEAN * 10} in 10 (got ${lean} of 400)`)
  const pk = pickAngle("email", "prospect-1", stats)
  assert.match(pk.why, /^Leaning on “It's already built”: 4 replies from 5 first emails, against 1 from 5 for the next best\. The others still go out 4 times in 10, so the comparison stays honest\.$/)
  // a tiny lead is no lead
  const tie = angleStats("call", { a: "built-it", b: "built-it", c: "built-it", d: "built-it", e: "built-it", f: "customers", g: "customers", h: "customers", i: "customers", j: "customers", k: "value", l: "value", m: "value", n: "value", o: "value" }, [row("a", "x", "meeting"), row("f", "x", "meeting")])
  assert.equal(leader(tie), null)
  assert.match(pickAngle("call", "q", tie).why, /^No clear winner yet/)
  assert.ok(draw("email", "x") >= 0 && draw("email", "x") < 1)
})

test("words view: results per opening only with 5 tries, the leaning said, a note below that", () => {
  const few = wordsView("email", angleStats("email", { a: "customers", b: "customers", c: "built-it" }, [row("a", "x", "reply")]))
  assert.deepEqual(few.items, [])
  assert.equal(few.note, "Too early to say which first email works: 3 written so far (1 “It's already built”, 2 “More calls from phones”). I lean on one once each has 5.")
  const big: Record<string, string> = {}, rows: Outcome[] = []
  for (const k of ["built-it", "customers", "value"]) for (let i = 0; i < 6; i++) { const id = `${k}-${i}`; big[id] = k; if (i < (k === "value" ? 3 : 0)) rows.push(row(id, "x", "meeting")) }
  const v = wordsView("call", angleStats("call", big, rows))
  assert.ok(v.items.some((x) => x.sentence === "Calls that open with “What is a new customer worth?” got 3 meetings from 6."))
  assert.ok(v.items.some((x) => x.sentence.startsWith("The next calls lean on “What is a new customer worth?” (6 in 10)")))
  assert.equal(v.note, null)
  assert.equal(WORDS_MIN, 5)
  assert.equal(ANGLES.email.length, 3)
  assert.match(callOpener("customers", { name: "Tallmarsh Roofing", trade: "roofer" }), /look for a roofer on their phone now\. I built a new site for Tallmarsh Roofing/)
  assert.match(callOpener("value", { name: "Orvane Piscines" }, "fr"), /combien vous rapporte un nouveau client, pour Orvane Piscines/)
})
