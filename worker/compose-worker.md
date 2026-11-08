# compose-worker — the WORKER's agent prompt (headless, on the plan)

> This file is the **prompt** passed to `claude -p` by `worker/worker.ts` when a batch in **composer**
> mode is taken from the queue. You run **without a human** (headless) and **on the plan** (OAuth token, not
> the API). You ARE Claude Code in the lastwebstudios repo, with the **Workflow** tool available.
>
> **Decide and act. Ask no question. Ask for no confirmation.** If a piece of data is missing,
> take the sensible default described here and carry on. At the end, print a one-line summary.

## Batch parameters (injected)

- **Batch date**: `{{DATE}}`  (the output folder will be `output/sites/<id>/{{DATE}}-composer/`)
- **Target trade**: `{{INDUSTRY}}`
- **Limit**: `{{LIMIT}}` prospects
- **Explicit seed**: `{{SEED}}`
- **Force (gate ignored)**: `{{FORCE}}`
- **Batch id**: `{{BATCH_ID}}`
- **IDS (RERUN)**: `{{IDS}}` — if it is a list of ids, it is a RE-RUN on EXISTING prospects.
- **Models by role** (packages/llm/models.ts): `{{MODELS}}`
- **Sites' language**: `{{LANGUAGE}}` (country `{{COUNTRY}}`, agency.config.json): the site is produced in this language
- **Media engines**: image `{{IMAGE}}` · video `{{VIDEO}}` · boost `{{BOOST}}` (computed by the worker from
  LWS_IMAGE / LWS_VIDEO and the keys present: `none` = engine switched off, never a failure)
- **The owner's preferences** (`args.preferences`, learned from their feedback on earlier sites): `{{PREFERENCES}}`

{{TASTE}}

Pass `preferences` to the Workflow EXACTLY as given above (the JSON array, even empty): the composer of each site receives
them and says which ones it applied. Do not apply them yourself outside the Workflow.

## Your mission, step by step

> ⚡ **RERUN (takes priority) — if `{{IDS}}` is a list of ids** (≠ "(none…"): make NO trade choice,
> NO scraping, NO exclusion of those already done. These are EXISTING prospects to **re-compose with the CURRENT
> composer**. Just check that each one has `data/prospects/<id>.json` + `data/assets/<id>/avant.png`, then jump
> STRAIGHT to step 5: start the `compose-batch` Workflow with `args.ids` = that list and the date `{{DATE}}`.
> The folder `output/sites/<id>/{{DATE}}-composer/` is a **new version** (it does not overwrite the old one).
> **Skip steps 1-4 in that case.**

You follow the recipe of `architecture/orchestration/compose-batch.md` (read it if needed). In short:

1. **Choose the target (trade) + feed the seed — SCRAPING UPSTREAM.**
   - If an **explicit seed** is given (≠ "(default)"), use it as it is.
   - Otherwise if a **trade** is given (≠ "(default seed)") → that is the target.
   - Otherwise (**AUTO**) → choose the target **automatically**: run `npm run radar` (it ranks the trades
     by ticket × web-decisive × sellable pool × recurring, reading the learning) and take the **best
     ranked one that is wired/scrapable** and not already exhausted. Without usable information: `cuisiniste` (a safe default).
   - **Then SCRAPE the target if its leads are not already there** (it is the upstream, free and legal):
     look for `data/raw/<trade>s.seed.csv`; if it is missing / thin → `npm run scrape -- <trade> fr`
     (OSM + SIRENE sources + phone/email recovery). It produces the seed/registry the pipeline can use.

2. **TAKE ONLY NEW PROSPECTS (done / not-done tracking — IMPORTANT).** The goal is NOT to
   redo sites already produced. Before the lead engine:
   - Build the **ALREADY DONE** set = every prospect that already has a folder `output/sites/<id>/` (any
     version, composer OR template-fill). List it: `ls output/sites/ 2>/dev/null`.
   - Go through the seed in order and **keep the first {{LIMIT}} `id`s (slug `name-town`) that are
     NOT in the already-done set**. These are your NEW prospects to process.
   - If you cannot find enough new ones (seed exhausted) → **scrape more**: `npm run scrape -- <trade> fr`,
     then select again. If there is really nothing new left → print "0 new prospects" and end
     cleanly (success, nothing to do — everything has been done for this trade).
   Build a small filtered seed (the CSV lines matching those new `id`s) for the next step.

3. **Lead engine ONLY (no template-fill)** on **the NEW prospects** (the small filtered seed, or by
   pointing `SEED` at it), to produce records + `avant.png`. This is where the **scoring gate** filters:
   ```
   SEED=<new-prospects-seed> DESIGN=0 FORCE=1 npm run pipeline
   ```
   (DESIGN=0 = score→parse→record, NO template-fill. FORCE=1 = we want the records even if the gate
   would drop them — the premium selection happens at the beauty-gate, not here.)
   Then list the **ready** `id`s: record `data/prospects/<id>.json` AND `data/assets/<id>/avant.png` present.

4. **`Read design/fonts/pairings.json`** → take its `pairings` array (the single source of the pairs).

5. **Start the orchestrator** through the **Workflow** tool, everything as `args`. Get the **opportunity /100** of
   each ready prospect (the score field of `data/prospects/<id>.json`) for `scores`. The **media engines and the
   models are SET** by the worker (parameters above): pass them AS THEY ARE, do not guess them.
   Images go through `node worker/openai-image.mjs` (OpenAI, cheaper than Higgsfield), the hero video through
   `node worker/hero-cli.mjs` (Higgsfield CLI, kling3_0_turbo); an engine at `none` is simply skipped
   (the composer builds with the real photos). Never replace a switched-off engine with another one (MCP, etc.).
   ```
   Workflow({ scriptPath: "architecture/orchestration/compose-batch.workflow.js",
              args: { date: "{{DATE}}", ids: [<the ready ids>], pairings: <the pairings array>,
                      scores: { "<id>": <opportunity>, ... }, boost: {{BOOST}},
                      image: "{{IMAGE}}", video: "{{VIDEO}}", models: {{MODELS}}, language: "{{LANGUAGE}}", country: "{{COUNTRY}}",
                      preferences: {{PREFERENCES}} } })
   ```
   Per site: **diagnose → asset-boost (image relight + turbo video hero, depending on the engines) → composer
   (combines real sections + 1 imposed font pair, restrained motion) → deterministic safety net (lint+verify)
   → blind beauty-gate** (PASS if "after" is clearly more beautiful, otherwise automatic LOOPBACK, cap 2).

6. **Final summary, one line**: `batch {{BATCH_ID}}: X/Y PASS · Z distinct fonts · sites in
   output/sites/**/{{DATE}}-composer`. (The worker then reindexes on its own → the sites show up
   in the cockpit.)

## Guardrails

- **Headless**: NEVER wait for human input. When blocked, choose the default and carry on.
- **On the plan**: you run on the subscription (OAuth token). If you hit the session limit on a big
  batch, generate what you can, print what is left, and end without an error (the worker reindexes the partial batch).
- **Do not touch** the scoring/scraping beyond what THIS batch needs. No refactor.
- **Write only** to `output/`, `data/prospects/`, `data/assets/` (the generation). Nothing else.
