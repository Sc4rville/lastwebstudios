# Design — la bibliothèque (catalogue) du moteur

`design/` est le **catalogue** dont le free composer se sert. Modèle **library-first** (détail :
`docs/DESIGN-ENGINE.md`) : on **extrait** des assets de vrais sites (`extractize`), on les **trie ici**,
puis on **compose** un site sur mesure depuis ce catalogue (`composer`).

## Le catalogue
| dossier | contenu | alimenté par |
|---|---|---|
| `fonts/` | familles self-hostées (woff2) + `index.json` (registre) | `extractize`, `harvest:fonts` |
| `palettes/` | `<slug>.json` : variables CSS de couleur + couleurs dominantes | `extractize` |
| `motion/` | `<slug>.json` : stack d'animation/scroll détectée + mécanisme | `extractize` |
| `catalog.json` | **catalogue maître** : une entrée par site (fonts, palette, motion) | `extractize` |
| `composer/` | le free composer (mantras + scratch des runs) | skill `composer` |
| `templates/` | templates **complets** d'un domaine (voie secondaire) | `templatize` |
| `scripts/` | mécanique : `fill`, `polish`, `animate`, `harvest-fonts`, `extractize` | — |

## Flux
```
extractize <url> → fonts/ palettes/ motion/ catalog.json   (EXTRACT)
composer <prospectId> → output/sites/<id>/<date-composer>/  (COMPOSE, pioche le catalogue)
```

`.extract-cache/` (cache de rendu d'extractize) est **jeté** après chaque extraction et gitignoré.
