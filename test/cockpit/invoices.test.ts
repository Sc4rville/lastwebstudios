/**
 * Blitz test (24/10) · the cockpit's BILLING (backoffice/reviewpipe/invoices.ts + public/billing.html).
 *
 * Bugs found and fixed:
 *   · amounts as floats: ~1 invoice in 5 printed a Total TTC 1 cent off "Total HT + TVA", ~1 in 8 had
 *     lines that did not add up to the Total HT → computed in whole cents (lineCents / totalsCents);
 *   · numbering: two simultaneous creations got the same number and the second OVERWROTE the first (upsert
 *     in the database, writeFile on disk), while the comment promised a retry → exclusive creation;
 *   · payment link injected as is into an attribute (quotes, `javascript:`); client name and labels
 *     injected unescaped into billing.html's list and form.
 */
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { totals, totalsCents, lineCents, renderInvoiceHtml, renderInvoiceHtmlIntl, DEFAULT_SELLER, invoiceProblem, sellerProblem, taxDefault, type Invoice } from "../../backoffice/reviewpipe/invoices.ts"
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

test("amounts: over 5,000 random invoices, printed lines = Total HT and Total HT + TVA = Total TTC, to the cent", () => {
  const r = rng(20261024)
  for (let i = 0; i < 5000; i++) {
    const inv = randomInvoice(r)
    const t = totals(inv), c = totalsCents(inv)
    const printedLines = inv.items.map((it) => cents(eur(lineCents(it) / 100)))
    assert.equal(printedLines.reduce((a, b) => a + b, 0), cents(eur(t.ht)), `lines ≠ HT: ${JSON.stringify(inv)}`)
    assert.equal(cents(eur(t.ht)) + cents(eur(t.tva)), cents(eur(t.ttc)), `HT + TVA ≠ TTC: ${JSON.stringify(inv)}`)
    assert.equal(c.ht + c.tva, c.ttc)
  }
})

test("amounts: the case the blitz found, and a credit note is the exact opposite of its invoice (rounded away from zero)", () => {
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
  assert.equal(lineCents({ qty: 1.5, unitPrice: 45.33 }), 6800, "67.995 → 68.00 (the float gave 67.99)")
  assert.equal(totalsCents({ items: [{ label: "x", qty: 1, unitPrice: 100.1 }], vatRate: 5.5 } as any).tva, 551) // 5,5055 → 5,51
})

test("billing.html computes the preview EXACTLY like the server (same function, 5,000 invoices)", () => {
  const html = readFileSync("backoffice/reviewpipe/public/billing.html", "utf8")
  const m = /\/\/ <money>\n([\s\S]*?)\/\/ <\/money>/.exec(html)
  assert.ok(m, "<money> block not found in billing.html")
  const page = new Function(`${m[1]}; return { lineCents, totalsCents }`)() as { totalsCents: typeof totalsCents }
  const r = rng(77)
  for (let i = 0; i < 5000; i++) { const inv = randomInvoice(r); assert.deepEqual(page.totalsCents(inv), totalsCents(inv)) }
  assert.doesNotMatch(html, /\(it\.qty\|\|0\)\*\(it\.unitPrice\|\|0\)/, "no more totals recomputed as floats in the list")
})

test("printable invoice: http(s) payment link only, escaped attributes, escaped client name, consistent totals", () => {
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
  // 1.5 × 45.33 = 67.995 → 68.00; VAT 13.60; TTC 81.60
  assert.match(quoted, /<td class=r>68,00 €<\/td><\/tr>/)
  assert.match(quoted, /Total HT<\/span><span>68,00 €/)
  assert.match(quoted, /TVA \(20 %\)<\/span><span>13,60 €/)
  assert.match(quoted, /Total TTC<\/span><span>81,60 €/)
})

