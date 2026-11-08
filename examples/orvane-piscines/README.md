# Orvane Piscines: first real site

A **fictional** prospect (a pool builder in Valmont-sur-Lys, an invented town). Its "old site", dated 2016, was made from
scratch for the tests (`test/fixtures/sites/orvane-piscines/`: tables, a promo banner, a visit counter, no viewport,
home-made SVG illustrations). This folder is the output, as is, of a real run:

```
npm run first-site -- http://127.0.0.1:<port>/ --name "Orvane Piscines" --city Valmont-sur-Lys \
  --industry pisciniste --phone "03 53 01 24 68" --date 2026-10-24 --pairings design/fonts/pairings.oss.json
```

run on 24/10/2026 in a throwaway workspace (code only, no `.env`, no real data), the old site served locally,
`LWS_SIRENE=0`, on the Claude subscription (Claude Code 2.1.281, claude.ai login), image/video boost off. The agency was
French, so the site and the prospect sheet are in French.

| step | result |
|---|---|
| preflight | `npm run doctor -- --for first-site`: ready, Workflow tool available → `workflow` engine |
| score (the gate) | 95/100 *hot* in 46 ms: no viewport, poor SEO, no HTTPS, no structured data |
| parse | 5 visuals + logo + 2,268 characters in 2.4 s (`captures/avant.png`) |
| fiche | the structuration skill on the plan (alias `haiku`, structured output `--json-schema`): 5 services in 10.7 s (`fiche.json`) |
| compose | the `compose-batch` Workflow: diagnose → asset-boost (audit only, `boost.json`: 0 credits) → composer → lint + verify net → self-review → blind judge, in 709 s |
| beauty-gate | **PASS on the first round**, "clearly more beautiful" (the judge's reasons in `first-site.json`) |
| cross-check | `lint.mjs` clean (0 em-dash) · `verify.cjs` clean at 1440 and 390 px (0 overflow, 0 broken image, 0 clipped heading, 0 console error) |
| total | 12 min 10 s · Claude Code estimate $2.88 (subscription quota, no API bill) |

What the composer decided (from `site/control.md`): the **Host Grotesk × Geist** pair (free fonts, SIL Open Font
License 1.1, self-hosted in `site/fonts/`), the *hero-split* archetype, a light mood, 3 movements at most, real content
only (no invented review: the fiche has none), the illustrations presented as pool types and never as "our work".

| file | what |
|---|---|
| `site/` | the delivered site, self-contained (open `site/index.html`) |
| `captures/avant.png`, `captures/apres-desktop.png`, `captures/apres-mobile.png` | full-page before / after |
| `fiche.json` | the ProspectSheet (identity, content, the diagnose brief) |
| `boost.json` | the asset-boost trace (engines off, 0 credits) |
| `first-site.json` | the run's report: durations, the judge's verdict, lint, verify |

Licences: the Host Grotesk and Geist fonts are under SIL OFL 1.1; each family's `OFL.txt` file must accompany the
open-source edition (to add to the export). The illustrations and the text are fictional, made for LWS.
