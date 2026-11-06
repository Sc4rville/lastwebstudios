---
name: account-research
description: Recherche un prospect (entreprise/personne) et sort un BRIEF de vente actionnable + un SCRIPT D'APPEL customisé, branché au CRM /outreach de lastwebstudios. Use quand l'opérateur dit "/account-research <id>", "research <boîte>", "intel sur <prospect>", "qui est <nom> chez <boîte>", "prépare l'appel de <id>", "renseigne-toi sur <prospect>".
user-invocable: true
argument-hint: "<prospect-id> | <nom d'entreprise> | <url> | <personne> chez <boîte>"
license: Apache 2.0
metadata:
  status: test
---

# account-research — l'intel avant l'appel (maillon distribution)

Donne une image complète d'un prospect AVANT de l'appeler, et **produit le script d'appel** que l'opérateur
lit dans le CRM. Marche en standalone (web search) ; **bien meilleur** branché sur nos données (fiche,
scoring, diagnose, record outreach) et le bucket/DB partagés.

> **Nos prospects = des PME locales** (piscinistes, paysagistes, lieux de réception, cuisinistes, artisans),
> pas des scale-ups. Donc « key people » = le **gérant/propriétaire** ; « news » = activité locale récente,
> avis Google, nouveaux chantiers/showroom ; « angle » = la **faille SEO** + la **preuve concurrent** + notre
> promesse (un site qui fait SIGNER). Adapte le brief B2B générique à cette réalité — ne sur-formate pas.

## Langue
Brief et script d'appel dans la langue de l'agence (`agency.config.json › language` ; défaut français). En anglais, le script garde la même structure (« CALL 0 — {business} », opener, proof, ask), avec des phrases natives : « Hi, this is [your name] at [studio]. I'm calling because I've just built a website for [business] and wanted to show it to you. » ; preuve locale : « We already work with a few [trade]s around here. » ; closing : « Thirty seconds, I'll be quick. » Jamais une traduction mot à mot du script français.

## Déroulé

### 1. Cible
- **`<id>` connu de nous** (ex. `orvane-piscines-valmont-sur-lys`, `atelier-brisane-sornac-le-haut`) → c'est le cas standard (lead du CRM).
- Sinon : un **nom d'entreprise / une URL / une personne** → recherche générique.

### 2. Nos données D'ABORD (gratuit, fiable, déjà là)
Pour un `<id>`, lis avant toute recherche web :
- **Fiche** `data/prospects/<id>.json` (ou repli DB `prospects.sheet_json`) : identité (nom, ville, tél,
  email), site existant (`existing.url`), **brief diagnose** (ce qui cloche / angle), **scoring** (tier, axes).
- **Record outreach** `data/outreach/<id>.json` : **`competitor` (preuve)**, **`seoIssue`**, email vérifié.
- (Optionnel) le site composé `output/sites/<id>/…` pour rappeler ce qu'on lui propose.
Ces faits sont la colonne vertébrale du brief et du script — la recherche web vient ENRICHIR, pas remplacer.

### 3. Recherche web (toujours)
- `"<nom> <ville>"` → site, GBP, présence.
- `"<nom>" avis` / Google reviews → réputation, volume d'avis, points sensibles.
- `"<nom>" actualité|chantier|projet|recrute` → signaux récents (90 j).
- `"<gérant>" <nom>` / LinkedIn → la personne à qui parler, son parcours.
- le **site actuel** (déjà diagnostiqué) → confirmer la faille SEO précise.
Pour une boîte plus grosse : ajoute funding/effectifs/tech-stack/key-people (cf. format générique plus bas).

### 4. Synthèse → BRIEF + SCRIPT D'APPEL
Produis **deux choses** :
1. **Brief** (court, actionnable) : qui ils sont · pourquoi ils ont besoin de nous · **le meilleur angle** ·
   à qui parler · 2-3 signaux récents · concerns/inconnues à creuser en découverte.
2. **Script d'appel** (à LIRE pendant l'appel) — SUIS le SCRIPT DE VENTE de l'agence (`docs/` PDF), customisé
   pour CE prospect :
   - **PITCH** : « Bonjour, [prénom] à l'appareil, directeur commercial chez lastwebstudios. Je suis bien avec
     [interlocuteur] ? Je vous contacte parce que j'ai créé mon agence de web design et on travaille avec pas mal
     de vos confrères dans le secteur [métier]. On leur permet d'augmenter leur taux de conversion de +7 %. J'ai
     jeté un œil au vôtre et je me suis permis de vous en développer un nouveau. Quand auriez-vous 10 min en visio
     pour que je vous le présente ? » (injecte interlocuteur + métier ; ajoute la faille SEO si pertinent).
   - **Objections : méthode CRAC** (Creuser → Reformuler → Argumenter → Contrôler) — d'abord CREUSER (faire parler).
     Reprends les 3 objections du doc avec leurs questions : « on a déjà un site », « c'est trop cher », « pas le
     bon moment ». Garde-le **parlé, court, FR, zéro jargon**. (Le cockpit affiche déjà ce socle ; tu l'AFFÛTES.)

### 5. Persister → le CRM l'affiche (le pont)
Écris `data/research/<id>.json` (inclus le **décisionnaire** : nom `contact` + URL `linkedin`) :
```json
{ "callScript": "CALL 0 — …\n\n…", "research": { "brief": "…", "angle": "…", "contact": "<gérant/dirigeant>", "linkedin": "https://www.linkedin.com/in/…", "people": "…", "news": ["…"] } }
```
> **Décisionnaire** : trouve le gérant/dirigeant (LinkedIn, Pappers/societe.com) → `contact` (nom) + `linkedin`
> (URL du profil, ou à défaut la page LinkedIn de l'entreprise). Jamais inventé ; rien de fiable = vide.
puis lance **`npm run research:save -- <id>`** → upsert dans `crm_leads` (DB partagée) → le script + le brief
apparaissent dans la fiche du lead sur **`/outreach`** (section « 📞 Script d'appel »), côté local ET box.
*(Sans `<id>` connu — recherche générique — affiche juste le brief + le script à l'écran, pas de persistance.)*

### 6. Rapporter
Montre le brief + le script en clair, dis qu'ils sont enregistrés (visibles dans le CRM), et le prochain pas
(appeler depuis la colonne Hot Lead, lire le script, puis reach/unreach/rdv).

## Intégration pipeline (cf. `/new-step`)
- **Réflexion** (LLM + web) → c'est un **skill** (ici). Le maillon **mécanique** de persistance = `npm run
  research:save` (`outreach/scripts/research-save.ts`) → `crm_leads.call_script` + `research_json`.
- **Place dans le funnel** : `lead-engine → composer → outreach (brouillon) → /account-research (intel + script)
  → CALL (CRM Hot Lead) → close`. À lancer quand un lead est **approuvé** (entré au CRM en Call 0), ou juste
  avant un appel/relance. Le CRM lit le résultat en live.
- Lié : `/out` (brouillons mail), le CRM `/outreach`, `/diagnose` (le brief technique du site).

## Format générique (boîte plus grosse / standalone)
Si la cible n'est pas une de nos PME (ex. recherche libre « research Stripe »), garde l'esprit du brief de
vente complet : Quick Take · Company Profile (taille, funding, HQ) · Recent News · Hiring Signals · Key People
(+ talking points) · Tech Stack · Qualification (✅/⚠️/❓) · Recommended Approach (entry point, hook, discovery
questions) · Sources. Mais pour nos prospects, l'essentiel = **angle + script d'appel** ci-dessus.
