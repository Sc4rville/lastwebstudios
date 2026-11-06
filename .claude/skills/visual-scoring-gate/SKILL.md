---
name: visual-scoring-gate
status: test
description: L'axe BESOIN du scoring — juge la qualité visuelle du site d'un prospect (screenshots Playwright + LLM) pour rattraper les sites techniquement corrects mais moches que la porte gratuite recale. Appelé automatiquement par scoreProspect() quand la porte cheap dit cold ; à la main via npm run gate -- <id> <url>.
---

> ⚠ mode test — câblé dans le pipeline mais jeune : promotion après ≥ 3 usages validés
> (vérifier que les verdicts collent à l'œil humain sur de vrais prospects).

# visual-scoring-gate

**Le problème.** La porte gratuite (`score.ts`, fetch HTML zéro LLM) juge la *technique*
(responsive, SEO, builder daté). Vérifié en réel : elle recale 5/5 vrais cuisinistes dont les
sites sont « corrects » techniquement mais faibles visuellement — exactement nos cibles.

**La solution.** Un deuxième étage qui juge la *beauté* : screenshots (haut + milieu de page,
`visual-gate.ts`) → le LLM (ce skill, `prompt.md`) note le **besoin de refonte /100** avec un
barème calibré. Score final = `max(technique, besoin visuel)`.

## Quand il tourne
- **Automatique** : `scoreProspect(id, url)` l'appelle UNIQUEMENT si la porte gratuite dit
  `cold` (le coûteux en dernier — un site déjà retenu ne coûte rien de plus). `VISUAL=0` le coupe.
- **À la main** : `npm run gate -- <id> <url>` (juge un site isolément, écrit les captures
  dans `data/assets/<id>/gate-*.png`).

## Étapes (le déroulé interne)
1. `visual-gate.ts` capture haut de page + milieu de page (1440×900, preloaders retombés).
2. Le runner (`run-skill.ts`) envoie `prompt.md` + les captures au modèle (multimodal).
3. Retour JSON strict `{ besoin: 0-100, reasons: [...] }` ; en cas d'hésitation le barème
   pousse vers la tranche haute (rater un vrai prospect coûte plus cher qu'en regarder un moyen).
4. `score.ts` fusionne : `value = max(cheap, besoin)`, raisons visuelles préfixées `visuel :`.

## Captures mensongères — géré (2026-06-12)
Cookie walls et preloaders donnaient des captures vides → le juge **devinait** depuis l'URL/la
marque (faux verdicts plausibles). Triple parade : `visual-gate.ts` ferme les bandeaux cookies
(sélecteurs connus + boutons « accepter ») ; le prompt interdit de deviner et impose
`{"unusable": true}` si rien n'est jugeable → re-capture patiente (networkidle + 6 s + scroll) ;
toujours rien → **warm 30** « à juger à la main » (jamais jeté sur une capture vide).

## Validation (2026-06-12)
- **5/5 cuisinistes du seed rattrapés** (52–72/100, hot) là où la porte cheap recalait 5/5 —
  raisons concrètes vérifiées à l'œil sur les captures (un site client réellement cassé, etc.).
- **3/3 contre-tests premium** (norr11, daytrip.studio, maap.cc) restent à 5–20/100 → pas jetés
  à tort, et jugés sur ce qui est VISIBLE (après la parade anti-cookie-wall).
- **Validation humaine (naly, 2026-06-12) : les verdicts collent.** Nuance de calibration relevée :
  un site client noté 72 est moins cassé en vrai que sur la capture (probable raté de chargement CSS au
  moment du shot → score gonflé), et cuisinespassions (52) est le plus moche des 5 à l'œil humain.
  Le CLASSEMENT entre prospects retenus est donc approximatif — pas grave pour la porte
  (hot/cold), à resserrer si on se sert un jour du score pour PRIORISER les prospects.
- Promotion hors test : après usage réel dans le pipeline.

## À étoffer
- Les sites scroll-jackés/WebGL restent un angle mort possible (capture ≠ expérience).
- À terme : brancher les autres axes du modèle (LEVIER, VALEUR…) — cf. `leadengine/2_scoring/README.md`.
