# Composer — the free composer (prototype, TEST MODE)

Our composer: the COMPOSE phase of the library-first model. Operational: `.claude/skills/composer/SKILL.md`.
Taste: `.claude/skills/frontend-design/SKILL.md` + the **real sections** (`design/sections/`). Vision: `docs/DESIGN-ENGINE.md`.

## What
We **don't clone** an HTML page: we **compose a bespoke site** from the product fiche, by **combining real sections**
from award-winning sites (`design/sections/`) + the **catalogue** (`design/fonts · palettes · motion`).

## How
`/composer <prospectId>` → read the fiche, **understand the space**, **combine real sections** + choose (font pair /
motion / colour), **compose** a self-contained `index.html`, **check** with the **deterministic net** (`lint.mjs` +
`verify.cjs`). The **blind beauty-gate** judges "more beautiful".

## Constraints
The same **content / assets / logo** as the fiche (we elevate, we don't invent) · self-contained, zero build,
offline · **deliberate motion, CSS scroll-driven first** (≤3 movements) · `prefers-reduced-motion` ·
0 overflow · mobile with an equal hierarchy.

## Production lessons

The corrections made on a first kitchen-maker client become composition rules:

> The composer must produce fewer "pretty AI brochures" and more pages that sell with real visual proof.
>
> This client was the case study: every time we added "process / proof / 6 steps / why us", it quickly became clean
> but boring. As soon as we put back a real video, real projects, testimonials, a short form and a mobile bar, it came
> alive again.
>
> The guard question: **does this section show, prove, reassure or convert?** If not, it goes.

- **Visual proof first**: a real video, a project, a testimonial or a before/after must carry a real section, not serve
  as decoration.
- **Anti-brochure**: don't stack "process", "journey", "why us" if they tell the same story. Merge them into one visual
  scene + 3 or 4 short points.
- **No invented proof**: no fake founder photo, no figure without a source, no approximate comparison slider presented
  as exact.
- **Mobile conversion**: for a local service, plan a persistent mobile action (call / book / quote).
- **Short form**: with no backend, prefer a form that prepares an email rather than a lonely `mailto:` link.
- **Memory**: `control.md` must say what was kept, rejected, removed, and why, to avoid regressions.

## Output
**A new generation** `output/sites/<id>/<date-composer>/` → **at the top of the back office**. `control.md`
tagged `template: composer`. Scratch/decisions in `design/composer/runs/<id>/` (gitignored).

## Status
Prototype **proven** on a kitchen-maker prospect (Austin × Geist, terracotta accent, accordion gallery). Still to do:
photo curation, CSS scroll-driven motion, and labelling the catalogue.
