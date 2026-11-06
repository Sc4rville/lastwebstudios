# Cursor — curseur custom « Awwwards »

Point net qui suit au pixel + anneau qui **traîne** (easing RAF), en `mix-blend-mode: difference`
(inverse ce qu'il survole → lisible sur clair ET sombre). **Magnétique** sur les boutons, **grossit +
libellé** sur les liens. **Zéro dépendance, ~2 Ko, auto-contenu** (aucun CDN — cohérent avec les sites lws).

## Poser sur un site
```html
<link rel="stylesheet" href="cursor.css">
<script src="cursor.js" defer></script>
```
Régler l'accent du site dans le CSS : `:root{ --cz-accent: <couleur du site> }`.

## Marquer des éléments (optionnel)
- `data-magnetic` (ou `data-magnetic="0.45"`) → l'élément **attire** le curseur (CTA principaux).
- `data-cursor="voir"` → l'anneau **grossit** et affiche le libellé au survol (cartes, galeries).

## Garde-fous (déjà gérés)
- **Tactile** (`pointer: coarse`) et **`prefers-reduced-motion`** → le curseur natif est conservé, le script
  ne s'active pas. Accessibilité OK, aucune régression mobile.
- `z-index` max + `pointer-events:none` → ne bloque jamais les clics.

Démo : ouvrir `demo.html`. Variantes possibles (à dériver) : traîne d'images, points multiples, halo flou.
