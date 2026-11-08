---
name: visual-scoring-gate
status: test
description: The NEED axis of scoring — judges the visual quality of a prospect's site (Playwright screenshots + LLM) to catch the sites that are technically fine but ugly, which the free gate turns down. Called automatically by scoreProspect() when the cheap gate says cold; by hand via npm run gate -- <id> <url>.
---

> ⚠ test mode — wired into the pipeline but young: promoted after ≥ 3 validated uses
> (check that the verdicts match the human eye on real prospects).

# visual-scoring-gate

**The problem.** The free gate (`score.ts`, an HTML fetch, zero LLM) judges the *technical side*
(responsive, SEO, dated builder). Checked for real: it turned down 5/5 real kitchen makers whose
sites are technically "fine" but visually weak — exactly our targets.

**The solution.** A second stage that judges *beauty*: screenshots (top + middle of the page,
`visual-gate.ts`) → the LLM (this skill, `prompt.md`) rates the **redesign need /100** on a calibrated
scale. Final score = `max(technical, visual need)`.

## When it runs
- **Automatically**: `scoreProspect(id, url)` calls it ONLY if the free gate says
  `cold` (the costly part last — a site already kept costs nothing more). `VISUAL=0` turns it off.
- **By hand**: `npm run gate -- <id> <url>` (judges one site on its own, writes the screenshots
  to `data/assets/<id>/gate-*.png`).

## Steps (the internal flow)
1. `visual-gate.ts` captures the top of the page + the middle of the page (1440×900, once preloaders are gone).
2. The runner (`run-skill.ts`) sends `prompt.md` + the screenshots to the model (multimodal).
3. Strict JSON back `{ besoin: 0-100, reasons: [...] }`; when hesitating, the scale pushes towards the higher
   band (missing a real prospect costs more than looking at an average one).
4. `score.ts` merges: `value = max(cheap, besoin)`, visual reasons prefixed `visuel :`.

## Misleading screenshots — handled (2026-06-12)
Cookie walls and preloaders gave empty screenshots → the judge **guessed** from the URL/the brand
(plausible false verdicts). A triple defence: `visual-gate.ts` closes cookie banners
(known selectors + "accept" buttons); the prompt forbids guessing and requires
`{"unusable": true}` if nothing can be judged → a patient re-capture (networkidle + 6 s + scroll);
still nothing → **warm 30** "to judge by hand" (never thrown away on an empty screenshot).

## Validation (2026-06-12)
- **5/5 kitchen makers from the seed caught** (52–72/100, hot) where the cheap gate turned down 5/5 —
  concrete reasons checked by eye on the screenshots (a client site really broken, etc.).
- **3/3 premium counter-tests** (norr11, daytrip.studio, maap.cc) stay at 5–20/100 → not thrown away
  wrongly, and judged on what is VISIBLE (after the cookie-wall defence).
- **Human validation (2026-06-12): the verdicts match.** A calibration nuance noted:
  a client site rated 72 is less broken in reality than on the screenshot (probably a CSS loading miss at
  the moment of the shot → inflated score), and cuisinespassions (52) is the ugliest of the 5 to the human eye.
  The RANKING between kept prospects is therefore approximate — no problem for the gate
  (hot/cold), to tighten if we ever use the score to PRIORITISE prospects.
- Out of test: after real use in the pipeline.

## To flesh out
- Scroll-jacked/WebGL sites remain a possible blind spot (screenshot ≠ experience).
- Eventually: wire in the model's other axes (LEVER, VALUE…) — see `leadengine/2_scoring/README.md`.
