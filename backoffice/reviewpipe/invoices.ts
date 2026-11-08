/**
 * invoices.ts — the cockpit's INVOICING tool.
 *
 * PERSISTENCE: the shared DB (Supabase, table `invoices`, JSONB) — invoices are LEGAL accounting
 * records, they cannot live in the Coolify container's ephemeral FS (a redeploy
 * used to wipe them). FS fallback (data/invoices/) only without DATABASE_URL (offline local dev); the
 * old local JSON files are IMPORTED into the DB on first access. Seller settings → table `meta`.
 *
 * LEGAL RULES (FR):
 * - Sequential number YYYY-NNN with no gap and no reuse → max+1 over the year (never a count of
 *   files), and NO deletion: an issued invoice is cancelled by a CREDIT NOTE (negative amounts).
 * - An invoice that is no longer a draft is FROZEN: only the status and the payment link can still change.
 * - Mandatory notices: late-payment penalties + €40 fixed fee (B2B), and « TVA non applicable,
 *   art. 293 B du CGI » when VAT is 0 (VAT-exempt small business).
 *
 * EASY TO GET PAID: a payment link field (Stripe Payment Link) per invoice or by default (seller
 * settings) → a big "Pay online" button on the invoice, next to the IBAN bank transfer.
 * The printable invoice is HTML → "Print → PDF".
 */
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { tryDb, getMeta, setMeta } from "../../packages/shared/db.ts"
import { agency } from "../../packages/shared/agency.mjs"
import { readExamples } from "../../packages/shared/agency-demo.mjs"

const DIR = "data/invoices"
const SETTINGS = join(DIR, "_settings.json")
const META_KEY = "invoice_settings"

export type Item = { label: string; qty: number; unitPrice: number }
export type Invoice = {
  id: string; number: string; status: "draft" | "sent" | "paid"
  kind: "facture" | "acompte" | "solde" | "avoir"
  ref?: string // for a credit note: the number of the cancelled/corrected invoice
  createdAt: string; issueDate: string; dueDate: string
  client: { name: string; address?: string; email?: string; siret?: string }
  items: Item[]; vatRate: number; notes?: string
  paymentUrl?: string // payment link (Stripe Payment Link…) — wins over the seller default
}
export type Seller = { name: string; legal?: string; address: string; siret: string; tva: string; taxId?: string; rcs?: string; email: string; phone?: string; iban?: string; bic?: string; capital?: string; paymentLink?: string; payment?: string }

/** a value the owner really typed : a <…> placeholder of the demo config (or one left half-filled) is no value at all */
export const filled = (v: unknown): string => { const t = String(v ?? "").trim(); return /<[^>]*>/.test(t) ? "" : t }
/** what the shipped demo studios print (their seller, name, email, phone, address) : never the owner's own details */
let DEMO: Set<string> | null = null
function demoValues(): Set<string> {
  if (DEMO) return DEMO
  const out = new Set<string>()
  for (const e of readExamples(process.cwd()) as any[]) {
    for (const v of [e?.name, e?.contactEmail, e?.phone, e?.postalAddress, e?.mail?.legalIdentity, ...Object.values(e?.invoice?.seller || {})]) {
      const t = filled(v); if (t) out.add(t.toLowerCase())
    }
  }
  return (DEMO = out)
}
/** a seller value that still belongs to a demo studio (its exact value, or an address on a reserved .example domain) */
export const isDemoValue = (v: unknown): boolean => { const t = filled(v); return !!t && (demoValues().has(t.toLowerCase()) || /\.(example|invalid|test)\b/i.test(t)) }
/** the sandbox IS the demo studio : its fictional business details are its own there (a demo invoice prints whole,
 *  marked as a demo) ; anywhere else a demo studio's value is never the owner's */
export const demoAgency = (): boolean => process.env.LWS_SANDBOX === "1"
/** the owner's own value : a placeholder or a demo studio's value is no value at all (except in the demo itself) */
export const own = (v: unknown): string => (!demoAgency() && isDemoValue(v) ? "" : filled(v))
/** the seller with every placeholder AND every demo studio's value blanked : what is printed on a document a client receives */
export const cleanSeller = (s: Seller): Seller => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, own(v)])) as Seller
/** the seller fields that still carry a demo studio's value (Billing › Your business shows them empty, to be replaced) */
export const demoSellerKeys = (s: Seller): string[] => (demoAgency() ? [] : Object.entries(s).filter(([, v]) => isDemoValue(v)).map(([k]) => k))

