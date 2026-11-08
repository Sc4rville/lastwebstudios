# Architecture

> The **what** and the **how**: the product, the loop, the nature of each piece, the repository map. For the
> working method see [PHILOSOPHY.md](PHILOSOPHY.md); for the design engine, [DESIGN-ENGINE.md](DESIGN-ENGINE.md);
> for every variable, [CONFIGURATION.md](CONFIGURATION.md).

## The product

A web agency that runs itself. The system finds local businesses with a weak website, **builds a demonstration
site from their own content**, and contacts them with that site already made. The demo *is* the sales argument: a
result is shown, not a proposal. Demo sites are front-end only; a back end is built after a signature.

The product is the **scaling of an agency's production**: a piece of know-how captured as a *skill* produces a
quality result on its own, and a library of coordinated skills produces whole sites, in series, while a human
keeps two decisions: which prospects to approve, and which site to send.

## The loop

Seven stages. Each one **reads what precedes it and writes its result**, and talks to the others **only through
files in `data/`** (and the shared database when there is one). No block calls the next one. That is what makes
every stage independent, replaceable and re-runnable on its own.

```
 FIND          SCORE            READ             BUILD                JUDGE          SELL              LEARN
 OSM, SIRENE   the gate         browser parse    diagnose → compose   blind A/B      approve (human)   outcomes →
 66 trades  →  5 axes, no   →   → ProspectSheet  → lint/verify     →  cap 2       →  sequencer, CRM →  bounded
 enrich        model call       (skill)          (agents)             (skill)        calls (human)     rules
                                                                                                        │
                      ◀──────────────────────── reweights the gate ◀────────────────────────────────────┘
```

| stage | what it does | where |
|---|---|---|
| **find** | OpenStreetMap (independent businesses with a website, chains excluded), SIRENE (the French registry), domain guessing and DNS validation; a search-engine fallback exists and is off by default | `leadengine/1_scraping/` |
| **score** | the gate: two hard gates (fit, feasibility) then five weighted axes (need 30, leverage 25, value 20, reachability 15, expansion 10) read from the raw HTML with no model call; a visual judge only on the sites the probe would let through; tiers hot ≥ 60, warm ≥ 35, cold | `leadengine/2_scoring/` |
| **read** | a real browser captures the current site (full-page "before", photos, logo, menu, text, an audit of real defects); a skill turns the text into a `ProspectSheet` | `leadengine/3_parsing/`, skill `structuration` |
| **build** | Claude Code agents: diagnose the old site, optional asset boost, compose from the catalog, deterministic lint and verify, self-review | `architecture/orchestration/compose-batch.workflow.js`, skills `diagnose`, `asset-boost`, `composer` |
| **judge** | a neutral model compares before and after blind, A/B order alternated, on full-page captures; pass only if clearly more beautiful, otherwise one more round (cap 2) | skill `beauty-gate` |
| **sell** | the human approves in the Station; the account research writes a brief and a call script into the CRM; the sequencer runs a click-gated, dry-run-first funnel with self-hosted tracking; replies become Hot Leads; the call cockpit records outcomes | `backoffice/`, `outreach/`, skills `account-research`, `generate-savior` |
| **learn** | sent, reply, meeting, won, lost are recorded once per prospect and recomputed into bounded rules (±15 per trade, signal weights 0.5 to 1.5, damped by sample size) that the gate reads at its next run | `learning/` |

**Two human decisions, no more**: approve the prospects, choose the site. Everything else runs on its own, and
the learning loop closes the circle.

## Three natures: skill, script, orchestration

One rule sorts the code: **tell at a glance what costs a model call and what does not.**

| nature | what it is | where | model call |
|---|---|---|---|
| **skill** | a judgment or a generation | `.claude/skills/<name>/` — a `SKILL.md` (invocable as `/<name>`, used by the agents) or a `prompt.md` with an optional `schema.json` (run by `packages/utils/run-skill.ts`, strict JSON out) | yes |
| **script** | deterministic mechanics: scrape, score, parse, lint, verify, package, serve | `<block>/scripts/*.ts`, named by a verb | no |
| **orchestration** | who calls what, in which order | `architecture/` — the **single authority** | – |

A block holds capabilities only; the order lives in `architecture/`. The cheap filter runs first; the browser and
the model only run on what survived the gate.

Skills go through **two engines**, chosen by two switches (details in [BYO-MODEL.md](BYO-MODEL.md)):

- **structured calls** (`structuration`, `visual-scoring-gate`, `generate-savior`, the diagnoses used by scripts)
  go through `packages/llm/` and the way selected by `LWS_LLM`: the Claude subscription through `claude -p`
  (default), Codex, the Claude API, any Messages-compatible server, any Chat-Completions-compatible server;
- **agents** (`composer`, `diagnose`, `beauty-gate`, `account-research`, the coach, edits) run in Claude Code,
  either through its Workflow tool (parallel agents) or through `architecture/orchestration/workflow-local.ts`
  (the same script executed in Node, one `claude -p` per agent).

`packages/llm/models.ts` is the only file that names a model: the product reasons in roles (`smart`, `fast`,
`judge`) and every role can be overridden.

## The contract

