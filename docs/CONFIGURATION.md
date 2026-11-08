# Configuration reference

Every environment variable the product reads, grouped by what it controls. **Nothing is required to start**:
`npm run sandbox` needs no variable at all, and `npm run first-site` runs on your Claude subscription with an empty
environment. Copy [`.env.example`](../.env.example) to `.env` and uncomment only what you need. Scripts load `.env`
from the repository root (`process.loadEnvFile()`); systemd units also read `~/lws/.env` (`EnvironmentFile=`).

A variable read by the product and missing here is a documentation bug: please open an issue. `npm run doctor`
tells you which of these your machine is missing for what you want to run.

The agency's identity (name, sender, legal footer, HELO, User-Agent, invoices, CRM operators, storage bucket) is not
an environment variable: it lives in `agency.config.json` (fictional examples: `agency.config.example.us.json`, the default until you save Settings, and `agency.config.example.json` for France).

## Database and storage

| Variable | Default | What it does |
|---|---|---|
| `DATABASE_URL` | none | Any Postgres 14+ (`postgres://user:pass@host:5432/db`). Optional for a first site (the Station reads the disk); required for the 24/7 agency: CRM, batch queue, worker, shared state between machines. Create the schema with `npm run db:init` (idempotent, also upgrades an older database). Supabase on IPv4: use the **session pooler** URL. |
| `DB_SSL` | `require`, except loopback | `disable` \| `require` \| `prefer` \| `verify-full`. No TLS on `127.0.0.1`/`localhost`. Use `disable` for a self-hosted Postgres without TLS on a private network. |
| `DB_POOL_MAX` | 4 (cockpit), 10 (scripts) | Connections per process. The sandbox (PGlite) sets 1. |
| `SUPABASE_SERVICE_KEY` | none | Supabase `service_role` key, only to upload media to a Storage bucket. `SUPABASE_KEY` is accepted as an alias. |
| `SUPABASE_KEY` | none | Alias of `SUPABASE_SERVICE_KEY`. |
| `SUPABASE_URL` | derived from `DATABASE_URL` | `https://<ref>.supabase.co`, only if it cannot be derived. |
| `SUPABASE_BUCKET` | `agency.config.json` › `storage.bucket` | Storage bucket for media. |
| `ASSETS_BASE_URL` | none | Public base URL of a self-hosted media server (for example Caddy on the box). Takes priority over Supabase Storage. |

## Models: bring your own (see [BYO-MODEL.md](BYO-MODEL.md))

