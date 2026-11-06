# CLAUDE.md — Last Web Studios

> Loaded at the start of every session. This file orients you; the knowledge lives in `docs/`, the actions in
> `.claude/skills/` and `npm run …`.

## What this is

A web agency that runs itself: it **finds** local businesses with a dated website (OpenStreetMap, SIRENE),
**scores** them without a model call, **reads** the site in a real browser into a `ProspectSheet`, **builds** a
bespoke site with Claude Code agents (diagnose → compose → lint/verify → blind beauty judge, cap 2), lets a human
**approve** in the cockpit, **sells** through a dry-run-first mail sequencer and a call cockpit, and **learns** from
every outcome. Built for the French market: the cockpit UI and the generated copy are French; docs are English.

## The commands

| command | what it does |
|---|---|
| `npm run sandbox` | a fictional agency on 127.0.0.1: embedded Postgres, cast, cockpit, the whole story. No key, no `.env`. `-- --check` verifies every view and exits. |
| `npm run doctor` | one line per check, "missing X ⇒ do Y". `-- --for first-site` for the minimum, `-- --json` for machines. |
| `npm run first-site -- --sample orvane` | the whole chain on a fictional prospect, on the user's Claude subscription. `-- <url>` for a real one. `--engine local` on a Pro plan. |
| `npm run backoffice` | the cockpit on http://127.0.0.1:4000, three steps: `/` Prospects (the prompt field, build, skip, hands-off), `/#sites` review and send to outreach, `/#outreach` the sales steps, the call panel and its prompt; `/#settings`, `/billing.html`. The cockpit runs the jobs itself unless `npm run worker` is alive (`backoffice/reviewpipe/engine.ts`); `LWS_SANDBOX=1` simulates them. |
| `npm run cage` | STOP, daily budget, breaker, send mode. `-- stop "reason"` / `-- resume`. |
| `npm run typecheck && npm test` | strict TypeScript, then the offline suites in a throwaway workspace with a fake `claude`. |

## Map

- `docs/README.md` — the map of every document. Start with `docs/ARCHITECTURE.md`, then `docs/CONFIGURATION.md`
  (every variable) and `docs/BYO-MODEL.md` (the `LWS_LLM` ways). `docs/GUIDE.md` is the 24/7 setup.
- `packages/shared/prospect.ts` — the contract between blocks (`ProspectSheet`). Blocks only talk through `data/`.
- `architecture/orchestration/compose-batch.workflow.js` — the composer chain; `workflow-local.ts` runs the same
  script in Node, one `claude -p` per agent. `architecture/scheduling/` — the systemd units and `run-guarded.sh`.
- `packages/llm/` — the only place with model IDs (`models.ts`, roles smart/fast/judge) and the provider ways.
- `packages/shared/cage.ts`, `breaker.ts` — the cage. `outreach/tracking/` — signed links and RFC 8058.
- `.claude/skills/<name>/` — a `SKILL.md` is invocable as `/<name>`; a `prompt.md` (+ `schema.json`) is run by
  `packages/utils/run-skill.ts`. `docs/SKILLS.md` lists them by category.
- `data/sample/` — the fictional cast; `examples/` — three real builds; `test/fixtures/` — fictional sites and a fake
  `claude`.

## Rules for an agent working here

1. **Never send anything.** The sequencer and the warmup are dry-run unless a human sets `"dryRun": false` in
   `outreach/sequencer/config.json` **and** `LWS_LIVE_SEND=1`. Do not set either. Do not add a send path outside
   `outreach/scripts/lib/smtp.ts`.
2. **Never commit data.** `data/*` (except `data/sample/`), `output/` and `.env*` are gitignored; leave them so.
   Anything you add as an example or fixture is fictional: `.example` domains, ARCEP fiction phone ranges,
   invented names and towns. `node scripts/oss/scan.mjs .` must stay at zero.
3. **Fonts: the OFL library only** (`design/fonts/oss.lock.json`, `pairings.json`). Never copy a font from a
   captured site. **GSAP and other non-OSI libraries: CDN only**, never vendored.
4. **Skill or script.** A model call is a skill (`.claude/skills/`); deterministic work is a script
   (`<block>/scripts/*.ts`, named by a verb). Orchestration lives in `architecture/` only.
5. **Docs tell the truth.** A new variable goes in `docs/CONFIGURATION.md` and, commented out, in `.env.example`;
   a new command goes in the folder's README; `test/docs.test.ts` checks the skill count and the judge cap.
6. **No em dashes** in generated copy (sites, mails); `design/scripts/lint.mjs` enforces it on sites.
7. **Keep the cage.** Do not weaken STOP, the budget, the breaker, the locks or the opt-out registry.

## Tests

`npm test` copies the tracked code into a throwaway workspace (no `data/`, no `output/`, no `.env`), strips secret
variables, puts a fake `claude` first on the PATH and cuts outbound network with a dead proxy. `npm run test:pg`
adds a throwaway Postgres (Docker); `npm run test:e2e` drives the cockpit in headless Chromium at 1440 and 390 px.
A bug fix comes with a regression test that fails on the old code.

## First session checklist

1. `npm ci` · `npx playwright install chromium` · `npm run doctor`.
2. `npm run sandbox -- --check` to see the product green, then `npm run sandbox` to look at the cockpit.
3. Read `docs/ARCHITECTURE.md` and the README of the folder you will touch.
4. Change, test, update the doc, run `node scripts/oss/scan.mjs .`, commit with `area: what; why; test`.
