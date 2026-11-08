# CLAUDE.md — Last Web Studios

> Loaded at the start of every session. This file orients you; the knowledge lives in `docs/`, the actions in
> `.claude/skills/` and `npm run …`. One name for the UI: **the cockpit**.

## What this is

A web agency kit: it finds local businesses with a dated website, rebuilds their site with Claude, has a second AI
check the new one is better, and helps you pitch it (emails, a call list, a call script). You approve every site and
make every call; nothing is sent until you set two switches by hand.

For you, the agent (never say this to the user): find (OpenStreetMap, plus SIRENE in France) → score (no model call)
→ read the site into a `ProspectSheet` → build with Claude Code agents (diagnose → compose → lint/verify → blind
judge, cap 2) → approve in the cockpit → sell (a test-mode-first email sequencer, a call panel) → learn from every
outcome. The cockpit UI, the CLI and the docs are English; generated sites, emails and call scripts are written in
the prospect's language when known, else the agency's `language` (`agency.config.json`; the US demo studio is
English, `agency.config.example.json` is the French one).

## First conversation ("how does this work?", "open the UI for me")

Answer in this order, then act.

1. **What it is**: the first paragraph above, in your words (two lines, no pipeline vocabulary). The user's chain is
   **Prospects → Sites → Outreach**; that is the cockpit.
