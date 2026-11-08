---
name: radar-industries
description: The lead engine's industry radar — scores TRADES (not prospects) to decide which verticals to go after, and CREATES a new industry end to end (scraping entry + design profile). Use when the user wants "the radar", "which industries to target", "quelles industries viser", "add/create an industry", "wire a trade", "rank the trades", or is looking at `design/industries/RADAR.md`. The score (ticket × web-decisive × sellable pool × recurring) is mechanical (`npm run radar`); creating an industry is research work (LLM).
version: 0.1.0
user-invocable: true
argument-hint: "[<trade to create>]"
license: Apache 2.0
allowed-tools:
  - Bash(npm run radar*)
  - Bash(npx tsx *)
  - Read
  - Write
  - Edit
  - WebSearch
  - WebFetch
---

The **industry radar** makes the choice of targets SMART: instead of guessing which trade to scrape, we **score**
it. Two uses.

## 1 · Read the ranking (mechanical, zero LLM)

```
npm run radar             # ranks the whole universe + writes design/industries/RADAR.md
npm run radar -- <trade>  # the detail of one trade (score + why + state)
```

Score = **ticket** (what they can pay us) × **web-decisive** (do they sell through imagery?) ×
**sellable pool** (TAM × (1 − franchise density) — the pool-builder lesson) × **recurring**. It reuses the
`value`/`lever` baselines of `industries.ts` and **reads the learned rules** (`learning/`) → it sharpens with real
conversion. The ranking lives in **`design/industries/RADAR.md`** (regenerated, readable).

`leadengine/1_scraping/scripts/radar.ts` — `CANDIDATES` = the universe evaluated. A trade is **scrapable**
as soon as it has an entry in `industries.ts`; otherwise the radar marks it **"to wire"** (« à câbler »).

## 2 · Create an industry (research → scraping + design)

When the radar lists a 🎯 trade **"to wire"**, make it scrapable end to end. For `<trade>`:

### a. Research the scraping config (web, to VERIFY — a wrong tag = a scraper that brings back 0)
- **`osm`**: the OpenStreetMap tags actually used for this trade in the target country (OSM wiki / taginfo) →
  1–3 Overpass selectors in the format `'["key"="value"]'`. No reliable tag → `[]` (we rely on the business
  registry, SIRENE in France).
- **`naf`**: the real French NAF/APE codes (`"NN.NNL"`), verified.
- **`terms`**: 4–6 distinctive keywords in the country's language (they confirm a site belongs to the trade).
- **`chains`**: the trade's **big national franchises / networks** (case-insensitive regex fragments). A
  franchisee doesn't decide on its own site = unsellable → we exclude it. Be exhaustive on the networks.

### b. Wire the scraping — add the entry in `leadengine/1_scraping/scripts/industries.ts`
```ts
<key>: {
  label: "<label>",
  osm: [...], naf: [...], terms: [...],
  chains: [...],                 // the trade's franchises
  lever: NN, value: NN, expansion: NN,  // baselines: reuse the radar candidate's (keeps the score consistent)
},
```
If the trade produces a `ProspectSheet`, also add its key to the `Industry` type in `packages/shared/prospect.ts`.

### c. Create the DESIGN profile — `design/industries/<key>/playbook.md` (the dedicated file, read by the composer and the filler)
Copy the format of **`design/industries/lieu-reception/playbook.md`**: `# <key> — playbook`, then **What this trade
sells**, **Concept & angle**, **STRUCTURE**, **Mood**, **Avoid**, **Photos**. Write it for THIS trade
(what it really sells, its buying emotion, its key sections), not generic.

### d. Check
`npm run radar -- <key>` → it must show as **scrapable**. `npx tsc --noEmit` clean. Optional: `npm run
scrape -- <key> fr` (a small batch) to prove the OSM tags bring back real prospects of the trade.

> In bulk (several trades at once): orchestrate the **research + adversarial verification** phase as agents (one
> per trade) before writing — see the `wire-industries` workflow (web research → sceptic → verified config). We never
> guess an OSM tag / NAF code: we research, we verify, then we wire.

## 3 · DISCOVER new industries (the half that was missing)

The ranking (§1) only **sorts what it was already given**. **Discovery** finds verticals we DON'T have yet. It is
the missing half of the radar (ranking ≠ discovering).

Target profile: **big ticket × the web sells (visual / portfolio / booking) × many independents ×
few franchises × in the agency's market (French-speaking FR/BE/CH for the French agency)**.

A discovery pass:
1. **Brainstorm + research** trades that fit the profile and are **missing from `industries.ts`** (web: trade
   directories, craft sectors & premium services). Aim wide: home/outdoor, beauty/health, events/hospitality,
   luxury crafts, premium auto/boating…
2. **Filter**: remove the ones already wired, the overly franchised (weak sellable pool), weak ticket/web.
3. **Wire** each one kept via §2 (VERIFIED `osm/naf/terms/chains` research → `industries.ts` + design profile).
4. `npm run radar` → they show up ranked at their real place.

**At scale, orchestrate as agents** (one per trade: research → adversarial check → config) — see the
**`wire-industries-folie`** workflow, the engine of mass discovery. Examples already discovered & wired this way:
interior architect, cabinetmaker, boutique hotel, wine estate, caterer, event florist, and ~25 others.
