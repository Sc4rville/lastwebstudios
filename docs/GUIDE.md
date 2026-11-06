# From zero to a 24/7 agency

> The step-by-step from an empty Ubuntu box to a machine that finds, scores, reads, builds and judges while you
> sleep, and sends only when you have decided it may. Every step is reversible, and the cage (STOP, budget,
> breaker) is in place before anything runs unattended. Reference of every variable: [CONFIGURATION.md](CONFIGURATION.md).
> The scheduling details: [`architecture/scheduling/cron.md`](../architecture/scheduling/cron.md).

## 1. What you need

| piece | why | notes |
|---|---|---|
| a small VPS, Ubuntu 24.04 | the worker runs Claude Code agents and a headless Chromium | a Hetzner CX-class box or any equivalent; 2 vCPU and 4 GB are enough for one site at a time |
| a Claude subscription | the agents (composer, coach, research) run through Claude Code on it | Max runs the composer through Claude Code's Workflow tool; Pro uses `--engine local` (one `claude -p` per agent) |
| Postgres 14+ | the CRM, the batch queue, the shared state between the cockpit and the worker | self-hosted on the box, or a managed one (Supabase: use the **session pooler** URL on IPv4) |
| a domain for the cockpit | the public tracking links in your mails point at it, over HTTPS | a sub-domain and a Caddy reverse proxy are enough |
| later: sending inboxes | real Google Workspace mailboxes, one domain of your own, warmed up | not before §11; nothing in this guide sends a mail until you set two switches |

Read the terms of your subscription: Claude Code's terms talk about ordinary, individual use and forbid serving
other people with your credentials. Start on **your** subscription, **your** box, **your** agency; move to an API
key (billed per token, cappable) when the volume is not personal any more.

## 2. The box

```bash
# as root, once
apt-get update && apt-get -y upgrade
adduser --disabled-password --gecos "" lws
loginctl enable-linger lws                 # user units keep running without an open session
# optional, recommended: SSH keys only, a firewall that allows 22, 80 and 443
```

Everything below runs **as `lws`**, never as root. `architecture/scheduling/install-units.sh` refuses root on
purpose: the worker gives `Bash` to an agent, and an agent with root has the machine.

```bash
su - lws
```

## 3. Node, Claude Code, the repository

```bash
# Node 24 (any way you like; nvm is fine, the units resolve npm from it)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash && . ~/.nvm/nvm.sh
nvm install 24 && nvm use 24

# Claude Code, native installer (auto-updates), then log in with your subscription
curl -fsSL https://claude.ai/install.sh | bash
claude setup-token                          # no browser on the box: prints a token for CLAUDE_CODE_OAUTH_TOKEN
# or, with a browser at hand: claude auth login

# the repository, in ~/lws: the units assume this path (%h/lws)
git clone https://github.com/Sc4rville/lastwebstudios.git ~/lws && cd ~/lws
npm ci
npx playwright install --with-deps chromium   # the browser and its system libraries
```

If the repository lives elsewhere: `ln -s /path/to/repo ~/lws`.

## 4. Postgres

Self-hosted on the box:

```bash
# as root
apt-get install -y postgresql
sudo -u postgres psql -c "CREATE USER lws WITH PASSWORD 'choose-a-long-password';"
sudo -u postgres psql -c "CREATE DATABASE lws OWNER lws;"
```

`DATABASE_URL=postgres://lws:choose-a-long-password@127.0.0.1:5432/lws`. On the loopback no TLS is used; on a
private network without TLS set `DB_SSL=disable`; on a managed Postgres keep the default (`require`).

Then, as `lws`, in `~/lws` after §5:

```bash
npm run db:init           # applies db/schema.sql: 12 tables, idempotent, adds missing columns to an older base
```

## 5. `.env`, outside the agents' reach

The units read `EnvironmentFile=-%h/lws/.env`. Keep it unreadable by anyone else, and keep secrets out of the
working directory of the agents when you can: the worker removes `ANTHROPIC_API_KEY` from every `claude -p` it
launches (plan-first), and the skill calls run with no tools, but the file itself should not be world-readable.

```bash
cp .env.example .env && chmod 600 .env
```

Uncomment and fill only what this guide asks for, in this order:

```
DATABASE_URL=postgres://lws:…@127.0.0.1:5432/lws
CLAUDE_CODE_OAUTH_TOKEN=…            # from claude setup-token; not needed if you ran claude auth login on the box
BACKOFFICE_PASSWORD=…                # Basic auth on the cockpit once it is reachable from outside
LWS_BUDGET_USD_DAY=20                # the daily cap; pick yours
LWS_JOB_MAX_USD=6                    # the cap of one agent job
```

