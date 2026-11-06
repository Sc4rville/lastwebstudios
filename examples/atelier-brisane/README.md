# Atelier Brisane: second real site (OFL font pair)

Prospect **fictif** (menuisier ébéniste, Sornac-le-Haut, commune inventée). Son « vieux site » de 2011 a été fait de
zéro (`data/sample/sites/atelier-brisane/` : mise en page fixe 960 px, colonne de gauche, vignettes minuscules,
compteur de visites, tarifs 2011, illustrations SVG maison). Ce dossier est la sortie d'un vrai run :

```
npm run first-site -- http://127.0.0.1:<port>/ --name "Atelier Brisane" --city Sornac-le-Haut \
  --industry menuisier --phone "02 61 91 37 05" --email bonjour@atelier-brisane.example --date 2026-10-24 \
  --pairings <un fichier avec la paire « warm-editorial » de design/fonts/pairings.oss.json>
```

lancé le 24/10/2026 (nuit, WP4) dans un workspace jetable (code seul, sans `.env`, sans données réelles), le vieux
site servi en local, `LWS_SIRENE=0`, sur l'abonnement Claude (Claude Code, login claude.ai), boost image/vidéo coupé.
Il prouve la bibliothèque de polices libres : la paire imposée vient de `design/fonts/oss.lock.json` (Fontsource).

| maillon | résultat |
|---|---|
| préflight | `npm run doctor -- --for first-site` : prêt, outil Workflow disponible → moteur `workflow` |
| score (la porte) | 82/100 *hot* en 43 ms : pas de viewport, SEO pauvre, pas de HTTPS, pas de données structurées |
| parse | 6 visuels + logo + 2 056 caractères en 2,7 s (`captures/avant.png`) |
| fiche | skill structuration sur le plan (sortie structurée) : 7 services en 15 s (`fiche.json`) |
| compose | Workflow `compose-batch` : diagnose → asset-boost (audit seul, `boost.json` : 0 crédit) → composer → filet lint + verify → auto-revue → juge aveugle, en 638 s |
| beauty-gate | **PASS au 1er tour**, marge « much » (6 raisons du juge dans `first-site.json`) |
| contre-vérification | `lint.mjs` propre (0 tiret cadratin) · `verify.cjs` propre en 1440 et 390 px (0 débordement, 0 image cassée, 0 titre rogné, 0 erreur console) |
| total | 11 min 9 s · estimation Claude Code 2,93 $ (quota de l'abonnement, aucune facture API) |

Ce que le composer a décidé (extrait de `site/control.md`) : paire **Fraunces × Instrument Sans** (variables, SIL OFL
1.1, `site/fonts/` avec leur `OFL.txt`), archétype *hero-split*, papier chaud et chêne huilé, 3 gestes de motion au
plus, `prefers-reduced-motion` respecté. Les illustrations sont présentées comme telles et marquées « à remplacer par
de vraies photos de chantier » ; les tarifs 2011, le compteur et les actualités périmées sont retirés ; aucune
preuve sociale inventée (la fiche n'en a pas).

| fichier | quoi |
|---|---|
| `site/` | le site livré, autonome (ouvre `site/index.html`) |
| `captures/avant.png`, `captures/apres-desktop.png`, `captures/apres-mobile.png` | avant / après pleine page |
| `fiche.json` | la ProspectSheet (identité, contenu, audit, brief du diagnose) |
| `boost.json` | la trace de l'asset-boost (moteurs coupés, 0 crédit) |
| `first-site.json` | le rapport du run : durées, verdict du juge, lint, verify |

Seules retouches après le run : l'URL locale du vieux site (`http://127.0.0.1:<port>/`) est remplacée par
`http://atelier-brisane.example/` dans `fiche.json` et `first-site.json`, les chemins des captures pointent dans ce
dossier, et une phrase de `control.md` qui citait par son nom un autre site du dépôt privé est rendue générique.
Les `OFL.txt` des deux familles ont été ajoutés à côté des woff2.
