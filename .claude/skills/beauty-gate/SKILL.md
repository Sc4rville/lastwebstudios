---
name: beauty-gate
description: The "much more beautiful" gate after composing. Screenshots the newly composed site, then a NEUTRAL context-free judge compares it BLIND against the prospect's original site (avant.png) — not told which is which, no business context, no brief — and decides if the new design is CLEARLY more beautiful. If it is not, automatic loopback : re-compose with the judge's critique, until the new wins decisively (or a loop cap). Triggers: "beauty-gate <prospect>", "is the new site much more beautiful", "check the redesign beats the original", "juge avant/après". Not the human review (control.md) nor the design itself (composer).
user-invocable: true
argument-hint: "<prospectId> [date]"
license: Apache 2.0
metadata:
  status: test
---

> ⚠ **TEST MODE** (see `/skilldraft` §6) — a young skill: warn before use, never automatic/unattended.
> Promoted after ≥3 validated uses.

The **beauty-gate**: the guard-rail that guarantees the new site is **much more beautiful** than the old one,
judged by a **neutral, blind eye**. It is the verifier that closes the `compose` loop:

```
composer → ★ beauty-gate (blind before/after judge) → PASS ✔  |  FAIL → loopback → recompose
```

## Input
- `data/assets/<id>/avant.png` — the prospect's **original site**.
- `output/sites/<id>/<date>/index.html` — the **composed site** (the most recent if `date` is omitted).

## Steps
1. **Capture** the composed site: `node design/verify/verify.cjs <site>/index.html <site>/_after.png`
   (full page: you can also take a dedicated full-page screenshot). You then have 2 images: `avant.png` and `_after.png`.
2. **A NEUTRAL, BLIND judge** — spawn a **sub-agent** (`general-purpose`) to whom you give **only the
   2 images**, labelled **A** and **B** in an **order you alternate** (sometimes the old one as A, sometimes as B),
   **with no context at all** (not the trade, not the brief, no "new/old"). Typical prompt:
   > "Here are two home-page mock-ups, A and B. Judge **only the visual design** (beauty, hierarchy, typography,
   > finish, trust, modernity). Which one is more beautiful, and by how much:
   > **A≫B / A>B / tie / B>A / B≫A**? Give 2-3 reasons. Don't guess the trade."
3. **Map** A/B → old/new. **PASS only if the NEW one wins clearly** (`≫`, "much more beautiful"). A mere `>` or a
   tie = **FAIL**.
4. **FAIL → automatic loopback**: run `/composer <id>` again, passing it **the judge's critique** as feedback
   ("the new one is not clearly more beautiful because X, Y → fix it"), recompose, re-capture, re-judge.
   **Cap: 2 loops** (`GATE_MAX_LOOPS` in `architecture/orchestration/compose-batch.workflow.js`); if it still FAILs
   after 2, **stop and tell the human** (don't loop forever, don't fake the verdict).
5. **Log** in the site's `control.md`: `beauty_before` (from `diagnose`) vs the gate's verdict (winner +
   margin + number of loops).

## Guard-rails
- **Truly blind**: the sub-agent receives **only the pixels** + a neutral prompt. Alternating the A/B order
  avoids position bias. That is what makes "much more beautiful" credible (not self-congratulatory).
- **Honesty > green**: if it doesn't pass after 2 loops, say so (the composer/diagnose has a real problem to fix)
  — never force a PASS.
- It is the **seed of the visual gate** (judging beauty) and the anchor point of the **learning loop**
  (the judge's repeated critiques → rules for the composer).
