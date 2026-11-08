# design/sections · the section catalogue (the heart of the composer's taste)

**Section skeletons** taken from real award-winning compositions. The `composer` (the MAIN route, see
`docs/DESIGN-ENGINE.md`) **picks and COMBINES** these skeletons instead of inventing reflex layouts: that is WHAT
gets it out of "AI slop". Without this catalogue, the composer falls back on improvising.

## How the composer uses it
1. Reads `index.json`, **filters by the sections of the trade's playbook** (`design/industries/<industry>/playbook.md`)
   + the brief's **mood**.
2. For each section wanted, chooses a skeleton (a `layout` variant). **Two sites must not pick the same variants**
   (diversity enforced).
3. Loads the skeleton's `.html`, **adapts the prospect's real content** into it, and applies **its font pair + its
   palette** through the CSS tokens.

## `index.json` · one entry per skeleton
```json
{
  "id": "hero-editorial",
  "type": "hero",
  "layout": "editorial heading on the left + tall image on the right (asymmetric grid)",
  "mood": ["premium", "editorial"],
  "motion": "cascading reveal of the heading + image fade",
  "useWhen": "premium trade, at least 1 strong photo",
  "file": "hero-editorial.html"
}
```
- **`type`**: `hero` · `process` · `gallery` · `brands` · `about` · `testimonials` · `guarantees` · `services`
  · `cta` · `coverage` · `stats` · `faq`.
- **`layout`**: the composition's signature (what sets it apart from the others of the same type).
- **`mood`**: tags (`premium`, `editorial`, `warm`, `technical`, `bold`, `minimal`, `architectural`…) to match the trade.
- **`useWhen`**: when to choose it (e.g. "visual trade with ≥ 6 photos", "0-2 photos → editorial").

## A skeleton's contract (`.html`)
- **ONE standalone `<section>`**: structure + layout ONLY. The final taste (colours, fonts) comes from the composer.
- **CSS tokens** (the composer defines them globally; the skeleton CONSUMES them, doesn't redefine them):
  `var(--bg)` · `var(--fg)` · `var(--muted)` · `var(--accent)` · `var(--serif)` · `var(--sans)` · `var(--mono)`.
- **Content = clear placeholders**: `{{HEADLINE}}`, `{{TEXT}}`, `{{CTA_LABEL}}`, `<img src="{{IMG}}" alt="{{ALT}}">`,
  and repeatable items wrapped in a comment `<!-- repeat: <item> -->  … <!-- /repeat -->`.
- **Motion**: a `.reveal` class on the elements to animate (the composer wires scroll-driven + `prefers-reduced-motion`).
  **No JS required.** Content visible by default (the animation is an extra, never a 100% hide without a fallback).
- **Responsive**: holds at **390px** (an `@media (max-width: 880px)`). Mobile = the same hierarchy.
- **Anti-AI-slop** (the composer's rules): **no dashed eyebrow**, **no em-dash**, **left-aligned by default**,
  **asymmetric grids**, **use the width** (no narrow centred column out of reflex).

## Adding a section
1. Create `<id>.html` following the contract above. 2. Add its entry to `index.json`.
Later: automatic extraction of real sections from award-winning sites through `extractize` (see skillstash).
