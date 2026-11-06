# Contributing

Thanks for looking under the hood. This page is the short version of how the repository works; the long
version is in [docs/](docs/README.md).

## Set up

```bash
git clone https://github.com/Sc4rville/lastwebstudios.git && cd lastwebstudios
npm ci                                  # Node >= 20.12 (24 recommended, same as the Docker image)
npx playwright install chromium         # scoring, parsing, captures and the render check need a browser
npm run sandbox                         # a fictional agency on 127.0.0.1, no key, no .env
npm run doctor                          # what your machine is missing, and the exact command to fix it
```

Claude Code is only needed to build sites (`npm run first-site`) or to run the worker. Everything else,
including the whole test suite, runs without it: the tests use a fake `claude` binary.

## Test

| command | what it runs | needs |
|---|---|---|
| `npm run typecheck` | `tsc --noEmit`, strict, repo + tests | nothing |
| `npm test` | unit and integration suites, offline, in a throwaway workspace with no `.env`, no key and a fake `claude` | Chromium |
| `npm run test:pg` | the same product against a throwaway Postgres (one container per run) | Docker |
| `npm run test:e2e` | the cockpit in a headless browser at 1440 and 390 px | Docker + Chromium |
| `npm run sandbox -- --check` | mounts the fictional agency, plays the story, verifies every view, exits | nothing |
| `node scripts/oss/scan.mjs .` | "nothing real" scan: phones outside fiction ranges, non-reserved e-mails, public IPs, home paths, fonts outside the OFL lock | nothing |

A change in behavior comes with a test. When you fix a bug, write the test first and watch it fail on the
old code; the history of this repository follows that rule and it is what keeps it green.

## How the code is organized

One rule sorts everything: **what costs a model call and what does not**.

| nature | what it is | where | model call |
|---|---|---|---|
| **skill** | a judgment or a generation: a prompt with named inputs and a strict JSON output | `.claude/skills/<name>/` with a `SKILL.md` (invocable as `/<name>`) or a `prompt.md` (+ `schema.json`) run by `packages/utils/run-skill.ts` | yes |
| **script** | deterministic mechanics: scrape, score, parse, lint, verify, package | `<block>/scripts/*.ts`, named by a verb | no |
| **orchestration** | the order of the steps | `architecture/` only | – |

Blocks (`leadengine/`, `design/`, `outreach/`, `learning/`) talk to each other **only through files in
`data/`**, never by importing each other. The one documented exception: the scoring reads the rules the
learning loop writes. The contract between blocks is `packages/shared/prospect.ts` (`ProspectSheet`).

Other conventions:

- one `README.md` per folder, kept short; tables over paragraphs;
- file and folder names in lowercase kebab-case, no accents;
- the data a run produces (`data/*`, `output/`) is never committed; `data/sample/` is the only exception and
  it is fictional by construction;
- fonts come from the OFL library only (`design/fonts/oss.lock.json`); never copy a font from a captured site;
- GSAP and other non-OSI libraries are loaded from a CDN, never vendored;
- generated copy (sites, mails) contains no em dashes; `design/scripts/lint.mjs` enforces it;
- every environment variable the product reads is documented in `docs/CONFIGURATION.md`, commented out in
  `.env.example`, and reported by `npm run doctor`.

## Fictional data only

Anything you add as an example, fixture or test must be invented: company names that do not exist, towns
that do not exist, `.example` domains (RFC 2606), French phone numbers in the ARCEP ranges reserved for
fiction (`01 99 00`, `02 61 91`, `03 53 01`, `04 65 71`, `05 36 49`, `06 39 98`), artwork made from scratch.
`node scripts/oss/scan.mjs .` is the gate; CI runs it on every push.

## Sending

The product never sends an e-mail on its own. A real send needs `"dryRun": false` in
`outreach/sequencer/config.json` **and** `LWS_LIVE_SEND=1` in the environment, both set by a human. Do not
add a code path that sends without going through `outreach/scripts/lib/smtp.ts` and these two switches,
and do not weaken the cage (`packages/shared/cage.ts`: STOP file, daily budget, breaker).

## Commits and pull requests

- One commit per logical change. First line: `area: what changed; why; test` (for example
  `sequencer: a second tick waits for the lock instead of double-sending; test`).
- Keep the pull request small and explain what you observed, not only what you changed.
- Before opening it: `npm run typecheck && npm test && node scripts/oss/scan.mjs .` all green, docs updated
  when a command, a variable or a behavior changed.

## Where to start

Good first contributions: a new trade playbook in `design/industries/<trade>/playbook.md`, a new section
skeleton in `design/sections/`, an English translation of the cockpit UI (the product is built for the French
market and the cockpit speaks French), a lead source beyond OpenStreetMap and SIRENE, a reply reader for a
mailbox provider other than Gmail.
