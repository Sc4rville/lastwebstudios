/**
 * invoices.ts — l'outil de FACTURATION du cockpit.
 *
 * PERSISTANCE : la DB partagée (Supabase, table `invoices`, JSONB) — les factures sont des données
 * comptables LÉGALES, elles ne peuvent pas vivre dans le FS éphémère du conteneur Coolify (un redeploy
 * les effaçait). Repli FS (data/invoices/) uniquement sans DATABASE_URL (dev local hors ligne) ; les
 * anciens JSON locaux sont IMPORTÉS en DB au premier accès. Réglages vendeur → table `meta`.
 *
 * RÈGLES LÉGALES (FR) :
 * - Numéro séquentiel AAAA-NNN sans trou ni réutilisation → max+1 sur l'année (jamais un count de
 *   fichiers), et AUCUNE suppression : une facture émise s'annule par un AVOIR (montants négatifs).
 * - Une facture qui n'est plus en brouillon est FIGÉE : seuls statut et lien de paiement restent modifiables.
 * - Mentions obligatoires : pénalités de retard + indemnité 40 € (B2B), et « TVA non applicable,
 *   art. 293 B du CGI » si TVA à 0 (franchise en base).
 *
 * ENCAISSER FACILE : champ lien de paiement (Stripe Payment Link) par facture ou par défaut (réglages
 * vendeur) → gros bouton « Payer en ligne » sur la facture, à côté du virement IBAN.
 * La facture imprimable est du HTML → "Imprimer → PDF".
 */
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { tryDb, getMeta, setMeta } from "../../packages/shared/db.ts"
import { agency } from "../../packages/shared/agency.mjs"

const DIR = "data/invoices"
const SETTINGS = join(DIR, "_settings.json")
const META_KEY = "invoice_settings"

export type Item = { label: string; qty: number; unitPrice: number }
export type Invoice = {
  id: string; number: string; status: "draft" | "sent" | "paid"
  kind: "facture" | "acompte" | "solde" | "avoir"
  ref?: string // pour un avoir : le numéro de la facture annulée/corrigée
  createdAt: string; issueDate: string; dueDate: string
  client: { name: string; address?: string; email?: string; siret?: string }
  items: Item[]; vatRate: number; notes?: string
  paymentUrl?: string // lien de paiement (Stripe Payment Link…) — prime sur le défaut vendeur
}
export type Seller = { name: string; legal?: string; address: string; siret: string; tva: string; rcs?: string; email: string; phone?: string; iban?: string; bic?: string; capital?: string; paymentLink?: string }

// Vendeur par défaut = agency.config.json › invoice.seller (placeholders <...> à remplir), par-dessus ce squelette
// structurellement complet. Les réglages saisis dans le cockpit (meta DB, sinon FS) priment toujours.
const SELLER_SKELETON: Seller = {
  name: "<nom de l'agence>",
  legal: "SASU au capital de <montant> €",
  address: "<n° et rue>, <CP> <ville>",
  siret: "<SIRET — 14 chiffres>",
  tva: "<TVA intracom — FRXX XXXXXXXXX>",
  rcs: "<RCS <ville> <numéro>>",
  email: "<e-mail>",
  phone: "<téléphone>",
  iban: "<IBAN>",
  bic: "<BIC>",
  capital: "<capital social €>",
  paymentLink: "", // Stripe Payment Link par défaut (optionnel) — vide = virement seul
}
export const DEFAULT_SELLER: Seller = { ...SELLER_SKELETON, name: agency().name, ...(agency().invoice.seller as Partial<Seller>) }

/* ── réglages vendeur : meta (DB) d'abord, FS en repli ── */
export async function getSettings(): Promise<Seller> {
  if (tryDb()) {
    const v = await getMeta(META_KEY)
    if (v) { try { return { ...DEFAULT_SELLER, ...JSON.parse(v) } } catch { /* meta corrompu → défaut */ } }
  }
  try { if (existsSync(SETTINGS)) return { ...DEFAULT_SELLER, ...JSON.parse(await readFile(SETTINGS, "utf8")) } } catch { /* défaut */ }
  return DEFAULT_SELLER
}
export async function saveSettings(patch: Partial<Seller>): Promise<Seller> {
  const merged = { ...(await getSettings()), ...patch }
  if (tryDb()) await setMeta(META_KEY, JSON.stringify(merged))
  else { await mkdir(DIR, { recursive: true }); await writeFile(SETTINGS, JSON.stringify(merged, null, 2)) }
  return merged
}

