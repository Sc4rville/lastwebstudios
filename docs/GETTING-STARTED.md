# Getting started: day one on your laptop

> From a fresh clone to your first real site and a cockpit that is yours, in an afternoon, on the subscription you
> already have. Nothing here sends a mail or spends money beyond the quota of your plan. The server part (the
> always-on agency) is [GUIDE.md](GUIDE.md).

## 0. What you need

Node 20.12+ (24 recommended) and git, on macOS or Linux (on Windows, WSL), and a Claude plan: Pro ($20 a month)
or Max, with [Claude Code](https://claude.ai/code) installed and logged in (`claude auth login`), or a Claude API
key paid per use. **Building sites needs Claude**: a ChatGPT subscription alone can only run the lighter steps
([BYO-MODEL.md](BYO-MODEL.md)). The demo below needs none of it.

```bash
git clone https://github.com/Sc4rville/lastwebstudios.git && cd lastwebstudios
npm ci
npx playwright install chromium     # the browser that reads sites and checks builds
```

## 1. See the product: the demo

```bash
npm run sandbox                     # the demo studio: American (Austin businesses, English, dollars)
npm run sandbox -- --country FR     # or the French one (businesses near Lyon, French sites, euros)
```

A fictional agency starts on a free local port and prints its address on the line that starts with
`✓ Fictional agency ready` (`-- --port 4100` to fix it): open it in your browser. Nine invented businesses and five
sites are already there, at every stage (the story's six businesses, plus three that a first search brought; one
lead is in the emails, in Outreach › Emails, where its Email tab shows what was written):
**Prospects** (found, with why they were picked), **Sites** (built, before / after, waiting for your approval),
**Outreach** (the sales steps, the call panel). Type a request in the field at the top, click **Find prospects**,
**Build site**, **Send to outreach**: every action runs, simulated, in seconds. Nothing leaves your machine, and
what you change is thrown away when you stop it (`Ctrl-C`). On a remote machine (SSH, a cloud session), open a
tunnel first: `ssh -L 4100:127.0.0.1:4100 <host>`, then <http://127.0.0.1:4100> on your computer.

## 2. Check your machine

```bash
npm run doctor
```

One line per check, "missing X ⇒ do Y", in plain words, and the next command at the end. The default profile is
what you need now (Claude Code login, Chromium, the AI); the shared database, the 24/7 worker and the sending checks
of the always-on agency come with `npm run doctor -- --for agency`. The `Claude Code` line names your plan; `Agents
in parallel` says whether sites build with agents in parallel (Max) or one at a time (Pro, chosen for you). Optional
add-ons (image boost, hero video) show as information, with what turning them on costs.

## 3. Your first site, on a fictional business

```bash
npm run first-site -- --sample
```

A dated site of a fictional business of your agency's country (`pecanwood`, an Austin pool builder, for a US
agency; `orvane` otherwise) is served locally and rebuilt end to end: score, read, prospect sheet, diagnose,
compose, lint and verify, the blind judge. About 10–14 minutes; Claude Code estimates the token cost at roughly $3 of
plan quota (an estimate, not a bill; on Pro, a build can take a large share of one five-hour usage window). The
result lands in `output/sites/<the prospect>/`.

## 4. Look at it in your cockpit

```bash
npm run backoffice      # http://127.0.0.1:4000, or the next free port: it prints the one it uses
```

Stop the demo first if it still runs. Unlike the demo, this cockpit shows **your** runs: the site you just built,
before / after, the comment box that sends an edit to the agent, **Send to outreach**. It starts its own local
database (`data/pglite`, nothing to install), so **Find prospects**, the call list and the jobs work on your laptop.
Jobs run inside the cockpit itself, while it is open; no other process to start.

To show a business owner the site you built for them, `npm run share` (it needs
[`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)) prints a
public link per built site, valid while that terminal stays open; for a lasting link, copy
`output/sites/<prospect>/<date>/` to a static host.

## 5. Make the agency yours

- **Settings** in the cockpit (⋯ › Settings): your agency's name, your first name (it signs the emails and opens
  the call scripts), country, language, the US postal address, which AI you use, your phone, email, website and
  offer, and what happens after you approve a site. It saves to `agency.config.json` and says what still belongs
  to the demo studio; `npm run doctor` keeps warning until nothing does.
- **Billing › Your business**: the details printed on your invoices (no invoice gets a number before they are in,
  and the demo studio's details never count as yours).
- **Hands-off** (⋯ menu) builds new good prospects on its own: it asks for a daily cap in builds first
  (`LWS_BUILDS_PER_DAY` in `.env`; a build uses about $3 of your plan, an estimate, not a charge), and the cockpit
  never builds past it: what does not fit today is built tomorrow, first in line.
- `.env` is optional (`cp .env.example .env` to start one). `LWS_LLM=codex` switches the lighter calls to your
  ChatGPT subscription. `agency.config.json`, created by Settings, is yours: it is gitignored, never commit it.

## 6. A real prospect

```bash
npm run first-site -- https://a-dated-site.example --industry plumber --name "Business name" --city "Town"
```

`--industry` takes an English or French trade name (`plumber`, `roofer`, `kitchen designer`, `menuisier`…);
`npm run first-site -- --help` lists every option. The gate may refuse a site that does not need rebuilding
(`--force` to build anyway). Approve the result in the cockpit, then call: the call panel has the phone, the facts
and the script.

## 7. Optional: a shared database

`npm run backoffice` keeps its own local database in `data/pglite`. A shared Postgres is for several machines: the
CRM shared with a teammate, a remote worker that builds while your laptop is closed, the 24/7 agency.

```bash
docker run -d --name lws-pg -e POSTGRES_PASSWORD=lws -p 5432:5432 postgres:17-alpine
echo 'DATABASE_URL=postgres://postgres:lws@127.0.0.1:5432/postgres' >> .env
npm run db:init
```

A free Supabase project works too (use the session-pooler URL). `npm run doctor -- --for agency` checks it. With a
`DATABASE_URL` set, the cockpit uses it instead of the local one.

## 8. Optional: sending

Email sequences stay in test mode (every mail is a file in `data/sequencer/outbox/`) until a human sets
`"dryRun": false` in `outreach/sequencer/config.json` **and** `LWS_LIVE_SEND=1`. Before that you need a domain,
warmed-up mailboxes and the tracking URL: [GUIDE.md](GUIDE.md) §10–11. Calls and hand-written mails need none of it.
