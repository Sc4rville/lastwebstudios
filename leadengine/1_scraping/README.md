# 1_scraping — le robinet à prospects (multi-sources)

Trouve en masse des prospects **francophones qualifiés** (FR + Wallonie/Bruxelles + Suisse romande)
pour n'importe quel **métier** : `name, city, website, phone, industry` → `data/raw/prospects.scraped.csv`.
Mécanique, zéro LLM, gratuit/légal, dédupliqué, fait pour tourner en auto (cron).

```bash
npm run scrape -- <industry> [fr|be|ch|all]
SEED=data/raw/prospects.scraped.csv npm run pipeline
```

Le **métier est un paramètre** (cuisiniste, menuisier, ferronnier, architecte, paysagiste… une ligne
dans `industries.ts` par métier : ses tags OSM + ses codes NAF + ses mots-clés).

## Les sources (entonnoir : précis d'abord, volume ensuite)

| source | couverture | site web ? | précision | clé/binaire |
|--------|-----------|:---:|:---:|---|
| **osm** | FR+BE+CH (Overpass) | **direct** (tag) | haute | aucune |
| **gmaps** | partout (adapter gosom) | **direct** | haute | binaire Go `gosom/google-maps-scraper` (opt-in `GMAPS_CSV=`) |
| **sirene** | FR (registre complet par NAF) | **non → enrichi** | moyenne | aucune (API gouv sans clé) |

- **osm** / **gmaps** donnent le site directement → backbone qualifié.
- **sirene** donne un volume massif de noms sans site → l'**enrichissement** (`enrich.ts`) retrouve le
  site (devine-domaine+DNS, fallback DuckDuckGo) et **valide** : appartenance (mot du nom ≠ ville dans
  le domaine/titre) **et** pertinence métier (la page parle du métier). Garde-fous : agrégateurs,
  parkings, sites de mairie, chaînes/franchises.

**Contacts gratuits** (`harvest.ts`, défaut on, `HARVEST=0` pour couper) : une fois le site connu, on
lit la home (+ `/contact`) et on extrait **téléphone + email** (`tel:`/`mailto:` + regex FR/BE/CH) →
colonnes `phone`/`email`. Ça nourrit le **scoring** (closabilité) et la **distribution** (à qui écrire).
Couverture observée : ~70 % de téléphones.

**Maillon EMAIL** (`emails.ts`, `npm run emails [-- <id..>]`) : la couche contactabilité SÉRIEUSE, sur
les fiches (`data/prospects/`) sans email vérifié — éventail de pages (home, contact, **mentions
légales**, à-propos…), extraction large (mailto, texte, obfuscations `[at]`, protection Cloudflare
`data-cfemail`, JSON-LD), tri par affinité de domaine, **vérification MX** ; dernier recours = pattern
deviné (`contact@`, `prénom@`) marqué `emailVerified:false`/`emailSource:"pattern"`. La machine à cold
email vit ou meurt sur ce maillon. Après : `npm run reindex`.

## Flags (env)

| flag | effet |
|------|-------|
| `SOURCES=osm,sirene,gmaps` | quelles sources (défaut : `osm` + `sirene` si la zone touche la FR) |
| `ENRICH=0` | ne pas chercher les sites manquants (jette les lignes sans site) |
| `LIMIT=n` | cap des prospects NEUFS ajoutés |
| `PER_SOURCE=n` | cap par source (surtout SIRENE, dont l'enrichissement est lent ; défaut 200) |
| `DEPTS=69,13,75` | départements SIRENE (défaut : toute la France) |
| `GMAPS_CSV=path` | ingère un CSV `gosom/google-maps-scraper` |

Dédup : `data/raw/prospects.registry.json` (versionné, partagé). Un re-run n'ajoute QUE du neuf et ne
re-tente pas un enrichissement déjà échoué. Auto : `lws-scrape.timer` (hebdo).

## gosom/google-maps-scraper (la source volume haute-précision)

GMaps a le champ `website` directement → zéro devinette. On ne le réimplémente pas (binaire Go
battle-tested, ~4,3k★). Workflow :
```bash
# 1) requêtes "cuisiniste <ville>" → gosom → CSV   2) on l'ingère :
GMAPS_CSV=gmaps-out.csv SOURCES=gmaps npm run scrape -- cuisiniste fr
```
Risque : ToS Google (throttler le cron). Détails & alternatives : section ci-dessous.

## Sources futures (recherche GitHub/deep-research 2026-06)

- **KBO/BCE Open Data (Belgique)** — dump CSV mensuel **officiel** avec TEL/WEB/EMAIL par NACE+commune ;
  zéro scraping. → un adapter type `gmapsCsvSource` à écrire.
- **API Recherche d'entreprises (FR)** — déjà intégrée (source `sirene`).
- **rverton/webanalyze** (Go) — détection techno de masse (Wix/vieux WordPress…) : pré-tri AVANT le
  gate visuel → appartient à la phase **scoring**.
- À éviter : scrapers PagesJaunes/societe.com (morts, anti-bot DataDome → proxies payants).
