---
name: outreach-mail
description: Create ready-to-send Gmail DRAFTS for prospects (no copy-paste, no send) — verifies the REAL email + phone on the prospect's live site (Playwright), composes a personalized draft from the fiche + new-site link, and creates the draft in the operator's Gmail via the connector (MCP). Use when the operator says "crée les drafts mail", "envoie les mails outreach", "draft Gmail pour <prospect>", "drafts pour les ♥ rouge", or wants to contact loved/selected prospects. The outreach maillon (distribution) after a site is composed.
user-invocable: true
argument-hint: "<prospectId | id1,id2,… | ♥1|♥2|♥3 | loved>"
license: Apache 2.0
metadata:
  status: test
---

> ⚠ **MODE TEST** — préviens avant usage. **Crée des BROUILLONS** (jamais d'envoi auto) dans la boîte
> de l'opérateur → réversible (un draft se supprime). L'envoi reste un geste humain (relecture dans Gmail).

Le maillon **OUTREACH** : un site refait ne sert à rien s'il dort. Ce skill transforme un (ou des)
prospect(s) en **brouillons Gmail prêts à relire et envoyer** — zéro copier-coller, **avec le bon
destinataire** (email vérifié sur le vrai site, jamais deviné).

## ⚠ Architecture (à savoir)
Le connecteur **Gmail est lié à la SESSION claude.ai** (cet agent), **PAS** au cockpit (conteneur VM)
ni au worker (box). Donc **c'est CET agent qui crée les drafts**. Le travail déterministe (trouver le
vrai email, composer) est fait par un **script** (`npm run outreach`) ; l'agent n'a plus qu'à pousser
le résultat dans Gmail via le MCP. *(Full auto-send depuis le cockpit = OAuth Google côté serveur VM,
un chantier séparé, pas fait — et l'envoi doit rester relu.)*

## Déroulé
1. **Cibler** : un `<id>`, une **liste** `id1,id2,…`, un niveau de ♥ (`♥1`/`♥2`/`♥3`), ou `loved`
   (tous les `love>0`). *(Le ciblage par ♥ lit la DB — `DATABASE_URL` requis ; sinon passe des ids.)*
2. **Préparer (déterministe)** : lance
   ```bash
   npm run outreach -- <cible>
   ```
   Le script ouvre le **vrai site** de chaque prospect (Playwright), en extrait l'**email + tél réels**
   (mailto/tel, Cloudflare email-protection, JSON-LD, repli texte ; **affinité de domaine** → l'adresse
   du prospect, pas celle du webmaster), compose un brouillon court et écrit `data/outreach/<id>.json`.
   Il imprime **`READY_TO_DRAFT: id1,id2,…`** (email vérifié, prêt) et **`À VÉRIFIER: …`** (email non
   confirmé → **on ne drafte pas**, on signale).
3. **Créer les drafts** — pour **chaque id de `READY_TO_DRAFT`** :
   - lis `data/outreach/<id>.json` (`to`, `subject`, `body`) ;
   - crée le brouillon :
     ```
     mcp__claude_ai_Gmail__create_draft({ to: [rec.to], subject: rec.subject, body: rec.body })
     ```
   - grave l'`id` rendu : `npm run outreach:mark -- <id> <draftId>`.
4. **Ne PAS drafter** les ids `À VÉRIFIER` (pas d'email vérifié). Reporte la raison (`skipReason`) et,
   si la fiche a un email-piste, propose-le pour confirmation humaine. **Jamais inventer une adresse.**
5. **Confirmer** : `mcp__claude_ai_Gmail__list_drafts({ query: "subject:(refait OR refonte)" })` →
   vérifie que les drafts existent bien.
6. **Rapporter** un tableau : prospect → email (source/confiance) · tél · lien du site · id du draft,
   ou la raison du skip.

## Règles
- **Brouillon, jamais envoi.** L'opérateur relit et envoie depuis Gmail (un par un, ou multi-sélection
  dans Gmail). Ne JAMAIS appeler un outil d'envoi.
- **Un vrai email, vérifié sur le site.** Le script ne retient un email que trouvé sur le vrai site
  (haute/moyenne confiance). Un email seulement présent en fiche, non confirmé → **à vérifier**, pas
  drafté. Jamais de `contact@<domaine>` posé au hasard.
- **Le lien du nouveau site** : auto-rempli si **`OUTREACH_SITE_BASE`** est dans `.env` (l'URL publique
  du cockpit/preview, ex. le tunnel cloudflared de `npm run share` ou le domaine de la box). Sinon le
  corps porte `[lien de votre nouveau site]` à compléter — préviens l'opérateur.
- **Vidéo démo dans le mail** : `draft.ts` enregistre une démo (curseur qui **hover** les interactions +
  **scroll fluide**, dans un **mockup navigateur**) via `design/scripts/demo-video.ts`, l'héberge dans le
  **bucket Supabase**, et colle le **lien DIRECT** dans le corps. Best-effort : nécessite les clés Supabase
  dans l'env (présentes sur la box ; en local, configure-les ou lance l'outreach sur la box). Réutilise la
  vidéo si déjà dans le bucket. `OUTREACH_DEMO=0` pour couper.
- **Multi-sélection** = passer une liste d'ids ou un niveau de ♥ ; le script et l'agent bouclent.

## Config (`.env`, optionnel)
- `OUTREACH_SITE_BASE` — base publique des previews → le lien du site est auto-rempli.
- `OUTREACH_FROM_NAME` — prénom de signature (défaut `[Votre prénom]`).
- `DATABASE_URL` — requis seulement pour cibler par ♥ (sinon passe des ids).

## Ce que ça NE fait pas (encore)
- Envoyer (volontaire). Auto-send full-auto = OAuth serveur (chantier distribution séparé).
- Brancher le retour terrain : un `reply`/`meeting` peut nourrir `npm run learn:record` (maillon 9).