/** a value saved in Billing › Your business that cannot be right, said for that field (the form shows it) ; "" when fine.
 *  Plain text only, a SIRET of 14 digits, an IBAN / BIC / VAT number of their shape, an http(s) payment link, an email,
 *  a phone, a US EIN of 9 digits. Empty is fine here (what is required is checked before the first invoice). */
export function sellerFieldProblem(patch: Record<string, unknown>, country = String(agency().country || "")): { field: string; error: string } | null {
  const LABEL: Record<string, string> = { name: "Business name", legal: "Legal form", address: "Address", siret: "SIRET", tva: "VAT number", taxId: country.toUpperCase() === "US" ? "EIN" : "Tax ID", rcs: "Registry", email: "Email", phone: "Phone", iban: "IBAN", bic: "BIC", capital: "Share capital", paymentLink: "Payment link", payment: "How to pay" }
  for (const [k, raw] of Object.entries(patch || {})) {
    if (k.startsWith("_") || !(k in LABEL)) continue
    const v = String(raw ?? "").trim()
    if (!v) continue
    const bad = (error: string) => ({ field: k, error })
    if (/[<>]/.test(v)) return bad(`${LABEL[k]}: plain text only (no < or >).`)
    if (v.length > 300) return bad(`${LABEL[k]} is too long.`)
    if (k === "siret" && !/^\d{14}$/.test(v.replace(/\s/g, ""))) return bad("A SIRET is 14 digits.")
    if (k === "iban" && !/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/i.test(v.replace(/\s/g, ""))) return bad("That IBAN doesn't look right (two letters, two digits, then up to 30 letters and digits).")
    if (k === "bic" && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/i.test(v.replace(/\s/g, ""))) return bad("A BIC is 8 or 11 letters and digits.")
    if (k === "tva" && !/^[A-Z]{2}[0-9A-Z]{2,13}$/i.test(v.replace(/\s/g, ""))) return bad("That VAT number doesn't look right (two letters, then digits).")
    if (k === "taxId" && country.toUpperCase() === "US" && !/^\d{2}-?\d{7}$/.test(v)) return bad("An EIN is 9 digits (12-3456789).")
    if (k === "paymentLink" && !/^https?:\/\/\S+$/i.test(v)) return bad("The payment link must start with http(s)://.")
    if (k === "email" && !/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(v)) return bad("That email doesn't look right.")
    if (k === "phone" && !(/^[+(\d][\d\s().\-+/]*$/.test(v) && v.replace(/\D/g, "").length >= 7)) return bad("That phone number doesn't look right.")
  }
  return null
}
/** what a business must print on its invoices before the first one gets a number, by country */
export function sellerRequired(country = String(agency().country || "")): [keyof Seller, string][] {
  const c = country.toUpperCase()
  if (c === "FR") return [["name", "Name"], ["address", "Address"], ["siret", "SIRET"]]
  return [["name", "Business name"], ["address", "Address"]]
}
/** "" when the seller can issue invoices ; else « Fill in Your business first: Address, SIRET ». A demo studio's value
 *  counts as missing : no invoice gets a number while it would print someone else's business */
export function sellerProblem(seller: Seller, country = String(agency().country || "")): string {
  const req = sellerRequired(country)
  const missing = req.filter(([k]) => !own(seller[k])).map(([, l]) => l)
  if (!missing.length) return ""
  const demo = req.some(([k]) => isDemoValue(seller[k]))
  return `Fill in Your business first${demo ? " (your own details, not the demo studio's)" : ""}: ${missing.join(", ")}`
}

// Default seller = agency.config.json › invoice.seller (<...> placeholders to fill in), on top of this structurally
// complete skeleton. Settings entered in the cockpit (meta DB, otherwise FS) always win.
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
  paymentLink: "", // default Stripe Payment Link (optional) — empty = bank transfer only
}
const SELLER_SKELETON_INTL: Seller = { name: "<business name>", legal: "", address: "<street>, <city> <state> <zip>", siret: "", tva: "", taxId: "<Tax ID / EIN>", email: "<email>", phone: "<phone>", paymentLink: "" }
/** FR agencies print the French legal skeleton ; everyone else gets the plain one (Tax ID / EIN, no SIRET / VAT / RCS / IBAN) */
export const isFrInvoice = () => String(agency().country || "").toUpperCase() === "FR"
/** the seller skeleton of the agency AS IT IS NOW (Settings can change the country while the cockpit runs) */
export const defaultSeller = (): Seller => ({ ...(isFrInvoice() ? SELLER_SKELETON : SELLER_SKELETON_INTL), name: agency().name, ...(agency().invoice.seller as Partial<Seller>) })
export const DEFAULT_SELLER: Seller = defaultSeller()

