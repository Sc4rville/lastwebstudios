---
name: web-cinematics
description: >
  Couche cinématique d'un site prospect : key-frames et clips vidéo (héros,
  ambiance, reveals interactifs, scroll-scrub) générés à partir des assets déjà
  boostés par asset-boost. Tourne sur tous les prospects (le gate score > 65 est levé ; cinematic:false le réactive).
user-invocable: true
argument-hint: "<prospectId>"
license: Apache 2.0
metadata:
  status: active
---

# web-cinematics

## Pipeline

parse → diagnose → asset-boost → web-cinematics → composer

Inputs :
- `data/prospects/<id>.json` — fiche prospect
- `data/prospects/<id>.brief` — angle + diagnostic
- `data/assets/<id>/` — photos réelles auditées et boostées (`_audit.json`, `_boost.json`, job_ids)
- `design/industries/<industry>/playbook.md` — mood et besoins métier

Output : `data/assets/<id>/_cinematics.json`

asset-boost produit le réel. web-cinematics produit le généré et l'interactif. Le généré sert l'ambiance, le héros et le mouvement. Il n'invente jamais une réalisation passée.

---

## Étape 0 — Sensation cible

Une seule question, avant tout le reste :

**Quand le visiteur quitte ce site, qu'a-t-il ressenti ?**

La réponse est physique et émotionnelle, jamais visuelle : oppressé par le luxe, rassuré par la précision, envieux d'un mode de vie, confiant dans un savoir-faire. Cette phrase devient le critère unique. Tout effet qui ne la renforce pas est coupé.

Ensuite, inventaire des assets réels. Lis `_audit.json` et `_boost.json`. Détermine ce que chaque photo est vraiment, lequel porte la sensation cible le plus fort (le héros), lesquels l'appuient, et ce qui manque pour raconter l'histoire.

Sortie : la sensation cible en une phrase, l'inventaire classé par force narrative, les trous à combler.

---

## Étape 1 — Lire chaque asset comme une opportunité

Pour chaque asset et chaque section, cherche s'il existe une dimension qui dépasse l'image fixe.

**Une transformation avant/après.** Un revêtement de piscine posé puis la piscine remplie et éclairée. Un mur brut puis fini. Un chantier puis la livraison. Un visage avant et après. Candidat à un reveal interactif.

**Une structure cachée ou un processus.** Les couches d'un revêtement, l'intérieur d'un mécanisme, les étapes d'une pose, le côté technique d'un ouvrage. Candidat à une décomposition révélée au scroll ou au survol.

**Un espace à traverser.** Une propriété et ses pièces, un lieu du bar à la terrasse, un atelier et ses zones. Candidat à un room tour en scroll-scrub.

**Un objet central.** Un flacon, un meuble, un équipement. Candidat à une décomposition ou une rotation pilotée au scroll.

Un asset qui ne porte qu'une seule lecture devient un clip passif. Un asset qui porte une transformation, une structure, un parcours ou une rotation mérite un pattern interactif.

---

## Étape 2 — Composer le mouvement

Le mouvement n'est jamais décoratif. C'est la sensation cible traduite en trajectoire. Avant d'animer quoi que ce soit, formule le mouvement avec un verbe de direction physique et un objectif. Si la phrase ne tient pas, la décision n'est pas prise.

Le geste se déduit du sujet et de l'intention. Un détail précieux appelle un rapprochement lent. Un grand espace appelle un recul qui en révèle l'ampleur ou un survol qui le domine. Une matière vivante — eau, flamme, vapeur, tissu — se filme presque fixe, le mouvement vient de la matière elle-même. Le temps qui passe se raconte par la lumière qui glisse du jour au crépuscule. Compose le geste pour ce métier précis ; la liste d'exemples n'est qu'un point de départ, pas un menu.

---

## Étape 3 — Choisir le pattern de section

### Clip passif

Une boucle ou un plan qui tourne sans intervention. Héros, fonds de section, transitions d'ambiance.

### Reveal avant/après

Deux états du même sujet superposés, le second révélé au survol ou au drag. Génère deux key-frames cadrées et éclairées à l'identique, état A puis état B. Référence l'état A dans `medias` pour générer B afin de garder lieu et style.

### Scroll-scrub

Une vidéo dont la lecture suit la position de scroll : le visiteur avance dans le plan en descendant la page. Sert le room tour pièce par pièce, la décomposition d'un produit couche par couche, la rotation d'un objet sur 360°, la révélation progressive d'un espace technique.

La vidéo se pense comme une timeline d'états plutôt qu'un plan à regarder. Mouvement continu et lent, aucune coupe, durée 6 à 15 secondes, son inutile. Chaque seconde correspond à une étape précise du parcours, de sorte que n'importe quelle position de scroll tombe sur une image lisible. Note la correspondance temps → étape pour le composer.

---

## Étape 4 — Choisir l'outil vidéo

Le critère est le type de mouvement, pas le nombre de plans.

Quand tu contrôles exactement le point de départ et d'arrivée de la caméra : **Kling 3.0**, start frame et end frame.

Quand le mouvement principal est de la physique libre — eau, fumée, tissu, feu, cheveux — ou un plan continu pour scroll-scrub : **Seedance 2.0**.

Sur un storyboard multi-plans avec coupes : **Seedance 2.0**.

Kling 3.0 exige que la end frame soit un point de vue réellement déplacé, pas la start frame à peine tournée. La caméra a voyagé : un détail flou est devenu net au premier plan, l'objet central est devenu petit dans un espace révélé, un nouvel élément est entré par un bord pendant qu'un autre sortait, le sol a cédé la place au ciel. Génère la end frame en référençant la start dans `medias` pour conserver lieu et style, avec un cadrage franchement déplacé. Kling interpole la trajectoire entre les deux.

Les variantes turbo et fast servent au preview et aux tests, pas à la livraison.

---

## Étape 5 — Préparer les key-frames

Les key-frames partent toujours du réel. Deux voies, jamais de génération à partir de rien.

Voie directe : une photo boostée par asset-boost convient telle quelle comme frame. Tu réutilises son job_id de boost. C'est le défaut quand l'asset porte déjà le cadrage et la lumière voulus.

Voie éditée : `gpt_image_2` lorsqu'il faut transformer la source — recadrer pour un héros 16:9 ou 21:9, recadrer en 3:4 pour une colonne, produire l'état B d'un avant/après, ajuster la lumière ou le mood vers la palette métier, ou générer la end frame déplacée d'un plan Kling. La source réelle est toujours référencée dans `medias` par son job_id de boost, jamais par URL CloudFront. Passe l'avatar ID explicitement quand un avatar récurrent intervient.

`nano_banana_2` n'est pas utilisé ici. Aucune frame ne se génère sans un asset réel en référence.

Une image par beat. Conserve chaque job_id, la vidéo en dépend.

---

## Étape 6 — Générer les clips

`get_cost:true` avant chaque appel vidéo. Génère selon l'outil choisi. Détoure après génération seulement, jamais avant : `remove_background` avec `media_type:"video"`. Produis la variante mobile par `reframe` 9:16 depuis la source, sans regénérer.

---

## Output — `_cinematics.json`

Pour chaque beat, le pattern (`passive_clip`, `hover_reveal`, `scroll_scrub`), la sensation servie, le ou les job_ids de frames, le job_id vidéo, le job_id alpha si détouré, le ratio, la durée, la boucle, la variante mobile. Pour un hover_reveal, les deux frames et l'axe. Pour un scroll_scrub, la table temps → étape. Le coût total en crédits.

Le storyboard complet et la sensation cible figurent en tête du fichier. L'agent route l'intégration.
