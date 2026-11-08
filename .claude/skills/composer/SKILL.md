---
name: composer
description: Our free composer — composes a bespoke "masterclass" site from a product fiche by COMBINING real harvested sections (design/sections/) with one curated font pair + palette, NOT by inventing generic layouts. Keeps the prospect's real content/assets/logo, elevated. Restrained, intentional motion. Self-checks with a DETERMINISTIC net (lint + verify), then the blind beauty-gate judges. Use when the user says "composer", "compose", "compose libre", "free composer". Not for cloning a page (use templatize) nor filling a known template (use filler).
user-invocable: true
argument-hint: "<prospectId>"
license: Apache 2.0
metadata:
  status: test
  version: 0.2.0
---

> ⚠ **TEST MODE** — warn before use. Promoted after ≥3 validated uses.

The **composer**: the COMPOSE phase of the library-first model (see `docs/DESIGN-ENGINE.md`). The principle (lesson
from the 2026-06-17 audit): **a beautiful site comes from a coherent design system + restraint + a deterministic net
downstream** — NOT from a wall-of-a-prompt with a thousand warnings. You are given little, but the right things; you
have room for taste; the mechanics are guaranteed by scripts, not begged for.

## Language
**The site is written in the agency's language** (`agency.config.json › language`, passed to the composer as `LANGUAGE`; default `fr`). The trade playbooks and this skill are written in English: produce the site in `LANGUAGE` no matter what (navigation, headings, CTAs, legal notices, the country's phone and address formats). The prospect's own words (services, proper names) stay theirs.

## Input
- `data/prospects/<id>.json` — the real content (name, services, town, tone, `industry`).
- `data/assets/<id>/*` — the **real** photos + the **real** logo (already **audited/boosted**: `_audit.json`,
  `_boost.json`; if `hero.mp4` exists → a hero video is available).
- **`fiche.brief`** (skill `diagnose`) — **YOUR DIRECTION** (angle, problems to fix, moves). Missing → `/diagnose <id>`.
- **`design/industries/<industry>/playbook.md`** — **YOUR STRUCTURE**: the sections + the concept come from the
  TRADE (a wedding venue ≠ a kitchen maker). Think "what does THIS trade need?" before any section.

## The design system (few pieces, coherent — that is where the value is)
- **REAL sections to combine** (the core, your source of taste): `design/sections/index.json` — section skeletons
  from real **award-winning** sites (by `type`/`layout`/`motion`). **Pick and COMBINE them** (filter by the
  playbook's sections, adapt the prospect's content into them) rather than inventing reflex layouts.
  THAT is what gets you out of generic "AI": you start from real compositions, not a lukewarm average.
- **One font pair** (imposed by the orchestrator, or a distinctive choice from the `design/fonts/` catalogue,
  **never** from `blacklist.txt`). Self-host the woff2 files in the site's `fonts/`, with the family's `OFL.txt`
  when it exists (`<slug>-OFL.txt`: a free font travels with its licence). A site publishable without a commercial
  licence: `design/fonts/pairings.oss.json` (verified OFL library, `design/fonts/oss.lock.json`). ⚠ **A broken
  @font-face = the browser falls back to the system font = the "AI-generated" look we hate = FAILURE** (the lint catches it).
- **Palette**: 1 accent + neutrals (derived from the logo/photos, or `design/palettes/<slug>.json`). The accent punctuates.
- **Taste**: `/frontend-design` (the anti-AI-slop philosophy). Icons = inline **Lucide** SVG (one family).

## Constraints (non-negotiable)
- **Same content / assets / logo as the fiche** — we **elevate**, we don't invent (0 lorem, 0 phantom service).
- **Self-contained**: a single `index.html`, inline CSS, fonts + **photos copied locally, relative paths**
  (`assets/…`), **no disk path** `../../data/…`, **no build**, works offline.
- **THE DESIGN LEADS, THE ASSETS FOLLOW**: decide the format/ratio YOUR layout wants, crop the real photo into it
  (`object-fit:cover` + `object-position`, `aspect-ratio`). A photo never blocks the layout.
- **Count your photos BEFORE laying out the grid**: 0-2 photos → an **editorial** composition (strong type, worked
  colour fields), **no empty slot and no image placeholder**. The logo is not a filler photo.
  *(Exception for visual trades: see the HERO rule below.)*
- **PHOTO CURATION — judge BEFORE using**: Read each photo and judge it: **sharp? clear subject? nothing
  unprofessional?** A **blurry**, badly framed photo, or one with a **detail that kills credibility** (factory film or
  sticker still on — like "VELUX" on the glass, a dirty sign, clutter, a bin, a car, a finger) → **NOT in the hero**:
  crop it out, or **drop the photo**. Better 2 good photos than 6 with one embarrassing one.
- **HERO = IMAGE for a VISUAL trade** (pool builder, wedding venue, landscaper, kitchen maker, architect…): the hero is
  **carried by the image** (a real boosted photo, or a `web-cinematics` cinematic). **NEVER** a big block of text on
  top with the photo below, **never** a text-only hero for these trades (the water, the light, the atmosphere SELL).
  0 real photos on a visual trade → `web-cinematics` generates the atmosphere; do **not** fall back on giant type.
