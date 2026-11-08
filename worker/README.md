# worker — autonomous generation (the box works while your computers are off)

The **cockpit** (Coolify container) does not generate anything itself: no Claude Code and no Playwright
browsers inside it. It **queues** requests in the `batch_requests` queue (Supabase). The **worker**
here runs **natively on the box**, takes the jobs, **generates**, **reindexes**, marks the job done.

```
  cockpit (container)  ──[/api/batch]──▶  batch_requests (Supabase)  ◀──[claim]──  worker (box)
        ▲                                                                              │
        └────────────── reindexAll(): the built sites show up in the cockpit ◀─────────┘
```

## The parts

| File | Role |
|---|---|
| `worker.ts` | the daemon: atomic claim → generates → `reindexAll()` → marks done/error. One job at a time. Routes the 4 modes + runs the `coach` gate. |
| `compose-worker.md` | the **prompt** of the `composer` mode passed to `claude -p`: lead engine + compose-batch, headless, **on the plan**. |
| `edit-worker.md` | the **prompt** of the `edit` mode: applies a targeted fix to an existing site (without a full rebuild). |
| `research-worker.md` | the **prompt** of the `research` mode: prospect intel → CRM (`crm_leads`/`outreach`), bounded, without coach or heavy reindex. |
| `coach.mjs` / `coach.md` | the **quality gate** after composing: looks at a new site's SERVED render, loops its fixes back to the composer BEFORE publishing (violet gauge in the cockpit). |
| `openai-image.mjs` | image generation through OpenAI `gpt-image` (heroes / visuals), called while composing. |
| `setup-box.sh` | the install **on the box** (Node + Claude Code + repo + Playwright + systemd service). Run it over SSH. |
| `lws-worker.service` | the systemd user service (runs at boot, restarts on its own). |

## Four batch modes (+ the coach gate)

`worker.ts` routes on the job's `mode`:

- **composer** (default, *premium*) → `claude -p` (prompt `compose-worker.md`) orchestrates the custom work.
  Runs **on the plan** (`CLAUDE_CODE_OAUTH_TOKEN`) — the expensive part, hence `plan-first`. ~$0.15 per site
  of extra API extraction (negligible).
- **template-fill** (*cheap*) → `npm run pipeline` (poliform template, API). Secondary path.
- **edit** → applies a targeted fix to an existing site (prompt `edit-worker.md`), without a rebuild.
- **research** → prospect intel saved in the shared DB (prompt `research-worker.md`), idempotent and bounded.

After a compose, the **`coach` gate** (`coach.mjs`, prompt `coach.md`) runs BEFORE publishing: the new
sites are first marked `.reviewing` (not published), the coach looks at the served render and loops its
fixes back to the composer, then `reindexAll()` publishes. Can be turned off with `WORKER_NO_COACH=1`.

## Getting started (on the box, once)

> The full step by step on a fresh box, without root (dedicated user, firewall, linger, Station behind HTTPS,
> cage): **`docs/GUIDE.md`** §3 to §9, and `architecture/scheduling/install-units.sh --enable core`. Below: the
> historical layout of the team's box.

```bash
ssh root@<box-IP>
git clone <repo-url> ~/lws && cd ~/lws   # the repo the box pulls (team: the mirror, docs/DEPLOY.md)
bash worker/setup-box.sh          # installs everything
claude setup-token                # ← THE PLAN's token (interactive), to paste into ~/lws/.env
nano ~/lws/.env                   # DATABASE_URL (pooler) + CLAUDE_CODE_OAUTH_TOKEN + ANTHROPIC_API_KEY
systemctl --user enable --now lws-worker
journalctl --user -u lws-worker -f
```

Then from the cockpit: **"start a batch"** → the worker takes it here, live.

## plan-first (important)

The composer runs on the subscription: `claude auth login` on the machine, or `CLAUDE_CODE_OAUTH_TOKEN`
(`claude setup-token`). The worker **removes `ANTHROPIC_API_KEY`** from the environment of each `claude -p`: in
`-p` mode, Claude Code ALWAYS uses an API key that is present before the plan (code.claude.com/docs/en/authentication,
"Authentication precedence"), which billed the API (or failed on a dead key). The lead engine's
extraction goes through `runSkill` → the `LWS_LLM` path (`claude-code` by default): everything runs on the plan.
`WORKER_PLAN_STRICT=0` restores the old behaviour (the key stays, the agents bill the API).
At startup, the line `✓ lws worker — … · claude <version> · <auth source>` says what the agents run on
(read through `claude auth status`), and the worker **refuses to start in `--bare`** (neither plan nor skills).

> ⚠ Billing reminder (06/15/2026): headless usage draws on the **Agent SDK allowance** ($100-200/month
> on Max) then switches to the API if "usage credits" is on. Keep "usage credits" **OFF** to
> avoid a surprise bill (see `~/.claude/skills/plan-first/SKILL.md`).

## Settings (env)

`WORKER_NAME` (readable id), `WORKER_POLL_MS` (default 15000), `CLAUDE_BIN`, `WORKER_CLAUDE_ARGS`, `WORKER_PLAN_STRICT=0`
(keeps the API key), `COACH_MODEL`; models by role `LWS_MODEL_SMART/FAST/JUDGE` and media engines `LWS_IMAGE` /
`LWS_VIDEO` (see `.env.example`), injected into the composer's prompt then into the Workflow's `args`.

> ⚠ **Permissions as root.** The box runs as root → Claude Code REFUSES `--dangerously-skip-permissions` /
> `--permission-mode bypassPermissions` (security). So the worker declares the allowed tools
> explicitly (`worker/claude-args.ts`): `-p --strict-mcp-config --allowedTools Bash Read Write Edit Glob Grep Agent
> Workflow Skill WebFetch WebSearch` (no MCP server loaded; names up to date on 10/24/2026: `Agent` replaces `Task`, `MultiEdit` no longer exists; since
> 2.1.302, a permission-gated tool that is not listed is refused in `-p`). Do NOT
> spoof `IS_SANDBOX=1`. (The clean alternative: run the worker as a non-root user.)
