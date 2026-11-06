# Motion recipes — la bibliothèque de VRAIES animations (lue par le composer)

> Le composer DOIT en utiliser **plusieurs, délibérément** (pas 1 fade triste). But : du scroll vivant,
> interactif, « legendary » — mais **intentionnel** (jamais de gadget qui suit le curseur sans sens ;
> chaque motion a une raison). CSS scroll-driven d'abord (`animation-timeline: view()/scroll()`, 0 JS,
> compositor) ; GSAP+ScrollTrigger seulement pour le complexe (pin, scrub, SplitText), **chargé depuis le CDN**
> (`https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js` + `ScrollTrigger.min.js`), **jamais copié** dans le site ni
> dans le dépôt : la licence GSAP n'est pas une licence libre OSI, on ne la redistribue pas.

## Le socle (à mettre presque partout)
- **Reveal à l'entrée** — `animation-timeline: view()`, fade + rise (translateY) ou clip, **stagger** par
  enfant (`animation-delay` croissant). La base d'un site vivant.
- **Parallax de profondeur** — `animation-timeline: scroll()` : le fond/visuel bouge plus lentement que le
  texte (yPercent). Donne de la couche. Léger (≤15%).
- **Hero qui respire** — Ken Burns au scroll : la photo héro zoome/dérive doucement (`scale 1→1.08`).

## Les signatures (en choisir 1-2 fortes par site, selon le métier/archétype)
- **Texte ligne-par-ligne / mot-par-mot** — split en lignes/mots, chaque ligne se lève + se démasque
  (`clip-path` ou translateY sous overflow:hidden). Magnifique sur un gros titre (Splitting/GSAP si besoin).
- **Image clip-reveal** — la photo se dé-masque (`clip-path: inset(... )` animé au scroll) au lieu d'apparaître brut.
- **Section épinglée (pin) + cross-fade** — une section colle (`position:sticky`) pendant qu'on scrolle et
  son contenu change/progresse (cartes qui s'empilent, étapes d'un process). Idéal « notre savoir-faire ».
- **Scroll horizontal** — une bande (galerie, réalisations) défile latéralement quand on scrolle vertical
  (sticky + translateX lié au scroll). Très fort pour une galerie reine.
- **Compteur / chiffres animés** — les stats montent quand elles entrent (« 550 cuisines », « 200 invités »).
- **Marquee / bandeau continu** — logos partenaires ou mots-clés qui défilent en boucle (vitesse réagit au scroll).
- **Scrub** (GSAP) — une frise/timeline ou un SVG qui se dessine (`DrawSVG`) piloté par la position de scroll.

## Micro-interactions (discret, sur les éléments actifs seulement)
- **Hover magnétique / tilt** léger sur CTA et cartes (transform sur `:hover`, transition douce).
- **Soulignés/flèches** qui s'animent au survol des liens.
- **Reduced-motion** : tout sous `@media (prefers-reduced-motion: no-preference)` + `@supports`.

## Les règles (mémoire Scarville : intentionnel, zéro gadget)
- **Pas de motion gratuite** : chaque animation sert la lecture/l'émotion. Pas d'assets qui suivent le
  curseur sans sens. **Max 1 aller-retour sombre↔clair** par page.
- **Délibéré** : décide CONSCIEMMENT où va chaque fade / reveal / parallax / pin — pas « un fade sur tout ».
- **Riche mais cohérent** : 1 socle + 1-2 signatures fortes > 10 effets dispersés.