Two engines: **skills** (JSON calls: prospect sheet, visual gate, filler, savior mail, cyber audit) go through
`packages/llm` and `LWS_LLM`; **agents** (composer, coach, account research) always run in Claude Code, which reads its
own variables (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_USE_BEDROCK` / `_VERTEX` / `_FOUNDRY`,
`CLAUDE_CONFIG_DIR`, documented at code.claude.com).

| Variable | Default | What it does |
|---|---|---|
| `LWS_LLM` | `claude-code` | Way for the skills: `claude-code` (your Claude subscription through `claude -p`) \| `codex` (your ChatGPT subscription through the Codex CLI, `codex exec --output-schema`) \| `anthropic` (API key) \| `anthropic-compatible` (any Messages API: Ollama ≥ 0.14, LM Studio, llama.cpp, LiteLLM, a gateway) \| `openai-compatible` (any Chat Completions API: OpenAI, OpenRouter, Groq, Together, vLLM, Ollama). Without it, an `OPENAI_BASE_URL` selects openai-compatible and a non-Anthropic `ANTHROPIC_BASE_URL` selects anthropic-compatible. An API key alone never switches away from the plan. |
| `LWS_CODEX_BIN` | `codex` | The Codex CLI binary used by the `codex` way, if it is not `codex` on the PATH. `codex login` once with your ChatGPT account; models default to the CLI's own default, `LWS_MODEL_<ROLE>` pins one. |
| `LLM_VIA` | none | Legacy switch, still understood: `plan` (= claude-code) \| `api` (= anthropic). |
| `LWS_MODEL_SMART` | `claude-opus-5-5` (API) · `opus` (plan) | Composer, filler, edit, cyber audit, coach, savior mail. |
| `LWS_MODEL_FAST` | `claude-haiku-5-5` · `haiku` | Prospect sheet (structuration), personas. |
| `LWS_MODEL_JUDGE` | `claude-sonnet-5-5` · `sonnet` | Vision: visual gate, diagnose, self-review, beauty-gate. Must accept images. |
| `LWS_MODEL` | none | One model for every role (typical for a local model). |
| `ANTHROPIC_MODEL`, `OPENAI_MODEL` | none | Fallback model names for the matching way, after `LWS_MODEL_*` and `LWS_MODEL`. |
| `COACH_MODEL` | the smart model | Model of the quality coach that reviews a served site before publishing. |
| `LWS_EFFORT_<ROLE>` | the model's default | `low` \| `medium` \| `high` \| `xhigh` \| `max`, per role (`LWS_EFFORT_SMART`, `LWS_EFFORT_FAST`, `LWS_EFFORT_JUDGE`) or for all (`LWS_EFFORT`). Claude API only. |
| `LWS_STRUCTURED` | on for `anthropic`, off for compatible ways | `1` forces native structured output on a compatible server, `0` disables it (JSON is then extracted from the text). |
| `LWS_PROMPT_CACHE` | on for `anthropic` | `1` sends `cache_control` to an anthropic-compatible gateway too. |
| `LWS_LLM_RETRIES` | 4 | Retries of the Anthropic SDK. |
| `LWS_LLM_TIMEOUT_MS` | 600000 | Timeout of one openai-compatible call. |
| `LWS_OPENAI_TOKEN_PARAM` | `max_tokens` | `max_completion_tokens` for servers that require it (retried automatically on a 400 anyway). |
| `ANTHROPIC_API_KEY` | none | Claude API key (`LWS_LLM=anthropic`). Removed from every `claude -p` the product starts, so agents stay on your plan (in `-p` mode Claude Code would otherwise prefer the key). |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | A proxy, gateway or local Messages server. Also read by Claude Code for the agents. |
| `ANTHROPIC_AUTH_TOKEN` | none | Bearer token for that server (`ollama` for Ollama). Also read by Claude Code. |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Chat Completions server for `openai-compatible`. |
| `OPENAI_API_KEY` | none | Key for that server (optional on a local server). Also enables the image boost (`LWS_IMAGE`). |
| `CLAUDE_CODE_OAUTH_TOKEN` | none | One-year subscription token from `claude setup-token`, for a server without a browser. Read by Claude Code. Not needed if you ran `claude auth login` as the same user. |
| `CLAUDE_BIN` | `claude` | Path of the Claude Code binary (skills, worker, local engine). |
| `CLAUDE_CODE_SIMPLE` | unset | Claude Code's "bare" switch. Must stay unset: bare mode reads neither your plan nor the skills, so `npm run doctor` flags it and the worker refuses to start. |
| `LWS_CLAUDE_SETTING_SOURCES` | `project` | Setting sources of the pure skill calls on the plan. `user,project,local` restores your hooks and plugins (about 25k tokens of context per call instead of about 1k). |

## Worker, composer and first site

| Variable | Default | What it does |
|---|---|---|
| `WORKER_NAME` | hostname | Readable id of this worker in the queue. |
| `WORKER_POLL_MS` | 15000 | How often an idle worker looks at the queue. |
| `WORKER_CLAUDE_ARGS` | `-p --strict-mcp-config --allowedTools Bash Read Write Edit Glob Grep Agent Workflow Skill WebFetch WebSearch` | Arguments of every agent `claude -p`. No MCP server is loaded by default. |
| `WORKER_CLAUDE_BIN` | `CLAUDE_BIN` | Claude Code binary of the coach. |
| `WORKER_PLAN_STRICT` | on | `0` keeps `ANTHROPIC_API_KEY` in the agents' environment (they then bill the API). |
| `WORKER_LLM_VIA` | `plan` | Way of the lead-engine steps run inside a template-fill batch (`plan` \| `api`). |
| `WORKER_NO_COACH` | off | `1` skips the quality coach after a composer batch. |
| `WORKER_STOP_POLL_MS` | 5000 | How often a running agent checks the STOP switch. |
| `CURSOR_INJECT` | off | `1` injects the custom cursor into new sites (experimental). |
| `LWS_AGENT_TIMEOUT_MS` | 2700000 (45 min) | Timeout of one agent in the local engine. |
| `LWS_FIRST_SITE_TIMEOUT_MS` | 7200000 (2 h) | Timeout of the Workflow engine in `npm run first-site`. |

## Media engines (optional)

| Variable | Default | What it does |
|---|---|---|
| `LWS_IMAGE` | `openai` if `OPENAI_API_KEY` is set, else `none` | Image boost of the prospect's real photos. `none` is not a failure: the composer keeps the real photos. |
| `OPENAI_IMAGE_BASE_URL` | `https://api.openai.com/v1` | Any compatible Images API. |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2` | Image model. |
| `LWS_VIDEO` | `higgsfield` if a key or the `higgsfield` CLI is present, else `none` | Hero video. |
| `HIGGSFIELD_API_KEY` | none | Higgsfield account key. |
| `HIGGSFIELD_API_BASE` | `https://api.higgsfield.ai` | Higgsfield API base. |
| `HF_VIDEO_MODEL` | `kling3_0_turbo` | Hero video model. |
| `DEMO_FORCE` | off | `1` re-renders the demo video even if it is already in the bucket (`npm run demo`). |

## Lead engine: find, score, read

| Variable | Default | What it does |
|---|---|---|
| `SOURCES` | `osm` (+ `sirene` when the zone touches France) | `osm,sirene,gmaps`. |
| `GMAPS_CSV` | none | Ingest a Google Maps CSV you produced yourself (opt-in; read the terms in [GUIDE.md](GUIDE.md) §10). |
| `DEPTS` | all of France | SIRENE departments, for example `69,13,75`. |
| `PER_SOURCE` | 200 | Cap per source (SIRENE enrichment is slow). |
| `LIMIT` | none | Cap of new prospects added (also the batch size of `npm run pipeline`). |
| `ENRICH` | on | `0`: do not look for the website of SIRENE companies (rows without a site are dropped). |
| `ENRICH_CONC` | 8 | Parallel enrichments. |
| `HARVEST` | on | `0`: do not read phone and e-mail from the prospect's own site. |
| `HARVEST_CONC` | 8 | Parallel harvests. |
| `LWS_SIRENE` | on | `0` disables the company lookup (recherche-entreprises.api.gouv.fr). |
| `LWS_SIRENE_URL` | the public API | Another endpoint (tests). |
| `VISUAL` | on | `0` skips the visual gate (screenshots judged by the LLM) and scores on HTML signals only, zero LLM. |
| `SCORE_CONC` | 3 | Parallel scorings (Playwright + LLM). |
| `RESCORE_PROBE` | on | `0`: `npm run rescore` does not re-probe the site's HTML. |
| `PAGESPEED_KEY` | none | Google PageSpeed Insights key for the performance part of `npm run audit` (best effort: without it the PSI call is often rate-limited and the audit carries on without a perf score). |
| `VERIFY_HELO` | `agency.config.json` › `mail.heloDomain` | HELO name of the SMTP verifier. Needs outbound port 25, which most clouds block by default. |
| `VERIFY_CSV` | none | Verify the e-mails of a CSV instead of the prospect sheets. |
| `VERIFY_OUT` | `outreach/sequencer/verified-emails.json` | Output of the verifier. |
| `VERIFY_REPORT` | `outreach/sequencer/verified-report.json` | Report of the verifier. |
| `SEED` | `data/raw/cuisinistes.seed.csv` | Seed CSV of `npm run pipeline` (template-fill path). |
| `INDUSTRY`, `ZONE` | none, `fr` | `npm run pipeline` scrapes this trade in this zone first if the seed is short. |
| `FORCE` | off | `1` builds even what the gate rejects (debug). |
| `DESIGN` | on | `0` stops `npm run pipeline` at the prospect sheet. |
| `PIPELINE_JSON` | off | `1` prints the pipeline report as JSON. |

## Station (cockpit) and local servers

| Variable | Default | What it does |
|---|---|---|
| `BACKOFFICE_HOST` | `127.0.0.1` | Listening address. `0.0.0.0` only inside a container behind a proxy. |
| `BACKOFFICE_PORT` | 4000 (next free port if busy) | Cockpit port. `npm run backoffice` prints and opens the port it really uses. |
| `LWS_LOCAL_DB` | `1` with `npm run backoffice` | With no `DATABASE_URL`: an embedded Postgres on disk in `data/pglite`, served on 127.0.0.1 to the cockpit and the jobs it runs (Find prospects, the call list, the job queue work on a laptop). `0`: go without (the cockpit reads `output/` only). One cockpit at a time per folder. |
| `BACKOFFICE_PASSWORD` | none | Basic auth on every route except the public tracking `/t/`. **Required before any exposure**: without it, a request with a non-local Host gets 403. |
| `BACKOFFICE_USER` | `lws` | Basic auth user name. |
| `BACKOFFICE_ALLOWED_HOST` | none | A tunnel host to accept without password (for example `.trycloudflare.com`); prefer a password. |
| `LWS_NO_OPEN` | off | `1`: `npm run backoffice` does not open a browser. |
| `LWS_RUN_DIR` | `output/lab` | Where `npm run backoffice` keeps its pidfile. |
| `SALES_PORT` | 4555 | Local sales platform (`npm run sales`), loopback only. |
| `CAL_HOST`, `CAL_PORT` | `127.0.0.1`, 4112 | Activity calendar (`npm run calendar`). Its POST commits and pushes: keep it on loopback. |
| `NO_OPEN` | off | Set: `npm run calendar` does not open a browser. |
| `DOCS_PORT` | 4111 | Documentation viewer (`npm run docs`). |
| `TELEGRAM_BOT_TOKEN` | none | Review bot (`npm run telegram`), from @BotFather. |
| `TELEGRAM_ALLOWED_CHAT_IDS` | none (the bot serves nobody) | Comma-separated chat ids the bot obeys. Write to the bot once: it logs your id. |
| `TELEGRAM_API_BASE` | `https://api.telegram.org` | Another Bot API endpoint (tests, self-hosted Bot API). |
| `PREVIEW_PORT` | 4100 | Port of the bot's site previews. |

## Outreach, tracking and replies (dry-run first)

A real send needs **two keys**: `"dryRun": false` in `outreach/sequencer/config.json` **and** `LWS_LIVE_SEND=1`.
With either missing, every mail is written as an `.eml` in `data/sequencer/outbox/` and nothing leaves.

| Variable | Default | What it does |
|---|---|---|
| `LWS_LIVE_SEND` | unset (dry-run everywhere) | `1` allows real sends (sequencer and warmup). Put it in the systemd unit, not in `.env`. |
| `LWS_MAIL_TRANSPORT` | `gmail` | `simulated` logs the call in `data/sequencer/transport.jsonl` and sends nothing (rehearsals). |
| `LWS_SIMULATED_FAIL` | none | The simulated transport fails for recipients containing this text (rehearse errors). |
| `LWS_SIMULATED_DELAY_MS` | 0 | Latency of each simulated send (concurrency tests). |
| `LWS_REPLY_READER` | `gmail` if `outreach/sequencer/sa-key.json` exists, else `none` | `gmail` (read-only Gmail API) \| `file` (`data/sequencer/inbox.jsonl`) \| `none`. A reply stops the sequence and creates a Hot Lead. |
| `TRACK_BASE` | none | Public HTTPS URL of the Station: the signed click and one-click unsubscribe links (`/t/`) point there. |
| `LWS_TRACK_SECRET` | none | HMAC secret of those links, at least 32 characters (`openssl rand -base64 48`). Same value on the Station and on the machine that runs the sequencer. Without `TRACK_BASE` and this secret, no link is rewritten and unsubscribing works by replying "STOP". |
| `LWS_SEQ_LOCK_WAIT_MS` | 180000 | How long a second sequencer or warmup command waits for the lock before exiting 75. |
| `DIGEST_TO` | none (required for the digest) | Recipient of the warmup's daily report (`npm run warmup -- digest`). |
| `DIGEST_FROM` | first inbox of pool B | Sender of that report. |
| `OUTREACH_SITE_BASE` | none | Public base of the new sites, used to fill the link in `/out` drafts. |
| `OUTREACH_DEMO` | on | `0`: no demo video link in `/out` drafts. |
| `OUTREACH_FROM_NAME` | `[Your first name]` (`[Votre prénom]` for a French agency) | Signature first name in `/out` drafts. |

## The cage: stop, budget, breaker

| Variable | Default | What it does |
|---|---|---|
| `LWS_STOP_FILE` | `STOP` | Emergency stop file at the repository root (`npm run cage -- stop "why"`, or the Station's STOP button). Worker, sequencer, warmup, media and every timer honour it. |
| `LWS_BUDGET_USD_DAY` | none (no cap) | Spend cap per UTC day (agents, skills, images, videos; ledger `data/logs/spend.jsonl`). Reached: the worker claims no job until midnight UTC. On the plan these are Claude Code's estimates, not invoices. |
| `LWS_BUILDS_PER_DAY` | derived | The daily cap in **builds** (sites built per UTC day; ledger `data/logs/builds.jsonl`), what Hands-off, the cockpit's engine and the worker keep to: a build job past it keeps what fits, the rest waits for tomorrow. Absent: `LWS_BUDGET_USD_DAY` ÷ `LWS_SITE_USD` (rounded down); neither: no cap. Hands-off asks for it before it turns on. |
| `LWS_SITE_USD` | 3 | The estimate of one site build in $ of plan usage (what the cockpit says a build uses, and the divisor of the derived cap). An estimate, not a charge. |
| `LWS_JOB_MAX_USD` | none | Cap of one agent job (`--max-budget-usd`, bounded by what is left of the day). |
| `LWS_IMAGE_USD` | 0.25 | Estimated cost of one image when the provider returns no price. |
| `LWS_VIDEO_USD` | 1.50 | Estimated cost of one video. |

The deliverability breaker (bounces, complaints, unsubscribes) is configured in `outreach/sequencer/config.json`
› `breaker`, not by environment.

## Scheduling (systemd units and scripts)

| Variable | Default | What it does |
|---|---|---|
| `LWS_BATCH_SIZE` | 5 | Prospects per nightly composer batch (`lws-batch.timer`). |
| `LWS_BATCH_ARGS` | empty (trade chosen by `npm run radar`) | Extra `npm run batch` options, for example `--industry menuisier`. |
| `LWS_SCRAPE_ARGS` | `cuisiniste all` | Trade and zone of the weekly scrape (`lws-scrape.timer`): `<trade> fr\|be\|ch\|all`. |
| `LWS_ALERT_URL` | none | Failure alerts leave the box as a plain-text POST: an ntfy topic, a healthchecks.io `/fail` URL, any webhook. Unset: alerts stay in `data/logs/ALERT.log`. |
| `LWS_REPO` | the script's repository | Repository used by `run-guarded.sh` and `setup-box.sh`. |
| `NPM_BIN` | `npm` on the PATH, else the latest nvm | npm used by `run-guarded.sh`. |
| `LWS_LOCK_DIR` | `/tmp` | Lock files of `run-guarded.sh`. |
| `LWS_UNIT_DIR` | `~/.config/systemd/user` | Target of `install-units.sh`. |
| `LWS_ALLOW_ROOT` | off | `1` lets `install-units.sh` run as root (not recommended). |
| `SYSTEMCTL`, `LOGINCTL` | `systemctl`, `loginctl` | Binaries used by `install-units.sh` (tests). |
| `LWS_DIR` | `~/lws` | Where `worker/setup-box.sh` clones the repository. |
| `NODE_MAJOR` | 24 | Node major version installed by `worker/setup-box.sh`. |

## Agency identity and sandbox

`agency.config.json` also carries the country and language of the agency (not environment variables):

| Key | Default | What it does |
|---|---|---|
| `country` | `FR` | ISO 3166-1 alpha-2. Drives the public company registry (SIRENE is wired for `FR` only; elsewhere the registry step is skipped with one log line), the legal footer of every mail (`FR`/`BE`/`CH`: LCEN + GDPR; `US`: CAN-SPAM, postal address required for a live send; `CA`: CASL wording; `GB`/`IE`/`AU`/`NZ`: identity + address + opt-out), the default scrape zone and the TLDs guessed by the enrichment. |
| `language` | from `country` (`fr` for FR/BE/CH, `en` for US/GB/CA/AU/IE/NZ, else `fr`) | BCP-47 language of everything generated: sites, savior mail, drafts, call scripts, briefs. The industry playbooks stay French; the composer is told to produce the site in this language regardless. `en` switches the built-in draft and the fixed phrases to native English. |
| `locale`, `currency`, `timezone` | from `country` | Formatting defaults (`en-US`/`USD`/`America/New_York` for `US`, …). The time zone is the agency's clock: meetings and the email sequence's sending hours. |
| `mail.sendHours` | `{ "start": 9, "end": 17, "days": [1,2,3,4,5] }` | The sending hours of the email sequence, on the agency's clock: a next email is always scheduled inside them (days: 0 = Sunday … 6 = Saturday). |
| `postalAddress` | `invoice.seller.address` | Physical address printed in the mail footer. Mandatory for a live send when `country` is `US`. |

| `invoice.seller.*` | placeholders | Free-text fields printed on invoices: `name`, `legal` (legal form, or entity type such as LLC), `address`, `email`, `phone`, `paymentLink`, plus the country's identifiers: France `siret`, `tva`, `rcs`, `iban`, `bic`, `capital`; United States `taxId` (EIN). Unknown keys are ignored; empty ones are not printed. |

A fictional US studio is shipped as `agency.config.example.us.json` (`LWS_AGENCY_CONFIG=agency.config.example.us.json`
to try it, or copy it over `agency.config.json`). `npm run doctor` warns while `agency.config.json` is still identical
to one of the shipped examples. Doctor profiles: the default checks what a newcomer needs (sandbox, `first-site` on a
subscription); `npm run doctor -- --for agency` adds the database, sending, tracking and worker checks.

| Variable | Default | What it does |
|---|---|---|
| `LWS_AGENCY_CONFIG` | `agency.config.json` | Read another agency file (for example the fictional `agency.config.example.json`). |

`npm run sandbox` needs no variable: embedded database (PGlite), fictional agency (the US demo studio by default,
`--country FR` for the French one), nothing sent, a demo cap of 6 builds a day. Its options are flags (`--country`,
`--check`, `--verbose`, `--port`, `--db pglite|docker|postgres://…@127.0.0.1/…`), see `scripts/sandbox.ts`.

## Test harness only

Set by `test/run.mjs`, never needed by users: `LWS_TEST`, `LWS_TEST_ROOT`, `LWS_TEST_DATABASE_URL` (a loopback
Postgres for `npm run test:pg` instead of a throwaway Docker one), `LWS_KEEP_WS` (keep the throwaway workspace),
`LWS_SHOTS_DIR` (where e2e screenshots go), and the fake `claude` switches `FAKE_CLAUDE_*`. The harness strips every
secret and model variable from the environment before it runs.