Everything else stays commented. `.env.example` documents every variable; nothing is required to start.

## 6. Your agency

`agency.config.json` is read by everything that speaks in your name: the legal footer and the HELO of your mails,
the User-Agent of the lead engine (the open-data APIs ask you to identify yourself with a way to reach you), the
seller on invoices, the brand facts of the savior mail, the signatures, the CRM operators.

```bash
cp agency.config.example.json agency.config.json
$EDITOR agency.config.json                   # replace every value of the fictional "Atelier Vélin"
```

Two keys deserve a decision rather than a default:

- `leadengine.searchFallback` (default `false`): when the guessed domain of a company does not answer, look its
  website up on DuckDuckGo then Bing by reading their result pages. Reading result pages by program is outside
  those engines' terms of use; turn it on knowingly or leave it off (the DNS guess and SIRENE still work).
- `outreach.competitorClaims` (default empty): the sentences a draft may say about a **named** competitor. Leave it
  empty unless every sentence is true and verifiable: an invented claim about an identifiable third party is a
  misleading commercial practice (Code de la consommation, L121-2).

The SMTP mailbox verifier (`outreach/scripts/wehavemillionverifierathome.ts`) probes `RCPT TO` on port 25. It is a
separate command, never run automatically; some hosts block port 25 and aggressive use gets an IP listed. Run it
on purpose, on small batches.

### Outside France

Set `country` and `language` in `agency.config.json` (`agency.config.example.us.json` is a complete fictional US example).
What changes: the mail footer follows the country's rules (CAN-SPAM in the US: a postal address is required and a
live send is refused without one; CASL wording in Canada), phone numbers in US/UK/CA/AU formats are recognised by
the gate, the lead engine scrapes OpenStreetMap for any country or subdivision (`npm run scrape -- roofer us-me`,
`ca-on`, `au-nsw`: a whole country like the US times out, aim at a state), domains are guessed on the country's TLD,
the trades carry English labels and search terms, and every generated text (sites, savior mail, drafts, call
scripts) is written in `language`. What is not wired: a public company registry outside France (SIRENE is French),
so "active / size / revenue" stay unknown there; the industry playbooks and the sales script are French prose that
the agents read and render in your language.

## 7. Doctor

```bash
npm run doctor
```

One line per check, `✓`, `⚠` or `✗ missing X ⇒ do Y`: Node, dependencies, Chromium, the `LWS_LLM` way and the
model of each role, Claude Code (installed, logged in, which auth source, no `--bare`), the Workflow tool, the
database and its schema, the image and video engines, the sending configuration, Telegram. It never makes a paid
request. Exit 1 while anything blocks; fix, repeat.

## 8. The units

The machine is a set of **user** systemd units, versioned in `architecture/scheduling/`, `worker/` and
`backoffice/reviewpipe/`, installed by one script that copies them, reloads systemd and enables only the groups
you ask for:

```bash
architecture/scheduling/install-units.sh --dry-run --enable core     # says what it would do
architecture/scheduling/install-units.sh --enable core               # worker + Station + nightly learning
```

| group | units | what runs |
|---|---|---|
| `core` | `lws-worker.service` · `lws-cockpit.service` · `lws-learn.timer` | the daemon that builds, the Station on 127.0.0.1:4000, the learning run at 01:30 Paris |
| `auto` | `lws-batch.timer` · `lws-scrape.timer` | one composer batch per night at 00:30 Paris (`LWS_BATCH_SIZE`, default 5; `LWS_BATCH_ARGS`, empty = the trade radar picks); new prospects from OpenStreetMap every Monday at 02:00 (`LWS_SCRAPE_ARGS`) |
| `warmup` | `lws-warmup.timer` | one tick per hour, 08:15 to 19:15 Paris: your inboxes write to each other, ramp 2 to 20 mails per inbox and per day. **Dry-run** until §11 |
| `outreach` | `lws-sequencer.timer` | one tick every 20 minutes, Monday to Friday, 08:00 to 18:40 Paris. **Dry-run** until §11 |
| `telegram` | `lws-telegram.service` | the optional bot, closed by default (`TELEGRAM_ALLOWED_CHAT_IDS`) |

