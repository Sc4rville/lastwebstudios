---
name: asset-boost
description: Improve a prospect's visual assets BEFORE composing — upscale low-res/ugly photos, clean the logo (remove background), widen a photo for a hero band, and (last resort) generate ATMOSPHERIC/abstract fillers — via the Higgsfield MCP. The asset-quality step between parse and compose. Use when assets are low-res, ugly, too few, or missing, or the user says "upscale", "improve the photos", "améliore les photos", "generate visuals", "remove bg from the logo". Honesty rule: enhance the REAL assets ; never fabricate fake photos of THEIR work.
user-invocable: true
argument-hint: "<prospectId>"
license: Apache 2.0
metadata:
  status: active
---

> ✅ **STANDARD — always on** (decision 2026-06-20). asset-boost runs on **EVERY site**:
> at least one boosted photo per site, systematically (no more opt-in "until the first sale").
> The only costly notch kept conditional = the **hero video** (the cinematic layer, kept for hot prospects
> **score > 65**, see `web-cinematics`).

> ⚙️ **ENGINES (current as of 2026-10-24, overrides the rest of this file)**: in a batch (`compose-batch.workflow.js`),
> the **image** goes through `node worker/openai-image.mjs` (OpenAI directly, `LWS_IMAGE=openai|none`,
> `OPENAI_IMAGE_BASE_URL`, `OPENAI_IMAGE_MODEL`) and the **video** through `node worker/hero-cli.mjs` (the Higgsfield CLI,
> `LWS_VIDEO=higgsfield|none`). The launcher passes `args.image` / `args.video`; an engine set to `none` is skipped,
> never replaced, and the "one boosted photo" minimum only applies when an image engine is available. The
> **Higgsfield MCP** sections below apply to interactive use (a session with the MCP), not to the headless batch.

The **ASSET-BOOST** step: a brilliant composer working on **lousy photos** produces an average site. Before
composing, we **raise the prospect's visual quality**. It is the "generation/upscale" complement of curation
(keep/drop): here we **repair and fill the gaps**.

```
parse (raw assets) → diagnose → ★ asset-boost (AUDIT → upscale/relight/borderless/video) → composer
```

⚠ **Wired into the pipeline**: the step runs in `compose-batch.workflow.js` (the **Assets** phase, between
diagnose and compose). No longer an orphan.

## Step 0 — the deterministic AUDIT (always, zero credits)
`node design/scripts/asset-audit.mjs <id>` → writes `data/assets/<id>/_audit.json`: for each photo the native
resolution, HD or not, the ratio, **borderless** suitability, the **hero candidate**, and the mechanical `action`
(`crop-ok` / `upscale+relight` / `thumbnail`). **It is what decides what to boost** — you don't estimate by eye.

## What we do (Higgsfield MCP) — in order of preference
1. **Improve the REAL while keeping it AUTHENTIC** (the default — their real photo, just better captured):
   - **FIRM RULE — UPSCALE EVERYTHING**: assume **all their photos are blurry**. **Every** image that goes on the
     landing page goes through `upscale_image` (and any photo with `action != "crop-ok"` in `_audit.json`
     → upscale **+ relight** is mandatory) — **never** a low-res/dull image served as is.
   - **NEVER a screenshot of the site as an asset.** If a real photo can't be extracted cleanly (locked, a CSS
     background, covered by UI…): screenshot it, THEN Higgsfield (`remove_background` / an editing model, with the
     instruction "remove the text/buttons/HTML on top") to **isolate the real visual** — we serve the clean image,
     **never** the screenshot with the site's interface.
   - **MANDATORY MINIMUM — at least ONE boosted photo per site, always**: even if every photo is already HD, put
     the **hero** through a light relight/upscale + borderless widening. Zero boosted photos on a site (except a
     prospect with 0 photos) = the step failed.
   - **Upscale** — `upscale_image` (2K/4K) on the low-res ones *(pass the source's `width`/`height`)*.
   - **Relight / correct** — `models_explore` → an editing model, the photo in `medias` + an instruction (exposure,
     white balance, light too dark/orange, denoising). **We correct the light, we don't change the place.**
   - **BORDERLESS resize (important)** — for a **sharp full-bleed** hero, `outpaint_image` to **widen to the target
     ratio** (the audit's hero candidate) without distorting or inventing. **The DESIGN sets the format, the asset
     follows**: better a beautiful sharp borderless photo than a big blurry block.
2. **Clean the logo** — `remove_background` (a dirty/white background that clashes → transparent) → the logo-contrast rule.
3. **Generate — LAST resort, atmospheric/abstract ONLY** — `generate_image` for a **background**
   (mesh, grain, texture, pattern), **never** a fake project. Mood from the trade's `playbook.md`.

## Hero video — HIGH-potential prospects (opportunity > 65/100)
For a hot prospect, a **hero video** puts the site in another league. **Start from the ASSETS first**:
1. **Source image**: the **boosted** hero (upscaled/relit) = the **first frame** → continuity with their real place.
2. A short **storyboard** (**slow** movement, 5-8 s, **loopable**) written BEFORE the call — `generate_video`
   (`models_explore` for an image→video model). **NO text burned into the video**: the JS places the
   heading/CTA **on top**.
3. **Aware of the JS on top** (key): plan a **readability zone** (a calm side or bottom, enough contrast for a
   veil/overlay), a movement that doesn't fight the text. The composer sets it as the background
   (`muted/autoplay/loop/playsinline`, `poster` = the hero image, **a still image under `prefers-reduced-motion`**).
4. Output `data/assets/<id>/hero.mp4` (+ poster). `get_cost` first — video costs; kept for > 65.

## ⚠ The honesty line (non-negotiable)
- **We improve the real; we don't invent the portfolio.** Generating a photorealistic "kitchen", "estate" or
  "pool" and passing it off as **their** work = **a lie** (and a client risk). Forbidden.
- Generated = **abstract backgrounds/textures/atmospheres** only, or a clearly decorative visual.
- **Trace it**: every upscaled/generated asset is recorded in `data/assets/<id>/_boost.json` (source, action,
  generated yes/no) → transparency + the composer knows what is real vs decorative.

## Higgsfield workflow (good to know)
The source must first exist on the Higgsfield side: `media_import_url` (from the photo's original URL, captured
at parse) → `media_id` → `upscale_image`/`remove_background`/`outpaint_image` → fetch the result
→ write into `data/assets/<id>/` (suffix `-2k`/`-cut`). *(The `media_upload_widget` for a local file is
interactive → prefer `media_import_url` headless.)* `get_cost:true` to preflight the credits.

## Report
What was upscaled/cleaned/generated (with the trace), and what remains weak (to be reshot on the client's side).