/* ── normalisation : les factures d'avant la refonte n'ont pas kind ── */
const norm = (inv: any): Invoice => ({ kind: "facture", ...inv })
/** une facture + ses totaux (centimes, calculés ici) : ce que l'API renvoie, l'UI affiche ces chiffres-là */
export const withTotals = (inv: Invoice) => ({ ...inv, totals: totals(inv) })

/* ── import one-shot des JSON locaux d'avant la migration DB (idempotent : PK number) ── */
let fsImported = false
async function importFsOnce(): Promise<void> {
  const db = tryDb()
  if (!db || fsImported) return
  fsImported = true
  if (!existsSync(DIR)) return
  try {
    const files = (await readdir(DIR)).filter((f) => f.endsWith(".json") && f !== "_settings.json")
    for (const f of files) {
      try {
        const inv = norm(JSON.parse(await readFile(join(DIR, f), "utf8")))
        await db.prepare("INSERT INTO invoices(number, data, created_at) VALUES (?,(?)::text::jsonb,?) ON CONFLICT (number) DO NOTHING")
          .run(inv.number, JSON.stringify(inv), new Date(inv.createdAt || Date.now()).getTime())
      } catch { /* fichier cassé → ignoré */ }
    }
  } catch { /* pas de dossier → rien à importer */ }
}

export async function listInvoices(): Promise<Invoice[]> {
  const db = tryDb()
  if (db) {
    await importFsOnce()
    const rows = await db.prepare("SELECT data FROM invoices ORDER BY number DESC").all()
    return rows.map((r: any) => norm(typeof r.data === "string" ? JSON.parse(r.data) : r.data))
  }
  if (!existsSync(DIR)) return []
  const files = (await readdir(DIR)).filter((f) => f.endsWith(".json") && f !== "_settings.json")
  const invs: Invoice[] = []
  for (const f of files) { try { invs.push(norm(JSON.parse(await readFile(join(DIR, f), "utf8")))) } catch { /* ignore fichier cassé */ } }
  return invs.sort((a, b) => (a.number < b.number ? 1 : -1)) // plus récent d'abord
}
export async function getInvoice(id: string): Promise<Invoice | null> {
  const db = tryDb()
  if (db) {
    await importFsOnce()
    const r = await db.prepare("SELECT data FROM invoices WHERE number=?").get(id) as any
    return r ? norm(typeof r.data === "string" ? JSON.parse(r.data) : r.data) : null
  }
  const f = join(DIR, `${id}.json`)
  if (!existsSync(f)) return null
  try { return norm(JSON.parse(await readFile(f, "utf8"))) } catch { return null }
}

async function persist(inv: Invoice): Promise<void> {
  const db = tryDb()
  if (db) {
    // (?)::text::jsonb : sans le cast, postgres.js encode le param string en jsonb-STRING (double encodage)
    await db.prepare("INSERT INTO invoices(number, data, created_at) VALUES (?,(?)::text::jsonb,?) ON CONFLICT (number) DO UPDATE SET data=excluded.data")
      .run(inv.number, JSON.stringify(inv), new Date(inv.createdAt).getTime())
  } else {
    await mkdir(DIR, { recursive: true })
    await writeFile(join(DIR, `${inv.id}.json`), JSON.stringify(inv, null, 2))
  }
}

/* numéro suivant = MAX de l'année + 1 (séquence sans trou ni doublon — jamais un count, qui
   réutiliserait un numéro si un enregistrement disparaissait). */
async function nextNumber(year: string): Promise<string> {
  const all = await listInvoices()
  const max = all.filter((i) => i.number.startsWith(year + "-"))
    .reduce((m, i) => Math.max(m, parseInt(i.number.slice(5), 10) || 0), 0)
  return `${year}-${String(max + 1).padStart(3, "0")}`
}

const KINDS = new Set(["facture", "acompte", "solde", "avoir"])
function readBody(body: any): Omit<Invoice, "id" | "number" | "status" | "createdAt"> {
  const items: Item[] = Array.isArray(body?.items) ? body.items.map((it: any) => ({ label: String(it.label || ""), qty: Number(it.qty) || 0, unitPrice: Number(it.unitPrice) || 0 })) : []
  return {
    kind: KINDS.has(body?.kind) ? body.kind : "facture",
    ref: body?.ref ? String(body.ref) : undefined,
    issueDate: String(body?.issueDate || "").slice(0, 10),
    dueDate: String(body?.dueDate || "").slice(0, 10),
    client: { name: String(body?.client?.name || ""), address: body?.client?.address || "", email: body?.client?.email || "", siret: body?.client?.siret || "" },
    items, vatRate: typeof body?.vatRate === "number" ? body.vatRate : 20, notes: body?.notes || "",
    paymentUrl: body?.paymentUrl ? String(body.paymentUrl) : undefined,
  }
}