/** the usual sales tax / VAT rate of a country (a default the owner can change on each invoice) and its name */
const TAX: Record<string, [number, string]> = { US: [0, "Sales tax"], FR: [20, "VAT"], GB: [20, "VAT"], IE: [23, "VAT"], BE: [21, "VAT"], NL: [21, "VAT"], DE: [19, "VAT"], ES: [21, "VAT"], IT: [22, "VAT"], CH: [8.1, "VAT"], CA: [5, "GST"], AU: [10, "GST"], NZ: [15, "GST"] }
export const taxDefault = (country = String(agency().country || "")): { rate: number; label: string } => { const t = TAX[country.toUpperCase()]; return t ? { rate: t[0], label: t[1] } : { rate: 0, label: "Tax" } }

/**
 * What a new invoice must hold before it gets a number (the form checks the same, the server never trusts it) :
 * a client, at least one line, every line described, no negative quantity or price, a tax rate 0–100, a due date
 * not before the issue date, a payment link in http(s). "" = valid. Credit notes are made by createAvoir, not here.
 */
/** an invoice never carries more than this (a line or the total) : past it, a typo, not a website */
export const MAX_AMOUNT = 10_000_000
export const MAX_QTY = 100_000
export function invoiceProblem(body: any): string {
  if (!body || typeof body !== "object") return "Expected an invoice"
  if (!String(body.client?.name || "").trim()) return "Client name is required."
  const items = Array.isArray(body.items) ? body.items : []
  if (!items.length) return "Add at least one line."
  if (items.some((it: any) => !String(it?.label || "").trim())) return "Every line needs a description."
  // a number, finite (never « Infinity », 1e309 or a word), then not negative, then not absurd
  const num = (v: unknown) => (typeof v === "number" || (typeof v === "string" && v.trim() !== "")) ? Number(v) : NaN
  if (items.some((it: any) => !Number.isFinite(num(it?.qty)) || !Number.isFinite(num(it?.unitPrice)))) return "Quantities and prices must be numbers."
  if (items.some((it: any) => !(num(it?.qty) >= 0) || !(num(it?.unitPrice) >= 0))) return "Quantities and prices can't be negative."
  if (items.some((it: any) => num(it?.qty) > MAX_QTY || num(it?.unitPrice) > MAX_AMOUNT)) return "That amount looks like a typo: check the quantities and prices."
  if (body.vatRate != null && !(Number.isFinite(Number(body.vatRate)) && Number(body.vatRate) >= 0 && Number(body.vatRate) <= 100)) return "Tax must be between 0 and 100 %."
  // a number is never spent on nothing : a zero (or absurd) total is refused before it gets one
  const t = totalsCents({ items: items.map((it: any) => ({ qty: num(it?.qty), unitPrice: num(it?.unitPrice) })), vatRate: Number(body.vatRate) || 0 })
  if (!(t.ttc > 0)) return "The total is zero: add a price before creating the invoice."
  if (!Number.isSafeInteger(t.ttc) || t.ttc / 100 > MAX_AMOUNT) return "That amount looks like a typo: check the quantities and prices."
  const issue = String(body.issueDate || "").slice(0, 10), due = String(body.dueDate || "").slice(0, 10)
  if (issue && due && due < issue) return "The due date can't be before the issue date."
  // an invoice is dated the day it is issued, never ahead (a day of margin for time zones)
  if (issue && issue > new Date(Date.now() + 86400_000).toISOString().slice(0, 10)) return "The issue date can't be in the future."
  if (body.paymentUrl && !/^https?:\/\/\S+$/i.test(String(body.paymentUrl).trim())) return "The payment link must start with http(s)://."
  const mail = String(body.client?.email || "").trim()
  if (mail && !/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(mail)) return "The client's email doesn't look right."
  return ""
}

