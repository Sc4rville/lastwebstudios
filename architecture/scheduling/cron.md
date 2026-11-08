# Scheduling

When to run the machine, **robustly**. Seven scheduled jobs, plus two always-on services: the worker
(`worker/lws-worker.service`) and the Station (`backoffice/reviewpipe/lws-cockpit.service`). The full step by step on
a fresh box (dedicated user, linger, logs, cage): `docs/GUIDE.md` §8.

| job | what | pace (timer provided) |
|-----|------|------------------------|
| **scrape**    | `npm run scrape -- cuisiniste all`: new OSM prospects (French-speaking areas), deduplicated by a registry | once a week (Monday 02:00) |
| **pipeline**  | `npm run pipeline`: the template-fill path (score→…→animate) — private edition only (not in the open source edition) | once a day (03:00) |
| **review**    | `npm run review:batch`: `control.md` comments through the surgical editor — private edition only (the open source edition goes through the worker: `edit` job) | every 30 min |
| **sequencer** | `npm run sequencer -- tick`: replies read (reply = Hot Lead), the tracking's clicks and unsubscribes, circuit breaker, sends that are due | every 20 min, Mon-Fri 08:00-18:40 (Paris) |
| **learn**     | `npm run learn`: the CRM's outcomes (won, lost, meeting, replies) re-weight the scoring gate | every night, 01:30 (Paris) |
| **batch**     | `npm run batch -- composer $LWS_BATCH_SIZE $LWS_BATCH_ARGS`: queues a composer batch for the worker (AUTO trade from the radar when `LWS_BATCH_ARGS` is empty): **this is what makes the agency automatic** | every night, 00:30 (Paris) |
| **warmup**    | `npm run warmup -- tick`: the mailboxes write to and answer each other (ramp 2 → 20/mailbox/day), in dry-run while `LWS_LIVE_SEND=1` is commented out in the unit | every hour, 08:15-19:15 (Paris) |

The scrape reads its trade and area from `LWS_SCRAPE_ARGS` (default `cuisiniste all`, set it in `.env`).

> **Everything goes through the `run-guarded.sh` wrapper**: do NOT call `npm` directly from a
> scheduler. The wrapper handles four real traps:
> 1. **Overlap**: `flock -n` keeps two runs of the same job from colliding on `data/`/`output/`.
> 2. **`npm` not found**: under cron/systemd the `PATH` is minimal and **`/usr/bin/npm` does not exist**
>    (npm lives in nvm: `~/.nvm/versions/node/<v>/bin/npm`). The wrapper resolves it (`NPM_BIN` to force it).
> 3. **`.env`**: it `cd`s into the repo (derived from its own location, `LWS_REPO` to force it) → each
>    script finds `.env` (`process.loadEnvFile()` relative to the cwd).
> 4. **The cage**: emergency stop set (a `STOP` file at the root, or the cockpit's STOP button, read by
>    `npm run cage -- check`) → the job does not start (exit 0, `"skipped":"STOP"` in `last-<job>.json`).

## Run once (by hand)
```bash
npm run pipeline
# or, exactly like the scheduler (lock + npm resolution + cage + state written):
architecture/scheduling/run-guarded.sh pipeline  pipeline
architecture/scheduling/run-guarded.sh review    review:batch
architecture/scheduling/run-guarded.sh sequencer sequencer tick
architecture/scheduling/run-guarded.sh learn     learn
```

## Recommended: systemd user timers
The units are versioned in this folder and **are not installed by default**:
`lws-{scrape,pipeline,review,sequencer,learn,batch,warmup}.{service,timer}` + `lws-alert@.service` (dead man's switch:
when a job fails, it logs to `data/logs/ALERT.log`, runs `notify-send` when available, and sends a text POST to `LWS_ALERT_URL`
when it is set: an ntfy topic, the `/fail` URL of a healthchecks.io check, a webhook). Each service carries
`Environment=PATH=%h/.local/bin:…`: a native Claude Code install (`~/.local/bin/claude`) is found under systemd.

**Paths**: no unit carries a hard-coded path, they use `%h/lws` (`%h` = your HOME), the box's
layout (`worker/setup-box.sh` clones into `~/lws`). If your repo is elsewhere: `ln -s /path/to/the/repo ~/lws`.

