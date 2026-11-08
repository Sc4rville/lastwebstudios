/**
 * G14 (scan « rien de réel ») : les règles du scanner, sur un arbre jetable. Les valeurs « réelles » de ce test sont
 * assemblées à l'exécution (jamais écrites telles quelles dans ce fichier, qui est lui-même scanné dans l'export).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { scan, loadRealEntities } from "../../scripts/oss/scan.mjs"

const j = (...p: string[]) => p.join("")
const tree = (files: Record<string, string>) => {
  const d = mkdtempSync(join(tmpdir(), "lws-scan-"))
  for (const [rel, s] of Object.entries(files)) { mkdirSync(join(d, rel, ".."), { recursive: true }); writeFileSync(join(d, rel), s) }
  return d
}

test("fiction permise : plages ARCEP, domaines réservés, boucle locale, gabarits", () => {
  const d = tree({
    "a.md": ["tél. 01 99 00 41 52, 03 53 01 24 68, +33 6 39 98 12 45", "contact@orvane-piscines.example, toi@exemple.test, x@y.fr", "http://127.0.0.1:4000, 192.168.1.10, 10.0.0.2", "postgres://MOT_DE_PASSE@hote.example", "/home/<toi>/lws, /home/user/x"].join("\n"),
  })
  try { const r = scan(d); assert.deepEqual(r.findings, []) } finally { rmSync(d, { recursive: true, force: true }) }
})

test("réel détecté : téléphone hors fiction, e-mail grand public, IP publique, chemin /home, ref Supabase", () => {
  const d = tree({
    "b.ts": [`const tel = "${j("06 12", " 34 56 78")}"`, `const mail = "${j("jean.dupont", "@", "gmail.com")}"`, `const ip = "${j("51.", "15.", "20.", "30")}"`, `const p = "${j("/ho", "me/jean/projets")}"`, `const s = "https://${j("abcdefghij", "klmnopqrst")}.supabase.co"`].join("\n"),
  })
  try {
    const rules = scan(d).findings.map((f: any) => f.rule).sort()
    assert.deepEqual(rules, ["email", "home-path", "ipv4", "phone-fr", "supabase-ref"])
    for (const f of scan(d).findings) assert.doesNotMatch(f.value, /dupont|12 34 56|jean\/projets/, "la valeur est masquée")
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test("--real : les vrais prospects du dépôt privé (nom, slug, domaine, tél., e-mail) sont retrouvés dans l'export", () => {
  const priv = tree({
    "data/prospects/zz.json": JSON.stringify({ id: j("ebenisterie-", "kervaliou-", "quimperle"), identity: { name: j("Ébénisterie ", "Kervaliou"), phone: j("02 98 ", "11 22 33"), email: j("atelier@", "kervaliou-bois.fr") }, existing: { url: j("https://www.", "kervaliou-bois.fr") } }),
  })
  const exp = tree({
    "x.md": j("Le cas ", "ebenisterie kervaliou", " est un bon exemple."),
    "y.ts": `// ex. ${j("ebenisterie-", "kervaliou-", "quimperle")}`,
    "z.json": JSON.stringify({ url: j("kervaliou-", "bois.fr") }),
    "ok.md": "Une ébénisterie bretonne fictive, Atelier Brisane.",
  })
  try {
    const real = loadRealEntities(priv)
    assert.equal(real.slugs.size, 1)
    const rules = scan(exp, { real: priv }).findings.map((f: any) => `${f.file}:${f.rule}`).sort()
    assert.deepEqual(rules, ["x.md:real-entity:name", "y.ts:real-entity:name", "y.ts:real-entity:slug", "z.json:real-entity:domain"])
  } finally { rmSync(priv, { recursive: true, force: true }); rmSync(exp, { recursive: true, force: true }) }
})

test("polices : un woff2 du verrou OFL passe, un fichier inconnu est signalé hors verrou", () => {
  const d = tree({ "design/fonts/oss.lock.json": readLockCopy() })
  try {
    mkdirSync(join(d, "site/fonts"), { recursive: true })
    copyFileSync("design/fonts/fraunces/fraunces-var.woff2", join(d, "site/fonts/fraunces-var.woff2"))
    writeFileSync(join(d, "site/fonts/inconnue.woff2"), Buffer.from("wOF2-pas-une-police-du-verrou"))
    const r = scan(d)
    assert.equal(r.fonts.count, 2)
    assert.deepEqual(r.fonts.outsideLock.map((f: any) => f.file), ["site/fonts/inconnue.woff2"])
    assert.equal(r.ok, false)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test("CLI : exit 1 sur une trouvaille, exit 2 sans dossier", () => {
  const d = tree({ "c.txt": j("appelle le 07 ", "11 22 33 44") })
  try {
    assert.equal(spawnSync(process.execPath, ["scripts/oss/scan.mjs", d], { encoding: "utf8" }).status, 1)
    assert.equal(spawnSync(process.execPath, ["scripts/oss/scan.mjs"], { encoding: "utf8" }).status, 2)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

function readLockCopy(): string { return readFileSync("design/fonts/oss.lock.json", "utf8") }
