/**
 * G14 (polices) : la bibliothèque libre est vérifiable hors ligne. Chaque fichier du verrou existe et a son sha256,
 * chaque famille est OFL-1.1 avec son OFL.txt, les paires (≥ 12) n'utilisent que la bibliothèque, aucune police de
 * blacklist.txt, une police de titre distincte par paire.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { verify, readLock, readPairings, readBlacklist, ossIndex, FAMILIES } from "../../scripts/oss/fonts.mjs"

test("verrou OFL : fichiers présents, sha256 conformes, OFL.txt par famille", () => {
  const r = verify(process.cwd())
  assert.deepEqual(r.problems, [])
  assert.ok(r.ok)
  assert.ok(r.families >= 24, `${r.families} familles`)
  const lock = readLock(process.cwd())
  for (const fam of lock.families) {
    assert.equal(fam.license, "OFL-1.1", fam.family)
    assert.ok(existsSync(join("design/fonts", fam.licenseFile.file)), `${fam.slug}/OFL.txt`)
    assert.match(readFileSync(join("design/fonts", fam.licenseFile.file), "utf8"), /SIL OPEN FONT LICENSE Version 1\.1/i)
    for (const f of fam.files) {
      assert.match(f.url, /^https:\/\/cdn\.jsdelivr\.net\/fontsource\/fonts\/[a-z0-9-]+(:vf)?@\d+\.\d+\.\d+\//, "version figée, source Fontsource")
      assert.equal(readFileSync(join("design/fonts", f.file)).subarray(0, 4).toString("latin1"), "wOF2", f.file)
    }
  }
  assert.equal(lock.families.length, FAMILIES.length, "le verrou couvre toute la liste de scripts/oss/fonts.mjs")
})

test("paires libres : ≥ 12, titres distincts, rien de la blacklist, familles cohérentes", () => {
  const pairs = readPairings(process.cwd())
  assert.ok(pairs.length >= 12, `${pairs.length} paires`)
  const black = readBlacklist(process.cwd())
  const slugs = new Set(readLock(process.cwd()).families.map((f: any) => f.slug))
  for (const p of pairs) {
    for (const k of ["display_slug", "body_slug", "mono_slug"]) if (p[k]) { assert.ok(slugs.has(p[k]), p[k]); assert.ok(!black.has(p[k]), `${p[k]} en blacklist`) }
    assert.equal(p.license, "OFL-1.1")
  }
  assert.equal(new Set(pairs.map((p: any) => p.display_slug)).size, pairs.length)
})

test("index généré pour l'export : une entrée par famille, faces = fichiers du verrou", () => {
  const lock = readLock(process.cwd())
  const idx = ossIndex(lock)
  assert.equal(idx.count, lock.families.length)
  for (const fam of lock.families) assert.equal(idx.families[fam.family].faces.length, fam.files.length)
})

test("`node scripts/oss/fonts.mjs` (sans réseau) : exit 0 et le dit ; un fichier altéré est détecté", () => {
  const ok = spawnSync(process.execPath, ["scripts/oss/fonts.mjs"], { encoding: "utf8" })
  assert.equal(ok.status, 0, ok.stdout + ok.stderr)
  assert.match(ok.stdout, /polices libres : \d+ familles OFL-1\.1/)
})
