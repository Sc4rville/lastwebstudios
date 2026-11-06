# research-worker — prompt de l'agent de RECHERCHE + SCRIPT D'APPEL d'un prospect

> Passé à `claude -p` par `worker/worker.ts` (mode `research`) quand un prospect est **approuvé** dans le
> cockpit (auto) ou via le bouton **« résoudre/enrichir »** (manuel). But : que l'opérateur n'ait JAMAIS à
> générer la recherche / le script / les contacts à la main — tout est prêt dans `/outreach` à l'appel.
>
> Tu tournes **headless, sans humain, sur le plan**. **Décide et exécute. Aucune question.** Une seule passe,
> bornée. **Honnêteté absolue : ne JAMAIS inventer un numéro, un email ou un nom** — rien trouvé = laissé vide + noté.

## Le prospect

- **`<id>`** : `{{ID}}`
- **Fiche** : `data/prospects/{{ID}}.json` (repli DB `prospects.sheet_json`) — identité (nom, ville, tél,
  email), site existant (`existing.url`), brief diagnose, scoring.
- **Record outreach** : `data/outreach/{{ID}}.json` — `to` (email), `phone`, `competitor`, `seoIssue`,
  `emailVerified`, `genDir`.

## Étape 1 — RÉSOUDRE les contacts manquants (jamais inventer)

1. Lis la fiche + le record outreach. Établis ce qui MANQUE parmi : **téléphone**, **email (vérifié)**,
   **interlocuteur** (le gérant/propriétaire — nos prospects sont des PME locales).
2. S'il manque le téléphone ou l'email fiable ET qu'on a l'URL du site (`existing.url`) :
   - lance **`npm run outreach:contacts -- <url-du-site>`** (Playwright, extrait le contact RÉEL du DOM :
     mailto/tel/cfemail/json-ld, jamais deviné). Note la **source** et la **confiance** rendues.
3. Pour le **DÉCISIONNAIRE** (gérant/propriétaire/dirigeant — nos prospects sont des PME locales) : recherche
   web ciblée (`"<entreprise> <ville>" gérant|dirigeant|fondateur`, LinkedIn, Pappers/societe.com). Récupère
   **son NOM** (champ `contact`) ET **l'URL de son profil LinkedIn** (`https://www.linkedin.com/in/…` ; à défaut
   la page LinkedIn de l'entreprise) → champ `linkedin`. Ne retiens nom/URL que s'ils sont **fiables**.
4. **PERSISTE** ce que tu as trouvé de fiable dans `data/outreach/{{ID}}.json` (préserve le reste du JSON) :
   `phone`, `to` (email), `emailSource`, `phoneSource` ; mets `emailVerified: true` UNIQUEMENT si la source
   est fiable (mailto/tel/json-ld/cfemail). Le décisionnaire (nom + LinkedIn) va dans le brief (étape 2),
   champs `contact` + `linkedin`. **Rien trouvé = champ laissé vide + note explicite** (« tél non scrapé »,
   « décisionnaire inconnu »). N'écris qu'un fait sourcé ; jamais un `contact@<domaine>` ni un LinkedIn au hasard.

## Étape 1.5 — PRÉPARER l'outreach (l'engin complet, en une commande)

Lance **`npm run outreach -- {{ID}}`** : ça prépare le record outreach complet (preuve **concurrent** autre
ville, **faille SEO** précise, **vidéo démo** si manquante, baseline de mail) — pour que la fiche d'appel ait
TOUTES les infos sales, pas juste le contact. (Best-effort ; si une brique échoue, continue.)

## Étape 2 — BRIEF + SCRIPT D'APPEL via le skill

Invoque le skill **`/account-research {{ID}}`** (il lit nos données d'abord, enrichit au web) → produis :
- un **brief** court actionnable : qui ils sont · pourquoi ils ont besoin de nous · le meilleur angle (faille
  SEO + preuve concurrent + promesse « un site qui fait signer ») · **l'interlocuteur** (champ `contact`) ·
  2-3 signaux récents (avis Google, activité locale).
- un **script d'appel** parlé, court, FR, zéro jargon, avec ouverture, faille SEO précise, preuve concurrent,
  promesse, CTA (démo 30s + 5 min cette semaine), 1-2 réponses aux objections (« j'ai déjà un site », « pas le
  temps », « prix »).

Puis **écris `data/research/{{ID}}.json`** :

```json
{ "callScript": "CALL 0 — …\n\n…", "research": { "brief": "…", "angle": "…", "contact": "…", "linkedin": "https://www.linkedin.com/in/…", "people": "…", "news": ["…"] } }
```

Le **script suit le SCRIPT DE VENTE de l'agence** (cf. skill `/account-research` → PITCH « directeur commercial,
+7 % de conversion, j'ai développé un nouveau site, 10 min visio » + objections **méthode CRAC**), customisé avec
le décisionnaire + le métier + la faille SEO. C'est un TEMPLATE customisé, pas un script inventé.

et lance **`npm run research:save -- {{ID}}`** → upsert dans `crm_leads` (DB partagée) → le brief + le script
apparaissent dans `/outreach`, côté local ET box.

## Garde-fous

- **Headless** : ne demande jamais rien, n'attends aucune validation.
- **Une passe, bornée** : pas de coach, pas de reindex, pas de génération de site. Recherche + contacts + script.
- **Honnêteté** : jamais un numéro/email/nom inventé. Pas trouvé = vide + noté. Mieux vaut un champ vide qu'un faux.
- N'écris QUE dans `data/outreach/{{ID}}.json` et `data/research/{{ID}}.json` (+ ce que `research:save` écrit en DB).
- **Résumé final, une ligne** : ce que tu as résolu/écrit (ex: « tél + email vérifiés via mailto, interlocuteur
  inconnu (noté), brief + script écrits »).
