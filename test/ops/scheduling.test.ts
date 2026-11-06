/**
 * G11 / G12 · LES TIMERS DE LA MACHINE 24/7 (architecture/scheduling/) et le wrapper run-guarded.sh.
 *
 *   · unités sans aucun chemin en dur (%h/lws), le séquenceur et le learning de nuit fournis (NON installés),
 *     chaque timer a son service, OnCalendar valide (systemd-analyze, si présent), Persistent=true ;
 *   · l'alerte d'échec existe sous son VRAI nom (`lws-alert@.service` : le fichier s'appelait « [email protected] »,
 *     mangé par une protection d'e-mails, donc OnFailure= ne trouvait rien) ;
 *   · la 2e clé de l'envoi réel (LWS_LIVE_SEND=1) est commentée dans l'unité du séquenceur (fail-closed) ;
 *   · run-guarded.sh : dépôt déduit de son emplacement, code de sortie relayé, état last-<job>.json, verrou
 *     anti-chevauchement, et LA CAGE : STOP (fichier, ou drapeau du cockpit via `npm run cage -- check`) ⇒ le
 *     job ne part pas ;
 *   · `npm run cage` : status, stop, check (exit 3), resume.
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

describe("unités systemd de la machine (architecture/scheduling/, worker/)", () => {
  test("aucun chemin en dur : ni /home/…, ni /root/… ; le dépôt est %h/lws", () => {
    for (const f of unitFiles) {
      const t = read(f).split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n")
      assert.doesNotMatch(t, /\/home\/|\/root\//, `${f} porte un chemin en dur`)
      for (const d of [...directive(t, "WorkingDirectory"), ...directive(t, "ExecStart")]) {
        if (d.includes("lws")) assert.match(d, /%h\/lws/, `${f} : ${d}`)
      }
    }
    assert.doesNotMatch(read(join(DIR, "run-guarded.sh")), /^REPO="\/home\b/m)
  })

  test("le séquenceur et le learning de nuit sont fournis, chaque timer a son service, timers rattrapés (Persistent)", () => {
    // pipeline et review = voie template-fill, absente de l'édition open source : vérifiées seulement si livrées
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

  test("l'alerte d'échec existe sous son vrai nom (OnFailure=lws-alert@%n.service la trouve)", () => {
    assert.ok(existsSync(join(DIR, "lws-alert@.service")), "lws-alert@.service")
    assert.deepEqual(readdirSync(DIR).filter((f) => /protected/.test(f)), [], "plus de fichier « [email protected] »")
    assert.match(read(join(DIR, "lws-alert@.service")), /%h\/lws\/data\/logs/)
    assert.doesNotMatch(read(join(DIR, "cron.md")), /email protected/)
  })

  test("envoi réel : LWS_LIVE_SEND=1 est COMMENTÉ dans les unités qui envoient (séquenceur, warmup)", () => {
    for (const u of ["lws-sequencer.service", "lws-warmup.service"]) {
      const svc = read(join(DIR, u))
      assert.deepEqual(directive(svc, "Environment").filter((e) => !e.startsWith("PATH=")), [], `${u} : aucune variable active hors PATH`)
      assert.match(svc, /^#Environment=LWS_LIVE_SEND=1$/m, u)
    }
    for (const f of unitFiles) assert.doesNotMatch(read(f), /^Environment=.*LWS_LIVE_SEND/m, f)
  })

  test("PATH des services : ~/.local/bin d'abord (Claude Code en installation native), puis les dossiers système", () => {
    for (const f of unitFiles.filter((f) => f.endsWith(".service") && !/lws-alert@|lws-sync/.test(f))) {
      assert.deepEqual(directive(read(f), "Environment").filter((e) => e.startsWith("PATH=")), ["PATH=%h/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"], f)
    }
  })

  test("batch de nuit et scrape réglables par .env (LWS_BATCH_SIZE, LWS_BATCH_ARGS, LWS_SCRAPE_ARGS), défauts dans l'unité", () => {
    const b = read(join(DIR, "lws-batch.service")), s = read(join(DIR, "lws-scrape.service"))
    assert.match(directive(b, "ExecStart")[0], /run-guarded\.sh batch batch composer \$LWS_BATCH_SIZE \$LWS_BATCH_ARGS$/)
    assert.deepEqual(directive(b, "Environment").slice(0, 2), ["LWS_BATCH_SIZE=5", "LWS_BATCH_ARGS="])
    // EnvironmentFile APRÈS les défauts : le .env l'emporte (systemd.exec : EnvironmentFile= surcharge Environment=)
    assert.ok(b.indexOf("EnvironmentFile=") > b.indexOf("Environment=LWS_BATCH_ARGS="))
    assert.match(directive(s, "ExecStart")[0], /run-guarded\.sh scrape scrape \$LWS_SCRAPE_ARGS$/)
    assert.match(s, /^Environment="LWS_SCRAPE_ARGS=cuisiniste all"$/m)
  })

  test("l'alerte peut sortir de la box (LWS_ALERT_URL) : POST texte, rien sans la variable, `$$` échappés pour systemd", async () => {
    const t = read(join(DIR, "lws-alert@.service"))
    const cmd = /^ExecStart=\/usr\/bin\/env bash -c '(.*)'$/m.exec(t)?.[1]
    assert.ok(cmd)
    assert.doesNotMatch(cmd.replace(/\$\$/g, ""), /\$/, "chaque $ est doublé : c'est bash qui lit les variables")
    const ws = makeWorkspace()
    try {
      const curl = ws.write("bin/curl", `#!/usr/bin/env bash\necho "$*" >> "${ws.path("curl.log")}"\n`); chmodSync(curl, 0o755)
      const ns = ws.write("bin/notify-send", "#!/usr/bin/env bash\nexit 0\n"); chmodSync(ns, 0o755) // jamais de vraie notification de bureau pendant les tests
      const script = cmd.replace(/\$\$/g, "$").replace(/%h\/lws/g, ws.dir).replace(/%i/g, "lws-sequencer.service")
      const env = { PATH: `${ws.path("bin")}:/usr/bin:/bin` }
      assert.equal((await run("bash", ["-c", script], { cwd: ws.dir, env, timeoutMs: 15_000 })).code, 0)
      assert.match(ws.read("data/logs/ALERT.log"), /ÉCHEC lws-sequencer\.service/)
      assert.equal(ws.exists("curl.log"), false, "sans LWS_ALERT_URL, rien ne sort")
      assert.equal((await run("bash", ["-c", script], { cwd: ws.dir, env: { ...env, LWS_ALERT_URL: "https://ntfy.example/sujet" }, timeoutMs: 15_000 })).code, 0)
      assert.match(ws.read("curl.log"), /--data-raw ÉCHEC lws-sequencer\.service sur .* https:\/\/ntfy\.example\/sujet/)
    } finally { ws.cleanup() }
  })

  test("OnCalendar valides (systemd-analyze calendar) : 01:30 Paris pour le learning, heures de bureau pour le séquenceur", { skip: !HAS_SYSTEMD && "systemd-analyze absent" }, () => {
    for (const f of units.filter((u) => u.endsWith(".timer"))) {
      for (const cal of directive(read(join(DIR, f)), "OnCalendar")) {
        const r = spawnSync("systemd-analyze", ["calendar", cal], { encoding: "utf8" })
        assert.equal(r.status, 0, `${f} : « ${cal} » ${r.stderr}`)
      }
    }
    const next = spawnSync("systemd-analyze", ["calendar", "--iterations=6", directive(read(join(DIR, "lws-sequencer.timer")), "OnCalendar")[0]], { encoding: "utf8" }).stdout
    assert.doesNotMatch(next, /\b(Sat|Sun)\b/, "jamais le week-end")
  })
})

/** Un faux npm : journalise chaque appel (cwd + args), répond 3 à `cage check` si FAKE_CAGE=3, sinon FAKE_CODE. */
function fakeNpm(ws: Workspace): string {
  const p = ws.write("bin/npm", `#!/usr/bin/env bash
echo "$PWD|$*" >> "$FAKE_LOG"
case "$*" in *"cage -- check"*) exit "\${FAKE_CAGE:-0}";; esac
sleep "\${FAKE_SLEEP:-0}"
echo "sortie du job"
exit "\${FAKE_CODE:-0}"
`)
  chmodSync(p, 0o755)
  return p
}