test("invoice outside France: the seller's Tax ID (EIN) is printed, no SIRET / TVA / RCS / IBAN required, no French legal mentions", () => {
  const inv: Invoice = {
    id: "2026-002", number: "2026-002", status: "sent", kind: "facture", createdAt: "2026-11-06T10:00:00.000Z", issueDate: "2026-11-06", dueDate: "2026-12-06",
    client: { name: "Ridgeway Roofing", address: "1 Fictive St\nAustin, TX 78704" }, items: [{ label: "Website", qty: 1, unitPrice: 1200 }], vatRate: 0,
  }
  const html = renderInvoiceHtmlIntl(inv, { name: "Harbor Studio", address: "410 Harbor Street, Portland, ME 04101", siret: "", tva: "", taxId: "12-3456789", email: "hello@harbor.example", phone: "+1 207-555-0142" })
  assert.match(html, /(Tax ID|EIN) 12-3456789/)
  assert.match(html, /Thanks for your business/)
  assert.doesNotMatch(html, /SIRET|TVA|RCS|IBAN|Facture|Règlement|<IBAN>/)
  const noId = renderInvoiceHtmlIntl(inv, { name: "Harbor Studio", address: "410 Harbor Street", siret: "", tva: "", email: "hello@harbor.example" })
  assert.doesNotMatch(noId, /Tax ID|EIN/, "no Tax ID line when the seller has none")
})

test("a document a client receives never prints a <…> placeholder ; the seller's required details by country ; a bad client email is refused", () => {
  const inv: Invoice = {
    id: "2026-003", number: "2026-003", status: "sent", kind: "facture", createdAt: "2026-11-06T10:00:00.000Z", issueDate: "2026-11-06", dueDate: "2026-12-06",
    client: { name: "Lone Star Plumbing Co.", address: "Austin, TX 78731" }, items: [{ label: "Website", qty: 1, unitPrice: 2500 }], vatRate: 8.25,
  }
  const us = renderInvoiceHtmlIntl(inv, { name: "Lone Star Web Studio LLC", legal: "<entity type, e.g. LLC>", address: "<street>, <city> <state> <zip>", siret: "", tva: "", taxId: "<Tax ID / EIN>", email: "<email>", phone: "<phone>", iban: "<IBAN>", bic: "<BIC>", payment: "ACH: routing 000000000, account 000000 (fictional)" })
  for (const ph of ["entity type", "&lt;", "<street>", "<IBAN>", "Bank transfer", "EIN &lt;"]) assert.ok(!us.includes(ph), `${ph} printed`)
  assert.match(us, /Payment:<\/b> due .*ACH: routing 000000000/)
  const fr = renderInvoiceHtml({ ...inv, client: { name: "Orvane Piscines" } }, { name: "Atelier Vélin", legal: "<forme juridique et capital>", address: "<n° et rue>, <CP> <ville>", siret: "<SIRET — 14 chiffres>", tva: "<TVA intracom — FRXX XXXXXXXXX>", email: "bonjour@atelier-velin.example", iban: "<IBAN>", bic: "<BIC>" })
  for (const ph of ["forme juridique", "n° et rue", "&lt;IBAN", "<IBAN>", "SIRET &lt;", "SIRET <"]) assert.ok(!fr.includes(ph), `${ph} printed`)
  // the demo studio's name is not the owner's : it counts as missing (audit round 2, « Pixel Forge » printed under the demo's email)
  assert.equal(sellerProblem({ name: "Atelier Vélin", address: "<n° et rue>", siret: "<SIRET>", tva: "", email: "" }, "FR"), "Fill in Your business first (your own details, not the demo studio's): Name, Address, SIRET")
  assert.equal(sellerProblem({ name: "Studio Réel", address: "<n° et rue>", siret: "<SIRET>", tva: "", email: "" }, "FR"), "Fill in Your business first: Address, SIRET")
  assert.equal(sellerProblem({ name: "Harbor Studio", address: "410 Harbor Street, Portland, ME 04101", siret: "", tva: "", email: "" }, "US"), "")
  assert.equal(sellerProblem({ name: "Harbor Studio", address: "", siret: "", tva: "", email: "" }, "US"), "Fill in Your business first: Address")
  assert.match(invoiceProblem({ client: { name: "X", email: "not-an-email" }, items: [{ label: "Website", qty: 1, unitPrice: 1 }] }), /email/)
})