/* ── seller settings: meta (DB) first, FS as a fallback ── */
export async function getSettings(): Promise<Seller> {
  if (tryDb()) {
    const v = await getMeta(META_KEY)
    if (v) { try { return { ...defaultSeller(), ...JSON.parse(v) } } catch { /* corrupt meta → default */ } }
  }
  try { if (existsSync(SETTINGS)) return { ...defaultSeller(), ...JSON.parse(await readFile(SETTINGS, "utf8")) } } catch { /* default */ }
  return defaultSeller()
}
export async function saveSettings(patch: Partial<Seller>): Promise<Seller> {
  const merged = { ...(await getSettings()), ...patch }
  if (tryDb()) await setMeta(META_KEY, JSON.stringify(merged))
  else { await mkdir(DIR, { recursive: true }); await writeFile(SETTINGS, JSON.stringify(merged, null, 2)) }
  return merged
}

/* ── normalisation: invoices from before the rework have no kind ── */
const norm = (inv: any): Invoice => ({ kind: "facture", ...inv })
/** an invoice + its totals (cents, computed here): what the API returns, the UI shows these exact figures */
export const withTotals = (inv: Invoice) => ({ ...inv, totals: totals(inv) })

/* ── one-shot import of the local JSON files from before the DB migration (idempotent: PK number) ── */
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
      } catch { /* broken file → ignored */ }
    }
  } catch { /* no folder → nothing to import */ }
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
  for (const f of files) { try { invs.push(norm(JSON.parse(await readFile(join(DIR, f), "utf8")))) } catch { /* ignore a broken file */ } }
  return invs.sort((a, b) => (a.number < b.number ? 1 : -1)) // most recent first
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
    // (?)::text::jsonb: without the cast, postgres.js encodes the string param as a jsonb STRING (double encoding)
    await db.prepare("INSERT INTO invoices(number, data, created_at) VALUES (?,(?)::text::jsonb,?) ON CONFLICT (number) DO UPDATE SET data=excluded.data")
      .run(inv.number, JSON.stringify(inv), new Date(inv.createdAt).getTime())
  } else {
    await mkdir(DIR, { recursive: true })
    await writeFile(join(DIR, `${inv.id}.json`), JSON.stringify(inv, null, 2))
  }
}

/* next number = the year's MAX + 1 (a sequence with no gap and no duplicate — never a count, which
   would reuse a number if a record disappeared). */
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
    items, vatRate: typeof body?.vatRate === "number" ? body.vatRate : taxDefault().rate, notes: body?.notes || "",
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
  // two simultaneous creations (two operators, a double click) compute the same number: creation is
  // EXCLUSIVE (database: INSERT … ON CONFLICT DO NOTHING; disk: file opened with `wx`), the loser retries with the
  // next one. Before, persist() did an upsert: the second invoice overwrote the first under the same number.
  for (let attempt = 0; attempt < 50; attempt++) {
    inv.number = inv.id = await nextNumber(year)
    if (await persistNew(inv)) return inv
  }
  throw new Error(`numbering: ${year}-… still taken after 50 tries`)
}

/** Saves a NEW invoice; false if its number is already taken (never overwrites). */
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

/* an ISSUED invoice (sent/paid) is frozen: only the status and the payment link can still move.
   To correct an issued invoice → create a CREDIT NOTE then invoice again. */
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

/** A draft that was never sent can be deleted only when it is the LAST number of its year : the sequence never gets a
 *  hole (anything earlier, or anything sent, is cancelled with a credit note instead). "" = deletable. */
