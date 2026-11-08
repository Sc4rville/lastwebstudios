# Lead engine

Vertical pilot "one trade, end to end" (kitchen fitters). The lead engine **produces** the
`ProspectSheet`, the `design` block **consumes** it. They talk through `data/` only; no step
calls the next one.

## The funnel

The **cheap** filters **first**, the **expensive** ones **last**, on fewer and fewer prospects.

```
1_scraping       2_scoring                3_parsing                   DELIVERABLE
"who?"           THE GATE                 "what?"                     ProspectSheet
find the      →  judges from the HTML  →  read the kept prospect's →  data/prospects/
prospects        (fetch, ZERO LLM)        site: parse.ts + structuring
(pilot CSV)      weak=kept / modern=dropped  (EXPENSIVE → kept ones only)
```

## 1_scraping — "who?" (script: `scrape.ts`, done)

`npm run scrape -- <industry> [fr|be|ch|all]`: scrapes **OpenStreetMap (Overpass)** — free,
legal (ODbL), no key — across French-speaking Europe (France, Wallonia + Brussels, French-speaking
Switzerland). Trades are mapped to OSM tags (`cuisiniste` = `shop=kitchen`; joiner / ironworker /
architect ready). Keeps only **independents with a website** (`website` required; chains
excluded — `brand` tag + blocklist). Deduplicated by domain through `data/raw/prospects.registry.json`
(versioned): a re-run adds ONLY new rows to `data/raw/prospects.scraped.csv` →
`SEED=data/raw/prospects.scraped.csv npm run pipeline`. Automatic: once a week
(`lws-scrape.timer`, see `architecture/scheduling/`). The hand-made seed CSV still works.

## 2_scoring — "opportunity?" (script + skill, see 2_scoring/README.md)

Two stages, the expensive one last: `score.ts` (the free gate: fetch the HTML, zero LLM), then,
if it says `cold`, the **visual gate** (`visual-gate.ts` + the `visual-scoring-gate` skill:
screenshots + an LLM judge the looks, `npm run gate`). Final score = `max(technical, need)`.
The **full model** (need × leverage × value × closability × expansion) is described in
`leadengine/2_scoring/README.md`. `cold` = dropped, otherwise → parsing.

## 3_parsing — "what?" (done, coded)

Only on the kept prospects. `parse.ts` (mechanical: screenshot + photos + raw text →
`data/raw` + `data/assets`), then the `structuration` skill (LLM → clean fields →
`data/prospects/<id>.json`).

## Deliverable — `ProspectSheet`

`packages/shared/prospect.ts`. Fields: `industry`, `identity`, `content`, `assets`,
`existing.url`, `score`.

## Build order

| phase | what | kind | status |
|-------|------|------|--------|
| 0 | the `ProspectSheet` contract | definition | done |
| 1 | OSM scraping → identities (+ seed CSV) | script | done |
| 2 | scoring (gate + visual model) | script + skill | done (test) — gate + visual gate; LEVERAGE/VALUE left |
| 3 | parsing (`parse.ts` + `structuration`) | script + skill | done |
| 4 | orchestration: chains the steps + writes the sheet | orchestration | done |
