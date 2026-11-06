# Docs — map of the documentation

Every document in the repository is listed here, including the per-folder READMEs. Content is not duplicated:
this page points to each document where it lives.

## Core (`docs/`)

| document | content |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | the product, the seven-stage loop, skills vs scripts vs orchestration, the repository map |
| [CONFIGURATION.md](CONFIGURATION.md) | every environment variable the product reads, by what it controls; nothing is required to start |
| [BYO-MODEL.md](BYO-MODEL.md) | bring your own model: the `LWS_LLM` ways (Claude subscription, Codex, API key, Ollama/LiteLLM, OpenRouter/vLLM), models by role, media engines, plan-first details |
| [GUIDE.md](GUIDE.md) | from zero to a 24/7 agency: VPS, dedicated user, Claude Code, Postgres, units, hardening, tracking, reply reader, live sending, backups |
| [DESIGN-ENGINE.md](DESIGN-ENGINE.md) | the design engine: the catalog (sections, playbooks, OFL fonts, palettes, motion), the composer chain, the deterministic checks, the blind judge |
| [SKILLS.md](SKILLS.md) | the skills, by category, with the exact count (checked by `test/docs.test.ts`) |
| [PHILOSOPHY.md](PHILOSOPHY.md) | the working method: build and tool up at the same time, prove on several real cases |
| [RULES.md](RULES.md) | repository conventions |
| [mailing-lia.md](mailing-lia.md) | legitimate-interest assessment (GDPR art. 6.1.f) for B2B cold e-mail, in French |

## Entry points (root)

| document | content |
|---|---|
| [../README.md](../README.md) | what the product does, try it, first site, the cockpit, the cage, conformity |
| [../CLAUDE.md](../CLAUDE.md) | the agent's entry point: commands, map, rules, first session |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) · [../SECURITY.md](../SECURITY.md) | how to contribute, how to report a vulnerability |

## Per folder

| folder | document | content |
|---|---|---|
| lead engine | [../leadengine/README.md](../leadengine/README.md) | find, qualify and read the prospects: the funnel, cheap filters first |
| scoring | [../leadengine/2_scoring/README.md](../leadengine/2_scoring/README.md) | the gate: two gates, five weighted axes, tiers, re-scoring |
| trades | [../design/industries/RADAR.md](../design/industries/RADAR.md) | the trade radar: routing and score per trade |
| design catalog | [../design/README.md](../design/README.md) | the catalog the composer draws from |
| sections | [../design/sections/README.md](../design/sections/README.md) | the section skeletons and `index.json` |
| fonts | [../design/fonts/README.md](../design/fonts/README.md) | the OFL font library, the lock, the pairs |
| composer | [../architecture/orchestration/compose-batch.md](../architecture/orchestration/compose-batch.md) | the composer chain, the Workflow arguments, the cap |
| scheduling | [../architecture/scheduling/cron.md](../architecture/scheduling/cron.md) | the jobs, the timers, `run-guarded.sh`, monitoring |
| worker | [../worker/README.md](../worker/README.md) | the daemon that builds: modes, the coach, the units |
| outreach | [../outreach/README.md](../outreach/README.md) | contacts, drafts, the human-sent channel |
| tracking | [../outreach/tracking/README.md](../outreach/tracking/README.md) | signed click links, RFC 8058 unsubscribe, the endpoint, the caps |
| learning | [../learning/README.md](../learning/README.md) | outcomes to rules, bounded, small-sample-safe |
| Station | [../backoffice/reviewpipe/README.md](../backoffice/reviewpipe/README.md) | the cockpit server and its views |
| outreach platform | [../backoffice/salesport/README.md](../backoffice/salesport/README.md) | the CRM, the call cockpit, the sequences |
| Telegram | [../backoffice/telegram/README.md](../backoffice/telegram/README.md) | the optional review bot, closed by default |
| database | [../db/schema.sql](../db/schema.sql) | the 12 tables; `npm run db:init` applies and upgrades |
| examples | [../examples/README.md](../examples/README.md) | three real `first-site` runs on fictional prospects |
| sample data | [../data/sample/README.md](../data/sample/README.md) | the fictional cast: eight prospects, three trades, every stage |
| test fixtures | [../test/fixtures/README.md](../test/fixtures/README.md) | fictional sites, SIRENE scenarios, the fake `claude` |