test("a new invoice is checked before it gets a number (the form and the server say the same) ; tax defaults by country", () => {
  const ok = { client: { name: "Ridgeway Roofing" }, items: [{ label: "Website", qty: 1, unitPrice: 1200 }], vatRate: 0, issueDate: "2026-11-06", dueDate: "2026-12-06", paymentUrl: "https://pay.example/x" }
  assert.equal(invoiceProblem(ok), "")
  assert.match(invoiceProblem({ ...ok, client: { name: "  " } }), /Client name/)
  assert.match(invoiceProblem({ ...ok, items: [] }), /at least one line/)
  assert.match(invoiceProblem({ ...ok, items: [{ label: "", qty: 1, unitPrice: 1 }] }), /description/)
  assert.match(invoiceProblem({ ...ok, items: [{ label: "x", qty: -1, unitPrice: 1 }] }), /negative/)
  assert.match(invoiceProblem({ ...ok, items: [{ label: "x", qty: 1, unitPrice: -5 }] }), /negative/)
  assert.match(invoiceProblem({ ...ok, vatRate: 120 }), /between 0 and 100/)
  assert.match(invoiceProblem({ ...ok, dueDate: "2026-11-01" }), /due date/)
  assert.match(invoiceProblem({ ...ok, paymentUrl: "javascript:alert(1)" }), /http/)
  assert.deepEqual(taxDefault("US"), { rate: 0, label: "Sales tax" })
  assert.deepEqual(taxDefault("FR"), { rate: 20, label: "VAT" })
  assert.equal(taxDefault("ZZ").rate, 0)
})

test("audit round 2: a number is never spent on nothing — non-finite, absurd and zero totals are refused before one is taken", () => {
  const ok = { client: { name: "Ridgeway Roofing" }, items: [{ label: "Website", qty: 1, unitPrice: 1200 }], vatRate: 0 }
  assert.equal(invoiceProblem(ok), "")
  assert.match(invoiceProblem({ ...ok, items: [{ label: "Website", qty: 1, unitPrice: "Infinity" }] }), /must be numbers/)
  assert.match(invoiceProblem({ ...ok, items: [{ label: "Website", qty: 1, unitPrice: Infinity }] }), /must be numbers/)
  assert.match(invoiceProblem({ ...ok, items: [{ label: "Website", qty: 1, unitPrice: "1e309" }] }), /must be numbers/)
  assert.match(invoiceProblem({ ...ok, items: [{ label: "Website", qty: 1, unitPrice: "abc" }] }), /must be numbers/)
  assert.match(invoiceProblem({ ...ok, items: [{ label: "Website", qty: 1e300, unitPrice: 1e300 }] }), /typo/)
  assert.match(invoiceProblem({ ...ok, items: [{ label: "Website", qty: 90_000, unitPrice: 9_000_000 }] }), /typo/)
  assert.match(invoiceProblem({ ...ok, items: [{ label: "Website", qty: 0, unitPrice: 0 }] }), /total is zero/)
  assert.match(invoiceProblem({ ...ok, items: [{ label: "Website", qty: 1, unitPrice: 0 }] }), /total is zero/)
  assert.match(invoiceProblem({ ...ok, vatRate: "Infinity" }), /between 0 and 100/)
})

test("audit round 2: the demo studio's contact lines are never printed under the owner's name", () => {
  const inv: Invoice = {
    id: "2026-001", number: "2026-001", status: "draft", kind: "facture", createdAt: "2026-11-06T10:00:00.000Z", issueDate: "2026-11-06", dueDate: "2026-12-06",
    client: { name: "Orvane Piscines" }, items: [{ label: "Website", qty: 1, unitPrice: 1500 }], vatRate: 0,
  }
  // renamed « Pixel Forge » with an Austin address, but the demo's email and phone still in the seller
  const html = renderInvoiceHtmlIntl(inv, { name: "Pixel Forge", address: "12 Main St, Austin, TX 78701", siret: "", tva: "", email: "bonjour@atelier-velin.example", phone: "01 99 00 12 34" })
  assert.match(html, /Pixel Forge/); assert.match(html, /12 Main St, Austin/)
  for (const demo of ["atelier-velin", "01 99 00 12 34"]) assert.ok(!html.includes(demo), `${demo} printed`)
  assert.equal(sellerProblem({ name: "Pixel Forge", address: "12 Main St, Austin, TX 78701", siret: "", tva: "", email: "bonjour@atelier-velin.example" }, "US"), "", "the demo's email is left out, not a reason to refuse")
  // the US demo studio, untouched : no invoice until the owner's own name and address are in
  assert.match(sellerProblem({ name: "Harbor & Pine Web Co.", address: "418 Larkspur Row, Suite 2, Austin, TX 78704", siret: "", tva: "", email: "hello@harborpine.example" }, "US"), /not the demo studio's.*Business name, Address/)
})

let ws: Workspace, cockpit: Proc
before(async () => { ws = makeWorkspace({ seed: ["agency"] }); cockpit = await startCockpit(ws.dir) })
after(async () => { await cockpit?.stop(); ws?.cleanup() })

const post = (p: string, body: unknown) => fetch(cockpit.url + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) })

