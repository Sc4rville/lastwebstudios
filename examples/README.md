# Examples

REAL results of the product, on **fictional** prospects (no real business, person or photo). Each folder says how
it was produced and how to reproduce it.

| folder | content |
|---|---|
| [orvane-piscines/](orvane-piscines/) | the first real `npm run first-site` build, on the fictional dated site "Orvane Piscines" (test/fixtures/sites/orvane-piscines), on a Claude subscription, boost off: before / after, prospect sheet, report, the blind judge's verdict |
| [atelier-brisane/](atelier-brisane/) | the second real build, on the fictional dated site "Atelier Brisane" (joinery, data/sample/sites/atelier-brisane), with a pair from the open font library (Fraunces × Instrument Sans): PASS on the first round, 11 min |
| [cuisines-lumeo/](cuisines-lumeo/) | the third real build, the hard case: a fictional 2009 site with no e-mail and no usable photo (kitchens, data/sample/sites/cuisines-lumeo); the composer draws the trade instead of inventing photos, Cormorant Garamond × Manrope: PASS on the first round, 13 min |

Each folder holds `site/` (the built site, self-contained: assets and OFL fonts with their licence), `captures/`
(before and after), `fiche.json` (the prospect sheet), `boost.json`, `first-site.json` (timings, engine, lint and
verify results, the judge's reasons) and a `README.md`. Reproduce one: `npm run first-site -- --sample orvane` (10–14 min, about $3 of plan quota).
