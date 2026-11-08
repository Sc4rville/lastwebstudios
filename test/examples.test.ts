/**
 * G10 / G14: the examples from real runs (examples/orvane-piscines from WP2, examples/atelier-brisane from WP4) are
 * complete, self-contained, clean for the composer's safety net and 100 % fictional: no real URL or address, and ONLY
 * fonts from the free library (each woff2 identical, byte for byte, to a file in the OFL lock, licence next to it).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const EXAMPLES = [
  { dir: "examples/orvane-piscines", id: "orvane-piscines-valmont-sur-lys" },
  { dir: "examples/atelier-brisane", id: "atelier-brisane-sornac-le-haut" },
  { dir: "examples/cuisines-lumeo", id: "cuisines-lumeo-vereuil" },
]
const lock = JSON.parse(readFileSync("design/fonts/oss.lock.json", "utf8"))
const lockBySha = new Map<string, { family: string; slug: string }>()
for (const fam of lock.families) for (const x of fam.files) lockBySha.set(x.sha256, { family: fam.family, slug: fam.slug })

for (const { dir, id } of EXAMPLES) {
  const html = () => readFileSync(join(dir, "site", "index.html"), "utf8")

  test(`example ${id}: expected files, report of a real run (engine, gate PASS, clean safety nets)`, () => {
    for (const f of ["README.md", "site/index.html", "site/control.md", "captures/avant.png", "captures/apres-desktop.png", "captures/apres-mobile.png", "fiche.json", "boost.json", "first-site.json"]) assert.ok(existsSync(join(dir, f)), f)
    const rep = JSON.parse(readFileSync(join(dir, "first-site.json"), "utf8"))
    assert.equal(rep.id, id)
    assert.equal(rep.gate.pass, true)
    assert.equal(rep.lint.clean, true)
    assert.equal(rep.verify.clean, true)
    assert.equal(rep.compose.args.sync, false)
    assert.equal(rep.compose.args.boost, false)
  })

  test(`example ${id}: self-contained site (local assets and fonts present), clean lint.mjs`, () => {
    const refs = [...html().matchAll(/(?:src="|url\(")((?:assets|fonts)\/[^")]+)/g)].map((m) => m[1])
    assert.ok(refs.length >= 5)
    for (const r of refs) assert.ok(existsSync(join(dir, "site", r)), r)
    const lint = spawnSync(process.execPath, ["design/scripts/lint.mjs", join(dir, "site", "index.html")], { encoding: "utf8" })
    assert.equal(JSON.parse(lint.stdout).clean, true, lint.stdout)
  })

  test(`example ${id}: fictional (.example domains, no local address or disk path), fonts from the OFL lock with their licence`, () => {
    const all = ["site/index.html", "site/control.md", "fiche.json", "first-site.json", "boost.json"].map((f) => readFileSync(join(dir, f), "utf8")).join("\n")
    assert.doesNotMatch(all, /127\.0\.0\.1|localhost|\/home\/|\/tmp\//)
    const emails = all.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? []
    for (const e of emails) assert.match(e, /\.example$/, e)
    // namespaces (schema.org, w3.org/2000/svg): identifiers, not links to a third party
    const urls = (html().match(/https?:\/\/[^"' )<]+/g) ?? []).filter((u) => !/^https?:\/\/(schema\.org|www\.w3\.org)\//.test(u + "/"))
    assert.deepEqual(urls.filter((u) => !/\.example(\/|$)/.test(u)), [])
    const fontsDir = join(dir, "site", "fonts")
    const woff = readdirSync(fontsDir).filter((f) => /\.(woff2?|ttf|otf)$/.test(f))
    assert.ok(woff.length >= 2)
    const slugs = new Set<string>()
    for (const f of woff) {
      const hit = lockBySha.get(createHash("sha256").update(readFileSync(join(fontsDir, f))).digest("hex"))
      assert.ok(hit, `font outside the free library: ${f}`)
      slugs.add(hit!.slug)
    }
    for (const s of slugs) assert.ok(existsSync(join(fontsDir, `${s}-OFL.txt`)), `${s}-OFL.txt missing next to the woff2 files`)
  })
}

test("the WP4 runs' pairs come from the free library (pairings.oss.json)", () => {
  const oss = JSON.parse(readFileSync("design/fonts/pairings.oss.json", "utf8")).pairings
  for (const d of ["examples/atelier-brisane", "examples/cuisines-lumeo"]) {
    const font = JSON.parse(readFileSync(join(d, "first-site.json"), "utf8")).workflowResult.passed[0].font as string
    assert.ok(oss.some((p: any) => font.includes(p.display) && font.includes(p.body)), `${d} : ${font}`)
  }
})
