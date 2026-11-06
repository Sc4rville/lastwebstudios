# Bring your own model

The product runs **by default on your Claude subscription** through Claude Code (`claude -p`), plan-first. Nothing
to configure: `npm run doctor -- --for first-site` says whether your machine is ready, `npm run first-site`
builds a real site. This page explains how to plug in **any other model**: your ChatGPT subscription through the
Codex CLI, a Claude API key, an enterprise gateway, Ollama on your laptop, OpenRouter, Groq, vLLM.

## Two engines, two switches

| what runs | engine | setting |
|---|---|---|
| **structured skills**: the prospect sheet (`structuration`), the visual gate of the scoring, the savior mail, diagnoses called by scripts | `packages/llm/` (five ways) | `LWS_LLM` |
| **agents**: the composer chain (diagnose → boost → compose → self-review → blind judge), the coach, the account research, edits | Claude Code (`claude -p`, the Workflow tool or the local engine) | whatever Claude Code uses: your subscription, `ANTHROPIC_API_KEY`, or `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` |

Claude Code itself can talk to a gateway or a local server (`ANTHROPIC_BASE_URL`), to Amazon Bedrock, Google
Cloud Vertex or Microsoft Foundry (`CLAUDE_CODE_USE_*`). The agents follow those settings with no code on our
side. Honestly: a small local model runs the mechanics; it does not compose an award-worthy site.

## The five ways (`LWS_LLM`)

| `LWS_LLM` | for whom | variables | structured output |
|---|---|---|---|
| `claude-code` (default) | your Claude Pro or Max subscription, or whatever your Claude Code CLI uses | none; on a server, `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` | `--json-schema` → `structured_output` |
| `codex` | your ChatGPT subscription, through the Codex CLI | `codex login` once; `LWS_CODEX_BIN` if the binary is not `codex` on the PATH | `codex exec --output-schema`, native JSON; images attached with `-i` |
| `anthropic` | a Claude API key, billed per token, cappable | `ANTHROPIC_API_KEY` (+ `ANTHROPIC_BASE_URL` behind a proxy) | `output_config.format`, native |
| `anthropic-compatible` | any server that speaks the **Messages** API: Ollama ≥ 0.14, LM Studio, llama.cpp, LiteLLM, a gateway | `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `LWS_MODEL` | JSON extracted from the text (`LWS_STRUCTURED=1` to force native) |
| `openai-compatible` | any **Chat Completions** server: OpenAI, OpenRouter, Groq, Together, vLLM, Ollama, LM Studio | `OPENAI_BASE_URL`, `OPENAI_API_KEY` (optional locally), `OPENAI_MODEL` or `LWS_MODEL` | `response_format: json_schema`, automatic fallback if refused |

Without `LWS_LLM`: the older `LLM_VIA=plan|api` is understood; an `OPENAI_BASE_URL` selects `openai-compatible`;
an `ANTHROPIC_BASE_URL` outside `api.anthropic.com` selects `anthropic-compatible`; otherwise `claude-code`. **An
`ANTHROPIC_API_KEY` alone never switches to the API**: that is `LWS_LLM=anthropic`.

Every skill with a `schema.json` next to its `prompt.md` (the sheet, the visual gate) gets native structured output
when the way allows it; otherwise the JSON is extracted from the text (fences, reasoning around it).

The agents stay in Claude Code whatever `LWS_LLM` says: the composer depends on the repository's skills, the
Workflow tool and a fenced tool list that Claude Code provides.

## Models by role

| role | used by | API default | plan default | override |
|---|---|---|---|---|
| `smart` | composer, edits, coach, savior mail | `claude-opus-5-5` | alias `opus` | `LWS_MODEL_SMART` |
| `fast` | the prospect sheet (structuration) | `claude-haiku-5-5` | alias `haiku` | `LWS_MODEL_FAST` |
| `judge` | visual gate, diagnose, self-review, beauty gate (vision required) | `claude-sonnet-5-5` | alias `sonnet` | `LWS_MODEL_JUDGE` |

`LWS_MODEL` = one model for every role (typical of a local model). On the `codex` way the roles default to the
Codex CLI's own default model; set `LWS_MODEL_<ROLE>` to pin one. The aliases follow your Claude Code version: an
older CLI resolves `haiku` to an older generation (measured on 2026-10-24: CLI 2.1.281 resolves `haiku` to
Haiku 4.5). `claude update`, or set the explicit ID (`LWS_MODEL_FAST=claude-haiku-5-5`), which the same CLI
accepts. The only source of model IDs is `packages/llm/models.ts`.

On the Claude API, the 5.5 models' thinking is adaptive and on (not switchable off on Opus 5.5); its tokens count
in `max_tokens`: the adapter sets a floor of 4096 and the visual gate asks for 8192.
`LWS_EFFORT_<ROLE>=low|medium|high|xhigh|max` sets the effort (for example `LWS_EFFORT_FAST=low` for extraction).

## Recipes

**Ollama on your machine (free, offline)**:
```
ollama pull qwen2.5:1.5b
LWS_LLM=anthropic-compatible
ANTHROPIC_BASE_URL=http://127.0.0.1:11434
ANTHROPIC_AUTH_TOKEN=ollama
LWS_MODEL=qwen2.5:1.5b
```
or, through Chat Completions: `LWS_LLM=openai-compatible`, `OPENAI_BASE_URL=http://127.0.0.1:11434/v1`. Measured
on 2026-10-24 (Ollama 0.17.4, qwen2.5:1.5b, CPU): a valid sheet of the fictional pool builder through both ways,
17 s (Messages) and 33 s (Chat Completions); the Messages way filled phone, e-mail and tagline, the Chat way only
the services. A 1.5 B model sorts a text; it does not judge a design.