export async function deleteProblem(id: string): Promise<string> {
  const inv = await getInvoice(id); if (!inv) return "Invoice not found."
  if (inv.status !== "draft") return "A sent invoice is never deleted: cancel it with a credit note."
  const year = inv.number.slice(0, 4)
  const last = (await listInvoices()).filter((i) => i.number.startsWith(year + "-")).sort((a, b) => (a.number < b.number ? 1 : -1))[0]
  return last && last.number !== inv.number ? `Only the last invoice (${last.number}) can be deleted, so the numbers keep no gap.` : ""
}
export async function deleteInvoice(id: string): Promise<boolean> {
  if (await deleteProblem(id)) return false
  const db = tryDb()
  if (db) { await db.prepare("DELETE FROM invoices WHERE number=?").run(id); return true }
  const { rm } = await import("node:fs/promises")
  await rm(join(DIR, `${id}.json`), { force: true })
  return true
}

/* CREDIT NOTE (avoir): the LEGAL cancellation of an issued invoice — same lines as negatives, referencing the original.
   (An invoice is NEVER deleted: the sequence must stay complete.) */
/** the credit note that cancels invoice `number`, if any (one per invoice) */
export function creditNoteFor(number: string, all: Invoice[]): Invoice | undefined { return all.find((i) => i.kind === "avoir" && i.ref === number) }
/** every invoice with the number of the credit note that cancels it (the list says « Cancelled », offers no second one) */
export async function listWithCancels(): Promise<(Invoice & { cancelledBy?: string })[]> {
  const all = await listInvoices()
  return all.map((i) => { const c = i.kind === "avoir" ? undefined : creditNoteFor(i.number, all); return c ? { ...i, cancelledBy: c.number } : i })
}
/** why no credit note can be made for `id` ("" = it can) */
export async function avoirProblem(id: string): Promise<string> {
  const src = await getInvoice(id)
  if (!src) return "Invoice not found."
  if (src.kind === "avoir") return "A credit note can't be cancelled by another one."
  if (src.status === "draft") return "This invoice was never sent: nothing to cancel."
  const c = creditNoteFor(src.number, await listInvoices())
  return c ? `Invoice ${src.number} is already cancelled by credit note ${c.number}.` : ""
}
let avoirLock: Promise<unknown> = Promise.resolve()
export async function createAvoir(id: string, nowIso: string): Promise<Invoice | null> {
  // one at a time : two clicks (or two tabs) never make two credit notes for one invoice
  const run = avoirLock.then(() => createAvoirNow(id, nowIso))
  avoirLock = run.catch(() => null)
  return run
}
async function createAvoirNow(id: string, nowIso: string): Promise<Invoice | null> {
  if (await avoirProblem(id)) return null
  const src = (await getInvoice(id))!
  return createInvoice({
    kind: "avoir", ref: src.number,
    client: src.client, vatRate: src.vatRate,
    issueDate: nowIso.slice(0, 10), dueDate: nowIso.slice(0, 10),
    items: src.items.map((it) => ({ ...it, unitPrice: -it.unitPrice })),
    notes: `${isFrInvoice() ? `Avoir sur la facture ${src.number}.` : `Credit note for invoice ${src.number}.`}${src.notes ? " " + src.notes : ""}`,
  }, nowIso)
}

/* ── MONTANTS EN CENTIMES ENTIERS ──
   Before (floats): one invoice in five printed a Total TTC 1 cent off "Total HT + TVA", and one in eight
   had lines that did not add up to the Total HT (e.g. 2,5 × 2 438,35 + …: HT 19 371,68 + TVA 3 874,34 ≠ TTC
   23 246,01; blitz test of 24/10). Here: each line rounded to the cent (half a cent away from zero, so a credit note
   is the exact opposite of its invoice), HT = sum of the lines, TVA = HT × rate rounded to the cent, TTC = HT + TVA.
   The same rules are copied into public/billing.html (the form preview): test/cockpit/invoices.test.ts
   checks that both computations give the same result. */