Every job goes through `run-guarded.sh`: a `flock` so two runs never overlap, `npm` resolved even under a minimal
PATH, `cd` into the repository so `.env` is found, the cage checked first (a job skipped by STOP records
`"skipped":"STOP"`), and `data/logs/last-<job>.json` written for the cockpit. `lws-alert@.service` is the
dead-man's-switch: on a failure it appends to `data/logs/ALERT.log` and, if `LWS_ALERT_URL` is set, POSTs a line to
an ntfy topic, a healthchecks.io `/fail` URL or any webhook.

The script warns when the linger is missing (the timers would stop at logout) and when **system** timers of the
same name exist (two timers are two ticks, and two ticks are double sends).

Watch:

```bash
systemctl --user list-timers 'lws-*'
journalctl --user -u lws-worker -f
npm run cage
```

### Hardening the units

The shipped units are deliberately plain so they run anywhere. On a box that faces the internet, add to the
`[Service]` section of the copies in `~/.config/systemd/user/`:

```ini
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=%h/lws %h/.cache %h/.claude %h/.npm
```

`ReadWritePaths` must include the repository (`data/`, `output/`, `.sandbox/`), Playwright's browser cache,
Claude Code's own directory and npm's cache. Check with `journalctl --user -u lws-worker` after a restart: a
permission error there means a path is missing from the list. Keep `.env` at mode 600, owned by `lws`.

## 9. The cockpit, reachable from your machine

`lws-cockpit.service` binds `127.0.0.1:4000`. Two ways to reach it:

**SSH tunnel** (private, no exposure):

```bash
ssh -N -L 4000:127.0.0.1:4000 lws@your-box     # then http://127.0.0.1:4000 on your machine
```

**HTTPS behind a reverse proxy** (needed for the tracking links of §10):

```
# /etc/caddy/Caddyfile
cockpit.your-agency.example {
    reverse_proxy 127.0.0.1:4000
}
```

Set `BACKOFFICE_HOST=0.0.0.0` only if the proxy is on another machine; set `BACKOFFICE_PASSWORD` in every case
where a non-local `Host` can reach the server. Without a password an external `Host` gets 403: the Station never
exposes itself bare by accident. Everything is behind Basic auth except `/t/`, the public click and unsubscribe
endpoint.

## 10. Tracking

The sequencer gates its follow-ups on a click, and every mail carries a one-click unsubscribe. Both need the
cockpit's public URL and a signing secret, the **same** on the cockpit and on the sequencer's machine:

```
TRACK_BASE=https://cockpit.your-agency.example
LWS_TRACK_SECRET=…        # at least 32 characters: openssl rand -base64 48
```

Links in a mail become `/t/c/<id>.<url>.<signature>`: the destination is inside the token and signed (HMAC-SHA256),
so the endpoint only ever redirects to a URL it put in a mail itself. Unsubscribe is `/t/u/<id>.<signature>`,
served as a confirmation page on GET and honored on POST `List-Unsubscribe=One-Click` (RFC 8058, the native Gmail
and Yahoo button). Events land in the `outreach_events` table; without a database, in
`data/sequencer/events.jsonl`. A click less than 60 seconds after the send, or from a known scanner user agent,
is flagged `suspect` and does not unlock anything.

Without these two variables nothing breaks, but no link is rewritten, unsubscribe happens by a STOP reply and
`mailto:`, and the click-gated steps never unlock: every prospect goes to nurturing after the first mail.
`npm run doctor` makes this a blocking point in live mode.

## 11. Sending, in order

Nothing sends until **a human** sets two switches. Until then every tick writes what it would send as an `.eml`
in `data/sequencer/outbox/`, with the final headers, so you can read exactly what would leave.

**a. Inboxes.** Real mailboxes on a domain you own (Google Workspace), listed in
`outreach/sequencer/config.json › inboxes` with a `throttlePerDay` each. Never a shared SMTP relay. The shipped
file holds fictional `.example` inboxes; the sandbox refuses to run with inboxes outside reserved domains.

**b. Gmail access.** A Google Cloud service account with domain-wide delegation, its key in
`outreach/sequencer/sa-key.json` (gitignored, excluded from the Docker image), scopes:

| scope | used by |
|---|---|
| `gmail.send` | the sequencer's transport and the warmup |
| `gmail.readonly` | the reply reader (metadata and snippet only; a reply becomes a Hot Lead, STOP unsubscribes, bounces are counted, auto-replies are ignored) |
| `gmail.modify` | the warmup only, to pull warmup mails out of spam |

