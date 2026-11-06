---
template: composer
prospect: cuisines-lumeo-vereuil
date: 2026-10-24
fonts: Cormorant Garamond (display) × Manrope (texte)
archetype: hero-split
ambiance: clair
verdict: lint clean · verify clean (0 overflow, 0 titre rogné desktop+mobile, 0 erreur console)
---

# Cuisines Lumeo · composer

## Concept
Une grande idée : **« Votre cuisine commence par un dessin »**. Le site parle d'étude 3D, de fabrication
et de pose dans la même maison. Le héros (hero-split) montre à droite, en plein-bleed, une **planche d'étude**
(élévation + plan, traits crème sur fond noyer veiné) dont les cotes affichent « sur mesure » au lieu d'un chiffre.

## Assets
- Retenu : `assets/logo.svg` (rouge et gris foncé sur fond clair, contraste correct).
- **Écartés** : `photo-1.svg`, `photo-2.svg`. Ce sont des illustrations vectorielles fictives avec une légende
  incrustée (cf. `_boost.json`), pas des réalisations du client. 0 vraie photo, donc compo éditoriale :
  planche dessinée, nuancier matières en CSS (légendé « nuancier indicatif »), gros chiffres typographiques.
  Aucun slot vide, aucun faux portfolio.
- **À demander au client** : vraies photos du showroom et des cuisines posées. Elles iraient dans le héros
  (à la place de la planche) et dans une galerie de réalisations.

## Sections (catalogue design/sections)
hero-split → manifeste pleine largeur → process-steps (4 étapes) → nuancier matières (grille asymétrique 5/4/3, 3/4/5)
→ services-list (cuisines, bains, rangements) → about-editorial adapté en showroom (horaires + panneau 300 m²) → cta-booking.
- Pas de section avis, témoignages vidéo ni marques : la fiche n'en contient aucun, et rien n'a été inventé.
- Galerie de réalisations retirée volontairement : il n'y a pas de vraie photo.

## Corrections du brief
Plus d'offre 2009 · © 2026 · téléphone cliquable partout · viewport + responsive · meta description, OG, JSON-LD.
Le formulaire cassé est remplacé par un CTA téléphone (étude 3D). Le HTTPS se règle à l'hébergement.

## Motion (3)
1. Entrée du héros (fondu depuis .4 + translate). 2. Révélation des sections au scroll (`animation-timeline: view()`,
opacité depuis .88). 3. Accent : la planche du héros dérive doucement au scroll. Le tout est coupé en `prefers-reduced-motion`.

## Vérif
`node design/scripts/lint.mjs <site>/index.html --fix` · `node .claude/skills/templatize/scripts/verify.cjs <site>/index.html <site>/_after.png`

## Commentaires