/** rounds the integer n / d to the nearest, half away from zero (exact integers, no float) */
const divRound = (n: number, d: number) => (n < 0 ? -1 : 1) * Math.floor((Math.abs(n) + d / 2) / d) + 0 // + 0: never -0
/** a line's amount in cents: price entered to the cent, quantity to the thousandth (1.5 h; 0.25 day) */
export function lineCents(it: Pick<Item, "qty" | "unitPrice">): number {
  const priceCents = Math.round((Number(it.unitPrice) || 0) * 100)
  const qtyMilli = Math.round((Number(it.qty) || 0) * 1000)
  return divRound(qtyMilli * priceCents, 1000)
}
export function totalsCents(inv: Pick<Invoice, "items" | "vatRate">): { lines: number[]; ht: number; tva: number; ttc: number } {
  const lines = (inv.items || []).map(lineCents)
  const ht = lines.reduce((s, c) => s + c, 0)
  const rateBp = Math.round((Number(inv.vatRate) || 0) * 100) // 5.5 % → 550 basis points
  const tva = divRound(ht * rateBp, 10_000)
  return { lines, ht, tva, ttc: ht + tva }
}
/** totals in euros (computed in cents: HT + TVA = TTC to the cent, always) */
export function totals(inv: Pick<Invoice, "items" | "vatRate">) {
  const c = totalsCents(inv)
  return { ht: c.ht / 100, tva: c.tva / 100, ttc: c.ttc / 100 }
}

const eur = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"
const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string))
/** a payment link is only a button if it is http(s): never `javascript:` nor a broken attribute */
const safeHttpUrl = (u: string) => { try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? x.href : "" } catch { return "" } }
const nl = (s: any) => esc(s).replace(/\n/g, "<br>")

const KIND_TITLE = { facture: "FACTURE", acompte: "FACTURE D'ACOMPTE", solde: "FACTURE DE SOLDE", avoir: "AVOIR" }

// the printable INVOICE (A4, French legal notices). "Print → Save as PDF".
export function renderInvoiceHtml(inv: Invoice, rawSeller: Seller): string {
  const seller = cleanSeller(rawSeller)
  if (!isFrInvoice()) return renderInvoiceHtmlIntl(inv, seller)
  const t = totals(inv)
  const lc = totalsCents(inv).lines
  const rows = inv.items.map((it, i) => {
    return `<tr><td>${esc(it.label)}</td><td class=r>${esc(it.qty)}</td><td class=r>${eur(Number(it.unitPrice) || 0)}</td><td class=r>${eur(lc[i] / 100)}</td></tr>`
  }).join("")
  const fr = (d: string) => { const [y, m, j] = d.split("-"); return j && m && y ? `${j}/${m}/${y}` : d }
  const noVat = !(Number(inv.vatRate) > 0)
  const payUrl = safeHttpUrl(inv.paymentUrl || seller.paymentLink || "")
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(KIND_TITLE[inv.kind] || "Facture")} ${esc(inv.number)}</title>
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
${BACK}${demoAgency() ? DEMO_LINE : ""}
<div class="head">
  <div class="seller"><b>${esc(seller.name)}</b>${[seller.legal ? nl(seller.legal) : "", seller.address ? nl(seller.address) : "", seller.siret ? `SIRET ${esc(seller.siret)}` : "", seller.tva ? `TVA ${esc(seller.tva)}` : "", [seller.email, seller.phone].filter(Boolean).map(esc).join(" · ")].filter(Boolean).map((x) => "\n" + x).join("")}</div>
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
    : `<div class="pay"><b>Règlement :</b> ${seller.iban ? `par virement, IBAN ${esc(seller.iban)}${seller.bic ? " · BIC " + esc(seller.bic) : ""}. ` : seller.payment ? `${nl(seller.payment)}. ` : ""}Paiement à réception, échéance le ${fr(inv.dueDate)}.
  ${payUrl ? `<br><a class="paybtn" href="${esc(payUrl)}">Payer en ligne →</a>` : ""}</div>`}
