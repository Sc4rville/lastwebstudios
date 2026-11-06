# Design engine

> How a dated site becomes a bespoke one: the catalog, the composer chain, the deterministic checks and the blind
> judge. The decision behind it, taken on 2026-06-08: **library-first**, compose from real ingredients, never fill
> a template. Global structure: [ARCHITECTURE.md](ARCHITECTURE.md). The agents' arguments and recipe:
> [`architecture/orchestration/compose-batch.md`](../architecture/orchestration/compose-batch.md).

## The decision

Filling a cloned template produces drafts: one mold for everyone, animations that "go everywhere". The engine
composes instead:

```
CATALOG ────────────▶ DIAGNOSE ────────▶ COMPOSE ────────▶ LINT · VERIFY ────▶ BLIND JUDGE ───▶ site
design/               the old site:       sections ×        deterministic:      before vs after   output/sites/
sections · playbooks  what it is, what    font pair ×       em dashes, assets,  A/B alternated    <id>/<date>-composer/
fonts · palettes      fails, the angle    playbook ×        overflow, clipped   pass, or one
motion                and the moves       brief             headings, console   more round (cap 2)
```

**Too much orchestration kills design.** Orchestration wins on *coverage* (audit fifty files, mine fifty sites);
design is a *coherence* problem (type, color, motion, layout and content in relation). So the engine orchestrates
what decomposes (gates, checks, captures, one agent per prospect) and gives **one decider**, the composer, the
latitude to compose, with the constraints placed on the **quality of the ingredients**, the **playbooks** and the
**judge**, never on its creativity.

## The catalog (`design/`)

| piece | content | used by |
|---|---|---|
| `sections/` | 21 section skeletons (hero, services, process, gallery, brands, about, guarantees, testimonials, coverage, FAQ, CTA) with `index.json`: type, layout signature, mood tags, motion, "use when" | the composer picks and **combines** them; two sites must not pick the same variants |
| `industries/<trade>/playbook.md` | per trade: which sections, in which order, what the prospect's customers need to see; `RADAR.md` scores the trades themselves | the composer reads the playbook of the prospect's trade |
| `fonts/` | the OFL library: 31 families from Fontsource, every file's SHA-256 in `oss.lock.json`, `OFL.txt` in each family, 14 curated pairs in `pairings.json`; `blacklist.txt` bans the over-used | one pair is imposed per site; the composer copies the `OFL.txt` next to the woff2 |
| `palettes/`, `motion/`, `catalog.json` | color variables and dominant colors, detected animation stacks, per reference | consulted for mood and motion; the brand color itself is sampled from the prospect's old site |
| `scripts/lint.mjs` | the deterministic net: 0 em dashes, no asset on a disk path, fonts from the library, `--fix` | the composer, `first-site`, the worker |
| `scripts/asset-audit.mjs` | which photos are usable, which need an upscale or a relight | the asset boost |
| `scripts/demo-video.ts` | `npm run demo`: a scrolled, hovered capture of the new site as an mp4 for the outreach | the outreach platform |

## The chain, per prospect

Run by [`compose-batch.workflow.js`](../architecture/orchestration/compose-batch.workflow.js) in Claude Code's
Workflow tool, or by `workflow-local.ts` (the same script, one `claude -p` per agent). `scripts/first-site.ts`
runs it on one prospect.

1. **Diagnose** (skill `diagnose`): reads `avant.png` and the sheet, writes a brief into the sheet: what the
   business is, what fails on the old site, the angle, the moves. It also keeps what the prospect already has
   going for it (reviews, testimonials, partner brands, a booking form): those are strengths, never thrown away.
2. **Asset boost** (skill `asset-boost`, optional): upscale or relight real photos, clean the logo, a hero video.
   Image through an OpenAI-compatible Images API (`LWS_IMAGE=openai|none`), video through the Higgsfield API
   (`LWS_VIDEO=higgsfield|none`). `none` is not a failure: the site is composed with the prospect's real photos.
   `first-site` turns the boost off unless `--boost`.
3. **Compose** (skill `composer`): combines real sections from the catalog, one font pair, the trade's playbook,
   the brief, a restrained motion (three effects at most), the logo handled, a design system rather than a wall of
   prompt. The aesthetic frame is the `frontend-design` skill (the anti-generic direction). Icons are inline
   Lucide SVGs; GSAP, if used, comes from a CDN and is never vendored. No invented review, customer or claim.
4. **Lint and verify** (deterministic): `lint.mjs` must end `clean:true`; `verify.cjs` renders the page at 1440
   and 390 px, captures the full page (`_after.png`) and refuses overflow, broken images, empty bands, clipped
   headings and console errors. One self-review round patches the two or three most visible defects.
5. **Blind judge** (skill `beauty-gate`): a neutral model, no context, sees the old and the new full-page captures
   in alternating A/B order and says which is more beautiful and by how much. Pass only if the new one is clearly
   better; otherwise the composer gets one more round. The cap is 2 (`GATE_MAX_LOOPS` in the workflow; every
   document that cites the cap is checked against the code by `test/docs.test.ts`).
6. **Coach** (`worker/coach.mjs`, worker only): looks at the *served* render on desktop and mobile before the site
   is published to the Station, and loops its fixes back to the composer. `WORKER_NO_COACH=1` disables it.

The result is `output/sites/<id>/<date>-composer/`: `index.html`, assets, `_after.png`, a `control.md` where the
operator's comment lands, and for `first-site` a `first-site.json` report. The Station shows before and after, a
slider, and the comment box; a comment becomes an `edit` job for the worker (`edit-worker.md`), applied without
rebuilding the whole site.

## What the three shipped examples show

[`examples/`](../examples/README.md) holds three real runs on fictional prospects, boost off, on a Claude
subscription, each passing the blind judge on the first round in 10 to 13 minutes: a pool builder, a joiner with
Fraunces × Instrument Sans, and the hard case, a 2009 kitchen site with no e-mail and no usable photo, where the
composer drew the trade (elevation and plan in SVG, a swatch board) instead of inventing photos.

## Open threads

1. **The catalog learns.** An operator's correction should flow back into the catalog or a playbook (a pair
   rejected for a mood becomes a rule), not only into a rebuild of that one site.
2. **Extraction v2.** Labelled components and type scales as real reusable pieces, beyond fonts, palettes and motion.
3. **Variety.** An open model must not compose the same site every time; the catalog's "distinct variants" rule
   and the per-trade playbooks are the current answer, and the proof is in running it on several prospects.
4. **Playbook keys.** Some trade folders use a different key than the taxonomy (`piscine` vs `pisciniste`); the
   composer resolves them today, aliases would make it exact.