[`packages/shared/prospect.ts`](../packages/shared/prospect.ts) defines the `ProspectSheet`: identity, content
(tagline, about, services, brands), assets (logo, photos, optional video), the existing site and its capture, the
score with its five axes, and what the diagnosis adds. The lead engine writes it to `data/prospects/<id>.json`;
the design engine reads it. It is the only thing the two halves share, kept stable and minimal. The trade key is
normalized through `leadengine/1_scraping/scripts/industries.ts`, the single vocabulary of the 66 trades.

## Orchestrators

| orchestrator | what it runs | how |
|---|---|---|
| `architecture/orchestration/run.ts` | `npm run pipeline`: the lead engine on a seed (score → parse → sheet) | a script; `DESIGN=0` stops at the sheet |
| `architecture/orchestration/compose-batch.workflow.js` | the composer chain per prospect: diagnose → asset boost → compose → lint and verify → self-review → blind judge (cap 2) | a Workflow script, run by Claude Code's Workflow tool or by `workflow-local.ts` |
| `scripts/first-site.ts` | one prospect end to end on your account, nothing synced, boost off by default | a script around the two above |
| `worker/worker.ts` | the daemon: claims a batch from `batch_requests`, runs the composer (`compose-worker.md`), an edit (`edit-worker.md`) or an account research (`research-worker.md`), lets the coach check the served render, re-indexes the Station | a service |
| `outreach/scripts/sequencer.ts` | one tick: STOP → reply reader → events (clicks, unsubscribes, bounces) → breaker → due sends | a timer |
| `architecture/scheduling/` | when each job runs, through `run-guarded.sh` (lock, cage, state, alert) | systemd user units |

## The cage

What keeps an unattended machine from doing damage, in `packages/shared/cage.ts` and `breaker.ts`:

1. **STOP**: a `STOP` file at the root, or the cockpit flag in the database. The worker exits (code 3, not
   restarted), the sequencer and the warmup skip, every scheduled job is skipped, the media boost spends nothing.
2. **Budget**: `LWS_BUDGET_USD_DAY` per UTC day over `data/logs/spend.jsonl`; each agent gets `--max-budget-usd`.
3. **Breaker**: bounces, complaints and unsubscribes over their thresholds latch the breaker until a human re-arms it.
4. **Sending**: dry-run unless `config.dryRun === false` **and** `LWS_LIVE_SEND=1`; opt-outs are final; a tick is
   locked against a second tick on any machine sharing the database.

## Repository map

```
architecture/      the single orchestration authority
  orchestration/   run.ts · compose-batch.workflow.js (+ .md) · workflow-local.ts
  scheduling/      lws-*.service / .timer · install-units.sh · run-guarded.sh · cron.md
leadengine/        find, qualify, read
  1_scraping/      scrape (OSM) · company (SIRENE) · enrich · emails · qualify · radar · industries.ts (the 66 trades)
  2_scoring/       score (the gate) · model (axes) · visual-gate · rescore
  3_parsing/       parse (browser) · structure (skill) · audit · crawl
design/            the catalog the composer draws from
  sections/        section skeletons + index.json          industries/<trade>/playbook.md
  fonts/           the OFL library, oss.lock.json, pairings  palettes/ · motion/ · catalog.json
  scripts/         lint.mjs · asset-audit.mjs · demo-video.ts
outreach/          sell
  scripts/         sequencer · warmup · savior · contacts · draft · mark · research-save · lib/ (smtp, imap, optout)
  sequencer/       config.json (steps, inboxes, breaker thresholds)
  tracking/        links (signed tokens) · endpoint (/t/) · events
learning/          record → outcomes · learn → rules/rules.json · rules (read by the scoring)
backoffice/        the human interfaces
  reviewpipe/      serve.ts (the Station, /api, /t/, SSE) · public/ · machine.ts · invoices.ts · lws-cockpit.service
  salesport/       the outreach platform: CRM, call queue, call cockpit
  telegram/        the optional bot
worker/            worker.ts · compose-worker.md · edit-worker.md · research-worker.md · coach · claude-args · media engines · lws-worker.service
packages/
  shared/          prospect.ts (the contract) · cage · breaker · db · agency · lock · lines · media · storage
  llm/             provider (the ways) · models (the roles) · adapters/ · claude-code-status · json
  utils/           run-skill.ts (the runner of prompt.md skills)
scripts/           doctor · first-site · sandbox · cage · batch · reindex · lib/ (files, pglite-server, serve-dir) · oss/ (scan, fonts)
db/                schema.sql (12 tables) · init.ts
.claude/skills/    the skills (see SKILLS.md)
data/sample/       the fictional cast          examples/   three real builds        test/   unit · pg · e2e · fixtures
agency.config.json the agency's identity        .env.example  every variable, commented
```

Generated by a run, never committed: `data/*` (except `data/sample/`), `output/sites/`, `.sandbox/`, `data/logs/`.

## One documented exception to the isolation

`learning/rules` → `leadengine/2_scoring`: the learning loop produces the rules the scoring applies. The scoring
**reads** them, never writes them. With no rules file (a fresh clone), `loadRules()` returns `{}` and the gate runs
exactly on its baselines: the loop can refine the gate, it can never break it.
