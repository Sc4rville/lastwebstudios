# Composer — le free composer (proto, MODE TEST)

Notre composer : la phase COMPOSE du modèle library-first. Opérationnel : `.claude/skills/composer/SKILL.md`.
Le goût : `.claude/skills/frontend-design/SKILL.md` + les **vraies sections** (`design/sections/`). Vision : `docs/DESIGN-ENGINE.md`.

## Quoi
On **ne clone pas** un HTML : on **compose un site sur mesure** depuis la fiche produit, en **combinant de
vraies sections** de sites primés (`design/sections/`) + le **catalogue** (`design/fonts · palettes · motion`).

## Comment
`/composer <prospectId>` → je lis la fiche, je **comprends l'espace**, je **combine des sections réelles** +
choisis (paire de fonts / motion / couleur), je **compose** un `index.html` self-contained, je **vérifie**
avec le **filet déterministe** (`lint.mjs` + `verify.cjs`). Le **beauty-gate aveugle** juge le « plus beau ».

## Contraintes
Même **contenu / assets / logo** que la fiche (on élève, on n'invente pas) · self-contained, zéro build,
offline · motion **délibérée, CSS scroll-driven d'abord** (≤3 mouvements) · `prefers-reduced-motion` ·
0 overflow · mobile à hiérarchie égale.

## Leçons de production

Les corrections faites sur un premier client cuisiniste deviennent des règles de compose :

> Le composer doit sortir moins de “belles brochures IA” et plus de pages qui vendent avec de vraies preuves
> visuelles.
>
> Ce client a été le cas école : dès qu'on ajoutait “process / preuves / 6 étapes / pourquoi nous”, ça devenait
> vite propre mais chiant. Dès qu'on a remis une vraie vidéo, des vraies réalisations, des témoignages, un
> formulaire court et une barre mobile, ça redevenait vivant.
>
> Question de garde : **est-ce que cette section montre, prouve, rassure ou convertit ?** Si non, elle saute.

- **Preuve visuelle d'abord** : une vraie vidéo, une réalisation, un témoignage ou un avant/après doit porter une
  vraie section, pas servir de décor.
- **Anti-brochure** : ne pas empiler “process”, “parcours”, “pourquoi nous” si ça raconte la même chose. Fusionner
  en une scène visuelle + 3 ou 4 points courts.
- **Pas de preuve inventée** : pas de fausse photo de fondateur, pas de chiffre sans source, pas de comparateur
  approximatif présenté comme exact.
- **Conversion mobile** : pour un service local, prévoir une action persistante mobile (appeler / RDV / devis).
- **Formulaire court** : si pas de backend, préférer un formulaire qui prépare un e-mail plutôt qu'un simple lien
  `mailto:` perdu.
- **Mémoire** : `control.md` doit dire ce qui a été retenu, rejeté, retiré, et pourquoi, pour éviter les régressions.

## Sortie
**Nouvelle génération** `output/sites/<id>/<date-composer>/` → **en haut du backoffice**. `control.md`
taggé `template: composer`. Scratch/décisions dans `design/composer/runs/<id>/` (gitignoré).

## Statut
Proto **prouvé** sur un prospect cuisiniste (Austin × Geist, accent terracotta, galerie
accordéon). Reste : curation des photos, motion CSS scroll-driven, et la labellisation du catalogue.
