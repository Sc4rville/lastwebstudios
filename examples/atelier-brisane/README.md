# Atelier Brisane: second real site (OFL font pair)

A **fictional** prospect (a joiner-cabinetmaker in Sornac-le-Haut, an invented town). Its 2011 "old site" was made from
scratch (`data/sample/sites/atelier-brisane/`: a fixed 960 px layout, a left column, tiny thumbnails, a visit counter,
2011 prices, home-made SVG illustrations). This folder is the output of a real run:

```
npm run first-site -- http://127.0.0.1:<port>/ --name "Atelier Brisane" --city Sornac-le-Haut \
  --industry menuisier --phone "02 61 91 37 05" --email bonjour@atelier-brisane.example --date 2026-10-24 \
  --pairings <a file with the "warm-editorial" pair from design/fonts/pairings.oss.json>
```

run on 24/10/2026 (overnight, WP4) in a throwaway workspace (code only, no `.env`, no real data), the old site served
locally, `LWS_SIRENE=0`, on the Claude subscription (Claude Code, claude.ai login), image/video boost off. It proves the
free font library: the imposed pair comes from `design/fonts/oss.lock.json` (Fontsource). The agency was French, so the
site and the prospect sheet are in French.

| step | result |
|---|---|
| preflight | `npm run doctor -- --for first-site`: ready, Workflow tool available → `workflow` engine |
| score (the gate) | 82/100 *hot* in 43 ms: no viewport, poor SEO, no HTTPS, no structured data |
| parse | 6 visuals + logo + 2,056 characters in 2.7 s (`captures/avant.png`) |
| fiche | the structuration skill on the plan (structured output): 7 services in 15 s (`fiche.json`) |
| compose | the `compose-batch` Workflow: diagnose → asset-boost (audit only, `boost.json`: 0 credits) → composer → lint + verify net → self-review → blind judge, in 638 s |
| beauty-gate | **PASS on the first round**, margin "much" (the judge's 6 reasons in `first-site.json`) |
| cross-check | `lint.mjs` clean (0 em-dash) · `verify.cjs` clean at 1440 and 390 px (0 overflow, 0 broken image, 0 clipped heading, 0 console error) |
| total | 11 min 9 s · Claude Code estimate $2.93 (subscription quota, no API bill) |

What the composer decided (from `site/control.md`): the **Fraunces × Instrument Sans** pair (variable, SIL OFL 1.1,
`site/fonts/` with their `OFL.txt`), the *hero-split* archetype, warm paper and oiled oak, 3 motion gestures at most,
`prefers-reduced-motion` respected. The illustrations are presented as such and marked "to replace with real job-site
photos"; the 2011 prices, the counter and the stale news are removed; no invented social proof (the fiche has none).

| file | what |
|---|---|
| `site/` | the delivered site, self-contained (open `site/index.html`) |
| `captures/avant.png`, `captures/apres-desktop.png`, `captures/apres-mobile.png` | full-page before / after |
| `fiche.json` | the ProspectSheet (identity, content, audit, the diagnose brief) |
| `boost.json` | the asset-boost trace (engines off, 0 credits) |
| `first-site.json` | the run's report: durations, the judge's verdict, lint, verify |

The only touch-ups after the run: the old site's local URL (`http://127.0.0.1:<port>/`) is replaced with
`http://atelier-brisane.example/` in `fiche.json` and `first-site.json`, the screenshot paths point into this folder, and
a sentence of `control.md` that named another site of the private repository is made generic. The two families'
`OFL.txt` files were added next to the woff2 files.