`LWS_REPLY_READER=gmail` is the default once `sa-key.json` exists; `none` turns the reader off.

**c. Warm up first.** Enable `--enable warmup`, then uncomment `Environment=LWS_LIVE_SEND=1` **in
`~/.config/systemd/user/lws-warmup.service`** (not in `.env`: the switch is per unit on purpose) and run
`systemctl --user daemon-reload`. Your inboxes write to each other for 10 to 14 days on a ramp from 2 to 20 mails
per inbox and per day. A tick is locked: two simultaneous ticks cannot double the day's volume. Watch
`npm run warmup -- status`. Note that `install-units.sh` re-copies the units from the repository: running it again
puts the switch back in its commented, dry-run state, and you re-apply it by hand. That is the safe direction.

**d. Content.** The first step of the funnel is the savior mail, written per prospect by `npm run savior -- <id>`
from the diagnosis and the demo. The three click-gated follow-ups (personal demo, SEO article, content) read their
text from `data/demo/`, `data/seo/` and `data/contenu/`; a step whose content is missing is **held**
(`waiting-content`), never replaced by a placeholder. This edition ships no generator for those three: write them,
or shorten the funnel in `config.json › steps`.

**e. Go live.** `"dryRun": false` in `outreach/sequencer/config.json`, then uncomment `Environment=LWS_LIVE_SEND=1`
in `lws-sequencer.service`, `systemctl --user daemon-reload`, `--enable outreach`. One switch alone is refused
(exit 2, and `lws-alert@` fires). The sequencer records `sent` on the first real mail, which is what the learning
loop needs to count the prospects who never reply.

**f. The breaker.** Thresholds live in `config.json › breaker` (defaults: bounces 1 %, complaints 0.1 %,
unsubscribes 2 %, 7-day window, 100-send floor). Open, it stays open until you re-arm it:
`npm run sequencer -- breaker reset` or the button in the Machine view. A live tick whose send failed exits 1
(the mail is retried next tick, never doubled) and alerts.

## 12. What to watch

- **The Machine view** (`/#machine`): the seven stages with live counters and the last event of each, the journal,
  and the cage box: STOP, the budget meter, the three breaker meters, the send mode. A red banner means a human
  is needed.
- **The Station bar**: one dot per scheduled job, green for the last run OK, red for a failure, gray for skipped
  by STOP.
- **`npm run cage`**: the same, in the terminal. `npm run cage -- stop "reason"` halts everything at the next
  check; `npm run cage -- resume` then `systemctl --user restart lws-worker` (the worker exits with code 3 on STOP
  and systemd does not restart it on purpose).
- **The budget**: `data/logs/spend.jsonl` is what the daily cap counts. On a subscription the amounts are Claude
  Code's own quota estimates, not an invoice; image and video costs are estimates too (`LWS_IMAGE_USD`,
  `LWS_VIDEO_USD`), set them from your real bills. A usage limit reached mid-job fails the agent: the worker
  waits for the reset before claiming again, a half-built folder is marked and reaped once stale, and you queue
  the prospect again in the next batch.
- **`journalctl --user -u lws-sequencer -n 50`** after each change to the funnel.

## 13. Backups

Three things hold state; everything else is rebuilt from them.

| what | where | how |
|---|---|---|
| the database | Postgres | `pg_dump lws > lws-$(date +%F).sql` nightly, off the box |
| the files the pipeline wrote | `data/` (sheets, assets, sequencer state and outbox, learning outcomes, logs) and `output/sites/` | an rsync of `~/lws/data ~/lws/output` to another machine |
| the configuration | `.env`, `agency.config.json`, `outreach/sequencer/config.json`, `outreach/sequencer/sa-key.json` | copied by hand to a password manager or an encrypted vault, never to git |

`npm run db:init` on a restored dump brings an older schema up to date.

## 14. Updating

```bash
cd ~/lws && git pull --ff-only && npm ci && npx playwright install chromium
npm run doctor
architecture/scheduling/install-units.sh      # re-copies the units; enables nothing new
systemctl --user restart lws-worker lws-cockpit
```

Re-apply the `LWS_LIVE_SEND=1` line in the warmup and sequencer units if you had enabled live sending (§11.c), then
`systemctl --user daemon-reload`. `claude update` keeps Claude Code current; `npm run doctor` tells you when a model
alias resolves to an older generation than the one the product expects, and how to pin it (`LWS_MODEL_<ROLE>`).