<div class="legal">
  ${esc(seller.name)}${seller.legal ? " · " + esc(seller.legal) : ""}${seller.capital ? " · capital " + esc(seller.capital) : ""}${seller.rcs ? " · " + esc(seller.rcs) : ""}${seller.siret ? " · SIRET " + esc(seller.siret) : ""}${seller.tva ? " · TVA intracommunautaire " + esc(seller.tva) : ""}.<br>
  ${noVat ? "TVA non applicable, art. 293 B du CGI.<br>" : ""}
  En cas de retard de paiement : pénalités au taux de 3 fois le taux d'intérêt légal, exigibles sans rappel, + indemnité forfaitaire pour frais de recouvrement de 40 € (art. L441-10 et D441-5 du Code de commerce). Pas d'escompte pour paiement anticipé.
</div>
<div class="noprint" style="margin-top:30px;text-align:center"><button onclick="print()" style="padding:10px 22px;font-size:14px;border:0;border-radius:8px;background:#1a1a1a;color:#fff;cursor:pointer">Imprimer / PDF</button></div>
</body></html>`
}

/** the way back to the cockpit (never printed) and, in the demo, what this document is */
const BACK = `<div class="noprint" style="margin-bottom:24px;font-size:13px"><a href="/billing.html" style="color:#555;text-decoration:none">← Back to Billing</a></div>`
const DEMO_LINE = `<div style="margin-bottom:20px;padding:8px 12px;border:1px dashed #bbb;border-radius:8px;font-size:12px;color:#666">Demo invoice: a fictional business and a fictional client. Not a real document.</div>`

/* ── the same invoice, in English, for agencies outside France : Tax ID (EIN) instead of SIRET / VAT, no French legal mentions ── */
const KIND_TITLE_EN = { facture: "INVOICE", acompte: "DEPOSIT INVOICE", solde: "FINAL INVOICE", avoir: "CREDIT NOTE" }
export function renderInvoiceHtmlIntl(inv: Invoice, rawSeller: Seller): string {
  const seller = cleanSeller(rawSeller)
  const a = agency()
  const money = (n: number) => { try { return new Intl.NumberFormat(a.locale || "en-US", { style: "currency", currency: a.currency || "USD" }).format(n) } catch { return n.toFixed(2) } }
  const date = (d: string) => { try { return new Date(d + "T00:00:00").toLocaleDateString(a.locale || "en-US", { year: "numeric", month: "short", day: "numeric" }) } catch { return d } }
  const t = totals(inv)
  const lc = totalsCents(inv).lines
  const rows = inv.items.map((it, i) => `<tr><td>${esc(it.label)}</td><td class=r>${esc(it.qty)}</td><td class=r>${money(Number(it.unitPrice) || 0)}</td><td class=r>${money(lc[i] / 100)}</td></tr>`).join("")
  const noTax = !(Number(inv.vatRate) > 0)
  const payUrl = safeHttpUrl(inv.paymentUrl || seller.paymentLink || "")
  const taxId = seller.taxId || seller.tva || ""
  const us = String(a.country || "").toUpperCase() === "US", idLabel = us ? "EIN" : "Tax ID", taxLabel = taxDefault(a.country).label
  const status = inv.status === "paid" ? "Paid" : inv.status === "sent" ? "Sent" : "Draft"
  // « Lone Star Web Studio LLC » is not printed with « LLC » again under it
  const legal = seller.legal && !new RegExp(`\\b${String(seller.legal).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.?$`, "i").test(String(seller.name || "").trim()) ? seller.legal : ""
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(KIND_TITLE_EN[inv.kind] || "Invoice")} ${esc(inv.number)}</title>
<style>
  *{box-sizing:border-box} body{font:13px/1.5 -apple-system,system-ui,sans-serif;color:#1a1a1a;max-width:800px;margin:0 auto;padding:40px}
  .head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:36px}
  .seller b{font-size:17px} .seller,.client{white-space:pre-line;font-size:12px;color:#333}
  h1{font-size:30px;margin:0 0 4px;letter-spacing:-.5px} .meta{color:#666;font-size:12px}
  .to{margin:24px 0 28px} .to .lbl{font-size:12px;color:#999;margin-bottom:4px}
  table{width:100%;border-collapse:collapse;margin:16px 0} th{text-align:left;font-size:12px;color:#999;border-bottom:2px solid #1a1a1a;padding:8px 6px}
  td{padding:9px 6px;border-bottom:1px solid #eee} .r{text-align:right;font-variant-numeric:tabular-nums}
  .tot{margin-left:auto;width:280px;margin-top:8px} .tot div{display:flex;justify-content:space-between;padding:5px 6px}
  .tot .ttc{border-top:2px solid #1a1a1a;font-weight:700;font-size:16px;margin-top:4px}
  .legal{margin-top:36px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#777;line-height:1.6}
  .pay{margin-top:22px;font-size:12px} .status{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600}
  .draft{background:#eee;color:#666}.sent{background:#e0ecff;color:#1a56db}.paid{background:#dcfce7;color:#166534}
  .paybtn{display:inline-block;margin-top:14px;padding:12px 26px;border-radius:9px;background:#1a1a1a;color:#fff;font-weight:700;font-size:14px;text-decoration:none}
  .refline{color:#666;font-size:12px;margin-top:2px}
  @media print{body{padding:0} .noprint{display:none}}
</style></head><body>
${BACK}${demoAgency() ? DEMO_LINE : ""}
<div class="head">
  <div class="seller"><b>${esc(seller.name)}</b>${[legal ? nl(legal) : "", seller.address ? nl(seller.address) : "", taxId ? `${idLabel} ${esc(taxId)}` : "", [seller.email, seller.phone].filter(Boolean).map(esc).join(" · ")].filter(Boolean).map((x) => "\n" + x).join("")}</div>
  <div style="text-align:right">
    <h1>${esc(KIND_TITLE_EN[inv.kind] || "INVOICE")}</h1>
    <div class="meta">No. <b>${esc(inv.number)}</b><br>Date: ${date(inv.issueDate)}<br>Due: ${date(inv.dueDate)}<br><span class="status ${esc(inv.status)}">${status}</span></div>
    ${inv.kind === "avoir" && inv.ref ? `<div class="refline">cancels invoice <b>${esc(inv.ref)}</b></div>` : ""}
  </div>
</div>
<div class="to"><div class="lbl">Bill to</div><div class="client"><b>${esc(inv.client.name)}</b>\n${nl(inv.client.address || "")}${inv.client.siret ? "\nCompany no. " + esc(inv.client.siret) : ""}${inv.client.email ? "\n" + esc(inv.client.email) : ""}</div></div>
<table><thead><tr><th>Description</th><th class=r>Qty</th><th class=r>Unit price</th><th class=r>Amount</th></tr></thead><tbody>${rows || '<tr><td colspan=4 style="color:#bbb">no lines</td></tr>'}</tbody></table>
<div class="tot">
  <div><span>Subtotal</span><span>${money(t.ht)}</span></div>
  ${noTax ? "" : `<div><span>${taxLabel} (${esc(inv.vatRate)}%)</span><span>${money(t.tva)}</span></div>`}
  <div class="ttc"><span>Total</span><span>${money(t.ttc)}</span></div>
</div>
${inv.notes ? `<div class="pay"><b>Note:</b> ${nl(inv.notes)}</div>` : ""}
${inv.kind === "avoir"
    ? `<div class="pay"><b>Credit:</b> refunded or applied to your next invoice.</div>`
    : `<div class="pay"><b>Payment:</b> due ${date(inv.dueDate)}.${seller.payment ? " " + nl(seller.payment) + "." : seller.iban ? " Bank transfer: " + esc(seller.iban) + (seller.bic ? " · " + esc(seller.bic) : "") + "." : ""}
  ${payUrl ? `<br><a class="paybtn" href="${esc(payUrl)}">Pay online →</a>` : ""}</div>`}
<div class="legal">${esc(seller.name)}${legal ? " · " + esc(legal) : ""}${taxId ? ` · ${idLabel} ` + esc(taxId) : ""}. Thanks for your business.</div>
<div class="noprint" style="margin-top:30px;text-align:center"><button onclick="print()" style="padding:10px 22px;font-size:14px;border:0;border-radius:8px;background:#1a1a1a;color:#fff;cursor:pointer">Print / PDF</button></div>
</body></html>`
}
