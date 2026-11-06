/**
 * G10 / G14 : les exemples des vrais runs (examples/orvane-piscines du WP2, examples/atelier-brisane du WP4) sont
 * complets, autonomes, propres au filet du composer et 100 % fictifs : aucune URL ni adresse réelle, et SEULEMENT des
 * polices de la bibliothèque libre (chaque woff2 identique, octet pour octet, à un fichier du verrou OFL, licence à côté).
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

  test(`exemple ${id} : fichiers attendus, rapport d'un run réel (moteur, gate PASS, filets propres)`, () => {
    for (const f of ["README.md", "site/index.html", "site/control.md", "captures/avant.png", "captures/apres-desktop.png", "captures/apres-mobile.png", "fiche.json", "boost.json", "first-site.json"]) assert.ok(existsSync(join(dir, f)), f)
    const rep = JSON.parse(readFileSync(join(dir, "first-site.json"), "utf8"))
    assert.equal(rep.id, id)
    assert.equal(rep.gate.pass, true)
    assert.equal(rep.lint.clean, true)
    assert.equal(rep.verify.clean, true)
    assert.equal(rep.compose.args.sync, false)
    assert.equal(rep.compose.args.boost, false)
  })

  test(`exemple ${id} : site autonome (assets et polices locales présents), lint.mjs propre`, () => {
    const refs = [...html().matchAll(/(?:src="|url\(")((?:assets|fonts)\/[^")]+)/g)].map((m) => m[1])
    assert.ok(refs.length >= 5)
    for (const r of refs) assert.ok(existsSync(join(dir, "site", r)), r)
    const lint = spawnSync(process.execPath, ["design/scripts/lint.mjs", join(dir, "site", "index.html")], { encoding: "utf8" })
    assert.equal(JSON.parse(lint.stdout).clean, true, lint.stdout)
  })

  test(`exemple ${id} : fictif (domaines .example, aucune adresse locale ni chemin disque), polices du verrou OFL avec leur licence`, () => {
    const all = ["site/index.html", "site/control.md", "fiche.json", "first-site.json", "boost.json"].map((f) => readFileSync(join(dir, f), "utf8")).join("\n")
    assert.doesNotMatch(all, /127\.0\.0\.1|localhost|\/home\/|\/tmp\//)
    const emails = all.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? []
    for (const e of emails) assert.match(e, /\.example$/, e)
    // espaces de noms (schema.org, w3.org/2000/svg) : des identifiants, pas des liens vers un tiers
    const urls = (html().match(/https?:\/\/[^"' )<]+/g) ?? []).filter((u) => !/^https?:\/\/(schema\.org|www\.w3\.org)\//.test(u + "/"))
    assert.deepEqual(urls.filter((u) => !/\.example(\/|$)/.test(u)), [])
    const fontsDir = join(dir, "site", "fonts")
    const woff = readdirSync(fontsDir).filter((f) => /\.(woff2?|ttf|otf)$/.test(f))
    assert.ok(woff.length >= 2)
    const slugs = new Set<string>()
    for (const f of woff) {
      const hit = lockBySha.get(createHash("sha256").update(readFileSync(join(fontsDir, f))).digest("hex"))
      assert.ok(hit, `police hors de la bibliothèque libre : ${f}`)
      slugs.add(hit!.slug)
    }
    for (const s of slugs) assert.ok(existsSync(join(fontsDir, `${s}-OFL.txt`)), `${s}-OFL.txt manquant à côté des woff2`)
  })
}

test("les paires des runs du WP4 viennent de la bibliothèque libre (pairings.oss.json)", () => {
  const oss = JSON.parse(readFileSync("design/fonts/pairings.oss.json", "utf8")).pairings
  for (const d of ["examples/atelier-brisane", "examples/cuisines-lumeo"]) {
    const font = JSON.parse(readFileSync(join(d, "first-site.json"), "utf8")).workflowResult.passed[0].font as string
    assert.ok(oss.some((p: any) => font.includes(p.display) && font.includes(p.body)), `${d} : ${font}`)
  }
})
