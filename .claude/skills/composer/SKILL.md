---
name: composer
description: Our free composer — composes a bespoke "masterclass" site from a product fiche by COMBINING real harvested sections (design/sections/) with one curated font pair + palette, NOT by inventing generic layouts. Keeps the prospect's real content/assets/logo, elevated. Restrained, intentional motion. Self-checks with a DETERMINISTIC net (lint + verify), then the blind beauty-gate judges. Use when the user says "composer", "compose", "compose libre", "free composer". Not for cloning a page (use templatize) nor filling a known template (use filler).
user-invocable: true
argument-hint: "<prospectId>"
license: Apache 2.0
metadata:
  status: test
  version: 0.2.0
---

> ⚠ **MODE TEST** — préviens avant usage. Promotion après ≥3 usages validés.

Le **composer** : la phase COMPOSE du modèle library-first (cf. `docs/DESIGN-ENGINE.md`). Le principe (leçon
de l'audit 2026-06-17) : **un beau site naît d'un design-system cohérent + de la retenue + un filet
déterministe en aval** — PAS d'un prompt-mur de mille avertissements. On te donne peu, mais juste ; tu as
l'espace pour le goût ; la mécanique est garantie par des scripts, pas suppliée.

## Langue
**Le site est écrit dans la langue de l'agence** (`agency.config.json › language`, passée au composer en `LANGUAGE` ; défaut `fr`). Les playbooks métier et ce skill sont rédigés en français : produis le site dans `LANGUAGE` quoi qu'il arrive (navigation, titres, CTA, mentions, formats de téléphone et d'adresse du pays). Les mots du prospect (services, noms propres) restent les siens.

## Entrée
- `data/prospects/<id>.json` — le contenu réel (nom, services, ville, ton, `industry`).
- `data/assets/<id>/*` — les **vraies** photos + le **vrai** logo (déjà **audités/boostés** : `_audit.json`,
  `_boost.json` ; si `hero.mp4` existe → vidéo de héro dispo).
- **`fiche.brief`** (skill `diagnose`) — **TA DIRECTION** (angle, problèmes à corriger, moves). Absent → `/diagnose <id>`.
- **`design/industries/<industry>/playbook.md`** — **TA STRUCTURE** : les sections + le concept viennent du
  MÉTIER (un lieu de réception ≠ un cuisiniste). Pense « que faut-il pour CE métier ? » avant toute section.

## Le design-system (peu de pièces, cohérentes — c'est là qu'est la valeur)
- **Sections RÉELLES à combiner** (le cœur, ta source de goût) : `design/sections/index.json` — squelettes de
  sections de vrais sites **primés** (par `type`/`layout`/`motion`). **Pioche et COMBINE-les** (filtre par les
  sections du playbook, adapte le contenu du prospect dedans) plutôt que d'inventer des mises en page réflexes.
  C'est CE qui te sort du générique « IA » : tu pars de vraies compos, pas d'une moyenne tiède.
- **Une paire de fonts** (imposée par l'orchestrateur, ou choisie distinctive du catalogue `design/fonts/`,
  **jamais** la `blacklist.txt`). Self-host les woff2 dans `fonts/` du site, avec le `OFL.txt` de la famille
  quand il existe (`<slug>-OFL.txt` : une police libre voyage avec sa licence). Site publiable sans licence
  commerciale : `design/fonts/pairings.oss.json` (bibliothèque OFL vérifiée, `design/fonts/oss.lock.json`). ⚠ **Une @font-face cassée = le
  navigateur retombe sur la font système = l'aspect "généré par IA" qu'on déteste = ÉCHEC** (le lint l'attrape).
- **Palette** : 1 accent + neutres (déduits du logo/photos, ou `design/palettes/<slug>.json`). L'accent ponctue.
- **Le goût** : `/frontend-design` (la philosophie anti-AI-slop). Icônes = SVG inline **Lucide** (une famille).

## Contraintes (non négociables)
- **Même contenu / assets / logo que la fiche** — on **élève**, on n'invente pas (0 lorem, 0 service fantôme).
- **Self-contained** : un seul `index.html`, CSS inline, fonts + **photos copiées en local relatif**
  (`assets/…`), **aucun chemin disque** `../../data/…`, **aucun build**, offline.
- **LE DESIGN COMMANDE, LES ASSETS SUIVENT** : décide le format/ratio que TON layout veut, recadre la vraie
  photo dedans (`object-fit:cover` + `object-position`, `aspect-ratio`). Une photo ne bloque jamais le layout.
- **Compte tes photos AVANT de poser la grille** : 0-2 photo → compo **éditoriale** (typo forte, aplats
  travaillés), **aucun slot vide ni placeholder d'image**. Le logo n'est pas une photo de remplissage.
  *(Exception métier visuel : voir la règle HÉROS ci-dessous.)*
- **CURATION PHOTO — juge AVANT d'utiliser** : Read chaque photo et juge-la : **nette ? sujet clair ? rien de
  non-pro ?** Une photo **floue**, mal cadrée, ou avec un **détail qui tue la crédibilité** (film/autocollant
  d'usine encore collé — type « VELUX » sur la vitre, panneau sale, fouillis, poubelle, voiture, doigt) →
  **PAS en héros** : recadre pour l'exclure, ou **écarte-la**. Mieux vaut 2 bonnes photos que 6 dont une honteuse.
- **HÉROS = IMAGE pour un métier VISUEL** (piscine, lieu de réception, paysagiste, cuisiniste, archi…) : le
  héros est **porté par l'image** (vraie photo boostée, ou cinématique `web-cinematics`). **JAMAIS** un gros bloc
  de texte en haut + la photo en dessous, **jamais** un héros texte-seul pour ces métiers (l'eau, la lumière,
  l'ambiance VENDENT). 0 vraie photo sur un métier visuel → `web-cinematics` génère l'ambiance, on ne se rabat
  **pas** sur la typo-géante.
- **Logo conscient** : Read-le, juge-le. Jamais clair-sur-clair ni sombre-sur-sombre (chip/pastille/détourage).
  Illisible → wordmark texte propre dans la paire de fonts.
- **MOTION = RETENUE** (le piège, c'est le TROP) : **3 mouvements max**, cohérents (entrée héro · reveal de
  section · 1 accent), easing doux, ça **POSE**. CSS scroll-driven d'abord + `prefers-reduced-motion`. ⚠ Jamais
  un état initial qui masque à 100% sans filet (contenu **visible par défaut**, l'anim = un léger plus). Hover
  net sur les éléments interactifs (~.2s). **Max 1 bascule sombre↔clair.**
- **Header sobre** (nav ~64-88px, logo gauche + liens droite alignés), **images nettes** (pas de petite photo
  étirée en plein-bleed — le verify le flague), **grille stricte**, **0 overflow X**, **contraste AA**,
  **mobile = même hiérarchie**.
- **ZÉRO tell IA** : pas d'« **eyebrow à tiret** » (kicker en capitales précédé d'une fine ligne `::before`/
  `::after` ou d'un « —— » : c'est LE signe « généré par IA » — le lint le **refuse**) ; pas d'**em-dash** ;
  pas le tic réflexe « 2 derniers mots du titre en italique ». Surprends, ne reproduis pas la moyenne.
- **EXPLOITE LA LARGEUR (anti-centrage mou)** : ne centre PAS tout dans une colonne étroite au milieu,
  **surtout pas les paragraphes** des sections du bas (= réflexe paresseux qui gâche l'espace sur la longueur).
  Par défaut : **aligné à gauche**, **grilles asymétriques** (texte d'un côté, média/chiffres de l'autre),
  traitement **éditorial** qui occupe la largeur. Le **centré-étroit** est réservé aux **moments forts** (un
  manifeste, le CTA final), jamais le défaut. Une **bande pleine largeur (borderless)** de temps en temps respire.

## Leçons terrain à intégrer au compose

Ces règles viennent des retouches manuelles validées sur un premier client cuisiniste. Elles valent pour tous les métiers visuels
et de service premium.

> **Règle d'or (cas école cuisiniste)** : le composer doit sortir moins de “belles brochures IA” et plus de pages qui
> vendent avec de vraies preuves visuelles.
>
> Le cas école : dès qu'on ajoutait “process / preuves / 6 étapes / pourquoi nous”, ça devenait
> vite propre mais chiant. Dès qu'on a remis une vraie vidéo, des vraies réalisations, des témoignages, un
> formulaire court et une barre mobile, ça redevenait vivant.
>
> Avant de garder une section, demande-toi : **est-ce qu'elle montre, prouve, rassure ou convertit ?**
> Si non, elle saute.

### 1. Preuve visuelle avant brochure

- Si une vidéo, une vraie réalisation, un témoignage vidéo, un avant/après ou une photo forte existe : **elle doit
  porter une section entière**, pas rester en vignette décorative.
- Remplace les longs blocs “process / pourquoi nous / preuves” par **une scène visuelle + 3 à 4 points courts**.
- Ne crée pas deux sections qui disent la même chose avec des titres différents. Exemple à éviter :
  “De la conception à la pose” puis “Un parcours clair en 6 étapes”. Fusionne en un seul moment plus fort.
- Un process est utile seulement s'il est **actionnable et visuel** : image/vidéo d'un côté, étapes courtes de
  l'autre. Sinon, il sent la brochure.

### 2. Curation stricte des preuves

- N'affiche jamais un chiffre, une photo de dirigeant, un label ou un comparateur si la source n'est pas claire.
  Si l'asset manque, écris une carte éditoriale honnête plutôt que d'inventer.
- Les avis, vidéos clients, photos de chantier/réalisation et liens Google doivent être **cliquables ou vérifiables**
  quand c'est possible.
- Pour les comparateurs “3D / livré” ou “avant / après” : utilise-les seulement si les deux images sont crédibles
  ensemble. Sinon, préfère une vidéo/projection ou une galerie réelle. Ne force pas un widget juste parce qu'il est cool.

### 3. Conversion mobile par défaut

- Sur les sites de service local, le mobile doit avoir une action persistante discrète mais claire :
  **Appeler / Prendre RDV / Devis** selon le métier.
- Le CTA principal doit pointer vers une action utile. Un simple `mailto:` isolé est faible ; si pas de backend,
  crée un formulaire court qui construit un e-mail pré-rempli.
- Formulaire court recommandé : **coordonnées → projet → créneau**. Pas de formulaire administratif interminable.

### 4. Densité et rythme

- Après le hero, alterne : **preuve visuelle → portfolio/preuves → confiance → conversion**.
- Supprime les sections “preuve” qui ne font que répéter du texte. Une section doit changer la perception :
  montrer, prouver, rassurer, ou convertir.
- Les micro-preuves (ex. “plan 3D”, “échantillons”, “meubles montés d'usine”) peuvent vivre en chips autour d'une
  section visuelle. Elles ne méritent pas toujours une carte de 150 mots.

### 5. Handoff et mémoire

- `control.md` doit documenter les décisions utiles pour la prochaine passe : assets retenus/rejetés, pourquoi une
  section existe, ce qui a été volontairement retiré, et les commandes de vérification.
- Si une retouche manuelle importante a été faite, ajoute une note courte dans `control.md` pour que le site ne
  régresse pas au prochain composer.

## Double-check — LE FILET DÉTERMINISTE (obligatoire ; remplace les mille avertissements)
1. `node design/scripts/lint.mjs <site>/index.html --fix` → doit finir `clean:true` (0 em-dash, 0 asset en
   chemin disque, 0 @font-face absente). Corrige ce qu'il liste, relance.
2. `node design/verify/verify.cjs <site>/index.html <site>/_after.png` → doit donner
   `clean:true` (0 overflow, 0 image cassée/floue, 0 void béant) + capture pleine page.
3. Un défaut → corrige et re-check. Logue le verdict dans `control.md`.

> Le jugement esthétique (« est-ce nettement plus beau que l'avant ? ») n'est PAS fait ici : c'est le
> **beauty-gate aveugle** (orchestrateur) qui tranche. Le composer livre propre ; le gate juge.

## Sortie
- `output/sites/<id>/<YYYY-MM-DD>-composer/index.html` (+ `fonts/`, `assets/`) → en haut du backoffice.
- `control.md` (`packages/shared/control.ts`) : `template: composer`, paire de fonts, archétype, motion, verdict.

## Rapporte
La paire de fonts + pourquoi, le parti-pris layout/motion, `lintClean`/`verifyClean`, et ce qui reste fragile.
