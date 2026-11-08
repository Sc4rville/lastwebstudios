/**
 * What the agency understands from one sentence (brief.ts) and the fictional prospects the sandbox casts from it
 * (sim-data.ts): whole-word trades only, unknown or gibberish said back, no silent clamp, the country is the agency's
 * unless the text names one ; US searches sound American (ZIP and area code of the place, 555-01xx), French ones sound
 * French (ARCEP fiction blocks only), no near-duplicate names, the trade in the name, every trade has a family.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { parseBrief, validateBrief, tradeMatches } from "../../backoffice/reviewpipe/brief.ts"
import { invent, toSheet, familyOf, frFictionBlock, SIM_MAX } from "../../backoffice/reviewpipe/sim-data.ts"
import { renderNewSite, renderOldSiteSvg } from "../../backoffice/reviewpipe/sim-site.ts"
import { whyTags } from "../../backoffice/reviewpipe/insights.ts"
import { INDUSTRIES } from "../../leadengine/1_scraping/scripts/industries.ts"

test("trades: whole words only, EN / FR / DE terms, the everyday trades", () => {
  assert.deepEqual(tradeMatches("roofers in Boise"), ["couvreur-zingueur"], "Boise is not « bois »")
  assert.deepEqual(parseBrief("painters in Austin", "US").trades, ["peintre"])
  assert.equal(parseBrief("painters in Austin", "US").unmatched, undefined, "a known trade is never said back as unknown")
  assert.deepEqual(parseBrief("plombiers à Besançon", "FR").trades, ["plombier"])
  assert.deepEqual(parseBrief("Dachdecker in München", "FR").trades, ["couvreur-zingueur"])
  assert.deepEqual(parseBrief("9 kitchens and pools near Lyon", "FR").trades.sort(), ["cuisiniste", "pisciniste"])
})

test("not understood → no job: gibberish, an unknown trade, a foreign word ; > 200 is said, never clamped", () => {
  assert.match(parseBrief("asdkjh qwe", "US").error || "", /didn't catch a trade — try “roofers in Austin”/)
  assert.match(parseBrief("asdkjh qwe", "FR").error || "", /roofers in Lyon/)
  assert.match(parseBrief("Banana", "US").error || "", /didn't catch a trade/)
  const law = parseBrief("lawyers in Boston", "US")
  assert.deepEqual(law.unmatched, ["lawyers"]); assert.match(law.error || "", /lawyers: not a trade the agency knows yet/)
  assert.match(parseBrief("Bäcker in Berlin", "FR").error || "", /bäcker: not a trade/)
  // round 3 : a count past 200 runs for 200, said ; a negative or zero count is changed, said
  const big = parseBrief("500 roofers in Dallas", "US"); assert.equal(big.error, undefined); assert.equal(big.count, 200); assert.equal(big.note, "Searching for 200, the maximum per search")
  assert.equal(parseBrief("1,000 roofers in Dallas", "US").count, 200)
  assert.deepEqual([parseBrief("-5 plumbers in Boise", "US").count, parseBrief("-5 plumbers in Boise", "US").note], [5, "A count can't be negative: searching for 5"])
  assert.deepEqual([parseBrief("0 plumbers in Boise", "US").count, parseBrief("0 plumbers in Boise", "US").note], [1, "Searching for 1, at least one per search"])
  assert.equal(parseBrief("roofers in Boise, ID 83702", "US").count, 10, "a ZIP is a place, not a count")
  assert.equal(validateBrief({ trades: ["Banana"], place: "Austin" }, "US").error, "Banana: not a trade the agency knows")
  assert.equal(validateBrief({ trades: ["couvreur-zingueur"], count: 201 }, "US").error, "Max 200 per search")
})

test("place and country: the agency's country, unless the text names one, a US state, or a well-known city of another country", () => {
  const a = parseBrief("6 roofers and pool builders around Austin", "US")
  assert.equal(a.place, "Austin, TX", "a known US city gets its state"); assert.equal(a.country, "US"); assert.equal(a.count, 6)
  // the README's own examples, with a French agency : Austin is in Texas, Boston in Massachusetts (audits, 2026-11-06)
  for (const [t, place] of [["20 plumbers and roofers around Austin", "Austin, TX"], ["10 plumbers near Boston", "Boston, MA"], ["plumbers in Boise", "Boise, ID"]] as const) {
    const b = parseBrief(t, "FR"); assert.equal(b.country, "US", t); assert.equal(b.place, place, t)
  }
  // and the other way : a US agency asking for Nice or Dijon searches France, never « Riverbend Pool Co. · Nice »
  for (const t of ["4 pool builders near Nice", "6 carpenters in Dijon", "3 cuisiniste near Lyon"]) assert.equal(parseBrief(t, "US").country, "FR", t)
  assert.equal(parseBrief("roofers in Twin Falls", "US").country, "US", "an unknown town keeps the agency's country")
  assert.equal(parseBrief("couvreurs à Valmont-sur-Lys", "FR").country, "FR")
  assert.equal(parseBrief("a nice mix of trades", "US").place, "", "« nice » in lower case is a word, not Nice")
  assert.equal(parseBrief("roofers near Austin TX", "FR").place, "Austin, TX")
  assert.equal(parseBrief("roofers near Austin TX", "FR").country, "US")
  assert.equal(parseBrief("electricians in Texas", "FR").country, "US")
  const fr = parseBrief("roofers in France", "US"); assert.equal(fr.country, "FR"); assert.equal(fr.place, "")
  assert.equal(parseBrief("find a Plumber In Denver", "US").place, "Denver, CO", "a capitalised trade is not a place")
  assert.equal(parseBrief("plumbers austin", "US").place, "Austin, TX")
  assert.equal(parseBrief("pool builders in Saint-Étienne", "FR").place, "Saint-Étienne")
  const mix = parseBrief("surprise me, 8 of them", "FR"); assert.equal(mix.mix, true); assert.equal(mix.count, 8); assert.equal(mix.error, undefined)
})

test("US cast: American names with the trade in them, the place's ZIP and area code, 555-01xx, no near-duplicates", () => {
  const list = invent({ trades: ["couvreur-zingueur", "pisciniste"], place: "Austin", country: "US", count: 12, seed: 42, taken: new Set() })
  assert.equal(list.length, 12)
  const words = list.map((p) => p.name.split(" ")[0])
  for (const p of list) {
    assert.equal(p.city, "Austin"); assert.equal(p.region, "TX"); assert.match(p.zip, /^787\d\d$/)
    assert.match(p.phone, /^\((512|737)\) 555-01\d\d$/)
    assert.doesNotMatch(p.name, /Piscines|Cuisines|Menuiserie|Atelier|& Fils|LLC|Studio$/)
    assert.match(p.name, p.industry === "pisciniste" ? /Pool|Spa/ : /Roof/, p.name)
    assert.match(p.url, /^http:\/\/[a-z0-9-]+\.example\/$/)
    assert.equal(p.lang, "en")
  }
  assert.equal(new Set(words).size, words.length, `distinctive words reused: ${list.map((p) => p.name).join(" | ")}`)
  const sheet = toSheet(list[0], "US")
  assert.match(sheet.score.accroche, /^Your site: /)
  assert.ok(whyTags(sheet).length >= 1, "English reasons read as tags")
  // an unknown US town keeps the asked name ; a state given → its area code
  const boise = invent({ trades: ["plombier"], place: "Twin Falls, ID", country: "US", count: 3, seed: 7, taken: new Set() })
  for (const p of boise) { assert.equal(p.city, "Twin Falls"); assert.equal(p.region, "ID"); assert.match(p.phone, /^\(208\) 555-01\d\d$/); assert.match(p.name, /Plumbing|Rooter/) }
  // the towns around Austin (final rookie check : « plumbers around Round Rock » got Washington DC numbers and no state)
  const rr = parseBrief("plumbers around Round Rock", "US"); assert.equal(rr.place, "Round Rock, TX"); assert.equal(rr.country, "US")
  assert.equal(parseBrief("plumbers around Round Rock", "FR").country, "US", "a French agency searching Round Rock gets US businesses (the brief says so)")
  for (const p of invent({ trades: ["plombier"], place: rr.place, country: "US", count: 6, seed: 3, taken: new Set() })) {
    assert.equal(p.region, "TX"); assert.match(p.zip, /^(78664|78665|78681)$/); assert.match(p.phone, /^\((512|737)\) 555-01\d\d$/)
  }
  // a town the demo doesn't know, with no state : the agency's own state, never a (202) default
  for (const p of invent({ trades: ["plombier"], place: "Smallville", country: "US", count: 3, seed: 5, taken: new Set(), home: "TX" })) { assert.equal(p.region, "TX"); assert.match(p.phone, /^\(512\) 555-01\d\d$/); assert.match(p.zip, /^787\d\d$/) }
})

test("French cast: French names, the department's ARCEP fiction block, the asked town kept", () => {
  const list = invent({ trades: ["couvreur-zingueur", "cuisiniste"], place: "Lyon", country: "FR", count: 10, seed: 9, taken: new Set() })
  assert.equal(list.length, 10)
  for (const p of list) {
    assert.equal(p.city, "Lyon"); assert.match(p.zip, /^6900\d$/)
    assert.match(p.phone, /^04 65 71 \d\d \d\d$/, "Lyon is in the 04 zone: 04 65 71 is its fiction block")
    assert.doesNotMatch(p.name, /LLC|Co\.$|Studio$|Group$/)
  }
  const surnames = list.map((p) => p.name.replace(/ & Fils$/, "").split(" ").pop())
  assert.equal(new Set(surnames).size, surnames.length)
  assert.equal(frFictionBlock("75011"), "01 99 00"); assert.equal(frFictionBlock("35000"), "02 61 91"); assert.equal(frFictionBlock("59000"), "03 53 01"); assert.equal(frFictionBlock("33000"), "05 36 49")
  const annecy = invent({ trades: ["menuisier"], place: "Annecy", country: "FR", count: 2, seed: 3, taken: new Set() })
  assert.ok(annecy.every((p) => p.city === "Annecy"))
  const nowhere = invent({ trades: ["menuisier"], country: "FR", count: 4, seed: 5, taken: new Set() })
  for (const p of nowhere) assert.match(p.phone, /^0(1 99 00|2 61 91|3 53 01|4 65 71|5 36 49) \d\d \d\d$/)
})

test("the demo caps a search at SIM_MAX (said in the job line by the engine), a single one is one", () => {
  assert.equal(invent({ trades: ["menuisier"], country: "FR", count: 50, seed: 1, taken: new Set() }).length, SIM_MAX)
  assert.equal(invent({ trades: ["menuisier"], country: "FR", count: 1, seed: 1, taken: new Set() }).length, 1)
  const taken = new Set<string>()
  const a = invent({ trades: ["pisciniste"], place: "Austin", country: "US", count: 6, seed: 11, taken })
  const b = invent({ trades: ["pisciniste"], place: "Austin", country: "US", count: 6, seed: 11, taken })
  assert.equal(new Set([...a, ...b].map((p) => p.id)).size, a.length + b.length, "never the same prospect twice")
})

test("every trade the engine knows has a site family ; the sites speak the prospect's language", () => {
  const other = Object.keys(INDUSTRIES).filter((k) => familyOf(k) === "other")
  assert.deepEqual(other, [], `trades with no family: ${other.join(", ")}`)
  const [us] = invent({ trades: ["plombier"], place: "Denver", country: "US", count: 1, seed: 2, taken: new Set() })
  const site = renderNewSite(toSheet(us, "US"), "en")
  assert.match(site, new RegExp(us.name.replace(/[.&]/g, ".")))
  assert.match(site, /Get a free quote/); assert.match(site, /Denver, CO 802\d\d/)
  const svg = renderOldSiteSvg(toSheet(us, "US"), "en")
  assert.match(svg, /^<svg /); assert.match(svg, /Last updated/)
})
