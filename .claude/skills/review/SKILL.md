---
name: review
description: Applique les commentaires laissés par l'opérateur dans les control.md des sites générés (lastwebstudios). Scanne output/sites/**/control.md, prend en compte chaque commentaire non vide, le met en œuvre en planifiant intelligemment et en relançant le filler (qui passe le commentaire en feedback), logue un skill dans skillstash si une capacité manque, puis vide la section commentaire en gardant l'historique. Utilise-le quand l'utilisateur dit "applique les commentaires", "traite les control.md", "review les sites", ou après avoir annoté un site généré.
user-invocable: true
---

# /review — boucle de feedback par site (lastwebstudios)

Chaque site généré porte un **`control.md`** (écrit par le filler) : métadonnées (template, temps de
génération) + **dernières modif** + une section **commentaire**. L'opérateur écrit dans *commentaire*
ce qu'il veut changer sur ce site. Ce skill traite ces commentaires.

## Déroulé

### 1 · Scanner
Lister `output/sites/**/control.md` dont la section `## commentaire` est **non vide**
(ignorer la ligne d'aide `<!-- … -->`). Aucun commentaire → rien à faire.

### 2 · Pour chaque commentaire
1. **Lire** le commentaire + les métadonnées (`id`, `template`).
2. **Planifier** : le commentaire est-il réalisable en **relançant le filler** ? Le filler relit
   automatiquement le commentaire et le passe en `feedback` au skill — donc pour tout ce qui touche
   au **contenu / mapping / photos / sections**, un re-run suffit. Sinon, identifier l'action juste
   (changer de template, édition ciblée du HTML…).
3. **Capacité manquante ?** Si le commentaire demande quelque chose que le pipeline ne sait pas encore
   faire (nouveau type de section, effet, source de données, retouche image…) → **ajouter une ligne
   dans `docs/skillstash.md`** (l'idée + le signal) et **faire au mieux** avec l'existant.
4. **Mettre en œuvre** :
   - cas filler : `npm run fill -- <id> <template>` — le filler applique le commentaire, l'inscrit en
     *dernières modif*, et **vide** la section commentaire. Rien d'autre à faire côté `control.md`.
   - cas hors-filler : exécuter l'action, puis mettre `control.md` à jour à la main (ajouter une ligne
     *dernières modif* décrivant ce qui a été fait, **vider** la section commentaire).
5. **Vérifier** : screenshot du site (Playwright) — c'est bien le prospect, et le commentaire est pris
   en compte.

### 3 · Rapporter
Par site : le commentaire traité, ce qui a été appliqué, et les skills logués dans `skillstash` le cas échéant.

## Règles
- **Le commentaire est roi** : on l'applique, on ne le réinterprète pas à la baisse.
- **Toujours finir** avec la section *commentaire* **vide** et **une ligne ajoutée** aux *dernières modif*.
- Ne toucher qu'aux sites dont le commentaire est non vide. Garder l'historique (3 dernières lignes).
- Une capacité qui revient ≥ 2 fois dans les commentaires → c'est un vrai candidat-skill (`skillstash`).