export async function createInvoice(body: any, nowIso: string): Promise<Invoice> {
  const year = nowIso.slice(0, 4)
  const b = readBody(body)
  const inv: Invoice = {
    ...b,
    id: "", number: "", status: "draft", createdAt: nowIso,
    issueDate: b.issueDate || nowIso.slice(0, 10),
    dueDate: b.dueDate || nowIso.slice(0, 10),
  }
  // deux créations simultanées (deux opérateurs, un double clic) calculent le même numéro : la création est
  // EXCLUSIVE (base : INSERT … ON CONFLICT DO NOTHING ; disque : fichier ouvert en `wx`), le perdant retente avec le
  // suivant. Avant, persist() faisait un upsert : la seconde facture écrasait la première sous le même numéro.
  for (let attempt = 0; attempt < 50; attempt++) {
    inv.number = inv.id = await nextNumber(year)
    if (await persistNew(inv)) return inv
  }
  throw new Error(`numérotation : ${year}-… toujours pris après 50 essais`)
}

/** Enregistre une facture NEUVE ; false si son numéro est déjà pris (jamais d'écrasement). */
async function persistNew(inv: Invoice): Promise<boolean> {
  const db = tryDb()
  if (db) {
    const row = await db.prepare("INSERT INTO invoices(number, data, created_at) VALUES (?,(?)::text::jsonb,?) ON CONFLICT (number) DO NOTHING RETURNING number")
      .get(inv.number, JSON.stringify(inv), new Date(inv.createdAt).getTime())
    return !!row
  }
  await mkdir(DIR, { recursive: true })
  try { await writeFile(join(DIR, `${inv.id}.json`), JSON.stringify(inv, null, 2), { flag: "wx" }); return true }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") return false; throw e }
}

/* une facture ÉMISE (sent/paid) est figée : seuls le statut et le lien de paiement bougent encore.
   Pour corriger une facture émise → créer un AVOIR puis refacturer. */
export async function updateInvoice(id: string, patch: any): Promise<Invoice | null> {
  const inv = await getInvoice(id); if (!inv) return null
  const merged: Invoice = inv.status === "draft"
    ? { ...inv, ...readBody({ ...inv, ...patch }), id: inv.id, number: inv.number, status: patch?.status && ["draft", "sent", "paid"].includes(patch.status) ? patch.status : inv.status, createdAt: inv.createdAt }
    : {
      ...inv,
      status: patch?.status && ["sent", "paid"].includes(patch.status) ? patch.status : inv.status,
      paymentUrl: patch?.paymentUrl !== undefined ? String(patch.paymentUrl || "") || undefined : inv.paymentUrl,
    }
  await persist(merged)
  return merged
}

/* AVOIR : l'annulation LÉGALE d'une facture émise — mêmes lignes en négatif, référence à l'original.
   (On ne supprime JAMAIS une facture : la séquence doit rester pleine.) */
export async function createAvoir(id: string, nowIso: string): Promise<Invoice | null> {
  const src = await getInvoice(id); if (!src || src.kind === "avoir") return null
  return createInvoice({
    kind: "avoir", ref: src.number,
    client: src.client, vatRate: src.vatRate,
    issueDate: nowIso.slice(0, 10), dueDate: nowIso.slice(0, 10),
    items: src.items.map((it) => ({ ...it, unitPrice: -it.unitPrice })),
    notes: `Avoir sur la facture ${src.number}.${src.notes ? " " + src.notes : ""}`,
  }, nowIso)
}

