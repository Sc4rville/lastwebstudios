# compose-batch — the COMPOSER's orchestrator (the real custom path)

> **The composer is NOT `npm run pipeline`.** `npm run pipeline` = template-fill (poliform for
> everyone = clones). For **custom, unique, premium** sites, THIS is the path.

## Why a document and not an `npm run`
The composer **is not a deterministic script**: it is an **agent** that, per prospect, reads the record +
the catalogue + the real sections and **writes a bespoke site** (custom HTML+CSS). That does not boil down to a
function call like `fillSite()`. So it is **orchestrated as agents** (one per prospect), through the
Workflow tool — started by Claude, not by npm. Hence this document + the reference script
`architecture/orchestration/compose-batch.workflow.js`.

## The chain, per prospect
```
diagnose (avant.png + record → brief: beauty/10, problems, angle, moves)
  → asset-boost (Higgsfield): deterministic asset-audit → upscale/relight when not HD, sharp borderless hero,
                               + HERO VIDEO when the opportunity is > 65/100 (assets first → storyboard)
    → composer (slim): COMBINES real SECTIONS (design/sections/) + 1 imposed font pair + an archetype;
                        RESTRAINED motion (3 max); logo handled; a design system, not a wall of prompt
      → DETERMINISTIC SAFETY NET: lint.mjs (em dash/assets/fonts) + verify.cjs (overflow/images/void) = clean
        → BLIND before/after judge (alternating A/B, FULL-PAGE _after.png; PASS if clearly more beautiful, otherwise LOOPBACK, cap 2)
```

## Cross-cutting rules (2026-06-25)

- **SOCIAL PROOF — KEEP it and make it Awwwards-grade.** If the prospect already has on their site
  **reviews** (Google/Trustpilot shown, rating + count), **customer testimonials** (above all
  **video**: YouTube/Vimeo), **partner brands**, **online booking** → those are their strengths,
  NEVER thrown away when the site is rebuilt. The **diagnose** detects them and writes them into the record
  (`content.reviews`, `content.googleRating`, `content.testimonialVideos`, `content.brands`); the
  **composer** brings them back as polished sections, Awwwards level. Awwwards YES, but keep the
  prospect's substance and elevate it. (Sales argument: "your site is good, we keep your
  strengths and raise them".)
- **IMAGES = OpenAI gpt-image-2 DIRECTLY, no more Higgsfield.** The asset-boost generates/edits images
  through `node worker/openai-image.mjs` (key `OPENAI_API_KEY`, much cheaper). **Higgsfield stays
  ONLY for video** (kling). **No more endless Higgsfield upscales** (waste).
  Each engine is **optional** (`args.image` / `args.video` = `none`, from `LWS_IMAGE` / `LWS_VIDEO`):
  without an engine, the site is composed with the real photos, the step never fails.

> **Architecture (audit 2026-06-17)**: the wall of prompt was removed (9 KB → ~4 KB) and the judges merged.
> The **mechanics** (what we used to beg for: em dash, assets, fonts, void, blur) are now **guaranteed by
> scripts** (`lint.mjs`/`verify.cjs`), not by warnings. The composer has room for taste;
> the blind beauty-gate is the **only** aesthetic judge. Less context, fewer judges, more reliability.

## Recipe (what an agent does)
1. **Prerequisite: parsed prospects** (record `data/prospects/<id>.json` + `data/assets/<id>/avant.png`).
   If not done: `SEED=<seed.csv> DESIGN=0 FORCE=1 npm run pipeline` (lead engine ONLY, no template-fill).
2. **List the ready `id`s** (record + avant.png), leave out those already composed (`output/sites/<id>/*-composer`).
3. **`Read design/fonts/pairings.json`** → take its `pairings` array (the SINGLE SOURCE of the pairs).
4. **Start the orchestrator** `compose-batch.workflow.js` through the **Workflow** tool, passing everything as
   **`args`** (the script hard-codes nothing any more — Workflow scripts have neither a disk nor `Date.now()`):
   ```
   Workflow({ scriptPath: "architecture/orchestration/compose-batch.workflow.js",
              args: { date: "<YYYY-MM-DD>", ids: [<the ids>], pairings: <the pairings.json array>,
                      scores: { "<id>": 72, ... },   // optional: opportunity /100 → decides the hero video (>65)
                      boost: true,                   // false = audit only, no generation
                      image: "openai" | "none",      // the boost's image engine (worker/openai-image.mjs)
                      video: "higgsfield" | "none",  // video heroes (worker/hero-cli.mjs)
                      models: { smart, fast, judge },// models by role (packages/llm/models.ts); absent = the session's model
                      preferences: [...],            // the owner's active taste preferences (learning/scripts/taste.ts)
                      sync: true } })                // false = nothing goes to the bucket or the database (first-site)
   ```
   It assigns **a distinct font pair + an archetype per site** (never the `blacklist.txt`) →
   diversity **by construction** (anti-convergence: without it, the agent falls back on ~6 "trendy" fonts).
5. **Result**: `output/sites/<id>/<date>-composer/` (visible at the top of the backoffice). Report the blind
   judge's verdict + the diversity (number of distinct fonts).

> Why `args` and not a list in the file: before, `date` + `ids` + a **copy** of the pairings
> were frozen in the script (a snapshot of one run, and the copy of the pairings **drifted** from the canonical
> JSON). Now there is one source (`pairings.json`), zero script edits between two runs.

Without the Workflow tool (a Pro subscription without "Dynamic workflows", an old CLI, Claude Code on a local model):
`architecture/orchestration/workflow-local.ts` runs **the same script** in Node, one `claude -p` per agent
(same prompts, same schemas, same loop). It is the `local` engine of `npm run first-site`.

## How an operator starts it
The shortest, for ONE site: **`npm run first-site -- <url> --name "<name>" --city <city> --industry <trade>`**
(score → parse → record → this Workflow, boost off, no sync; report `first-site.json` in the site's folder).

Tell Claude: **"compose the prospects of `<seed>` with the composer"** (or "run the composer on
the top N"). Claude follows the recipe above. **Do not say "run the pipeline"** if you want
custom work — that one is the template-fill.

## Cost / scale (honest)
~$0.15-0.18 per site (Opus). A batch of 20 ≈ $2-3 + ~40 min. Subject to the **session limit** (a big
batch can hit it → pick up again with `resume`). Opt-in: this is multi-agent orchestration.

## Proven
2 batches: **15/15** then **19/19** PASS at the beauty-gate; **33 distinct fonts** out of 19 (vs ~6 before
forced diversity), 0 Reckless, em dashes 304→10. See `sessions/scarville.md` (2026-06-09/10).
