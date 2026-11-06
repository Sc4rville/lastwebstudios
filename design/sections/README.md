# design/sections · le catalogue de sections (le cœur du goût du composer)

Des **squelettes de sections** tirés de vraies compositions primées. Le `composer` (voie PRINCIPALE,
cf. `docs/DESIGN-ENGINE.md`) **pioche et COMBINE** ces squelettes au lieu d'inventer des layouts réflexes :
c'est CE qui le sort du « AI slop ». Sans ce catalogue, le composer tombe sur un fallback (il improvise).

## Comment le composer s'en sert
1. Lit `index.json`, **filtre par les sections du playbook métier** (`design/industries/<industry>/playbook.md`)
   + le **mood** du brief.
2. Pour chaque section voulue, choisit un squelette (une variante de `layout`). **Deux sites ne doivent pas
   piocher les mêmes variantes** (diversité imposée).
3. Charge le `.html` du squelette, **adapte le contenu réel du prospect** dedans, et applique **sa paire de
   fonts + sa palette** via les tokens CSS.

## `index.json` · une entrée par squelette
```json
{
  "id": "hero-editorial",
  "type": "hero",
  "layout": "titre éditorial à gauche + image haute à droite (grille asymétrique)",
  "mood": ["premium", "editorial"],
  "motion": "reveal en cascade du titre + fondu de l'image",
  "useWhen": "métier visuel premium, 1 photo forte au moins",
  "file": "hero-editorial.html"
}
```
- **`type`** : `hero` · `process` · `gallery` · `brands` · `about` · `testimonials` · `guarantees` · `services`
  · `cta` · `coverage` · `stats` · `faq`.
- **`layout`** : la signature de la compo (ce qui la distingue des autres du même type).
- **`mood`** : tags (`premium`, `editorial`, `warm`, `technical`, `bold`, `minimal`, `architectural`…) pour matcher le métier.
- **`useWhen`** : quand la choisir (ex. « métier visuel avec ≥ 6 photos », « 0-2 photo → éditorial »).

## Le contrat d'un squelette (`.html`)
- **UN `<section>` autonome** : structure + layout SEULEMENT. Le goût final (couleurs, fonts) vient du composer.
- **Tokens CSS** (le composer les définit globalement ; le squelette les CONSOMME, ne les redéfinit pas) :
  `var(--bg)` · `var(--fg)` · `var(--muted)` · `var(--accent)` · `var(--serif)` · `var(--sans)` · `var(--mono)`.
- **Contenu = placeholders** clairs : `{{HEADLINE}}`, `{{TEXT}}`, `{{CTA_LABEL}}`, `<img src="{{IMG}}" alt="{{ALT}}">`,
  et les items répétables encadrés d'un commentaire `<!-- repeat: <item> -->  … <!-- /repeat -->`.
- **Motion** : classe `.reveal` sur les éléments à animer (le composer câble le scroll-driven + `prefers-reduced-motion`).
  **Pas de JS requis.** Contenu visible par défaut (l'anim = un plus, jamais un masquage à 100 % sans filet).
- **Responsive** : tient à **390px** (un `@media (max-width: 880px)`). Mobile = même hiérarchie.
- **Anti-AI-slop** (règles du composer) : **pas d'eyebrow-à-tiret**, **pas d'em-dash**, **aligné à gauche par
  défaut**, **grilles asymétriques**, **exploite la largeur** (pas de colonne étroite centrée par réflexe).

## Ajouter une section
1. Crée `<id>.html` selon le contrat ci-dessus. 2. Ajoute son entrée dans `index.json`.
Plus tard : extraction automatique de vraies sections depuis des sites primés via `extractize` (cf. skillstash).
