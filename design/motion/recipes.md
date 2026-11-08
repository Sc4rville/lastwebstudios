# Motion recipes — the library of REAL animations (read by the composer)

> The composer MUST use **several of them, deliberately** (not 1 sad fade). Goal: lively, interactive, "legendary"
> scroll — but **intentional** (never a gadget that follows the cursor for no reason; every motion has a reason). CSS
> scroll-driven first (`animation-timeline: view()/scroll()`, 0 JS, compositor); GSAP+ScrollTrigger only for the
> complex cases (pin, scrub, SplitText), **loaded from the CDN** (`https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js`
> + `ScrollTrigger.min.js`), **never copied** into the site or into the repository: the GSAP licence is not an OSI free
> licence, we don't redistribute it.

## The base (to put almost everywhere)
- **Reveal on entry** — `animation-timeline: view()`, fade + rise (translateY) or clip, a **stagger** per child
  (increasing `animation-delay`). The base of a lively site.
- **Depth parallax** — `animation-timeline: scroll()`: the background/visual moves more slowly than the text
  (yPercent). Gives layering. Light (≤15%).
- **A hero that breathes** — Ken Burns on scroll: the hero photo zooms/drifts gently (`scale 1→1.08`).

## The signatures (choose 1-2 strong ones per site, according to the trade/archetype)
- **Line-by-line / word-by-word text** — split into lines/words, each line rises + unmasks (`clip-path` or translateY
  under overflow:hidden). Magnificent on a big heading (Splitting/GSAP if needed).
- **Image clip-reveal** — the photo unmasks (`clip-path: inset(... )` animated on scroll) instead of appearing raw.
- **Pinned section + cross-fade** — a section sticks (`position:sticky`) while you scroll and its content
  changes/progresses (stacking cards, process steps). Ideal for "our craft".
- **Horizontal scroll** — a band (gallery, projects) scrolls sideways as you scroll vertically
  (sticky + translateX tied to scroll). Very strong for a gallery that reigns.
- **Animated counter / figures** — the stats count up as they enter ("550 kitchens", "200 guests").
- **Marquee / continuous band** — partner logos or keywords scrolling in a loop (the speed reacts to scroll).
- **Scrub** (GSAP) — a timeline or an SVG that draws itself (`DrawSVG`) driven by the scroll position.

## Micro-interactions (discreet, on active elements only)
- A light **magnetic / tilt hover** on CTAs and cards (transform on `:hover`, a soft transition).
- **Underlines/arrows** that animate when hovering links.
- **Reduced motion**: everything under `@media (prefers-reduced-motion: no-preference)` + `@supports`.

## The rules (Scarville's memory: intentional, zero gadgets)
- **No gratuitous motion**: every animation serves the reading/the emotion. No assets following the cursor for no
  reason. **At most 1 dark↔light round trip** per page.
- **Deliberate**: decide CONSCIOUSLY where each fade / reveal / parallax / pin goes — not "a fade on everything".
- **Rich but coherent**: 1 base + 1-2 strong signatures > 10 scattered effects.
