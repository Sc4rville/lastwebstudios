# Orvane Piscines: first real site

Prospect **fictif** (pisciniste, Valmont-sur-Lys, commune inventée). Son « vieux site » daté de 2016 a été fait
de zéro pour les tests (`test/fixtures/sites/orvane-piscines/` : tableaux, bandeau promo, compteur de visites,
pas de viewport, illustrations SVG maison). Ce dossier est la sortie, telle quelle, d'un vrai run :

```
npm run first-site -- http://127.0.0.1:<port>/ --name "Orvane Piscines" --city Valmont-sur-Lys \
  --industry pisciniste --phone "03 53 01 24 68" --date 2026-10-24 --pairings design/fonts/pairings.oss.json
```

lancé le 24/10/2026 dans un workspace jetable (code seul, sans `.env`, sans données réelles), le vieux site servi
en local, `LWS_SIRENE=0`, sur l'abonnement Claude (Claude Code 2.1.281, login claude.ai), boost image/vidéo coupé.

| maillon | résultat |
|---|---|
| préflight | `npm run doctor -- --for first-site` : prêt, outil Workflow disponible → moteur `workflow` |
| score (la porte) | 95/100 *hot* en 46 ms : pas de viewport, SEO pauvre, pas de HTTPS, pas de données structurées |
| parse | 5 visuels + logo + 2 268 caractères en 2,4 s (`captures/avant.png`) |
| fiche | skill structuration sur le plan (alias `haiku`, sortie structurée `--json-schema`) : 5 services en 10,7 s (`fiche.json`) |
| compose | Workflow `compose-batch` : diagnose → asset-boost (audit seul, `boost.json` : 0 crédit) → composer → filet lint + verify → auto-revue → juge aveugle, en 709 s |
| beauty-gate | **PASS au 1er tour**, « nettement plus beau » (raisons du juge dans `first-site.json`) |
| contre-vérification | `lint.mjs` propre (0 tiret cadratin) · `verify.cjs` propre en 1440 et 390 px (0 débordement, 0 image cassée, 0 titre rogné, 0 erreur console) |
| total | 12 min 10 s · estimation Claude Code 2,88 $ (quota de l'abonnement, aucune facture API) |

Ce que le composer a décidé (extrait de `site/control.md`) : paire **Host Grotesk × Geist** (polices libres, SIL
Open Font License 1.1, auto-hébergées dans `site/fonts/`), archétype *hero-split*, ambiance claire, 3 mouvements au
maximum, contenu réel uniquement (aucun avis inventé : la fiche n'en a pas), les illustrations présentées comme des
types de bassins et jamais comme « nos réalisations ».

| fichier | quoi |
|---|---|
| `site/` | le site livré, autonome (ouvre `site/index.html`) |
| `captures/avant.png`, `captures/apres-desktop.png`, `captures/apres-mobile.png` | avant / après pleine page |
| `fiche.json` | la ProspectSheet (identité, contenu, brief du diagnose) |
| `boost.json` | la trace de l'asset-boost (moteurs coupés, 0 crédit) |
| `first-site.json` | le rapport du run : durées, verdict du juge, lint, verify |

Licences : les polices Host Grotesk et Geist sont sous SIL OFL 1.1 ; le fichier `OFL.txt` de chaque famille doit
accompagner l'édition open source (à ajouter à l'export). Les illustrations et le texte sont fictifs, faits pour LWS.