/* ── MONTANTS EN CENTIMES ENTIERS ──
   Avant (flottants) : une facture sur cinq imprimait un Total TTC à 1 centime de « Total HT + TVA », et une sur huit
   des lignes dont la somme ne faisait pas le Total HT (ex. 2,5 × 2 438,35 + … : HT 19 371,68 + TVA 3 874,34 ≠ TTC
   23 246,01 ; test blitz du 24/10). Ici : chaque ligne arrondie au centime (demi-centime vers l'extérieur, un avoir
   est donc l'exact opposé de sa facture), HT = somme des lignes, TVA = HT × taux arrondie au centime, TTC = HT + TVA.
   Les mêmes règles sont recopiées dans public/billing.html (aperçu du formulaire) : test/cockpit/invoices.test.ts
   vérifie que les deux calculs donnent la même chose. */
/** arrondi d'un entier n / d au plus proche, demi vers l'extérieur (entiers exacts, pas de flottant) */
const divRound = (n: number, d: number) => (n < 0 ? -1 : 1) * Math.floor((Math.abs(n) + d / 2) / d) + 0 // + 0 : jamais de -0
/** montant d'une ligne en centimes : prix saisi au centime, quantité au millième (1,5 h ; 0,25 jour) */
export function lineCents(it: Pick<Item, "qty" | "unitPrice">): number {
  const priceCents = Math.round((Number(it.unitPrice) || 0) * 100)
  const qtyMilli = Math.round((Number(it.qty) || 0) * 1000)
  return divRound(qtyMilli * priceCents, 1000)
}
export function totalsCents(inv: Pick<Invoice, "items" | "vatRate">): { lines: number[]; ht: number; tva: number; ttc: number } {
  const lines = (inv.items || []).map(lineCents)
  const ht = lines.reduce((s, c) => s + c, 0)
  const rateBp = Math.round((Number(inv.vatRate) || 0) * 100) // 5,5 % → 550 points de base
  const tva = divRound(ht * rateBp, 10_000)
  return { lines, ht, tva, ttc: ht + tva }
}
/** totaux en euros (calculés en centimes : HT + TVA = TTC au centime près, toujours) */
export function totals(inv: Pick<Invoice, "items" | "vatRate">) {
  const c = totalsCents(inv)
  return { ht: c.ht / 100, tva: c.tva / 100, ttc: c.ttc / 100 }
}

const eur = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"
const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string))
/** un lien de paiement n'est un bouton que s'il est http(s) : jamais de `javascript:` ni d'attribut cassé */
const safeHttpUrl = (u: string) => { try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? x.href : "" } catch { return "" } }
const nl = (s: any) => esc(s).replace(/\n/g, "<br>")

const KIND_TITLE = { facture: "FACTURE", acompte: "FACTURE D'ACOMPTE", solde: "FACTURE DE SOLDE", avoir: "AVOIR" }

