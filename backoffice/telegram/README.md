# telegram — bot de notification & prompt-back

Un bot Telegram qui **t'envoie les nouvelles générations** (screenshot + lien public cliquable) et te
laisse **répondre pour commenter** un site — ton message atterrit dans son `control.md`, appliqué au
prochain `review:batch`. C'est la station, dans ta poche. SCRIPT (pas de LLM).

## Setup (2 min)
1. Telegram → **@BotFather** → `/newbot` → copie le **token**.
2. Ajoute-le à `.env` à la racine :
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC-...
   ```
3. Lance : `npm run telegram`, puis **envoie un message au bot** (il capture ton chat id tout seul).

## Ce qu'il fait
- **Aperçu read-only** : sert `output/sites/` (GET `/preview/*` uniquement) sur `:4100`, exposé via un
  **tunnel cloudflared** → lien `https://…trycloudflare.com/preview/<id>/<date>/index.html`. On ne
  tunnelise **jamais** le backoffice complet (ses API d'écriture restent privées).
- **Notifie** chaque nouvelle génération : screenshot (playwright) + lien + `template · contenu`.
- **Prompt-back** : réponds à une génération (ou écris simplement) → le texte est **ajouté** au
  `control.md` du site → `review:batch` (cron) l'applique. Telegram = télécommande de la boucle.

## Dépendances
- `cloudflared` (tunnel, gratuit, sans compte) dans le PATH ou `~/.local/bin/`. **Absent → screenshot-only**
  (notifications par image, sans lien public).
- `playwright` (déjà une dépendance) pour les screenshots.

État (chats connus, générations déjà notifiées) : `output/.telegram.json` (gitignoré). Le token vit
dans `.env` (gitignoré). Rien de tout ça n'est versionné.