describe("install-units.sh (installer les unités de la machine 24/7)", () => {
  const fake = (ws: Workspace, name: string, body: string) => { const p = ws.write(`bin/${name}`, `#!/usr/bin/env bash\n${body}\n`); chmodSync(p, 0o755); return p }
  const install = (ws: Workspace, args: string[], env: Record<string, string> = {}) =>
    run("bash", [ws.path(DIR, "install-units.sh"), ...args], { cwd: ws.dir, env: { LWS_UNIT_DIR: ws.path("units"), SYSTEMCTL: fake(ws, "systemctl", `echo "$*" >> "${ws.path("systemctl.log")}"`), LOGINCTL: fake(ws, "loginctl", "echo Linger=yes"), ...env }, timeoutMs: 30_000 })

  test("installe toutes les unités livrées (pas lws-sync, propre à l'équipe), n'active que les groupes demandés", async () => {
    const ws = makeWorkspace()
    try {
      const r = await install(ws, ["--enable", "core", "--enable", "warmup"])
      assert.equal(r.code, 0, r.out)
      const got = readdirSync(ws.path("units")).sort()
      assert.ok(got.includes("lws-worker.service") && got.includes("lws-cockpit.service") && got.includes("lws-batch.timer") && got.includes("lws-alert@.service"))
      assert.ok(!got.some((u) => u.startsWith("lws-sync")), "lws-sync reste à l'équipe")
      assert.deepEqual(ws.read("systemctl.log").trim().split("\n"), ["--user daemon-reload", "--user enable --now lws-worker.service", "--user enable --now lws-cockpit.service", "--user enable --now lws-learn.timer", "--user enable --now lws-warmup.timer"])
      assert.match(r.stdout, /lws-warmup\.timer : en DRY-RUN/)
      assert.doesNotMatch(r.stdout, /linger absent/)
      const r2 = await install(ws, [])
      assert.equal(r2.code, 0, r2.out)
      assert.match(r2.stdout, /rien n'est activé/)
    } finally { ws.cleanup() }
  })

  test("--dry-run ne touche à rien ; groupe inconnu = 64 ; root refusé (77) ; linger absent signalé", async () => {
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
      assert.match(root.stderr, /utilisateur dédié/)
      const nl = await install(ws, [], { LOGINCTL: fake(ws, "loginctl2", "echo Linger=no") })
      assert.match(nl.stdout, /linger absent/)
    } finally { ws.cleanup() }
  })
})

