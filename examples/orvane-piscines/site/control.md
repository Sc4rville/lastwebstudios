# control · orvane-piscines-valmont-sur-lys

- template : composer
- généré   : 2026-10-24 13:30 · composer
- contenu  : 1 page · 4 illustrations + logo · 0 masqué
- fonts    : Host Grotesk (display 300/400/600) × Geist (texte 300/400), woff2 self-hostés dans fonts/
- archétype: hero-split (texte à gauche, illustration plein-bleed à droite) · ambiance CLAIRE (sable #F4EFE6), une seule bascule sombre en clôture (contact)
- sections : hero-split · process-timeline · services-list · bande pleine largeur spas/abris · entretien & SAV · guarantees-grid (version filets) · contact + formulaire court · barre mobile Appeler/Devis
- motion   : 3 mouvements (entrée héro fade+translate depuis .4 · reveal de section scroll-driven `animation-timeline:view()` fill none · ligne du chantier qui se remplit au scroll) + prefers-reduced-motion
- verdict  : lint clean:true · verify clean:true (0 overflow 1440/390, 0 image cassée/floue, 0 void, clippedHeadings vides desktop+mobile, 0 erreur console)

## décisions
- Assets : les 4 « photos » sont des ILLUSTRATIONS vectorielles marquées « illustration fictive » (cf. _boost.json). Copiées en assets/bassin-1..4.svg avec la vignette-légende cuite (rect+texte bas-gauche) RETIRÉE et width/height doublés (vectoriel, net). Présentées comme types de bassins / offres, JAMAIS comme « nos réalisations ». photo-5.svg (pastille 12px) écartée.
- Héros = bassin-2 (débordement, ciel chaud) recadré object-position 72% 60%. Process = bassin-1. Bande = bassin-3 (spa) + bassin-4 (abri).
- Logo : chip bleu #0d5c8a sur fond sable clair (contraste OK). Footer sombre : wordmark texte Host Grotesk (évite sombre-sur-sombre).
- Contenu réel uniquement : fiche + texte visible sur l'ancien site (avant.png) : devis détaillé et gratuit sans engagement, délais annoncés respectés, garantie décennale + assurance, SAV joignable toute l'année, bouche-à-oreille, showroom 12 chemin des Tilleuls. « Depuis plus de quinze ans » (texte de 2016) remplacé par « depuis 1998 ».
- Preuve sociale : la fiche n'a NI googleRating, NI reviews, NI testimonialVideos, NI brands → aucune section avis/vidéos/marques (rien inventé). À ajouter dès que le client fournit avis Google / vraies photos de chantiers.
- Retiré volontairement : bandeau promo 2016, compteur de visiteurs, « © 2016 ». Ajouté : viewport, meta description, OG, JSON-LD HomeAndConstructionBusiness (adresse/horaires).
- Pas de preload des fonts (en file:// le preload crossorigin lève des erreurs CORS console ; @font-face charge bien).
- Fragile : les visuels restent des illustrations plates ; un vrai shooting (ou web-cinematics à partir de vraies photos) ferait passer le site un cran au-dessus.
- Le playbook `design/industries/pisciniste/` n'existe pas : utilisé `design/industries/piscine/playbook.md`.
- Aucun autre site client (output/sites/**) n'a été ouvert ni utilisé comme référence.

## vérif
- node design/scripts/lint.mjs output/sites/orvane-piscines-valmont-sur-lys/2026-10-24-composer/index.html --fix
- node .claude/skills/templatize/scripts/verify.cjs output/sites/orvane-piscines-valmont-sur-lys/2026-10-24-composer/index.html output/sites/orvane-piscines-valmont-sur-lys/2026-10-24-composer/_after.png

## dernières modif
- 2026-10-24 13:30 · composé (composer)

## commentaire
<!-- Écris ici ce que tu veux changer sur ce site. `/review` le lit, l'applique en relançant le filler, puis vide cette section. -->
