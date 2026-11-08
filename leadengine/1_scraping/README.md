# 1_scraping — the prospect tap (several sources)

Finds **qualified French-speaking** prospects in bulk (FR + Wallonia/Brussels + French-speaking Switzerland)
for any **trade**: `name, city, website, phone, industry` → `data/raw/prospects.scraped.csv`.
Mechanical, zero LLM, free and legal, deduplicated, built to run unattended (cron).

```bash
npm run scrape -- <industry> [fr|be|ch|all]
SEED=data/raw/prospects.scraped.csv npm run pipeline
```

The **trade is a parameter** (cuisiniste, menuisier, ferronnier, architecte, paysagiste… one line
in `industries.ts` per trade: its OSM tags + its NAF codes + its keywords).

## The sources (a funnel: precise first, volume next)

| source | coverage | website? | precision | key/binary |
|--------|-----------|:---:|:---:|---|
| **osm** | FR+BE+CH (Overpass) | **direct** (tag) | high | none |
| **gmaps** | everywhere (gosom adapter) | **direct** | high | Go binary `gosom/google-maps-scraper` (opt-in `GMAPS_CSV=`) |
| **sirene** | FR (full registry by NAF code) | **no → enriched** | medium | none (government API, no key) |

- **osm** / **gmaps** give the website directly → the qualified backbone.
- **sirene** gives a huge volume of names without a website → **enrichment** (`enrich.ts`) finds the
  site (guess the domain + DNS, DuckDuckGo as a fallback) and **validates** it: ownership (a word of the
  name that is not the town appears in the domain/title) **and** trade relevance (the page talks about
  the trade). Guards: aggregators, car parks, town hall sites, chains/franchises.

**Free contacts** (`harvest.ts`, on by default, `HARVEST=0` to turn it off): once the site is known, we
read the home page (+ `/contact`) and extract **phone + email** (`tel:`/`mailto:` + FR/BE/CH regexes) →
the `phone`/`email` columns. This feeds **scoring** (closability) and **distribution** (whom to write to).
Observed coverage: ~70 % have a phone.

**The EMAIL link** (`emails.ts`, `npm run emails [-- <id..>]`): the SERIOUS reachability layer, on
the sheets (`data/prospects/`) without a verified email — a spread of pages (home, contact, **legal
notice**, about…), broad extraction (mailto, text, `[at]` obfuscations, Cloudflare protection
`data-cfemail`, JSON-LD), sorted by domain affinity, **MX check**; last resort = a guessed pattern
(`contact@`, `firstname@`) marked `emailVerified:false`/`emailSource:"pattern"`. The cold email
machine lives or dies on this link. Afterwards: `npm run reindex`.

## Flags (env)

| flag | effect |
|------|-------|
| `SOURCES=osm,sirene,gmaps` | which sources (default: `osm` + `sirene` if the area touches France) |
| `ENRICH=0` | don't look for missing websites (drops rows without a site) |
| `LIMIT=n` | cap on NEW prospects added |
| `PER_SOURCE=n` | cap per source (mostly SIRENE, whose enrichment is slow; default 200) |
| `DEPTS=69,13,75` | SIRENE départements (default: all of France) |
| `GMAPS_CSV=path` | ingests a `gosom/google-maps-scraper` CSV |

Dedup: `data/raw/prospects.registry.json` (versioned, shared). A re-run adds ONLY new rows and does not
retry an enrichment that already failed. Automatic: `lws-scrape.timer` (weekly).

## gosom/google-maps-scraper (the high-precision volume source)

GMaps has the `website` field directly → no guessing. We don't reimplement it (battle-tested Go
binary, ~4.3k★). Workflow:
```bash
# 1) "cuisiniste <town>" queries → gosom → CSV   2) ingest it:
GMAPS_CSV=gmaps-out.csv SOURCES=gmaps npm run scrape -- cuisiniste fr
```
Risk: Google's ToS (throttle the cron). Details and alternatives: section below.

## Future sources (GitHub / deep-research survey, 2026-06)

- **KBO/BCE Open Data (Belgium)** — an **official** monthly CSV dump with PHONE/WEB/EMAIL by NACE code + municipality;
  zero scraping. → an adapter like `gmapsCsvSource` to write.
- **API Recherche d'entreprises (FR)** — already integrated (the `sirene` source).
- **rverton/webanalyze** (Go) — bulk technology detection (Wix, old WordPress…): a pre-sort BEFORE the
  visual gate → belongs to the **scoring** phase.
- To avoid: PagesJaunes / societe.com scrapers (dead, DataDome anti-bot → paid proxies).
