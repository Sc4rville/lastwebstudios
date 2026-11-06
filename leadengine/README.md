# Lead engine

Pilote vertical "1 métier, bout en bout" (cuisinistes). Le lead engine **produit** le
`ProspectSheet`, le bloc `design` le **consomme**. Comm via `data/` uniquement, aucune
étape n'appelle la suivante.

## The funnel

Les filtres **pas chers d'abord**, le **coûteux en dernier**, sur de moins en moins de prospects.

```
1_scraping       2_scoring                3_parsing                 LIVRABLE
"qui ?"          LA PORTE                 "quoi ?"                  ProspectSheet
trouver les   →  juge depuis le HTML   →  lire le site du retenu →  data/prospects/
prospects        (fetch, ZÉRO LLM)        parse.ts + structuration
(CSV pilote)     faible=gardé / moderne=écarté  (CHER → seulement les retenus)
```

## 1_scraping — "who?" (script : `scrape.ts`, fait)

`npm run scrape -- <industry> [fr|be|ch|all]` : scrape **OpenStreetMap (Overpass)** — gratuit,
légal (ODbL), zéro clé — sur la francophonie (France, Wallonie+Bruxelles, Suisse romande).
Métiers mappés sur les tags OSM (`cuisiniste` = `shop=kitchen` ; menuisier/ferronnier/architecte
prêts). Garde uniquement les **indépendants avec site web** (`website` obligatoire ; chaînes
exclues — tag `brand` + blacklist). Dédup par domaine via `data/raw/prospects.registry.json`
(versionné) : un re-run n'ajoute QUE du neuf dans `data/raw/prospects.scraped.csv` →
`SEED=data/raw/prospects.scraped.csv npm run pipeline`. En auto : 1×/semaine
(`lws-scrape.timer`, cf. `architecture/scheduling/`). Le CSV seed manuel reste utilisable.

## 2_scoring — "opportunity?" (script + skill, voir 2_scoring/README.md)

Deux étages, le coûteux en dernier : `score.ts` (porte gratuite : fetch HTML, zéro LLM), puis
si elle dit `cold`, le **gate visuel** (`visual-gate.ts` + skill `visual-scoring-gate` :
screenshots + LLM jugent la beauté, `npm run gate`). Score final = `max(technique, besoin)`.
Le **modèle complet** (besoin × levier × valeur × closabilité × expansion) est décrit dans
`leadengine/2_scoring/README.md`. `cold` = écarté, sinon → parsing.

## 3_parsing — "what?" (fait, codé)

Seulement sur les retenus. `parse.ts` (mécanique : screenshot + photos + texte brut →
`data/raw` + `data/assets`) puis skill `structuration` (LLM → champs propres →
`data/prospects/<id>.json`).

## Deliverable — `ProspectSheet`

`packages/shared/prospect.ts`. Champs : `industry`, `identity`, `content`, `assets`,
`existing.url`, `score`.

## Build order

| phase | quoi | nature | état |
|-------|------|--------|------|
| 0 | contrat `ProspectSheet` | définition | fait |
| 1 | scraping OSM → identités (+ CSV seed) | script | fait |
| 2 | scoring (porte + modèle visuel) | script + skill | fait (test) — porte + gate visuel ; reste LEVIER/VALEUR |
| 3 | parsing (`parse.ts` + `structuration`) | script + skill | fait |
| 4 | orchestration : enchaîne + écrit la fiche | orchestration | fait |