test("cockpit : no invoice gets a number while Your business still holds the demo's <…> placeholders ; filled in, it does", async () => {
  const ok = { client: { name: "Client fictif" }, items: [{ label: "Site vitrine", qty: 1, unitPrice: 1490 }], vatRate: 20 }
  const r = await post("/api/invoices", ok)
  assert.equal(r.status, 400); const j = await r.json(); assert.equal(j.seller, true); assert.match(j.error, /^Fill in Your business first\b/)
  assert.equal((await (await fetch(cockpit.url + "/api/invoices")).json()).length, 0, "no number taken")
  const s = await post("/api/invoice-settings", { name: "Studio Fictif", address: "12 rue Fictive, 75011 Paris", siret: "000 000 000 00000" })
  assert.equal(s.status, 200)
})

test("cockpit WITHOUT a database: 12 invoices created AT THE SAME TIME get 12 distinct numbers and none is overwritten", async () => {
  const names = Array.from({ length: 12 }, (_, i) => `Client fictif ${i + 1}`)
  const created = await Promise.all(names.map((name) => post("/api/invoices", { client: { name }, items: [{ label: "Site vitrine", qty: 1, unitPrice: 1490 }], vatRate: 20 }).then((r) => r.json())))
  const numbers = created.map((c: any) => c.number)
  assert.equal(new Set(numbers).size, 12, `numbers: ${numbers.join(", ")}`)
  const list = await (await fetch(cockpit.url + "/api/invoices")).json()
  assert.equal(list.length, 12)
  assert.deepEqual(list.map((i: any) => i.client.name).sort(), [...names].sort(), "each invoice keeps ITS client")
  const year = new Date().toISOString().slice(0, 4)
  assert.deepEqual(list.map((i: any) => i.number).sort(), names.map((_, i) => `${year}-${String(i + 1).padStart(3, "0")}`), "complete sequence, no gap")
  assert.ok(list.every((i: any) => i.totals?.ttc === 1788), "the list carries the server's totals (€1,490 excl. VAT → €1,788 incl. VAT)")
})

