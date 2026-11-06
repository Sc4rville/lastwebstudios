/**
 * Test blitz (24/10) · la FACTURATION du cockpit (backoffice/reviewpipe/invoices.ts + public/billing.html).
 *
 * Bugs trouvés et corrigés :
 *   · montants en flottants : ~1 facture sur 5 imprimait un Total TTC à 1 centime de « Total HT + TVA », ~1 sur 8 des
 *     lignes dont la somme ne faisait pas le Total HT → calcul en centimes entiers (lineCents / totalsCents) ;
 *   · numérotation : deux créations simultanées recevaient le même numéro et la seconde ÉCRASAIT la première (upsert
 *     en base, writeFile sur disque), alors que le commentaire promettait une nouvelle tentative → création exclusive ;
 *   · lien de paiement injecté tel quel dans un attribut (guillemets, `javascript:`) ; nom du client et libellés
 *     injectés sans échappement dans la liste et le formulaire de billing.html.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { totals, totalsCents, lineCents, renderInvoiceHtml, DEFAULT_SELLER, type Invoice } from "../../backoffice/reviewpipe/invoices.ts"
import { makeWorkspace, type Workspace } from "../helpers/workspace.ts"
import { startCockpit } from "../helpers/cockpit.ts"
import type { Proc } from "../helpers/server.ts"

function rng(seed: number) { return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 } }
const eur = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const cents = (s: string) => Math.round(Number(s.replace(/[\s  €]/g, "").replace(",", ".")) * 100)

function randomInvoice(r: () => number): Pick<Invoice, "items" | "vatRate"> {
  const n = 1 + Math.floor(r() * 5)
  const items = Array.from({ length: n }, () => ({ label: "prestation fictive", qty: [1, 2, 3, 0.5, 1.5, 2.5, 7, 0.25, 12][Math.floor(r() * 9)], unitPrice: Math.round(r() * 500000) / 100 }))
  return { items, vatRate: [20, 10, 5.5, 0, 2.1][Math.floor(r() * 5)] }
}

test("montants : sur 5 000 factures aléatoires, lignes imprimées = Total HT et Total HT + TVA = Total TTC, au centime", () => {
  const r = rng(20261024)
  for (let i = 0; i < 5000; i++) {
    const inv = randomInvoice(r)
    const t = totals(inv), c = totalsCents(inv)
    const printedLines = inv.items.map((it) => cents(eur(lineCents(it) / 100)))
    assert.equal(printedLines.reduce((a, b) => a + b, 0), cents(eur(t.ht)), `lignes ≠ HT : ${JSON.stringify(inv)}`)
    assert.equal(cents(eur(t.ht)) + cents(eur(t.tva)), cents(eur(t.ttc)), `HT + TVA ≠ TTC : ${JSON.stringify(inv)}`)
    assert.equal(c.ht + c.tva, c.ttc)
  }
})

test("montants : le cas trouvé par le blitz, et un avoir est l'exact opposé de sa facture (arrondi vers l'extérieur)", () => {
  const inv = { items: [{ label: "a", qty: 2.5, unitPrice: 2438.35 }, { label: "b", qty: 2, unitPrice: 2507.8 }, { label: "c", qty: 3, unitPrice: 2753.4 }], vatRate: 20 }
  const t = totalsCents(inv)
  assert.deepEqual(t, { lines: [609588, 501560, 826020], ht: 1937168, tva: 387434, ttc: 2324602 }) // 6 095,875 → 6 095,88
  const r = rng(5)
  for (let i = 0; i < 2000; i++) {
    const f = randomInvoice(r)
    const av = { ...f, items: f.items.map((it) => ({ ...it, unitPrice: -it.unitPrice })) }
    const a = totalsCents(av), b = totalsCents(f)
    assert.deepEqual([a.ht, a.tva, a.ttc], [-b.ht + 0, -b.tva + 0, -b.ttc + 0])
  }
  assert.equal(lineCents({ qty: 1.5, unitPrice: 45.33 }), 6800, "67,995 → 68,00 (le flottant donnait 67,99)")
  assert.equal(totalsCents({ items: [{ label: "x", qty: 1, unitPrice: 100.1 }], vatRate: 5.5 } as any).tva, 551) // 5,5055 → 5,51
})

test("billing.html calcule l'aperçu EXACTEMENT comme le serveur (même fonction, 5 000 factures)", () => {
  const html = readFileSync("backoffice/reviewpipe/public/billing.html", "utf8")
  const m = /\/\/ <money>\n([\s\S]*?)\/\/ <\/money>/.exec(html)
  assert.ok(m, "bloc <money> introuvable dans billing.html")
  const page = new Function(`${m[1]}; return { lineCents, totalsCents }`)() as { totalsCents: typeof totalsCents }
  const r = rng(77)
  for (let i = 0; i < 5000; i++) { const inv = randomInvoice(r); assert.deepEqual(page.totalsCents(inv), totalsCents(inv)) }
  assert.doesNotMatch(html, /\(it\.qty\|\|0\)\*\(it\.unitPrice\|\|0\)/, "plus de total recalculé en flottants dans la liste")
})

test("facture imprimable : lien de paiement http(s) seulement, attributs échappés, nom du client échappé, totaux cohérents", () => {
  const base: Invoice = {
    id: "2026-001", number: "2026-001", status: "sent", kind: "facture", createdAt: "2026-10-24T10:00:00.000Z", issueDate: "2026-10-24", dueDate: "2026-11-23",
    client: { name: "Orvane <Piscines> & \"fils\"", address: "1 rue fictive\n00000 Valmont-sur-Lys" }, items: [{ label: "Refonte <b>site</b>", qty: 1.5, unitPrice: 45.33 }], vatRate: 20,
  }
  const evil = renderInvoiceHtml({ ...base, paymentUrl: "javascript:alert(1)" }, DEFAULT_SELLER)
  assert.doesNotMatch(evil, /javascript:/)
  assert.doesNotMatch(evil, /class="paybtn"/)
  const quoted = renderInvoiceHtml({ ...base, paymentUrl: 'https://pay.agence.example/x" onmouseover="alert(1)' }, DEFAULT_SELLER)
  assert.doesNotMatch(quoted, /" onmouseover="/)
  assert.match(quoted, /class="paybtn" href="https:\/\/pay\.agence\.example\/x%22%20onmouseover=%22alert\(1\)"/)
  assert.match(quoted, /Orvane &lt;Piscines&gt; &amp; &quot;fils&quot;/)
  assert.match(quoted, /Refonte &lt;b&gt;site&lt;\/b&gt;/)
  // 1,5 × 45,33 = 67,995 → 68,00 ; TVA 13,60 ; TTC 81,60
  assert.match(quoted, /<td class=r>68,00 €<\/td><\/tr>/)
  assert.match(quoted, /Total HT<\/span><span>68,00 €/)
  assert.match(quoted, /TVA \(20 %\)<\/span><span>13,60 €/)
  assert.match(quoted, /Total TTC<\/span><span>81,60 €/)
})

let ws: Workspace, cockpit: Proc
before(async () => { ws = makeWorkspace({ seed: ["agency"] }); cockpit = await startCockpit(ws.dir) })
after(async () => { await cockpit?.stop(); ws?.cleanup() })

const post = (p: string, body: unknown) => fetch(cockpit.url + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) })

test("cockpit SANS base : 12 factures créées EN MÊME TEMPS ont 12 numéros distincts et aucune n'est écrasée", async () => {
  const names = Array.from({ length: 12 }, (_, i) => `Client fictif ${i + 1}`)
  const created = await Promise.all(names.map((name) => post("/api/invoices", { client: { name }, items: [{ label: "Site vitrine", qty: 1, unitPrice: 1490 }], vatRate: 20 }).then((r) => r.json())))
  const numbers = created.map((c: any) => c.number)
  assert.equal(new Set(numbers).size, 12, `numéros : ${numbers.join(", ")}`)
  const list = await (await fetch(cockpit.url + "/api/invoices")).json()
  assert.equal(list.length, 12)
  assert.deepEqual(list.map((i: any) => i.client.name).sort(), [...names].sort(), "chaque facture garde SON client")
  const year = new Date().toISOString().slice(0, 4)
  assert.deepEqual(list.map((i: any) => i.number).sort(), names.map((_, i) => `${year}-${String(i + 1).padStart(3, "0")}`), "séquence pleine, sans trou")
  assert.ok(list.every((i: any) => i.totals?.ttc === 1788), "la liste porte les totaux du serveur (1 490 € HT → 1 788 € TTC)")
})

test("cockpit : un avoir annule une facture émise (montants opposés), une facture émise reste figée", async () => {
  const f = await (await post("/api/invoices", { client: { name: "Client fictif avoir" }, items: [{ label: "Acompte", qty: 2.5, unitPrice: 2438.35 }], vatRate: 20 })).json()
  await post(`/api/invoices/${f.id}`, { status: "sent" })
  const frozen = await (await post(`/api/invoices/${f.id}`, { items: [{ label: "triche", qty: 1, unitPrice: 1 }], client: { name: "autre" } })).json()
  assert.equal(frozen.items[0].label, "Acompte", "une facture émise ne change plus de lignes")
  assert.equal(frozen.client.name, "Client fictif avoir")
  const av = await (await post(`/api/invoices/${f.id}/avoir`, {})).json()
  assert.equal(av.kind, "avoir")
  assert.equal(av.ref, f.number)
  const list = await (await fetch(cockpit.url + "/api/invoices")).json()
  const tf = list.find((i: any) => i.number === f.number).totals, ta = list.find((i: any) => i.number === av.number).totals
  assert.deepEqual([ta.ht, ta.tva, ta.ttc], [-tf.ht + 0, -tf.tva + 0, -tf.ttc + 0])
  assert.equal((await post(`/api/invoices/${av.id}/avoir`, {})).status, 404, "pas d'avoir d'un avoir")
})