**ChatGPT subscription through Codex**: `codex login`, then `LWS_LLM=codex`. The skills run as
`codex exec` calls with a JSON schema; the agents still need Claude Code.

**Claude API key**: `LWS_LLM=anthropic` + `ANTHROPIC_API_KEY=sk-ant-…`. The 1.x SDK sends the key as
`Authorization: Bearer` (a gateway that read `X-Api-Key` must read `Authorization`).

**OpenRouter, Groq, vLLM**: `LWS_LLM=openai-compatible`, `OPENAI_BASE_URL=https://openrouter.ai/api/v1`,
`OPENAI_API_KEY=…`, `LWS_MODEL_SMART=…`, `LWS_MODEL_FAST=…`, `LWS_MODEL_JUDGE=<a vision model>`.

**Enterprise gateway or LiteLLM in front of Claude**: `LWS_LLM=anthropic-compatible`,
`ANTHROPIC_BASE_URL=<gateway>`, `ANTHROPIC_AUTH_TOKEN=<token>`; the default Claude IDs pass through unchanged.
Claude Code (the agents) reads the same variables.

## Media engines (optional)

| variable | values | default |
|---|---|---|
| `LWS_IMAGE` | `openai` \| `none` | `openai` if `OPENAI_API_KEY` is set, otherwise `none` |
| `OPENAI_IMAGE_BASE_URL` / `OPENAI_IMAGE_MODEL` | any compatible Images API / model | `https://api.openai.com/v1` / `gpt-image-2` |
| `LWS_VIDEO` | `higgsfield` \| `none` | `higgsfield` if `HIGGSFIELD_API_KEY` is set or the `higgsfield` CLI is on the PATH, otherwise `none` |

`none` is not a failure: the composer keeps the prospect's real photos. `first-site` turns the boost off by default
(`--boost` enables it). The engines reach the workflow as `args.image` / `args.video`.

## Plan-first, precisely

In `-p` mode Claude Code **always** prefers a present `ANTHROPIC_API_KEY` over the plan token and the claude.ai
login (Claude Code docs, "Authentication precedence"). The product therefore **removes** it from every `claude -p`
it launches (skills, worker, coach, first-site). `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL` stay: those are
explicit choices. At start-up the worker prints the real auth source (`claude auth status`) and refuses `--bare`
(a mode that reads neither the plan nor the skills, announced as the future default of `-p`).

Skill calls on the plan are pure: `--tools ""` (or `Read` for captures), `--strict-mcp-config` (neither the
repository's `.mcp.json` nor the claude.ai connectors), `--setting-sources project` (no user hooks or plugins).
Measured on 2026-10-24: the context of a call drops from about 25k to about 0.9k tokens, so far less quota per
prospect. `LWS_CLAUDE_SETTING_SOURCES=user,project,local` restores the full loading.

Subscriptions and 24/7: Claude Code's terms speak of ordinary, individual use and forbid serving other people with
your credentials. Start on **your** subscription, **your** box, **your** agency; move to an API key for production
(billed per token, cappable).