test("cockpit: a credit note cancels an issued invoice (opposite amounts), an issued invoice stays frozen", async () => {
  const f = await (await post("/api/invoices", { client: { name: "Client fictif avoir" }, items: [{ label: "Acompte", qty: 2.5, unitPrice: 2438.35 }], vatRate: 20 })).json()
  await post(`/api/invoices/${f.id}`, { status: "sent" })
  const frozen = await (await post(`/api/invoices/${f.id}`, { items: [{ label: "triche", qty: 1, unitPrice: 1 }], client: { name: "autre" } })).json()
  assert.equal(frozen.items[0].label, "Acompte", "an issued invoice no longer changes its lines")
  assert.equal(frozen.client.name, "Client fictif avoir")
  const av = await (await post(`/api/invoices/${f.id}/avoir`, {})).json()
  assert.equal(av.kind, "avoir")
  assert.equal(av.ref, f.number)
  const list = await (await fetch(cockpit.url + "/api/invoices")).json()
  const tf = list.find((i: any) => i.number === f.number).totals, ta = list.find((i: any) => i.number === av.number).totals
  assert.deepEqual([ta.ht, ta.tva, ta.ttc], [-tf.ht + 0, -tf.tva + 0, -tf.ttc + 0])
  assert.equal((await post(`/api/invoices/${av.id}/avoir`, {})).status, 409, "no credit note of a credit note")
  // audit round 2 : ONE credit note per invoice (a second request, one after the other, or two at once, is refused)
  const again = await post(`/api/invoices/${f.id}/avoir`, {})
  assert.equal(again.status, 409); assert.match((await again.json()).error, new RegExp(`already cancelled by credit note ${av.number}`))
  assert.equal(list.find((i: any) => i.number === f.number).cancelledBy, av.number, "the list says the invoice is cancelled, and by which credit note")
  const g = await (await post("/api/invoices", { client: { name: "Client fictif avoir 2" }, items: [{ label: "Site", qty: 1, unitPrice: 900 }], vatRate: 20 })).json()
  assert.equal((await post(`/api/invoices/${g.id}/avoir`, {})).status, 409, "a draft (never sent) has nothing to cancel")
  await post(`/api/invoices/${g.id}`, { status: "sent" })
  const both = await Promise.all([post(`/api/invoices/${g.id}/avoir`, {}), post(`/api/invoices/${g.id}/avoir`, {})])
  assert.deepEqual(both.map((r) => r.status).sort(), [200, 409], "two at once : one credit note")
  assert.equal((await (await fetch(cockpit.url + "/api/invoices")).json()).filter((i: any) => i.kind === "avoir" && i.ref === g.number).length, 1)
})

test("audit round 2: only the last draft can be deleted (the numbers keep no gap) ; a sent invoice never", async () => {
  const del = (n: string) => fetch(`${cockpit.url}/api/invoices/${n}`, { method: "DELETE", signal: AbortSignal.timeout(20_000) })
  const a = await (await post("/api/invoices", { client: { name: "Brouillon A" }, items: [{ label: "Site", qty: 1, unitPrice: 500 }], vatRate: 20 })).json()
  const b = await (await post("/api/invoices", { client: { name: "Brouillon B" }, items: [{ label: "Site", qty: 1, unitPrice: 500 }], vatRate: 20 })).json()
  const r1 = await del(a.number); assert.equal(r1.status, 409); assert.match((await r1.json()).error, new RegExp(`Only the last invoice \\(${b.number}\\)`))
  assert.equal((await del(b.number)).status, 200)
  const c = await (await post("/api/invoices", { client: { name: "Brouillon C" }, items: [{ label: "Site", qty: 1, unitPrice: 500 }], vatRate: 20 })).json()
  assert.equal(c.number, b.number, "the deleted number is taken again : the sequence keeps no gap")
  await post(`/api/invoices/${c.id}`, { status: "sent" })
  const r3 = await del(c.number); assert.equal(r3.status, 409); assert.match((await r3.json()).error, /credit note/)
})

test("audit round 2: through the API too, Infinity, 1e300 and a zero total take no number", async () => {
  const before = (await (await fetch(cockpit.url + "/api/invoices")).json()).length
  for (const items of [[{ label: "Inf", qty: 1, unitPrice: "Infinity" }], [{ label: "Big", qty: 1e300, unitPrice: 1e300 }], [{ label: "Zero", qty: 0, unitPrice: 0 }]]) {
    const r = await post("/api/invoices", { client: { name: "X" }, items, vatRate: 0 }); assert.equal(r.status, 400, JSON.stringify(items))
  }
  assert.equal((await (await fetch(cockpit.url + "/api/invoices")).json()).length, before)
})

test("cockpit : the server refuses an invoice the form would refuse (a stale tab, a script) — no number is taken", async () => {
  const before = (await (await fetch(cockpit.url + "/api/invoices")).json()).length
  for (const bad of [{ client: { name: "" }, items: [{ label: "Website", qty: 1, unitPrice: 1 }] }, { client: { name: "X" }, items: [{ label: "Website", qty: 1, unitPrice: -1 }] }, { client: { name: "X" }, items: [{ label: "Website", qty: 1, unitPrice: 1 }], vatRate: 150 }]) {
    const r = await post("/api/invoices", bad); assert.equal(r.status, 400); assert.ok((await r.json()).error)
  }
  assert.equal((await (await fetch(cockpit.url + "/api/invoices")).json()).length, before)
})
