# Cuisines Lumeo: third real site (no photo worth keeping, no e-mail)

Prospect **fictif** (cuisiniste, Véreuil, commune inventée). Son « vieux site » de 2009 a été fait de zéro
(`data/sample/sites/cuisines-lumeo/` : une page en tableau de 780 px, texte en 11 px, promo 2009 en jaune, deux
illustrations grossières, **aucune adresse e-mail** et un formulaire en panne). C'est le cas difficile : presque rien à
montrer, et un prospect qu'on ne peut joindre qu'au téléphone. Ce dossier est la sortie d'un vrai run :

```
npm run first-site -- http://127.0.0.1:<port>/ --name "Cuisines Lumeo" --city Véreuil --industry cuisiniste \
  --phone "01 99 00 41 52" --date 2026-10-24 \
  --pairings <un fichier avec la paire « artisan-heritage » de design/fonts/pairings.oss.json>
```

lancé le 24/10/2026 (nuit, WP4) dans un workspace jetable (code seul, sans `.env`, sans données réelles), le vieux
site servi en local, `LWS_SIRENE=0`, sur l'abonnement Claude, boost image/vidéo coupé.

| maillon | résultat |
|---|---|
| score (la porte) | 78/100 *hot* en 62 ms : pas de viewport, SEO pauvre, pas de HTTPS, pas de données structurées |
| parse | 2 visuels + logo + 975 caractères en 2,6 s (`captures/avant.png`) |
| fiche | skill structuration sur le plan : 9 services en 26 s (`fiche.json`) |
| compose | Workflow `compose-batch` : diagnose → asset-boost (audit seul, 0 crédit) → composer → filet lint + verify → auto-revue → juge aveugle, en 770 s |
| beauty-gate | **PASS au 1er tour**, marge « much » (6 raisons du juge dans `first-site.json`) |
| contre-vérification | `lint.mjs` propre · `verify.cjs` propre en 1440 et 390 px |
| total | 13 min 30 s · estimation Claude Code 2,56 $ (quota de l'abonnement, aucune facture API) |

Ce que le composer a décidé (`site/control.md`) : les deux illustrations du vieux site étaient trop pauvres pour
porter le site, alors il a dessiné l'idée du métier, **« votre cuisine commence par un dessin »** (élévation et plan
d'îlot en SVG inline, échantillons de matières en CSS) plutôt que d'inventer des photos ; paire **Cormorant Garamond ×
Manrope** (variables, SIL OFL 1.1, `site/fonts/` avec leur `OFL.txt`, copiés par le composer lui-même) ; et comme le
prospect n'a pas d'e-mail, tout mène au téléphone et à l'étude 3D.

| fichier | quoi |
|---|---|
| `site/` | le site livré, autonome (ouvre `site/index.html`) |
| `captures/avant.png`, `captures/apres-desktop.png`, `captures/apres-mobile.png` | avant / après pleine page |
| `fiche.json` | la ProspectSheet |
| `boost.json` | la trace de l'asset-boost (moteurs coupés, 0 crédit) |
| `first-site.json` | le rapport du run : durées, verdict du juge, lint, verify |

Seules retouches après le run : l'URL locale du vieux site est remplacée par `http://cuisines-lumeo.example/` dans
`fiche.json` et `first-site.json`, et les chemins des captures pointent dans ce dossier.
