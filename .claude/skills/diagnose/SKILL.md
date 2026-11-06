---
name: diagnose
description: Diagnose a prospect's EXISTING website before composing — look at their current site (the avant.png screenshot + the fiche + the live URL) and produce a short, specific design brief : what the business really is, what's WRONG with their current site, and the angle + concrete design moves we'll bring for THEM. Writes the brief into the fiche so the composer targets their real problems instead of building a generic pretty site. The reflection step between parse and compose. Triggers: "diagnose <prospect>", "brief <prospect>", "qu'est-ce qui cloche sur son site", "analyse le site du prospect". Not for composing (use composer) nor scoring opportunity (that's the scoring gate).
version: 0.1.0
user-invocable: true
argument-hint: "<prospectId>"
license: Apache 2.0
allowed-tools:
  - Read
  - Edit
---

> ⚠ **MODE TEST** (cf. `/skilldraft` §6) — skill jeune : préviens avant usage, jamais en auto/non surveillé.
> Promotion après ≥3 usages validés.

Le maillon **DIAGNOSE** : la **réflexion** qui manquait entre `parse` et `composer`. On ne compose pas
un joli site dans le vide — on regarde **le site ACTUEL du prospect**, on comprend ce qui cloche, et on
décide **ce qu'on apporte spécifiquement**. Ce brief rend la sortie ciblée (un pitch), pas générique.

```
parse (contenu + avant.png)  →  ★ diagnose (le brief)  →  composer (pioche le catalogue, suit le brief)
```

## Langue
Le brief est écrit dans la langue de l'agence (`agency.config.json › language`, `LANGUAGE` dans le prompt ; défaut français) : le composer et le script d'appel le reprennent tel quel.

## Entrée
- `data/prospects/<id>.json` — la fiche (contenu, services, ton ; `existing.url`, `existing.screenshot`).
- **`data/assets/<id>/_audit-desktop.png` ET `_audit-mobile.png`** — les captures FRAÎCHES **desktop (pleine page) +
  mobile (390px)** produites par l'audit : **Read les DEUX**. Le **mobile est crucial** (c'est là que ça casse : débordement, texte minuscule). Fallback : `avant.png`.
- **`fiche.audit`** — l'**audit technique MESURÉ** (`npm run audit -- <id>`) : vitesse, mobile cassé (390px), HTTPS,
  viewport, contact, SEO, liens morts, + `issues` (**griefs chiffrés et vérifiables**) + **`strengths`** (vidéos témoignage,
  avis/note Google, RDV détectés = les **FORCES**). **Absent → lance `npm run audit -- <id>` d'abord.** L'œil voit le design ; l'audit PROUVE le technique.

## Déroulé
0. **`npm run audit -- <id>`** si `fiche.audit` est absent (l'audit mesuré alimente les griefs).
1. **Lis** la fiche + **`fiche.audit`** + **Read les 2 captures** (`_audit-desktop.png` + `_audit-mobile.png` ; à défaut `avant.png`). **Juge le DESKTOP ET le MOBILE.**
2. **Réfléchis** et écris un brief, concret et spécifique à CE prospect :
   - **beauty_before** : note la **beauté du site actuel sur 10** + 1 phrase (la base de comparaison
     pour la `beauty-gate` ; sois honnête — un site daté = 2-4/10). Le nouveau devra être **nettement** au-dessus.
   - **what** : le business, sa cible, son ton, ce qu'il vend vraiment (1-2 phrases).
   - **problems** : ce qui **cloche sur leur site actuel**. Combine DEUX sources : (a) ce que tu VOIS sur `avant.png`
     (design daté, hiérarchie absente, pas de CTA clair, photos faibles, zéro preuve sociale, trop chargé/vide…) et
     (b) les **griefs MESURÉS de `fiche.audit.issues`** (chiffrés, irréfutables : « charge en X s », « déborde sur
     mobile », « pas de HTTPS », « aucun moyen de contact »…). **Le mesuré PRIME quand il existe** (c'est vérifiable).
     3-6 puces concrètes, jamais génériques.
     **CHERCHE ACTIVEMENT les BUGS (desktop ET mobile)** — ce sont les griefs les plus parlants : un élément qui en
     **RECOUVRE** un autre (un bouton posé PAR-DESSUS du texte), du **texte coupé/tronqué**, un **chevauchement**, un
     bloc cassé, une **image manquante**, un menu qui déborde. Regarde vraiment, ne te contente pas d'une impression générale.
   - **angle** : la **promesse** / le positionnement qu'on choisit pour LUI (une phrase).
   - **moves** : 2-3 **partis-pris design** concrets (ex. « hero plein écran sur les réalisations »,
     « mettre la garantie 10 ans en preuve », mood + paire de fonts suggérée du catalogue `design/fonts`).
   - **keep** : les **FORCES à GARDER et awwwardifier** (leçon DG) — avis/note Google, témoignages **VIDÉO**, marques
     partenaires, prise de **RDV**, avant/après. Pars de `fiche.audit.strengths` + ce que tu VOIS sur les captures
     (l'audit ne scanne que la home → complète à l'œil). Le composer ne JETTE jamais ça, il l'élève. (Liste ; vide si rien.)
3. **Écris le brief dans la fiche** : ajoute (ou remplace) une clé `"brief"` dans `data/prospects/<id>.json`
   (`{ "date": "...", "beauty_before": {"score": N, "why": "..."}, "what": "...", "problems": [...], "angle": "...", "moves": [...], "keep": [...] }`),
   **sans toucher au reste** de la fiche.
4. **Rapporte** le brief (les 3 temps) + ce qui reste incertain.

## Le composer le consomme
`/composer <id>` lit `fiche.brief` comme **direction** : corriger les `problems`, tenir l'`angle`,
appliquer les `moves`. Si `brief` absent → lancer `/diagnose` d'abord.

## Garde-fous
- **Basé sur ce qui est VU** (`avant.png`) + la fiche — **pas d'invention**. Si `avant.png` manque, le
  dire et faire un diagnostic partiel (fiche + live URL), marqué comme tel.
- Diagnostic **honnête et spécifique** : « pas de CTA, photos sombres, menu à rallonge » vaut mieux que
  « le site pourrait être plus moderne ». Pas de flatterie, pas de générique.
- C'est aussi l'embryon du **gate visuel** (juger le site actuel) et ça nourrit la boucle d'apprentissage.