**Install in one command** (`architecture/scheduling/install-units.sh`: copies, reloads, enables the groups asked for,
refuses root, flags a missing linger and duplicate system timers; `--dry-run` to look first):
```bash
architecture/scheduling/install-units.sh --enable core            # worker + Station + nightly learning
architecture/scheduling/install-units.sh --enable auto            # + nightly composer batch + weekly scrape
architecture/scheduling/install-units.sh --enable warmup          # warmup (dry-run while LWS_LIVE_SEND is commented out)
architecture/scheduling/install-units.sh --enable outreach        # sequencer (the same, + "dryRun": false for real sending)
```

**Install by hand** (`loginctl enable-linger "$USER"` once, so the timers run without an open session):
```bash
mkdir -p ~/.config/systemd/user
cp architecture/scheduling/lws-*.service architecture/scheduling/lws-*.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now lws-pipeline.timer lws-review.timer lws-scrape.timer lws-learn.timer
# the sequencer: only once the warmup is over and the content is ready (it runs in DRY-RUN while
# config.dryRun is not false AND Environment=LWS_LIVE_SEND=1 is not uncommented in its unit)
systemctl --user enable --now lws-sequencer.timer
```
On a box where these jobs already run as **system** timers (root), do not install the user version as well:
two timers = two ticks = duplicate sends.

**Monitor:**
```bash
systemctl --user list-timers 'lws-*'                        # last + next run, at a glance
systemctl --user status lws-sequencer.service               # health of the last tick
journalctl --user -u lws-pipeline.service -n 50 --no-pager  # logs (journald, automatic rotation)
journalctl --user -u lws-sequencer.service -f               # follow live
cat data/logs/last-sequencer.json                           # the state the cockpit reads (/api/schedule)
npm run cage                                                # STOP, today's budget, circuit breaker, sending mode
```
> The **cockpit shows this state**: "pipe / review / seq / learn" dots in the Station's bar
> (green = last run OK, red = failed, grey = skipped by a STOP), fed by `data/logs/last-<job>.json`
> (written by the wrapper) + `systemctl --user list-timers`. The **Machine** view (`/#machine`) shows the cage.

**Emergency stop (every job, the worker, the warmup):**
```bash
npm run cage -- stop "reason"     # or: echo "reason" > STOP · or the cockpit's STOP button
npm run cage -- resume            # then: systemctl --user restart lws-worker (the worker exits on STOP)
```

**Disable / remove:**
```bash
systemctl --user disable --now lws-pipeline.timer lws-review.timer lws-scrape.timer lws-sequencer.timer lws-learn.timer
systemctl --user daemon-reload
```

## Fallback: crontab (without systemd)
Always through the wrapper (lock + nvm npm + cage + state), **never** a hard-coded `/usr/bin/npm`. With the repo in `~/lws`:
```cron
0    3 * * *     $HOME/lws/architecture/scheduling/run-guarded.sh pipeline pipeline
*/30 * * * *     $HOME/lws/architecture/scheduling/run-guarded.sh review review:batch
30   1 * * *     $HOME/lws/architecture/scheduling/run-guarded.sh learn learn
*/20 8-18 * * 1-5 $HOME/lws/architecture/scheduling/run-guarded.sh sequencer sequencer tick
```
(cron reads the machine's clock: on a box in UTC, shift the sequencer by one or two hours.)
```bash
crontab -e   # edit    ·    crontab -l   # view    ·    (remove the line to disable)
```

## Notes
- **Persistent=true** on the timers: a missed run (machine asleep) catches up when it wakes.
- **Logs**: journald with systemd (`journalctl --user --vacuum-time=14d` to cap them). The wrapper also writes
  `data/logs/<job>-<date>.log` (gitignored) + `data/logs/last-<job>.json` (machine-readable state).
- **Exit code**: a sequencer tick with a failed send ends with code 1 (retried at the next tick,
  never a double send) → `lws-alert@` fires; a `dryRun:false` without `LWS_LIVE_SEND=1` ends with code 2.
- **Off-machine healthcheck** (optional, keeps zero local dependencies): a `HEALTHCHECK_URL` curled at the end of
  a run would cover the "the machine itself is off" case; not wired for now.
- The **station** (`npm run backoffice`) is not a scheduled job: it reads `output/` live (watcher +
  poller). To keep it on at boot: a dedicated systemd unit (optional).
```bash
# check a calendar expression before installing it
systemd-analyze calendar 'Mon..Fri *-*-* 08..18:00/20:00 Europe/Paris'
systemd-analyze calendar '*-*-* 01:30:00 Europe/Paris'
```