describe("run-guarded.sh (le wrapper de tous les timers)", () => {
  const guarded = (ws: Workspace, args: string[], env: Record<string, string> = {}) =>
    run("bash", [ws.path(DIR, "run-guarded.sh"), ...args], { cwd: "/", env: { NPM_BIN: ws.path("bin/npm"), FAKE_LOG: ws.path("calls.log"), LWS_LOCK_DIR: ws.dir, ...env }, timeoutMs: 30_000 })
  const calls = (ws: Workspace) => (ws.exists("calls.log") ? ws.read("calls.log").trim().split("\n") : [])

  test("dépôt déduit de l'emplacement du script (lancé depuis /), code relayé, état last-<job>.json", async () => {
    const ws = makeWorkspace()
    try {
      fakeNpm(ws)
      const job = `t-${randomUUID().slice(0, 8)}`
      const r = await guarded(ws, [job, "sequencer", "tick"], { FAKE_CODE: "5" })
      assert.equal(r.code, 5, r.out)
      const c = calls(ws)
      assert.deepEqual(c.map((l) => l.split("|")[0]), [ws.dir, ws.dir], "cage check puis le job, dans le dépôt")
      assert.equal(c[1].split("|")[1], "run sequencer -- tick")
      const last = ws.json<any>(`data/logs/last-${job}.json`)
      assert.equal(last.exit, 5); assert.equal(last.job, job); assert.equal(last.skipped, undefined)
      assert.match(ws.read(last.log), /sortie du job/)
    } finally { ws.cleanup() }
  })

  test("STOP (fichier) : le job ne part pas, npm n'est même pas appelé ; « sauté » dans l'état", async () => {
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
      assert.match(ws.read(last.log), /⏹ .* sauté : fichier STOP/)
    } finally { ws.cleanup() }
  })

  test("STOP du cockpit (cage check = 3) : le job ne part pas ; check illisible : le job part quand même", async () => {
    const ws = makeWorkspace()
    try {
      fakeNpm(ws)
      const job = `t-${randomUUID().slice(0, 8)}`
      assert.equal((await guarded(ws, [job, "review:batch"], { FAKE_CAGE: "3" })).code, 0)
      assert.deepEqual(calls(ws).map((l) => l.split("|")[1]), ["run --silent cage -- check"])
      assert.equal(ws.json<any>(`data/logs/last-${job}.json`).skipped, "STOP")
      assert.equal((await guarded(ws, [job, "review:batch"], { FAKE_CAGE: "1" })).code, 0)
      assert.equal(calls(ws).at(-1)!.split("|")[1], "run review:batch --")
      assert.match(ws.read(ws.json<any>(`data/logs/last-${job}.json`).log), /cage check illisible \(exit 1\)/)
    } finally { ws.cleanup() }
  })

  test("verrou : un 2e run du même job pendant le 1er est sauté proprement (pas de chevauchement)", async () => {
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
      assert.match(ws.read(`data/logs/${job}-${new Date().toLocaleDateString("sv-SE")}.log`), /déjà en cours \(lock\)/) // date locale, comme `date +%F`
    } finally { ws.cleanup() }
  })
})

test("npm run cage : état, stop (fichier sans base), check = 3, resume", { timeout: 90_000 }, async () => {
  const ws = makeWorkspace()
  try {
    const s0 = await npmRun(ws.dir, "cage")
    assert.equal(s0.code, 0, s0.out)
    assert.match(s0.stdout, /✓ la cage est au calme/)
    assert.match(s0.stdout, /envoi des mails\s+dry-run/)
    assert.equal((await npmRun(ws.dir, "cage", ["check"])).code, 0)
    const stop = await npmRun(ws.dir, "cage", ["stop", "test", "de", "la", "cage"])
    assert.equal(stop.code, 0, stop.out)
    assert.equal(ws.read("STOP").trim(), "test de la cage")
    const chk = await npmRun(ws.dir, "cage", ["check"])
    assert.equal(chk.code, 3)
    assert.match(chk.stdout, /⏹ STOP \(fichier : test de la cage\)/)
    const j = JSON.parse((await npmRun(ws.dir, "cage", ["--json"])).stdout)
    assert.deepEqual([j.stop.on, j.alerts], [true, ["stop"]])
    assert.equal((await npmRun(ws.dir, "cage", ["resume"])).code, 0)
    assert.equal(ws.exists("STOP"), false)
    assert.equal((await npmRun(ws.dir, "cage", ["oups"])).code, 1)
  } finally { ws.cleanup() }
})
