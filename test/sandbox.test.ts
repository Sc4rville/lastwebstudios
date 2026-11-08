/**
 * G14: `npm run sandbox` sets up the FICTIONAL agency in one command, with no .env or key: embedded database (PGlite),
 * schema, cast, a story played by the real processes, cockpit; `--check` checks every view then everything stops.
 * < 90 s, nothing written outside its folder, no process left behind.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { tsx } from "./helpers/proc.ts"
import { parseArgs, readCast, storyClock, SANDBOX_MARK } from "../scripts/sandbox.ts"

test("round 3: `npm run sandbox` is the US studio and its Austin cast by default ; --country FR the French one", () => {
  const d = readCast(process.cwd())
  assert.equal(d.agency, "agency.config.example.us.json")
  assert.ok(d.prospects.some((p) => p.id === "pecanwood-pools-austin"))
  assert.equal(parseArgs([]).country, undefined, "no --country : the default (US) is applied by startSandbox")
  assert.equal(parseArgs(["--country", "fr"]).country, "FR")
  // a lead in the emails always comes from an approved site (its first email links to it) : the cast gives it one
  for (const f of ["agency.config.example.us.json", "agency.config.example.json"]) assert.ok(readCast(process.cwd(), f).prospects.find((p) => p.role === "sequence")?.site, f)
  // Billing's demo : the studio's fictional business, complete
  for (const f of ["agency.config.example.us.json", "agency.config.example.json"]) { const s = readCast(process.cwd(), f).seller!; assert.ok(s.name && s.address && /example/.test(s.email), f) }
})

test("the sandbox story's clock : working days, inside the sending hours, whatever the hour it starts", () => {
  for (const now of ["2026-11-07T23:11:00Z", "2026-11-09T06:00:00Z", "2026-11-11T13:00:00Z", "2026-11-13T22:30:00Z"]) {
    const c = storyClock("America/Chicago", Date.parse(now))
    const local = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hourCycle: "h23", weekday: "short", hour: "2-digit" }).format(Date.parse(iso))
    for (const k of ["tick0", "tick3", "tickSeq"] as const) { const w = local(c[k]); assert.match(w, /^(Mon|Tue|Wed|Thu|Fri),? (09|1[0-6])$/, `${now} ${k}: ${w}`) }
    assert.ok(c.tick0 < c.click && c.click < c.unsub && c.unsub < c.tick3 && c.tick3 < c.reply && c.reply < c.tickReply && c.tickReply <= c.tickSeq, JSON.stringify(c))
    assert.ok(Date.parse(c.tickSeq) < Date.parse(now) && Date.parse(c.meeting) > Date.parse(now), now)
    assert.ok(Date.parse(c.tick3) - Date.parse(c.tick0) >= 3 * 86400_000 - 3600_000, "day 3 is three days after day 0")
  }
})

test("cast: 8 prospects, 3 trades, every stage of the funnel, 100 % fictional", () => {
  const cast = readCast(process.cwd(), "agency.config.example.json")
  assert.ok(cast.prospects.length >= 8)
  assert.deepEqual([...new Set(cast.prospects.map((p) => p.trade))].sort(), ["cuisiniste", "menuisier", "pisciniste"])
  for (const s of ["trouvé", "noté", "en build", "en séquence", "en appel", "gagné", "perdu"]) assert.ok(cast.prospects.some((p) => p.stage === s), s)
  assert.ok(cast.prospects.filter((p) => p.site?.from && existsSync(join(p.site.from, "site", "index.html"))).length >= 2, "at least 2 sites built (real runs)")
  assert.equal(cast.agency, "agency.config.example.json")
})

test("audit round 2: a US demo studio gets a US cast (Austin businesses, 555-01xx numbers, .example domains, one per role), the French one keeps its own", () => {
  const us = readCast(process.cwd(), "agency.config.example.us.json")
  assert.equal(us.agency, "agency.config.example.us.json")
  for (const r of ["won", "lost", "call", "sequence", "build", "noted"]) assert.ok(us.prospects.some((p) => p.role === r), r)
  const dir = us.data || ""
  assert.match(dir, /^data\/sample\/us\//)
  for (const p of us.prospects) {
    const sheet = JSON.parse(readFileSync(join(dir, "prospects", `${p.id}.json`), "utf8"))
    assert.equal(sheet.identity.city, "Austin", p.id)
    if (sheet.identity.phone) assert.match(sheet.identity.phone, /^\(\d{3}\) 555-01\d\d$/, `${p.id}: a fiction number`)
    for (const v of [sheet.identity.email, sheet.existing?.url].filter(Boolean)) assert.match(String(v), /\.example\b/, `${p.id}: a reserved domain`)
  }
  // a French studio keeps the French cast
  assert.equal(readCast(process.cwd(), "agency.config.example.json").agency, "agency.config.example.json")
  assert.ok(readCast(process.cwd(), "agency.config.example.json").prospects.some((p) => p.id === "orvane-piscines-valmont-sur-lys"))
  assert.deepEqual(parseArgs(["--country", "us"]).country, "US")
  assert.throws(() => parseArgs(["--country", "ZZ"]), /US or FR|FR or US/)
})

test("options: remote database refused, --dir protected", () => {
  assert.throws(() => parseArgs(["--db", "postgres://u:p@db.example.com:5432/x"]), /this machine only/)
  assert.doesNotThrow(() => parseArgs(["--db", "postgres://lws:lws@127.0.0.1:5432/lws"]))
  assert.throws(() => parseArgs(["--nope"]), /unknown option/)
  // one folder PER RUN by default : two sandboxes of one clone never share (nor wipe) a folder
  assert.match(parseArgs([]).dir, /[/\\]\.sandbox[/\\]\d+-[a-z0-9]+$/)
})

test("a second `npm run sandbox` in the same clone is refused with the running URL, before anything is built", async () => {
  mkdirSync(".sandbox", { recursive: true })
  const before = readdirSync(".sandbox").sort()
  writeFileSync(join(".sandbox", ".running"), JSON.stringify({ pid: process.pid, url: "http://127.0.0.1:4999", dir: "elsewhere" }))
  try {
    const t0 = Date.now()
    const r = await tsx(process.cwd(), "scripts/sandbox.ts", ["--quiet"], { timeoutMs: 30_000 })
    assert.notEqual(r.code, 0)
    assert.match(r.out, /A sandbox is already running at http:\/\/127\.0\.0\.1:4999/)
    assert.deepEqual(readdirSync(".sandbox").filter((f) => f !== ".running").sort(), before.filter((f) => f !== ".running"), "no folder built, no database started")
    assert.ok(Date.now() - t0 < 20_000)
  } finally { rmSync(join(".sandbox", ".running"), { force: true }) }
})

test("a --dir used by a live sandbox is never wiped: refused with its pid", async () => {
  const d = mkdtempSync(join(tmpdir(), "lws-live-sandbox-"))
  writeFileSync(join(d, SANDBOX_MARK), "x"); writeFileSync(join(d, ".lock"), String(process.pid)); writeFileSync(join(d, "live.txt"), "a running sandbox's data")
  try {
    const r = await tsx(process.cwd(), "scripts/sandbox.ts", ["--check", "--quiet", "--dir", d], { timeoutMs: 30_000 })
    assert.notEqual(r.code, 0)
    assert.match(r.out, new RegExp(`in use by a running sandbox \\(pid ${process.pid}\\)`))
    assert.ok(existsSync(join(d, "live.txt")), "the live sandbox kept its files")
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test("a non-empty --dir that is not a sandbox is never emptied", async () => {
  const d = mkdtempSync(join(tmpdir(), "lws-notsandbox-"))
  writeFileSync(join(d, "precieux.txt"), "ne pas effacer")
  try {
    const r = await tsx(process.cwd(), "scripts/sandbox.ts", ["--check", "--dir", d], { timeoutMs: 30_000 })
    assert.notEqual(r.code, 0)
    assert.match(r.out, /is not a sandbox/)
    assert.ok(existsSync(join(d, "precieux.txt")))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test("npm run sandbox -- --check: cockpit filled (sites, compare, pipeline, call panel, email, strip, cage) in < 90 s, without .env", { timeout: 180_000 }, async () => {
  const parent = mkdtempSync(join(tmpdir(), "lws-sandbox-"))
  const dir = join(parent, "sb")
  const before = existsSync("data") ? readdirSync("data").sort() : []
  try {
    assert.equal(existsSync(".env"), false)
    const r = await tsx(process.cwd(), "scripts/sandbox.ts", ["--check", "--json", "--quiet", "--dir", dir], { timeoutMs: 170_000 })
    assert.equal(r.code, 0, r.out.slice(-3000))
    const rep = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")))
    assert.ok(rep.ok, JSON.stringify(rep.checks, null, 1))
    assert.ok(rep.ms < 90_000, `${rep.ms} ms`)
    const views = rep.checks.map((c: any) => c.view)
    for (const v of ["rail (built sites)", "prospects page (found, why picked, good fit, status)", "automatic toggle", "find prospects (brief understood, job queued)", "brief: « surprise me » → a mix of trades", "jobs strip (built-in engine)", "settings (agency, which AI, hands-off pending, clients won)", "unknown /api/* → JSON 404", "gibberish brief → no job, a hint", "outreach (kanban)", "outreach (to call)", "call panel (phone, script, insights)", "outreach (steps)", "after approval (automation)", "email tab (sequences, dry-run)", "cage sheet (STOP, today's builds, breaker)", "outreach (in the emails)", "a business in the emails is in outreach, never new", "old sites open locally (no dead .example link)", "the written email reads in full (subject, body, footer)", "page /", "page /billing.html", "old /outreach/ link → /#pipeline"]) assert.ok(views.includes(v), v)
    assert.ok(views.filter((v: string) => v.startsWith("compare ")).length >= 2)
    // everything stayed in the sandbox's folder; the repository (here the test workspace) received nothing
    assert.ok(existsSync(join(dir, SANDBOX_MARK)))
    assert.ok(readdirSync(join(dir, "data/sequencer/outbox")).length >= 4, "each dry-run email is an .eml")
    assert.equal(existsSync(join(dir, "data/sequencer/transport.jsonl")), false, "no call to the mail transport")
    assert.deepEqual(existsSync("data") ? readdirSync("data").sort() : [], before)
    // no process left: the cockpit no longer answers
    await assert.rejects(fetch(rep.url + "/api/run", { signal: AbortSignal.timeout(3000) }))
  } finally { rmSync(parent, { recursive: true, force: true }) }
})
