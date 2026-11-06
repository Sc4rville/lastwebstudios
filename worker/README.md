# worker — la génération autonome (la box bosse PC éteints)

Le **cockpit** (conteneur Coolify) ne génère pas lui-même : pas de Claude Code ni de navigateurs
Playwright dedans. Il **empile** des demandes dans la file `batch_requests` (Supabase). Le **worker**
ci-présent tourne **nativement sur la box**, dépile, **génère**, **réindexe**, marque le job fait.

```
  cockpit (conteneur)  ──[/api/batch]──▶  batch_requests (Supabase)  ◀──[claim]──  worker (box)
        ▲                                                                              │
        └────────────── reindexAll() : les sites bâtis apparaissent au cockpit ◀───────┘
```

## Les pièces

| Fichier | Rôle |
|---|---|
| `worker.ts` | le daemon : claim atomique → génère → `reindexAll()` → marque done/error. Un job à la fois. Route les 4 modes + lance le gate `coach`. |
| `compose-worker.md` | le **prompt** du mode `composer` passé à `claude -p` : lead-engine + compose-batch, headless, **sur le plan**. |
| `edit-worker.md` | le **prompt** du mode `edit` : applique une correction ciblée sur un site existant (sans rebuild complet). |
| `research-worker.md` | le **prompt** du mode `research` : intel prospect → CRM (`crm_leads`/`outreach`), borné, sans coach ni reindex lourd. |
| `coach.mjs` / `coach.md` | le **gate qualité** après compose : regarde le rendu SERVI d'un nouveau site, boucle ses correctifs au composer AVANT publication (jauge violette au cockpit). |
| `openai-image.mjs` | génération d'images via OpenAI `gpt-image` (héros / visuels), appelée pendant la compose. |
| `setup-box.sh` | l'install **sur la box** (Node + Claude Code + repo + Playwright + service systemd). À lancer en SSH. |
| `lws-worker.service` | le service systemd utilisateur (tourne au boot, redémarre tout seul). |

## Quatre modes de batch (+ le gate coach)

`worker.ts` route selon le `mode` du job :

- **composer** (défaut, *premium*) → `claude -p` (prompt `compose-worker.md`) orchestre le sur-mesure.
  Tourne **sur le plan** (`CLAUDE_CODE_OAUTH_TOKEN`) — la partie chère, d'où `plan-first`. ~0,15 $/site
  d'extraction API en plus (négligeable).
- **template-fill** (*cheap*) → `npm run pipeline` (template poliform, API). Voie secondaire.
- **edit** → applique une correction ciblée sur un site existant (prompt `edit-worker.md`), sans rebuild.
- **research** → intel prospect persistée dans la DB partagée (prompt `research-worker.md`), idempotent et borné.

Après une compose, le **gate `coach`** (`coach.mjs`, prompt `coach.md`) passe AVANT publication : les sites
neufs sont d'abord marqués `.reviewing` (non publiés), le coach regarde le rendu servi et boucle ses
correctifs au composer, puis `reindexAll()` publie. Désactivable via `WORKER_NO_COACH=1`.

## Mise en route (sur la box, une fois)

> Pas à pas complet sur une box neuve, sans root (utilisateur dédié, pare-feu, linger, Station derrière HTTPS,
> cage) : **`docs/GUIDE.md`** §3 à §9, et `architecture/scheduling/install-units.sh --enable core`. Ci-dessous : la
> disposition historique de la box de l'équipe.

```bash
ssh root@<IP-de-la-box>
git clone <url-du-dépôt> ~/lws && cd ~/lws   # le dépôt que la box tire (équipe : le miroir, docs/DEPLOY.md)
bash worker/setup-box.sh          # installe tout
claude setup-token                # ← LE token du PLAN (interactif), à coller dans ~/lws/.env
nano ~/lws/.env                   # DATABASE_URL (pooler) + CLAUDE_CODE_OAUTH_TOKEN + ANTHROPIC_API_KEY
systemctl --user enable --now lws-worker
journalctl --user -u lws-worker -f
```

Puis depuis le cockpit : **« lancer un batch »** → le worker le dépile ici, en direct.

## plan-first (important)

Le composer tourne sur le forfait : login `claude auth login` sur la machine, ou `CLAUDE_CODE_OAUTH_TOKEN`
(`claude setup-token`). Le worker **retire `ANTHROPIC_API_KEY`** de l'environnement de chaque `claude -p` : en
mode `-p`, Claude Code utilise TOUJOURS une clé API présente avant le plan (code.claude.com/docs/en/authentication,
« Authentication precedence »), ce qui facturait l'API (ou échouait sur une clé morte). L'extraction du
lead-engine passe par `runSkill` → voie `LWS_LLM` (`claude-code` par défaut) : tout tourne sur le plan.
`WORKER_PLAN_STRICT=0` rétablit l'ancien comportement (la clé reste, les agents facturent l'API).
Au démarrage, la ligne `✓ worker lws — … · claude <version> · <source d'auth>` dit sur quoi les agents tournent
(lue par `claude auth status`), et le worker **refuse de démarrer en `--bare`** (ni plan, ni skills).

> ⚠ Rappel facturation (15/06/2026) : le headless tire sur l'**enveloppe Agent SDK** (100-200 $/mois
> sur Max) puis bascule API si « usage credits » est activé. Laisser « usage credits » **OFF** pour
> éviter une facture surprise (cf. `~/.claude/skills/plan-first/SKILL.md`).

## Réglages (env)

`WORKER_NAME` (id lisible), `WORKER_POLL_MS` (défaut 15000), `CLAUDE_BIN`, `WORKER_CLAUDE_ARGS`, `WORKER_PLAN_STRICT=0`
(garde la clé API), `COACH_MODEL` ; modèles par rôle `LWS_MODEL_SMART/FAST/JUDGE` et moteurs média `LWS_IMAGE` /
`LWS_VIDEO` (cf. `.env.example`), injectés dans le prompt du composer puis dans les `args` du Workflow.

> ⚠ **Permissions en root.** La box tourne en root → Claude Code REFUSE `--dangerously-skip-permissions` /
> `--permission-mode bypassPermissions` (sécurité). Le worker déclare donc explicitement les outils
> autorisés (`worker/claude-args.ts`) : `-p --strict-mcp-config --allowedTools Bash Read Write Edit Glob Grep Agent
> Workflow Skill WebFetch WebSearch` (aucun serveur MCP chargé ; noms à jour au 24/10/2026 : `Agent` remplace `Task`, `MultiEdit` n'existe plus ; depuis la
> 2.1.302, un outil soumis à permission et non listé est refusé en `-p`). Ne PAS
> spoofer `IS_SANDBOX=1`. (Alternative propre : faire tourner le worker sous un user non-root.)
