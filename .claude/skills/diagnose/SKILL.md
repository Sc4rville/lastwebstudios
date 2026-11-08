---
name: diagnose
description: Diagnose a prospect's EXISTING website before composing — look at their current site (the avant.png screenshot + the fiche + the live URL) and produce a short, specific design brief : what the business really is, what's WRONG with their current site, and the angle + concrete design moves we'll bring for THEM. Writes the brief into the fiche so the composer targets their real problems instead of building a generic pretty site. The reflection step between parse and compose. Triggers: "diagnose <prospect>", "brief <prospect>", "what's wrong with their site", "qu'est-ce qui cloche sur son site", "analyse le site du prospect". Not for composing (use composer) nor scoring opportunity (that's the scoring gate).
version: 0.1.0
user-invocable: true
argument-hint: "<prospectId>"
license: Apache 2.0
allowed-tools:
  - Read
  - Edit
---

> ⚠ **TEST MODE** (see `/skilldraft` §6) — a young skill: warn before use, never automatic/unattended.
> Promoted after ≥3 validated uses.

The **DIAGNOSE** step: the **thinking** that was missing between `parse` and `composer`. We don't compose a pretty
site in a vacuum — we look at **the prospect's CURRENT site**, understand what's wrong, and decide **what we bring
specifically**. This brief makes the output targeted (a pitch), not generic.

```
parse (content + avant.png)  →  ★ diagnose (the brief)  →  composer (picks from the catalogue, follows the brief)
```

## Language
The brief is written in the agency's language (`agency.config.json › language`, `LANGUAGE` in the prompt; default French): the composer and the call script reuse it as is.

## Input
- `data/prospects/<id>.json` — the fiche (content, services, tone; `existing.url`, `existing.screenshot`).
- **`data/assets/<id>/_audit-desktop.png` AND `_audit-mobile.png`** — the FRESH **desktop (full page) +
  mobile (390px)** screenshots produced by the audit: **Read BOTH**. **Mobile is crucial** (that's where things break: overflow, tiny text). Fallback: `avant.png`.
- **`fiche.audit`** — the **MEASURED technical audit** (`npm run audit -- <id>`): speed, broken mobile (390px), HTTPS,
  viewport, contact, SEO, dead links, + `issues` (**quantified, verifiable grievances**) + **`strengths`** (video testimonials,
  Google reviews/rating, booking detected = the **STRENGTHS**). **Missing → run `npm run audit -- <id>` first.** The eye sees the design; the audit PROVES the technical side.

## Steps
0. **`npm run audit -- <id>`** if `fiche.audit` is missing (the measured audit feeds the grievances).
1. **Read** the fiche + **`fiche.audit`** + **Read the 2 screenshots** (`_audit-desktop.png` + `_audit-mobile.png`; failing that `avant.png`). **Judge DESKTOP AND MOBILE.**
2. **Think** and write a brief, concrete and specific to THIS prospect:
   - **beauty_before**: rate the **beauty of the current site out of 10** + 1 sentence (the baseline for the
     `beauty-gate`; be honest — a dated site = 2-4/10). The new one will have to be **clearly** above it.
   - **what**: the business, its audience, its tone, what it really sells (1-2 sentences).
   - **problems**: what's **wrong with their current site**. Combine TWO sources: (a) what you SEE on `avant.png`
     (dated design, no hierarchy, no clear CTA, weak photos, zero social proof, too busy/empty…) and
     (b) the **MEASURED grievances from `fiche.audit.issues`** (quantified, irrefutable: "loads in X s", "overflows on
     mobile", "no HTTPS", "no way to get in touch"…). **The measured ones COME FIRST when they exist** (they're verifiable).
     3-6 concrete bullets, never generic.
     **ACTIVELY LOOK FOR BUGS (desktop AND mobile)** — they are the most telling grievances: an element that
     **COVERS** another (a button placed ON TOP of text), **cut-off/truncated text**, an **overlap**, a broken block,
     a **missing image**, a menu that overflows. Really look; don't settle for a general impression.
   - **angle**: the **promise** / positioning we choose for THEM (one sentence).
   - **moves**: 2-3 concrete **design stances** (e.g. "full-screen hero on the projects",
     "put the 10-year guarantee forward as proof", a mood + a suggested font pair from the `design/fonts` catalogue).
   - **keep**: the **STRENGTHS to KEEP and make award-worthy** (the DG lesson) — Google reviews/rating, **VIDEO**
     testimonials, partner brands, **booking**, before/after. Start from `fiche.audit.strengths` + what you SEE on the
     screenshots (the audit only scans the home page → complete it by eye). The composer never DROPS these, it elevates
     them. (A list; empty if nothing.)
3. **Write the brief into the fiche**: add (or replace) a `"brief"` key in `data/prospects/<id>.json`
   (`{ "date": "...", "beauty_before": {"score": N, "why": "..."}, "what": "...", "problems": [...], "angle": "...", "moves": [...], "keep": [...] }`),
   **without touching the rest** of the fiche.
4. **Report** the brief (the 3 parts) + what remains uncertain.

## The composer consumes it
`/composer <id>` reads `fiche.brief` as its **direction**: fix the `problems`, hold the `angle`,
apply the `moves`. If `brief` is missing → run `/diagnose` first.

## Guard-rails
- **Based on what is SEEN** (`avant.png`) + the fiche — **no invention**. If `avant.png` is missing, say so and
  make a partial diagnosis (fiche + live URL), marked as such.
- An **honest and specific** diagnosis: "no CTA, dark photos, a never-ending menu" beats "the site could be more
  modern". No flattery, nothing generic.
- It is also the seed of the **visual gate** (judging the current site) and it feeds the learning loop.
