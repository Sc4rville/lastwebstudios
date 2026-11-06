# control · atelier-brisane-sornac-le-haut

- template : composer
- généré   : 2026-10-24 16:55 · composer
- contenu  : 1 page · 6 visuels (5 illustrations recadrées + marque du logo) · 0 masqué
- fonts    : Fraunces (display, wght 330-450) × Instrument Sans (texte), woff2 self-host dans fonts/
- archétype : hero-split (texte à gauche, escalier plein-bleed à droite) · ambiance CLAIRE (papier chaud #f7f2ea, accent chêne huilé #8a461b, 1 seule bascule : bande contact accent + footer noyer)
- sections : hero-split · manifeste pleine largeur · services-list (7 fabrications) · gallery-feature (cuisine + 3 planches) · essences (bande pleine largeur, 4 aplats bois procéduraux) · process-timeline (4 étapes + atelier + visite sur RDV) · cta-booking adapté (contact + formulaire court mailto)
- motion   : 3 gestes · entrée héro (fade .38 + translate) · reveal de section scroll-driven (fill forwards, contenu visible par défaut) · dérive lente du visuel héro au scroll · prefers-reduced-motion respecté
- verdict  : lint clean:true · verify clean:true (0 overflow 1440/390, 0 image cassée/floue, 0 void, 0 titre rogné, 0 erreur console)

## décisions
- Visuels : les 6 photo-*.svg sont des illustrations (pas de vraies photos, cf. _boost.json). Recadrées par viewBox pour retirer les étiquettes blanches incrustées (non-pro). Escalier = héros, cuisine = feature, porte/fenêtre/dressing = planches, atelier = process. À REMPLACER par de vraies photos de chantier dès que le client en fournit (reshoot).
- Logo : seul le pictogramme (carré bois + A) est gardé, le nom est recomposé en Fraunces (le texte du SVG est en Georgia/Verdana système).
- Preuve sociale : aucune dans la fiche (pas d'avis, pas de vidéo, pas de marques) : aucune section inventée.
- Retiré volontairement : tarifs 2011 (périmés), compteur de visiteurs, actualités 2011, © 2011.
- Corrigé vs l'avant : viewport meta, téléphone tel: cliquable partout (header, héros, contact, barre mobile collante Appeler/Devis), meta description + OG + JSON-LD LocalBusiness, 0 débordement.
- Contenu repris du site live (accueil, réalisations, contact) : 3 menuisiers + 1 apprenti, tenon et mortaise, huile dure / vernis, ZA des Tilleuls, samedi matin sur RDV, rappel sous 48 h, années des réalisations.
- Refus d'utiliser tout autre site du repo comme référence : aucun ouvert.

## vérification
- node design/scripts/lint.mjs output/sites/atelier-brisane-sornac-le-haut/2026-10-24-composer/index.html --fix
- node .claude/skills/templatize/scripts/verify.cjs output/sites/atelier-brisane-sornac-le-haut/2026-10-24-composer/index.html output/sites/atelier-brisane-sornac-le-haut/2026-10-24-composer/_after.png

## dernières modif
- 2026-10-24 16:55 · composition initiale (composer)

## commentaire
<!-- Écris ici ce que tu veux changer sur ce site. `/review` le lit, l'applique en relançant le filler, puis vide cette section. -->