2. **Show it**: on a fresh clone run `npm ci` once first (about a minute; Chromium is not needed for the demo). The
   sandbox is the only way to see the product (`npm run backoffice` shows the user's own `output/`, empty today).
   Run `npm run sandbox -- --port 4100` **in the background** (the English demo: an American studio and an Austin
   cast; add `--country FR` only for a French-speaking user, who gets the French studio; it blocks until Ctrl-C;
   4100 leaves 4000 free for the user's own cockpit), wait for the line
   `✓ Fictional agency ready in … → http://127.0.0.1:4100` (about 10 s; it is followed by `Nothing is sent (test
   mode) · Ctrl-C to stop`, so do not wait for the arrow on the very last line), then open that URL for the user or
   paste it (it does not open a browser by itself). Summarise the log in one sentence; never paste its lines. If you run on a remote machine
   (SSH, a devcontainer, a cloud session), the user needs a tunnel first: `ssh -L 4100:127.0.0.1:4100 <host>`, then
   http://127.0.0.1:4100 on their computer. Say what the three pages are; a line under the header says it is a demo
   whose changes are thrown away when it stops. No key, nothing sent, $0.
3. **Their machine**: `npm run doctor` (the newcomer profile: Claude Code login, Chromium, the model way; no
   database needed). Read the `Claude Code` line aloud: it names the plan. If the `Agents in parallel (Max plan)` line
   is not ✓, it is a Pro plan (or Claude Code is not signed in yet): `first-site` picks `--engine local` by itself.
4. **Offer, do not launch**: `npm run first-site -- --sample` builds a fictional site (an Austin pool builder until the
   user has an `agency.config.json`, then one of the agency's country) in
   10–14 minutes and uses about $3 of plan quota as estimated by Claude Code (an estimate, not a bill; the API ways
   bill per use). Image and video boost are off by default. Then stop the background sandbox and run
   `npm run backoffice`: read the URL it prints (4000, or the next free port). It starts its own local database
   (`data/pglite`), so Find prospects works there too. Until Settings is saved it runs as the US demo studio (a line
   under the header says so); when Claude Code is not signed in, a bar on its main screen gives the one command
   (`claude auth login`), so check `claude auth status` first if the user says it "doesn't build". To show a business owner their site: `npm run share`
   (a Cloudflare quick tunnel, `cloudflared` needed) prints one public link per built site.
   **Costs, when asked**: sandbox $0; a site ≈ $3 of plan quota (on Pro, a build can take a large share of one
   five-hour usage window: a few builds a day); the always-on mode adds a small VPS (2 vCPU / 4 GB) and later your
   own domain and mailboxes; the image and video boost bill OpenAI and Higgsfield per use. There is no daily cap
   until `LWS_BUILDS_PER_DAY` (or `LWS_BUDGET_USD_DAY`) is set; the sandbox's cap of 6 builds is the demo's own.
5. **Make it theirs**: in their cockpit, **⋯ › Settings** (name, first name, country, language, the AI they use,
   contact details, offer); it creates `agency.config.json` (gitignored: rule 2) and lists what still belongs to the
   demo studio, as `npm run doctor` does. Invoices: **Billing › Your business** (no invoice gets a number while it
   still holds the demo studio's details). Sending stays in test mode until rule 1's two switches; say so. A
   ChatGPT-only user can't build sites: a Claude plan (Pro, $20 a month) or a Claude API key is needed for that.
   **Before Hands-off or anything unattended**, set a daily cap in builds, `LWS_BUILDS_PER_DAY=6` in `.env` (absent =
   no cap, unless `LWS_BUDGET_USD_DAY` is set; the cockpit's Hands-off asks for it and writes it); `npm run cage`
   shows today's builds against it.

Day-one walkthrough to point at: `docs/GETTING-STARTED.md`.

## The commands

| command | what it does |
|---|---|
| `npm run sandbox` | a fictional agency on 127.0.0.1: embedded Postgres, cast, cockpit, simulated jobs. No key, no `.env`. The US demo studio by default, `-- --country FR` the French one; `-- --port 4100` fixes the port; `-- --check` verifies every view, lists them and exits (`-- --verbose` lists them and keeps running). |
| `npm run doctor` | one line per check, "missing X ⇒ do Y", ends with the next command. `-- --for agency` adds the shared database, the 24/7 worker (alive or not), sending and tracking; `-- --json` for machines. |
| `npm run first-site -- --sample` | the whole chain on a fictional prospect (the agency's country; `pecanwood`, the Austin pool builder, while there is no `agency.config.json`), on the user's subscription (`--sample pecanwood` US, `orvane` France). `-- <url> --industry plumber` for a real one (English or French trade names). `-- --help` lists the options. |
| `npm run share` | the cockpit behind a password and a Cloudflare quick tunnel: one public link per built site, to send to the business owner. |
| `npm run backoffice` | the user's cockpit on http://127.0.0.1:4000 (or the next free port, printed and opened), with its own local database in `data/pglite` when there is no `DATABASE_URL`; three steps: `/` Prospects (the prompt field, build, skip, hands-off), `/#sites` review and send to outreach, `/#outreach` the sales steps, the call panel and its prompt; `/#settings`, `/billing.html`. The cockpit runs the jobs itself unless `npm run worker` is alive (`backoffice/reviewpipe/engine.ts`); `LWS_SANDBOX=1` simulates them. |
| `npm run cage` | STOP, today's builds against the daily cap, the plan usage estimate, the breaker, the sending mode. `-- stop "reason"` / `-- resume`. |
| `npm run typecheck && npm test` | strict TypeScript, then the offline suites in a throwaway workspace with a fake `claude`. |

## Map

- `docs/README.md` — the map of every document. `docs/GETTING-STARTED.md` (day one), `docs/ARCHITECTURE.md`,
  `docs/CONFIGURATION.md` (every variable and the agency keys), `docs/BYO-MODEL.md` (the `LWS_LLM` ways),
  `docs/GUIDE.md` (the 24/7 server).
- `packages/shared/prospect.ts` — the contract between blocks (`ProspectSheet`). Blocks only talk through `data/`.
- `architecture/orchestration/compose-batch.workflow.js` — the composer chain; `workflow-local.ts` runs the same
  script in Node, one `claude -p` per agent. `architecture/scheduling/` — the systemd units and `run-guarded.sh`.
- `packages/llm/` — the only place with model IDs (`models.ts`, roles smart/fast/judge) and the provider ways.
- `packages/shared/cage.ts`, `breaker.ts` — the cage. `outreach/tracking/` — signed links and RFC 8058.
- `leadengine/1_scraping/scripts/industries.ts` — the 66 trades (French keys, English names and terms).
- `.claude/skills/<name>/` — a `SKILL.md` is invocable as `/<name>`; a `prompt.md` (+ `schema.json`) is run by
  `packages/utils/run-skill.ts`. `docs/SKILLS.md` lists them by category.
- `data/sample/` — the fictional cast; `examples/` — three real builds; `test/fixtures/` — fictional sites and a fake
  `claude`.

## Rules for an agent working here

1. **Never send anything.** The sequencer and the warmup are dry-run unless a human sets `"dryRun": false` in
   `outreach/sequencer/config.json` **and** `LWS_LIVE_SEND=1`. Do not set either. Do not add a send path outside
   `outreach/scripts/lib/smtp.ts`.
2. **Never commit data.** `data/*` (except `data/sample/`), `output/`, `.env*` and `agency.config.json` (the
   owner's identity, created by Settings) are gitignored; leave them so, and never force-add them.
   Anything you add as an example or fixture is fictional: `.example` domains, ARCEP or 555-01xx phone ranges,
   invented names and towns. `node scripts/oss/scan.mjs .` must stay at zero.
3. **Fonts: the OFL library only** (`design/fonts/oss.lock.json`, `pairings.json`). Never copy a font from a
   captured site. **GSAP and other non-OSI libraries: CDN only**, never vendored.
4. **Skill or script.** A model call is a skill (`.claude/skills/`); deterministic work is a script
   (`<block>/scripts/*.ts`, named by a verb). Orchestration lives in `architecture/` only.
5. **Docs tell the truth.** A new variable goes in `docs/CONFIGURATION.md` and, commented out, in `.env.example`;
   a new command goes in the folder's README; `test/docs.test.ts` checks the skill count and the judge cap.
6. **English for everything a user reads** (cockpit, CLI output, docs); **no em dashes** in generated copy
   (`design/scripts/lint.mjs` enforces it on sites); no internal vocabulary (gate, sequencer, dry-run…) in the
   cockpit.
7. **Keep the cage.** Do not weaken STOP, the budget, the breaker, the locks or the opt-out registry.
8. **The code's comments are partly French** (the team is French); everything a user reads is English. Write new
   comments in English.

## Tests

`npm test` copies the tracked code into a throwaway workspace (no `data/`, no `output/`, no `.env`), strips secret
variables, puts a fake `claude` first on the PATH and cuts outbound network with a dead proxy. `npm run test:pg`
adds a throwaway Postgres (Docker); `npm run test:e2e` drives the cockpit in headless Chromium at 1440 and 390 px.
A bug fix comes with a regression test that fails on the old code.

## First session checklist (for an agent changing code)

1. `npm ci` · `npx playwright install chromium` · `npm run doctor`.
2. `npm run sandbox -- --check` to see the product green, then `npm run sandbox` to look at the cockpit.
3. Read `docs/ARCHITECTURE.md` and the README of the folder you will touch.
4. Change, test, update the doc, run `node scripts/oss/scan.mjs .`, commit with `area: what; why; test`.
