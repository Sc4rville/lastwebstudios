/**
 * G11 / G12 · THE 24/7 MACHINE'S TIMERS (architecture/scheduling/) and the run-guarded.sh wrapper.
 *
 *   · units without any hard-coded path (%h/lws), the sequencer and the nightly learning provided (NOT installed),
 *     each timer has its service, valid OnCalendar (systemd-analyze, when present), Persistent=true;
 *   · the failure alert exists under its REAL name (`lws-alert@.service`: the file used to be called « [email protected] »,
 *     eaten by an email protection, so OnFailure= found nothing);
 *   · the 2nd key of real sending (LWS_LIVE_SEND=1) is commented out in the sequencer's unit (fail-closed);
 *   · run-guarded.sh: repo derived from its location, exit code passed on, last-<job>.json state, anti-overlap
 *     lock, and THE CAGE: STOP (file, or the cockpit's flag through `npm run cage -- check`) ⇒ the
 *     job does not start;
 *   · `npm run cage`: status, stop, check (exit 3), resume.
 */
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { chmodSync, existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { makeWorkspace, type Workspace } from "../helpers/workspace.ts"
import { run, npmRun } from "../helpers/proc.ts"

const DIR = "architecture/scheduling"
const units = readdirSync(DIR).filter((f) => /\.(service|timer)$/.test(f))
const unitFiles = [...units.map((f) => join(DIR, f)), ...readdirSync("worker").filter((f) => /\.(service|timer)$/.test(f)).map((f) => join("worker", f)), "backoffice/reviewpipe/lws-cockpit.service"]
const read = (f: string) => readFileSync(f, "utf8")
const directive = (txt: string, k: string) => txt.split("\n").filter((l) => l.startsWith(`${k}=`)).map((l) => l.slice(k.length + 1).trim())
const HAS_SYSTEMD = spawnSync("systemd-analyze", ["--version"], { encoding: "utf8" }).status === 0

describe("the machine's systemd units (architecture/scheduling/, worker/)", () => {
  test("no hard-coded path: neither /home/… nor /root/…; the repo is %h/lws", () => {
    for (const f of unitFiles) {
      const t = read(f).split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n")
      assert.doesNotMatch(t, /\/home\/|\/root\//, `${f} carries a hard-coded path`)
      for (const d of [...directive(t, "WorkingDirectory"), ...directive(t, "ExecStart")]) {
        if (d.includes("lws")) assert.match(d, /%h\/lws/, `${f} : ${d}`)
      }
    }
    assert.doesNotMatch(read(join(DIR, "run-guarded.sh")), /^REPO="\/home\b/m)
  })

  test("the sequencer and the nightly learning are provided, each timer has its service, timers catch up (Persistent)", () => {
    // pipeline and review = the template-fill path, absent from the open source edition: checked only when shipped
    const jobs = ["sequencer", "learn", "scrape", "warmup", "batch", ...["pipeline", "review"].filter((j) => units.includes(`lws-${j}.service`))]
    for (const j of jobs) {
      assert.ok(units.includes(`lws-${j}.service`) && units.includes(`lws-${j}.timer`), `lws-${j}.{service,timer}`)
      const svc = read(join(DIR, `lws-${j}.service`)), tim = read(join(DIR, `lws-${j}.timer`))
      assert.deepEqual(directive(svc, "Type"), ["oneshot"])
      assert.match(directive(svc, "ExecStart")[0], new RegExp(`^%h/lws/architecture/scheduling/run-guarded\\.sh ${j} `))
      assert.deepEqual(directive(svc, "OnFailure"), ["lws-alert@%n.service"])
      assert.deepEqual(directive(tim, "Persistent"), ["true"])
      assert.equal(directive(tim, "OnCalendar").length, 1)
    }
    assert.match(directive(read(join(DIR, "lws-sequencer.service")), "ExecStart")[0], /run-guarded\.sh sequencer sequencer tick$/)
    assert.match(directive(read(join(DIR, "lws-learn.service")), "ExecStart")[0], /run-guarded\.sh learn learn$/)
  })

  test("the failure alert exists under its real name (OnFailure=lws-alert@%n.service finds it)", () => {
    assert.ok(existsSync(join(DIR, "lws-alert@.service")), "lws-alert@.service")
    assert.deepEqual(readdirSync(DIR).filter((f) => /protected/.test(f)), [], "no more « [email protected] » file")
    assert.match(read(join(DIR, "lws-alert@.service")), /%h\/lws\/data\/logs/)
    assert.doesNotMatch(read(join(DIR, "cron.md")), /email protected/)
  })

  test("real sending: LWS_LIVE_SEND=1 is COMMENTED OUT in the units that send (sequencer, warmup)", () => {
    for (const u of ["lws-sequencer.service", "lws-warmup.service"]) {
      const svc = read(join(DIR, u))
      assert.deepEqual(directive(svc, "Environment").filter((e) => !e.startsWith("PATH=")), [], `${u}: no active variable besides PATH`)
      assert.match(svc, /^#Environment=LWS_LIVE_SEND=1$/m, u)
    }
    for (const f of unitFiles) assert.doesNotMatch(read(f), /^Environment=.*LWS_LIVE_SEND/m, f)
  })

  test("the services' PATH: ~/.local/bin first (a native Claude Code install), then the system folders", () => {
    for (const f of unitFiles.filter((f) => f.endsWith(".service") && !/lws-alert@|lws-sync/.test(f))) {
      assert.deepEqual(directive(read(f), "Environment").filter((e) => e.startsWith("PATH=")), ["PATH=%h/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"], f)
    }
  })

  test("nightly batch and scrape set through .env (LWS_BATCH_SIZE, LWS_BATCH_ARGS, LWS_SCRAPE_ARGS), defaults in the unit", () => {
    const b = read(join(DIR, "lws-batch.service")), s = read(join(DIR, "lws-scrape.service"))
    assert.match(directive(b, "ExecStart")[0], /run-guarded\.sh batch batch composer \$LWS_BATCH_SIZE \$LWS_BATCH_ARGS$/)
    assert.deepEqual(directive(b, "Environment").slice(0, 2), ["LWS_BATCH_SIZE=5", "LWS_BATCH_ARGS="])
    // EnvironmentFile AFTER the defaults: the .env wins (systemd.exec: EnvironmentFile= overrides Environment=)
    assert.ok(b.indexOf("EnvironmentFile=") > b.indexOf("Environment=LWS_BATCH_ARGS="))
    assert.match(directive(s, "ExecStart")[0], /run-guarded\.sh scrape scrape \$LWS_SCRAPE_ARGS$/)
    assert.match(s, /^Environment="LWS_SCRAPE_ARGS=cuisiniste all"$/m)
  })

  test("the alert can leave the box (LWS_ALERT_URL): text POST, nothing without the variable, `$$` escaped for systemd", async () => {
    const t = read(join(DIR, "lws-alert@.service"))
    const cmd = /^ExecStart=\/usr\/bin\/env bash -c '(.*)'$/m.exec(t)?.[1]
    assert.ok(cmd)
    assert.doesNotMatch(cmd.replace(/\$\$/g, ""), /\$/, "each $ is doubled: bash reads the variables")
    const ws = makeWorkspace()
    try {
      const curl = ws.write("bin/curl", `#!/usr/bin/env bash\necho "$*" >> "${ws.path("curl.log")}"\n`); chmodSync(curl, 0o755)
      const ns = ws.write("bin/notify-send", "#!/usr/bin/env bash\nexit 0\n"); chmodSync(ns, 0o755) // never a real desktop notification during the tests
      const script = cmd.replace(/\$\$/g, "$").replace(/%h\/lws/g, ws.dir).replace(/%i/g, "lws-sequencer.service")
      const env = { PATH: `${ws.path("bin")}:/usr/bin:/bin` }
      assert.equal((await run("bash", ["-c", script], { cwd: ws.dir, env, timeoutMs: 15_000 })).code, 0)
      assert.match(ws.read("data/logs/ALERT.log"), /FAILED lws-sequencer\.service/)
      assert.equal(ws.exists("curl.log"), false, "without LWS_ALERT_URL, nothing leaves")
      assert.equal((await run("bash", ["-c", script], { cwd: ws.dir, env: { ...env, LWS_ALERT_URL: "https://ntfy.example/sujet" }, timeoutMs: 15_000 })).code, 0)
      assert.match(ws.read("curl.log"), /--data-raw FAILED lws-sequencer\.service on .* https:\/\/ntfy\.example\/sujet/)
    } finally { ws.cleanup() }
  })

  test("valid OnCalendar (systemd-analyze calendar): 01:30 Paris for the learning, office hours for the sequencer", { skip: !HAS_SYSTEMD && "systemd-analyze missing" }, () => {
    for (const f of units.filter((u) => u.endsWith(".timer"))) {
      for (const cal of directive(read(join(DIR, f)), "OnCalendar")) {
        const r = spawnSync("systemd-analyze", ["calendar", cal], { encoding: "utf8" })
        assert.equal(r.status, 0, `${f} : « ${cal} » ${r.stderr}`)
      }
    }
    const next = spawnSync("systemd-analyze", ["calendar", "--iterations=6", directive(read(join(DIR, "lws-sequencer.timer")), "OnCalendar")[0]], { encoding: "utf8" }).stdout
    assert.doesNotMatch(next, /\b(Sat|Sun)\b/, "never at the weekend")
  })
})

/** A fake npm: logs each call (cwd + args), answers 3 to `cage check` when FAKE_CAGE=3, otherwise FAKE_CODE. */
function fakeNpm(ws: Workspace): string {
  const p = ws.write("bin/npm", `#!/usr/bin/env bash
echo "$PWD|$*" >> "$FAKE_LOG"
case "$*" in *"cage -- check"*) exit "\${FAKE_CAGE:-0}";; esac
sleep "\${FAKE_SLEEP:-0}"
echo "job output"
exit "\${FAKE_CODE:-0}"
`)
  chmodSync(p, 0o755)
  return p
}

describe("install-units.sh (installing the 24/7 machine's units)", () => {
  const fake = (ws: Workspace, name: string, body: string) => { const p = ws.write(`bin/${name}`, `#!/usr/bin/env bash\n${body}\n`); chmodSync(p, 0o755); return p }
  const install = (ws: Workspace, args: string[], env: Record<string, string> = {}) =>
    run("bash", [ws.path(DIR, "install-units.sh"), ...args], { cwd: ws.dir, env: { LWS_UNIT_DIR: ws.path("units"), SYSTEMCTL: fake(ws, "systemctl", `echo "$*" >> "${ws.path("systemctl.log")}"`), LOGINCTL: fake(ws, "loginctl", "echo Linger=yes"), ...env }, timeoutMs: 30_000 })

  test("installs every shipped unit (not lws-sync, the team's own), enables only the groups asked for", async () => {
    const ws = makeWorkspace()
    try {
      const r = await install(ws, ["--enable", "core", "--enable", "warmup"])
      assert.equal(r.code, 0, r.out)
      const got = readdirSync(ws.path("units")).sort()
      assert.ok(got.includes("lws-worker.service") && got.includes("lws-cockpit.service") && got.includes("lws-batch.timer") && got.includes("lws-alert@.service"))
      assert.ok(!got.some((u) => u.startsWith("lws-sync")), "lws-sync stays with the team")
      assert.deepEqual(ws.read("systemctl.log").trim().split("\n"), ["--user daemon-reload", "--user enable --now lws-worker.service", "--user enable --now lws-cockpit.service", "--user enable --now lws-learn.timer", "--user enable --now lws-warmup.timer"])
      assert.match(r.stdout, /lws-warmup\.timer: in DRY-RUN/)
      assert.doesNotMatch(r.stdout, /linger missing/)
      const r2 = await install(ws, [])
      assert.equal(r2.code, 0, r2.out)
      assert.match(r2.stdout, /nothing is enabled/)
    } finally { ws.cleanup() }
  })

  test("--dry-run touches nothing; unknown group = 64; root refused (77); missing linger flagged", async () => {
    const ws = makeWorkspace()
    try {
      const d = await install(ws, ["--dry-run", "--enable", "outreach"])
      assert.equal(d.code, 0, d.out)
      assert.equal(ws.exists("units"), false)
      assert.equal(ws.exists("systemctl.log"), false)
      assert.match(d.stdout, /\(dry-run\) systemctl --user enable --now lws-sequencer\.timer|\(dry-run\) .*systemctl --user enable --now lws-sequencer\.timer/)
      assert.equal((await install(ws, ["--enable", "tout"])).code, 64)
      fake(ws, "id", `[ "$1" = "-u" ] && echo 0 || echo root`)
      const root = await install(ws, ["--enable", "core"], { PATH: `${ws.path("bin")}:${process.env.PATH}` })
      assert.equal(root.code, 77, root.out)
      assert.match(root.stderr, /dedicated user/)
      const nl = await install(ws, [], { LOGINCTL: fake(ws, "loginctl2", "echo Linger=no") })
      assert.match(nl.stdout, /linger missing/)
    } finally { ws.cleanup() }
  })
})

describe("run-guarded.sh (the wrapper of every timer)", () => {
  const guarded = (ws: Workspace, args: string[], env: Record<string, string> = {}) =>
    run("bash", [ws.path(DIR, "run-guarded.sh"), ...args], { cwd: "/", env: { NPM_BIN: ws.path("bin/npm"), FAKE_LOG: ws.path("calls.log"), LWS_LOCK_DIR: ws.dir, ...env }, timeoutMs: 30_000 })
  const calls = (ws: Workspace) => (ws.exists("calls.log") ? ws.read("calls.log").trim().split("\n") : [])

  test("repo derived from the script's location (started from /), code passed on, last-<job>.json state", async () => {
    const ws = makeWorkspace()
    try {
      fakeNpm(ws)
      const job = `t-${randomUUID().slice(0, 8)}`
      const r = await guarded(ws, [job, "sequencer", "tick"], { FAKE_CODE: "5" })
      assert.equal(r.code, 5, r.out)
      const c = calls(ws)
      assert.deepEqual(c.map((l) => l.split("|")[0]), [ws.dir, ws.dir], "cage check then the job, in the repo")
      assert.equal(c[1].split("|")[1], "run sequencer -- tick")
      const last = ws.json<any>(`data/logs/last-${job}.json`)
      assert.equal(last.exit, 5); assert.equal(last.job, job); assert.equal(last.skipped, undefined)
      assert.match(ws.read(last.log), /job output/)
    } finally { ws.cleanup() }
  })

  test("STOP (file): the job does not start, npm is not even called; \"skipped\" in the state", async () => {
    const ws = makeWorkspace()
    try {
      fakeNpm(ws)
      ws.write("STOP", "incident délivrabilité\n")
      const job = `t-${randomUUID().slice(0, 8)}`
      const r = await guarded(ws, [job, "pipeline"])
      assert.equal(r.code, 0)
      assert.deepEqual(calls(ws), [])
      const last = ws.json<any>(`data/logs/last-${job}.json`)
      assert.deepEqual([last.exit, last.skipped], [0, "STOP"])
      assert.match(ws.read(last.log), /⏹ .* skipped: STOP file/)
    } finally { ws.cleanup() }
  })

  test("the cockpit's STOP (cage check = 3): the job does not start; unreadable check: the job starts anyway", async () => {
    const ws = makeWorkspace()
    try {
      fakeNpm(ws)
      const job = `t-${randomUUID().slice(0, 8)}`
      assert.equal((await guarded(ws, [job, "review:batch"], { FAKE_CAGE: "3" })).code, 0)
      assert.deepEqual(calls(ws).map((l) => l.split("|")[1]), ["run --silent cage -- check"])
      assert.equal(ws.json<any>(`data/logs/last-${job}.json`).skipped, "STOP")
      assert.equal((await guarded(ws, [job, "review:batch"], { FAKE_CAGE: "1" })).code, 0)
      assert.equal(calls(ws).at(-1)!.split("|")[1], "run review:batch --")
      assert.match(ws.read(ws.json<any>(`data/logs/last-${job}.json`).log), /cage check unreadable \(exit 1\)/)
    } finally { ws.cleanup() }
  })

  test("lock: a 2nd run of the same job during the 1st is skipped cleanly (no overlap)", async () => {
    const ws = makeWorkspace()
    try {
      fakeNpm(ws)
      const job = `t-${randomUUID().slice(0, 8)}`
      const first = guarded(ws, [job, "learn"], { FAKE_SLEEP: "2" })
      await new Promise((r) => setTimeout(r, 700))
      const second = await guarded(ws, [job, "learn"])
      assert.equal(second.code, 0)
      assert.equal((await first).code, 0)
      assert.equal(calls(ws).filter((l) => l.endsWith("run learn --")).length, 1)
      assert.match(ws.read(`data/logs/${job}-${new Date().toLocaleDateString("sv-SE")}.log`), /already running \(lock\)/) // local date, like `date +%F`
    } finally { ws.cleanup() }
  })
})

test("npm run cage: state, stop (file without a database), check = 3, resume", { timeout: 90_000 }, async () => {
  const ws = makeWorkspace()
  try {
    const s0 = await npmRun(ws.dir, "cage")
    assert.equal(s0.code, 0, s0.out)
    assert.match(s0.stdout, /✓ all calm/)
    // round 3 : plain words, no « dry-run » next to its twin ; today's builds against the daily cap
    assert.match(s0.stdout, /email sending\s+test mode: nothing goes out \(two switches turn it on: README › The cage\)/)
    assert.match(s0.stdout, /builds today\s+0 · no daily cap \(set LWS_BUILDS_PER_DAY\)/)
    assert.equal((await npmRun(ws.dir, "cage", ["check"])).code, 0)
    const stop = await npmRun(ws.dir, "cage", ["stop", "test", "de", "la", "cage"])
    assert.equal(stop.code, 0, stop.out)
    assert.equal(ws.read("STOP").trim(), "test de la cage")
    const chk = await npmRun(ws.dir, "cage", ["check"])
    assert.equal(chk.code, 3)
    assert.match(chk.stdout, /⏹ STOP \(STOP file : test de la cage\)/)
    // no reason given on the command line : it says so, never « from the cockpit »
    assert.equal((await npmRun(ws.dir, "cage", ["resume"])).code, 0)
    assert.equal((await npmRun(ws.dir, "cage", ["stop"])).code, 0)
    assert.equal(ws.read("STOP").trim(), "Stopped from the command line")
    const j = JSON.parse((await npmRun(ws.dir, "cage", ["--json"])).stdout)
    assert.deepEqual([j.stop.on, j.alerts], [true, ["stop"]])
    assert.equal((await npmRun(ws.dir, "cage", ["resume"])).code, 0)
    assert.equal(ws.exists("STOP"), false)
    assert.equal((await npmRun(ws.dir, "cage", ["oups"])).code, 1)
  } finally { ws.cleanup() }
})
