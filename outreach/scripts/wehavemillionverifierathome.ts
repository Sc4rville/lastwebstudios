/**
 * wehavemillionverifierathome.ts · a poor man's email verifier, the SERIOUS version.
 *
 * Does what a paid MillionVerifier does, for free (needs outbound port 25 open):
 *   1. syntax             2. likely typo (gmial→gmail…)           3. disposable domain
 *   4. the domain's MX    5. SMTP RCPT TO probe (does the MAILBOX exist?)
 *   6. catch-all detection (a domain that accepts everything → unreliable)   7. greylisting → "unknown"
 *
 * Categories (like the real tools): valid · invalid · catch-all · unknown · disposable · role · dupe.
 * Send to "valid" with confidence; "catch-all"/"unknown" = small batches + monitoring; drop "invalid".
 * It never sends DATA (no email is sent) → no nuisance. Source: the emails in `data/prospects/*.json`.
 *
 * Usage: npx tsx outreach/scripts/wehavemillionverifierathome.ts
 *   → outreach/sequencer/verified-emails.json (the valid ones) + verified-report.json (everything, categorised).
 */
import { readdir, readFile, writeFile } from "node:fs/promises"
import { resolveMx } from "node:dns/promises"
import net from "node:net"
import { agency } from "../../packages/shared/agency.mjs"

const DIR = "data/prospects"
const OUT = process.env.VERIFY_OUT || "outreach/sequencer/verified-emails.json"
const REPORT = process.env.VERIFY_REPORT || "outreach/sequencer/verified-report.json"
// HELO = the agency's domain (agency.config.json › mail.heloDomain), VERIFY_HELO to force it
const HELO = process.env.VERIFY_HELO || agency().mail.heloDomain
const FROM = `verify@${HELO}`

const SYNTAX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const DISPOSABLE = new Set(["mailinator.com", "yopmail.com", "tempmail.com", "guerrillamail.com", "10minutemail.com", "trashmail.com", "getnada.com", "temp-mail.org", "sharklasers.com"])
const ROLE = new Set(["contact", "info", "admin", "hello", "bonjour", "commercial", "sav", "support", "accueil", "secretariat", "direction"])
const PROVIDERS = ["gmail.com", "hotmail.com", "hotmail.fr", "outlook.com", "outlook.fr", "yahoo.com", "yahoo.fr", "orange.fr", "free.fr", "wanadoo.fr", "sfr.fr", "laposte.net", "live.fr", "icloud.com"]

function lev1(a: string, b: string): boolean {
  if (a === b) return false
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0, j = 0, edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (a.length < b.length) j++
    else { i++; j++ }
  }
  return edits + (a.length - i) + (b.length - j) === 1
}
function typoSuggest(domain: string): string | null {
  for (const p of PROVIDERS) if (lev1(domain, p)) return p
  return null
}

const mxCache = new Map<string, string | null>()
async function mxHost(domain: string): Promise<string | null> {
  if (mxCache.has(domain)) return mxCache.get(domain)!
  let host: string | null = null
  try {
    const mx = await resolveMx(domain)
    if (mx.length) host = mx.sort((a, b) => a.priority - b.priority)[0].exchange
  } catch { /* no MX */ }
  mxCache.set(domain, host)
  return host
}

// one SMTP session per domain: probes [random address (catch-all), ...targets] → reply codes.
function smtpSession(host: string, rcpts: string[], timeoutMs = 12000): Promise<number[]> {
  return new Promise((resolve) => {
    const codes: number[] = []
    const sock = net.createConnection({ host, port: 25 })
    sock.setTimeout(timeoutMs)
    let buf = "", stage = 0, idx = 0, settled = false
    const finish = () => { if (settled) return; settled = true; try { sock.destroy() } catch { }; while (codes.length < rcpts.length) codes.push(0); resolve(codes) }
    const send = (l: string) => { try { sock.write(l + "\r\n") } catch { finish() } }
    const finalCode = (b: string): number | null => {
      if (!/\r?\n$/.test(b)) return null
      const lines = b.split(/\r?\n/).filter(Boolean)
      const m = lines[lines.length - 1]?.match(/^(\d{3}) /)
      return m ? parseInt(m[1], 10) : null
    }
    sock.on("data", (d) => {
      buf += d.toString()
      const code = finalCode(buf)
      if (code == null) return
      buf = ""
      if (stage === 0) { if (code !== 220) return finish(); send(`EHLO ${HELO}`); stage = 1; return }
      if (stage === 1) { if (code >= 400) return finish(); send(`MAIL FROM:<${FROM}>`); stage = 2; return }
      if (stage === 2) { if (code >= 400) return finish(); send(`RCPT TO:<${rcpts[0]}>`); stage = 3; return }
      codes.push(code); idx++
      if (idx < rcpts.length) return send(`RCPT TO:<${rcpts[idx]}>`)
      send("QUIT"); finish()
    })
    sock.on("timeout", finish)
    sock.on("error", finish)
    sock.on("close", finish)
  })
}

