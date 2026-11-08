# Cuisines Lumeo: third real site (no photo worth keeping, no e-mail)

A **fictional** prospect (a kitchen maker in Véreuil, an invented town). Its 2009 "old site" was made from scratch
(`data/sample/sites/cuisines-lumeo/`: a single 780 px table page, 11 px text, a yellow 2009 promotion, two crude
illustrations, **no e-mail address** and a broken form). It is the hard case: almost nothing to show, and a prospect
that can only be reached by phone. This folder is the output of a real run:

```
npm run first-site -- http://127.0.0.1:<port>/ --name "Cuisines Lumeo" --city Véreuil --industry cuisiniste \
  --phone "01 99 00 41 52" --date 2026-10-24 \
  --pairings <a file with the "artisan-heritage" pair from design/fonts/pairings.oss.json>
```

run on 24/10/2026 (overnight, WP4) in a throwaway workspace (code only, no `.env`, no real data), the old site served
locally, `LWS_SIRENE=0`, on the Claude subscription, image/video boost off. The agency was French, so the site and the
prospect sheet are in French.

| step | result |
|---|---|
| score (the gate) | 78/100 *hot* in 62 ms: no viewport, poor SEO, no HTTPS, no structured data |
| parse | 2 visuals + logo + 975 characters in 2.6 s (`captures/avant.png`) |
| fiche | the structuration skill on the plan: 9 services in 26 s (`fiche.json`) |
| compose | the `compose-batch` Workflow: diagnose → asset-boost (audit only, 0 credits) → composer → lint + verify net → self-review → blind judge, in 770 s |
| beauty-gate | **PASS on the first round**, margin "much" (the judge's 6 reasons in `first-site.json`) |
| cross-check | `lint.mjs` clean · `verify.cjs` clean at 1440 and 390 px |
| total | 13 min 30 s · Claude Code estimate $2.56 (subscription quota, no API bill) |

What the composer decided (`site/control.md`): the old site's two illustrations were too poor to carry the site, so it
drew the idea of the trade, **"your kitchen starts with a drawing"** (an elevation and an island plan in inline SVG,
material samples in CSS) rather than inventing photos; the **Cormorant Garamond × Manrope** pair (variable, SIL OFL 1.1,
`site/fonts/` with their `OFL.txt`, copied by the composer itself); and since the prospect has no e-mail, everything
leads to the phone and the 3D study.

| file | what |
|---|---|
| `site/` | the delivered site, self-contained (open `site/index.html`) |
| `captures/avant.png`, `captures/apres-desktop.png`, `captures/apres-mobile.png` | full-page before / after |
| `fiche.json` | the ProspectSheet |
| `boost.json` | the asset-boost trace (engines off, 0 credits) |
| `first-site.json` | the run's report: durations, the judge's verdict, lint, verify |

The only touch-ups after the run: the old site's local URL is replaced with `http://cuisines-lumeo.example/` in
`fiche.json` and `first-site.json`, and the screenshot paths point into this folder.
