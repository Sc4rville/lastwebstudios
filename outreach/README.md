# outreach · distribution (maillon 8, embryon)

Un site refait ne sert à rien s'il dort. Ce bloc transforme un prospect en **brouillon Gmail prêt à
relire et envoyer**, avec le **bon destinataire** (email vérifié sur le vrai site, jamais deviné).

## Le partage du travail
- **Déterministe** (`scripts/`, zéro LLM, zéro envoi) : trouver le vrai contact + composer + écrire un
  record. C'est ce que fait `npm run outreach`.
- **Agent** (skill `outreach-mail`, qui seul tient le connecteur Gmail/MCP) : pousser le record dans
  Gmail en **brouillon**. Le connecteur Gmail est lié à la **session claude.ai**, pas au cockpit/box.

## Scripts
| script | rôle |
|--------|------|
| `npm run outreach:contacts -- <url>` | résout le contact RÉEL d'un site (Playwright) : mailto/tel, Cloudflare email-protection, JSON-LD, repli texte ; **affinité de domaine** (le domaine du prospect > mail gratuit > webmaster) ; rend source + confiance. Rien trouvé = vide. |
| `npm run outreach -- <cible>` | PREPARE : pour chaque prospect (id \| `id1,id2` \| `♥N` \| `loved` \| `all`), vérifie le contact, résout le lien du nouveau site, compose le brouillon, écrit `data/outreach/<id>.json`. Imprime `READY_TO_DRAFT` / `À VÉRIFIER`. |
| `npm run outreach:mark -- <id> <draftId>` | write-back de l'id du draft Gmail + statut dans le record (appelé par le skill après `create_draft`). |

## Le flux complet (multi-sélection)
```
npm run outreach -- ♥3              # prépare tous les ♥ rouge (vérifie l'email, compose)
→ READY_TO_DRAFT: id1,id2,…         # email vérifié, prêt
→ skill outreach-mail : create_draft (MCP) par id prêt → brouillons Gmail (jamais envoyés)
```
Ou, depuis le cockpit : marque les prospects au ♥, puis demande à l'agent « crée les drafts ♥ rouge ».

## Config (`.env`, optionnel)
- `OUTREACH_SITE_BASE` · base publique des previews (cockpit/tunnel) → le lien du nouveau site est
  auto-rempli (`<base>/preview/<id>/<build>/index.html`). Sinon `[lien…]` à compléter.
- `OUTREACH_FROM_NAME` · prénom de signature (défaut `[Votre prénom]`).
- `DATABASE_URL` · requis seulement pour cibler par ♥ (sinon passe des ids).

## Garde-fous
- **Jamais d'envoi** (brouillon seulement, relu par l'humain). **Jamais d'email inventé** (pas vérifié
  sur le site = non drafté, signalé). Le contact vérifié est persisté dans la fiche (additif, réversible).
- `data/outreach/` est gitignoré (état transitoire, rebuildable).
