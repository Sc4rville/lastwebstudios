# Scoring model

Goal: should we invest a site + a pitch in this prospect, and will we close them?

## 2 gates (fail = score 0, dropped)
- **FIT**: right industry, independent (not a chain), active business.
- **FEASIBILITY**: enough content/photos to build a quality demo.

## 5 axes (each scored /100, weighted)

| weight | axis | the question |
|:---:|---|---|
| **30** | NEED | is their current site weak? (visual judge) |
| **25** | LEVERAGE | what would a better site change for them? (do they sell through the web?) |
| **20** | VALUE | can they pay? does one won customer pay it back many times over? |
| **15** | CLOSABILITY | reachable (the owner's line), a very small business = a single decision maker |
| **10** | EXPANSION | future potential (booking, e-commerce, app, recurring) |

**Score = Σ (axis × weight) / 100**, set to 0 if a gate fails.
Tiers: `hot ≥ 60 · warm ≥ 35 · cold < 35`.

## Order (the expensive last) — **full model wired (2026-06-13)**
1. **free**: `techProbe()` (technical need + feasibility, raw HTML) + CLOSABILITY (phone/email
   collected while scraping) + LEVERAGE/VALUE/EXPANSION (trade baselines, `industries.ts`).
2. **medium**: visual NEED (screenshots + LLM, `visual-gate.ts`) — called ONLY if the technical
   need is low (< 60); `need = max(tech, visual)`. `VISUAL=0` turns it off.
3. **expensive** *(to come)*: fine VALUE (revenue via Pappers/SIREN) + refined EXPANSION — on the kept ones.

The 5 axes are assembled and weighted in `model.ts` (`buildAxes` → `weighted`). The gate calls
`scoreProspect(id, url, {industry, phone, email, effectif?})`.

**Taxonomy**: every trade goes through `normalizeIndustry()` (`industries.ts` = the ONLY canonical
vocabulary; aliases `piscine→pisciniste`, `couverture→couvreur-zingueur`…). Off-table = reported, never
silent (before: a mute generic `value 50` fallback — a third of the portfolio scored blind).

**Extra gates**: reachability (neither email nor phone → never `hot`, capped at warm); the **AUDIT**
signal (`3_parsing/audit.ts`: real slowness, overlaps, dead images…) is fed back into the
need (`besoinFromAudit`, `need = max(tech, visual, audit)`).

**Portfolio re-score** (`rescore.ts`, `npm run rescore [-- <id..>]`): OFFLINE healing of the existing
sheets — normalises the taxonomy, replaces placeholder scores, rebuilds the axes + `expectedValue`
(the sort by €) with every gate. Run it after a model change or an audit; then
`npm run reindex`.

**Axes differ per prospect (not just per trade).** Leverage/value/expansion start from a
trade baseline BUT are adjusted by **free signals read in the HTML** (the same fetch as the
probe): gallery/portfolio + quote CTA + social links → **leverage**; bespoke/premium/showroom +
several branches → **value**; e-commerce/booking/blog → **expansion**. An inert brochure site
(no gallery, no CTA) is penalised on leverage. Result: a real **ranking** between prospects of the
same trade (checked: 5 kitchen fitters with leverage from 70 to 98 depending on how they really use their site).

### Gates
- **FIT**: known trade + independent (chains already excluded while scraping).
- **FEASIBILITY**: enough content/images to build a demo. A dead or too-thin site → capped
  at `warm` (a manual rebuild from scratch, nothing to parse/clone), never sent to automatic production.

## Output
`value` + `tier` + `axes` (the 5 scores) + `reasons` + `accroche` (weakness no. 1 → the email's angle).