type Rec = { id: string; email: string; category: string; note?: string }

// ---- collecting the emails ----
// source: a raw CSV (VERIFY_CSV=path, columns ...,email last) OR the data/prospects/ records (default).
const recs: Rec[] = []
const seen = new Set<string>()
const byDomain = new Map<string, Rec[]>()

const sources: { id: string; email: string }[] = []
if (process.env.VERIFY_CSV) {
  const rows = (await readFile(process.env.VERIFY_CSV, "utf8")).split("\n").slice(1).filter(Boolean)
  for (const ln of rows) {
    const em = ln.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i) // robust extraction (names may contain commas)
    if (!em) continue
    sources.push({ id: ln.split(",")[0].trim() || em[0], email: em[0].trim().toLowerCase() })
  }
} else {
  const files = (await readdir(DIR)).filter((f) => f.endsWith(".json"))
  for (const f of files) {
    const raw = await readFile(`${DIR}/${f}`, "utf8")
    const m = raw.match(/"email"\s*:\s*"([^"]+)"/i)
    if (!m) continue
    const id = (() => { try { return JSON.parse(raw).id } catch { return f.replace(".json", "") } })()
    sources.push({ id, email: m[1].trim().toLowerCase() })
  }
}

for (const { id, email } of sources) {
  const r: Rec = { id, email, category: "" }
  if (!SYNTAX.test(email)) { r.category = "bad-syntax"; recs.push(r); continue }
  if (seen.has(email)) { r.category = "dupe"; recs.push(r); continue }
  seen.add(email)
  const [local, domain] = email.split("@")
  const t = typoSuggest(domain); if (t) r.note = `typo ? → ${local}@${t}`
  if (DISPOSABLE.has(domain)) { r.category = "disposable"; recs.push(r); continue }
  if (ROLE.has(local)) r.note = (r.note ? r.note + " · " : "") + "role"
  recs.push(r)
  if (!byDomain.has(domain)) byDomain.set(domain, [])
  byDomain.get(domain)!.push(r)
}

// ---- check by domain (MX + SMTP), concurrently ----
const domains = [...byDomain.keys()]
const CONC = 12
let di = 0
async function worker() {
  while (di < domains.length) {
    const domain = domains[di++]
    const rs = byDomain.get(domain)!
    const host = await mxHost(domain)
    if (!host) { for (const r of rs) r.category = "no-mx"; continue }
    const rnd = `x${Math.floor(Date.now() % 1e6)}zzq${rs.length}@${domain}` // an address that almost surely does not exist
    const codes = await smtpSession(host, [rnd, ...rs.map((r) => r.email)])
    const catchAll = codes[0] === 250 || codes[0] === 251
    rs.forEach((r, i) => {
      const c = codes[i + 1] ?? 0
      if (catchAll) r.category = "catch-all"
      else if (c === 250 || c === 251) r.category = "valid"
      else if (c >= 500 && c < 560) r.category = "invalid"
      else r.category = "unknown" // greylist 4xx, timeout(0), refus probe…
    })
  }
}
await Promise.all(Array.from({ length: CONC }, worker))

// ---- output ----
const by = (cat: string) => recs.filter((r) => r.category === cat)
const valid = by("valid")
await writeFile(OUT, JSON.stringify(valid.map(({ id, email }) => ({ id, email })), null, 2))
await writeFile(REPORT, JSON.stringify(recs, null, 2))

const line = (cat: string, label: string) => `  ${label.padEnd(22)} ${by(cat).length}`
console.log("wehavemillionverifierathome · report (real SMTP)")
console.log(`  unique emails tested   ${seen.size}`)
console.log(line("valid", "✓ valid (to send)"))
console.log(line("catch-all", "~ catch-all (set aside)"))
console.log(line("unknown", "~ unknown/greylist"))
console.log(line("invalid", "✗ invalid (dropped)"))
console.log(line("no-mx", "✗ no MX"))
console.log(line("disposable", "✗ disposable"))
console.log(line("bad-syntax", "✗ syntax"))
console.log(line("dupe", "· duplicates"))
const roles = recs.filter((r) => r.note?.includes("role")).length
const typos = recs.filter((r) => r.note?.includes("typo")).length
console.log(`  (of which role: ${roles} · suspected typos: ${typos})`)
console.log(`  → ${OUT} (the valid ones)  +  ${REPORT} (everything, categorised)`)
const inv = by("invalid").concat(by("no-mx"))
if (inv.length) console.log(`  dropped: ${inv.slice(0, 12).map((r) => r.email).join(", ")}${inv.length > 12 ? "…" : ""}`)
