---
name: radar-industries
description: Le radar d'industries du lead engine — score les MÉTIERS (pas les prospects) pour décider quelles verticales attaquer, et CRÉE une nouvelle industrie de bout en bout (entrée scraping + profil design). Use quand l'utilisateur veut "le radar", "quelles industries viser", "ajoute/crée une industrie", "câble un métier", "classe les métiers", ou regarde `design/industries/RADAR.md`. Le score (ticket × web-décisif × vivier vendable × récurrent) est mécanique (`npm run radar`) ; la création d'industrie est un travail de recherche (LLM).
version: 0.1.0
user-invocable: true
argument-hint: "[<métier à créer>]"
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

Le **radar d'industries** rend le choix des cibles INTELLIGENT : au lieu de deviner quel métier scraper,
on le **score**. Deux usages.

## 1 · Lire le classement (mécanique, zéro LLM)

```
npm run radar              # classe tout l'univers + écrit design/industries/RADAR.md
npm run radar -- <métier>  # le détail d'un métier (score + pourquoi + état)
```

Score = **ticket** (ce qu'ils peuvent nous payer) × **web-décisif** (vendent-ils par l'image ?) ×
**vivier vendable** (TAM × (1 − densité de franchises) — la leçon piscine) × **récurrent**. Réutilise les
baselines `value`/`lever` de `industries.ts` et **lit les règles apprises** (`learning/`) → s'affine avec
la conversion réelle. Le classement vit dans **`design/industries/RADAR.md`** (régénéré, lisible).

`leadengine/1_scraping/scripts/radar.ts` — `CANDIDATES` = l'univers évalué. Un métier est **scrapable**
dès qu'il a une entrée dans `industries.ts` ; sinon le radar le marque **« à câbler »**.

## 2 · Créer une industrie (recherche → scraping + design)

Quand le radar liste un métier 🎯 **« à câbler »**, le rendre scrapable de bout en bout. Pour `<métier>` :

### a. Rechercher la config de scraping (web, à VÉRIFIER — un tag faux = scraper qui ramène 0)
- **`osm`** : les tags OpenStreetMap réellement utilisés en France pour ce métier (wiki OSM / taginfo) →
  1–3 sélecteurs Overpass au format `'["clé"="valeur"]'`. Aucun tag fiable → `[]` (on s'appuie sur SIRENE).
- **`naf`** : les codes NAF/APE FR réels (`"NN.NNL"`), vérifiés.
- **`terms`** : 4–6 mots-clés FR distinctifs (valident l'appartenance d'un site au métier).
- **`chains`** : les **grandes franchises / réseaux nationaux** FR du métier (fragments regex insensibles
  casse). Un franchisé ne décide pas de son site = invendable → on l'exclut. Sois exhaustif sur les réseaux.

### b. Câbler le scraping — ajouter l'entrée dans `leadengine/1_scraping/scripts/industries.ts`
```ts
<key>: {
  label: "<libellé>",
  osm: [...], naf: [...], terms: [...],
  chains: [...],                 // les franchises du métier
  lever: NN, value: NN, expansion: NN,  // baselines : reprends celles du candidat radar (cohérence du score)
},
```
Si le métier produit un `ProspectSheet`, ajoute aussi sa clé au type `Industry` de `packages/shared/prospect.ts`.

### c. Créer le profil DESIGN — `design/industries/<key>.md` (le fichier dédié, lu par le filler)
Calque le format de **`design/industries/lieu-reception.md`** : `# <key> — playbook`, puis **Ce que vend ce
métier**, **Angle & ton**, **Sections à privilégier**, **À éviter**, **Photos**. Écris-le pour CE métier
(ce qu'il vend vraiment, son émotion d'achat, ses sections clés), pas générique.

### d. Vérifier
`npm run radar -- <key>` → il doit apparaître **scrapable**. `npx tsc --noEmit` clean. Option : `npm run
scrape -- <key> fr` (un petit lot) pour prouver que les tags OSM ramènent de vrais prospects du métier.

> En lot (plusieurs métiers d'un coup) : orchestrer la phase **recherche + vérification adversariale** en
> agents (un par métier) avant d'écrire — cf. le workflow `wire-industries` (recherche web → sceptique →
> config vérifiée). On ne devine jamais un tag OSM / code NAF : on recherche, on vérifie, puis on câble.

## 3 · DÉCOUVRIR de nouvelles industries (la moitié qui manquait)

Le classement (§1) ne fait que **ranger ce qu'on lui a déjà donné**. La **découverte** trouve des
verticales qu'on n'a **PAS** encore. C'est la moitié manquante du radar (classer ≠ découvrir).

Profil cible : **gros ticket × le web vend (visuel / portfolio / réservation) × beaucoup d'indépendants ×
peu de franchises × francophone (FR/BE/CH)**.

Une passe de découverte :
1. **Brainstormer + rechercher** des métiers qui collent au profil et **absents de `industries.ts`** (web :
   annuaires de métiers, secteurs artisanaux & services premium). Vise large : habitat/extérieur,
   esthétique/santé, événementiel/hospitalité, artisanat de luxe, auto/nautisme premium…
2. **Filtrer** : retirer les déjà-câblés, les trop franchisés (vivier vendable faible), les ticket/web faibles.
3. **Câbler** chaque retenu via §2 (recherche `osm/naf/terms/chains` VÉRIFIÉE → `industries.ts` + profil design).
4. `npm run radar` → ils apparaissent classés à leur vraie place.

**À l'échelle, orchestrer en agents** (un par métier : recherche → vérif adversariale → config) — cf. le
workflow **`wire-industries-folie`**, le moteur de la découverte de masse. Exemples déjà découverts &
câblés ainsi : architecte d'intérieur, ébéniste, hôtel de charme, domaine viticole, traiteur, fleuriste
événementiel, et ~25 autres.