// la FACTURE imprimable (A4, mentions légales FR). "Imprimer → Enregistrer en PDF".
export function renderInvoiceHtml(inv: Invoice, seller: Seller): string {
  const t = totals(inv)
  const lc = totalsCents(inv).lines
  const rows = inv.items.map((it, i) => {
    return `<tr><td>${esc(it.label)}</td><td class=r>${esc(it.qty)}</td><td class=r>${eur(Number(it.unitPrice) || 0)}</td><td class=r>${eur(lc[i] / 100)}</td></tr>`
  }).join("")
  const fr = (d: string) => { const [y, m, j] = d.split("-"); return j && m && y ? `${j}/${m}/${y}` : d }
  const noVat = !(Number(inv.vatRate) > 0)
  const payUrl = safeHttpUrl(inv.paymentUrl || seller.paymentLink || "")
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(KIND_TITLE[inv.kind] || "Facture")} ${esc(inv.number)}</title>
<style>
  *{box-sizing:border-box} body{font:13px/1.5 -apple-system,system-ui,sans-serif;color:#1a1a1a;max-width:800px;margin:0 auto;padding:40px}
  .head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:36px}
  .seller b{font-size:17px} .seller,.client{white-space:pre-line;font-size:12px;color:#333}
  h1{font-size:30px;margin:0 0 4px;letter-spacing:-.5px} .meta{color:#666;font-size:12px}
  .to{margin:24px 0 28px} .to .lbl{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#999;margin-bottom:4px}
  table{width:100%;border-collapse:collapse;margin:16px 0} th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#999;border-bottom:2px solid #1a1a1a;padding:8px 6px}
  td{padding:9px 6px;border-bottom:1px solid #eee} .r{text-align:right;font-variant-numeric:tabular-nums}
  .tot{margin-left:auto;width:280px;margin-top:8px} .tot div{display:flex;justify-content:space-between;padding:5px 6px}
  .tot .ttc{border-top:2px solid #1a1a1a;font-weight:700;font-size:16px;margin-top:4px}
  .legal{margin-top:36px;padding-top:16px;border-top:1px solid #eee;font-size:10.5px;color:#777;line-height:1.6}
  .pay{margin-top:22px;font-size:12px} .status{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600}
  .draft{background:#eee;color:#666}.sent{background:#e0ecff;color:#1a56db}.paid{background:#dcfce7;color:#166534}
  .paybtn{display:inline-block;margin-top:14px;padding:12px 26px;border-radius:9px;background:#1a1a1a;color:#fff;font-weight:700;font-size:14px;text-decoration:none}
  .refline{color:#666;font-size:12px;margin-top:2px}
  @media print{body{padding:0} .noprint{display:none}}
</style></head><body>
<div class="head">
  <div class="seller"><b>${esc(seller.name)}</b>\n${nl(seller.legal || "")}\n${nl(seller.address)}\nSIRET ${esc(seller.siret)}\nTVA ${esc(seller.tva)}\n${esc(seller.email)}${seller.phone ? " · " + esc(seller.phone) : ""}</div>
  <div style="text-align:right">
    <h1>${esc(KIND_TITLE[inv.kind] || "FACTURE")}</h1>
    <div class="meta">N° <b>${esc(inv.number)}</b><br>Date : ${fr(inv.issueDate)}<br>Échéance : ${fr(inv.dueDate)}<br><span class="status ${esc(inv.status)}">${inv.status === "paid" ? "Payée" : inv.status === "sent" ? "Envoyée" : "Brouillon"}</span></div>
    ${inv.kind === "avoir" && inv.ref ? `<div class="refline">annule/corrige la facture <b>${esc(inv.ref)}</b></div>` : ""}
  </div>
</div>
<div class="to"><div class="lbl">Facturé à</div><div class="client"><b>${esc(inv.client.name)}</b>\n${nl(inv.client.address || "")}${inv.client.siret ? "\nSIRET " + esc(inv.client.siret) : ""}${inv.client.email ? "\n" + esc(inv.client.email) : ""}</div></div>
<table><thead><tr><th>Désignation</th><th class=r>Qté</th><th class=r>PU HT</th><th class=r>Montant HT</th></tr></thead><tbody>${rows || '<tr><td colspan=4 style="color:#bbb">aucune ligne</td></tr>'}</tbody></table>
<div class="tot">
  <div><span>Total HT</span><span>${eur(t.ht)}</span></div>
  ${noVat ? `<div><span>TVA</span><span>non applicable</span></div>` : `<div><span>TVA (${esc(inv.vatRate)} %)</span><span>${eur(t.tva)}</span></div>`}
  <div class="ttc"><span>Total TTC</span><span>${eur(t.ttc)}</span></div>
</div>
${inv.notes ? `<div class="pay"><b>Note :</b> ${nl(inv.notes)}</div>` : ""}
${inv.kind === "avoir"
    ? `<div class="pay"><b>Règlement de l'avoir :</b> remboursement ou imputation sur la prochaine facture.</div>`
    : `<div class="pay"><b>Règlement :</b> par virement — IBAN ${esc(seller.iban || "<IBAN>")}${seller.bic ? " · BIC " + esc(seller.bic) : ""}. Paiement à réception, échéance le ${fr(inv.dueDate)}.
  ${payUrl ? `<br><a class="paybtn" href="${esc(payUrl)}">Payer en ligne →</a>` : ""}</div>`}
<div class="legal">
  ${esc(seller.name)}${seller.legal ? " · " + esc(seller.legal) : ""}${seller.rcs ? " · " + esc(seller.rcs) : ""} · SIRET ${esc(seller.siret)} · TVA intracommunautaire ${esc(seller.tva)}.<br>
  ${noVat ? "TVA non applicable, art. 293 B du CGI.<br>" : ""}
  En cas de retard de paiement : pénalités au taux de 3 fois le taux d'intérêt légal, exigibles sans rappel, + indemnité forfaitaire pour frais de recouvrement de 40 € (art. L441-10 et D441-5 du Code de commerce). Pas d'escompte pour paiement anticipé.
</div>
<div class="noprint" style="margin-top:30px;text-align:center"><button onclick="print()" style="padding:10px 22px;font-size:14px;border:0;border-radius:8px;background:#1a1a1a;color:#fff;cursor:pointer">Imprimer / PDF</button></div>
</body></html>`
}
