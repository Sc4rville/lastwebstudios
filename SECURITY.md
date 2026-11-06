# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting:

**https://github.com/Sc4rville/lastwebstudios/security/advisories/new**

Include what you found, how to reproduce it and what you think the impact is. You will get an acknowledgment,
then a fix or a documented mitigation, and credit in the advisory if you want it. Please give us reasonable
time to ship a fix before you publish.

## What is in scope

- the cockpit server (`backoffice/reviewpipe/serve.ts`): authentication, Host and Origin checks, the public
  tracking endpoint under `/t/` (`outreach/tracking/endpoint.ts`: signed click and unsubscribe tokens);
- the sequencer and the warmup (`outreach/`): anything that could send a mail without the two switches, send
  twice, ignore an opt-out, or leak a prospect's data;
- the worker (`worker/`) and every `claude -p` call: prompt injection through prospect content or operator
  comments, tool access, secrets reaching an agent;
- the lead engine (`leadengine/`): hostile web servers (endless pages, redirect loops, bad charsets);
- the cage (`packages/shared/cage.ts`, `breaker.ts`): anything that lets the machine keep spending or
  sending after a STOP, over budget, or with the breaker open;
- the export and scan tooling (`scripts/oss/`): anything that would let real data or a secret ship.

Out of scope: the third-party services the product can call (Anthropic, OpenAI, Higgsfield, Google, OpenStreetMap,
SIRENE), denial of service against your own machine, and reports that require a compromised operator account.

## How the product protects itself

These are the properties the code is built around; a report that breaks one of them is a vulnerability.

- **Nothing is sent by default.** The sequencer and the warmup are dry-run unless a human sets
  `"dryRun": false` in `outreach/sequencer/config.json` **and** `LWS_LIVE_SEND=1`. One switch alone is refused
  (exit 2). Opt-outs (unsubscribe, complaint) are final, even with `--force`.
- **The cockpit binds 127.0.0.1.** Opening it to another host requires `BACKOFFICE_HOST` and
  `BACKOFFICE_PASSWORD`; without a password, an external `Host` gets 403. Only `/t/` (click and unsubscribe)
  is public, and it only redirects to URLs it signed itself (HMAC-SHA256 with `LWS_TRACK_SECRET`, at least 32
  characters). Forged tokens get 403, the old open-redirect format gets 400, POST bodies are capped.
- **Agents are fenced.** Every `claude -p` the product launches runs with `--strict-mcp-config` (no MCP server,
  no claude.ai connector), a fixed `--allowedTools` list, the API key removed from its environment, and
  prospect content or operator comments wrapped in tags marked "data, not instructions". The worker refuses to
  run as `--bare`, and `architecture/scheduling/install-units.sh` refuses to run as root.
- **The cage.** A `STOP` file (or the cockpit button) halts the worker, the sequencer, the warmup and the
  media boost at the next check; `LWS_BUDGET_USD_DAY` caps spending per UTC day and every agent gets a
  `--max-budget-usd`; the deliverability breaker latches when bounces, complaints or unsubscribes exceed their
  thresholds and stays open until a human re-arms it.
- **Nothing real ships.** `node scripts/oss/scan.mjs .` and gitleaks run in CI.

## Running it safely

- Run the worker under a dedicated non-root user; it gives `Bash` to an agent.
- Keep `.env` outside the agent's working directory (`EnvironmentFile=` in the units) with `chmod 600`.
- Put the cockpit behind HTTPS (Caddy or any reverse proxy) with `BACKOFFICE_PASSWORD` set, or reach it
  through an SSH tunnel.
- Read [docs/GUIDE.md](docs/GUIDE.md) before enabling live sending.