- **A deliberate logo**: Read it, judge it. Never light-on-light or dark-on-dark (chip/badge/cut-out).
  Unreadable → a clean text wordmark in the font pair.
- **MOTION = RESTRAINT** (the trap is TOO MUCH): **3 movements max**, coherent (hero entrance · section reveal ·
  1 accent), gentle easing, it **SETTLES**. CSS scroll-driven first + `prefers-reduced-motion`. ⚠ Never an initial
  state that hides 100% without a fallback (content **visible by default**, the animation is a slight extra). A crisp
  hover on interactive elements (~.2s). **At most 1 dark↔light switch.**
- **A sober header** (nav ~64-88px, logo left + links right, aligned), **sharp images** (no small photo stretched
  full-bleed — verify flags it), **a strict grid**, **0 horizontal overflow**, **AA contrast**,
  **mobile = the same hierarchy**.
- **ZERO AI tells**: no "**dashed eyebrow**" (an uppercase kicker preceded by a thin `::before`/`::after` line or a
  "——": it is THE "AI-generated" sign — the lint **rejects** it); no **em-dash**; not the reflex tic of "the last 2
  words of the heading in italics". Surprise, don't reproduce the average.
- **USE THE WIDTH (no limp centring)**: do NOT centre everything in a narrow column in the middle, **especially not
  the paragraphs** of the lower sections (= a lazy reflex that wastes space all the way down). By default:
  **left-aligned**, **asymmetric grids** (text on one side, media/figures on the other), an **editorial** treatment
  that fills the width. **Narrow centring** is kept for **strong moments** (a manifesto, the final CTA), never the
  default. A **full-width (borderless) band** now and then lets the page breathe.

## Field lessons to build into the composition

These rules come from manual touch-ups validated on a first kitchen-maker client. They hold for every visual trade
and premium service.

> **Golden rule (the kitchen-maker case study)**: the composer must produce fewer "pretty AI brochures" and more
> pages that sell with real visual proof.
>
> The case study: every time we added "process / proof / 6 steps / why us", it quickly became clean but boring.
> As soon as we put back a real video, real projects, testimonials, a short form and a mobile bar, it came alive
> again.
>
> Before keeping a section, ask yourself: **does it show, prove, reassure or convert?**
> If not, it goes.

### 1. Visual proof before brochure

- If a video, a real project, a video testimonial, a before/after or a strong photo exists: **it must carry a whole
  section**, not stay a decorative thumbnail.
- Replace long "process / why us / proof" blocks with **one visual scene + 3 to 4 short points**.
- Don't create two sections that say the same thing under different headings. Example to avoid:
  "From design to installation" then "A clear 6-step journey". Merge them into one stronger moment.
- A process is useful only if it is **actionable and visual**: image/video on one side, short steps on the
  other. Otherwise it smells of brochure.

### 2. Strict curation of proof

- Never show a figure, a photo of the owner, a label or a comparison slider if the source is not clear.
  If the asset is missing, write an honest editorial card rather than inventing.
- Reviews, client videos, job-site/project photos and Google links should be **clickable or verifiable**
  when possible.
- For "3D / delivered" or "before / after" sliders: use them only if both images are credible together.
  Otherwise prefer a video/projection or a real gallery. Don't force a widget just because it's cool.

### 3. Mobile conversion by default

- On local-service sites, mobile must have a persistent action, discreet but clear:
  **Call / Book an appointment / Get a quote** depending on the trade.
- The main CTA must point to a useful action. A lone `mailto:` is weak; with no backend, build a short form that
  composes a pre-filled email.
- Recommended short form: **contact details → project → time slot**. No endless administrative form.

### 4. Density and rhythm

- After the hero, alternate: **visual proof → portfolio/proof → trust → conversion**.
- Remove "proof" sections that only repeat text. A section must change the perception:
  show, prove, reassure, or convert.
- Micro-proofs (e.g. "3D plan", "samples", "factory-assembled units") can live as chips around a visual section.
  They don't always deserve a 150-word card.

### 5. Handoff and memory

- `control.md` must document the decisions useful for the next pass: assets kept/rejected, why a section exists,
  what was deliberately removed, and the verification commands.
- If a significant manual touch-up was made, add a short note in `control.md` so the site does not regress at the
  next composer run.

## Double-check — THE DETERMINISTIC NET (mandatory; replaces the thousand warnings)
1. `node design/scripts/lint.mjs <site>/index.html --fix` → must end `clean:true` (0 em-dash, 0 asset on a disk
   path, 0 missing @font-face). Fix what it lists, run it again.
2. `node design/verify/verify.cjs <site>/index.html <site>/_after.png` → must give
   `clean:true` (0 overflow, 0 broken/blurry image, 0 gaping void) + a full-page screenshot.
3. A defect → fix and re-check. Log the verdict in `control.md`.

> The aesthetic judgement ("is it clearly more beautiful than before?") is NOT made here: the **blind beauty-gate**
> (orchestrator) decides. The composer delivers clean work; the gate judges.

## Output
- `output/sites/<id>/<YYYY-MM-DD>-composer/index.html` (+ `fonts/`, `assets/`) → at the top of the back office.
- `control.md` (`packages/shared/control.ts`): `template: composer`, font pair, archetype, motion, verdict.

## Report
The font pair + why, the layout/motion stance, `lintClean`/`verifyClean`, and what remains fragile.
