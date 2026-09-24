import { test } from "node:test"
import assert from "node:assert/strict"
import { render, navLinks, brandParts } from "../design/scripts/compose.ts"
import { tuneForDark, luminance } from "../design/scripts/polish.ts"

test("the template engine renders values, marks, loops and conditions — escaped", () => {
  const tpl = "<h1>{{mark copy.h}}</h1>{{#each list}}<i>{{@num}}:{{this.t}}:{{ref}}</i>{{/each}}{{#if none}}X{{/if}}{{#if list}}Y{{/if}}"
  const out = render(tpl, { copy: { h: "Fire <b> *now*" }, list: [{ t: "a" }, { t: "b" }], none: [], ref: "AB" })
  assert.equal(out, "<h1>Fire &lt;b&gt; <em>now</em></h1><i>01:a:AB</i><i>02:b:AB</i>Y")
})

test("real nav labels are mapped to sections; unknown labels are dropped, never invented", () => {
  assert.deepEqual(navLinks(["Accueil", "Nos ouvrages", "L'atelier", "Notre méthode", "Contact", "Nos réalisations"]), [
    { label: "Nos ouvrages", href: "#ouvrages" },
    { label: "L'atelier", href: "#atelier" },
    { label: "Notre méthode", href: "#methode" },
  ])
})

test("wordmark and reference prefix come from the name", () => {
  assert.deepEqual(brandParts("Atelier Braise"), { first: "Atelier", rest: "Braise", initials: "AB" })
})

test("a sampled brand colour is lifted until it reads on a dark ground", () => {
  const tuned = tuneForDark("#5a1a08")
  assert.ok(luminance(tuned) >= 0.2)
  assert.equal(tuneForDark("#ff5a1f"), "#ff5a1f") // already readable: untouched
})
