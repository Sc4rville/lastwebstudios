# reviewpipe — control station & review lab

La **station de contrôle** : l'interface de review humaine (maillon 4), fusionnée au repo. Un seul
serveur `node:http` (zéro dépendance, lancé via `tsx`), bind **127.0.0.1**, qui sert les sites générés
en preview live et expose une fine API sur les `control.md` et la bibliothèque de templates.

## Lancer
```bash
npm run backoffice          # → http://127.0.0.1:4000  (port libre suivant si occupé)
```

## Trois pages (nav `station · lab · brain`, swipe ←→ / flèches)

**Station** — previews **live cliquables** des sites de `output/sites/<id>/<date>/`, et l'éditeur
**bidirectionnel** du `control.md` : ce que tu écris dans *commentaire* est sauvé dans le fichier
(seule cette section est touchée) ; toute modif du fichier (édition manuelle, `review:batch`, rebuild)
revient dans l'UI **en live** (SSE + `fs.watch`). Colle une capture (Ctrl-V) pour un retour visuel —
elle atterrit à côté du `control.md` et le filler la lit comme feedback.

**Lab** — previews des templates organisées par catégorie, **notes `.md` par template** pour itérer
(dans `output/lab/`, gitignoré), **font pairings** (specimens depuis `video/fonts/`), extraits des
templates, et la **zone réservée aux animations**.

**Brain** — le **cerveau de l'agent** : monitore le système de skills en funnel **idées → en test →
actifs**. Les *idées* viennent d'un `docs/skillstash.md` (absent de cette édition : crée-le, une idée par ligne, taggée par catégorie) ; « mettre à l'épreuve »
crée un **brouillon en mode test** dans `.claude/skills/`. Les *skills* (`.claude/skills/`) ont chacun
un **prompt** (comme un `control.md`) pour demander un changement (à appliquer ensuite par un agent),
et les skills en test ont un bouton **promouvoir**. Drafter à la main aussi. Tout en live (`fs.watch`
sur `.claude/skills/`).

## Rebuild = batch (cron)
La station n'écrit que les commentaires. Le rebuild est différé : `npm run review:batch` scanne les
`control.md` à commentaire non vide et relance le filler (qui applique, vide la section, incrémente
l'historique). À programmer en cron — cf. `architecture/scheduling/cron.md`. Un bouton **refill**
manuel existe aussi par site. Le travail LLM reste **dans le filler** : ce dossier est un SCRIPT.

## Fichiers
| fichier | rôle |
|---|---|
| `serve.ts` | le serveur (routes statiques `/preview` `/tpl` `/font`, API JSON, SSE `/events`, `fs.watch`) |
| `templates.ts` | extracteurs du lab (templates, `@font-face`, extraits, specimens de fonts) |
| `skills.ts` | lecture du brain : skills `.claude/skills/` (statut test/actif, feedback) + idées `skillstash` |
| `apply-pending.ts` | le batch `review:batch` (cron) : relance le filler sur les commentaires en attente |
| `public/` | la page full-screen (vanilla `index.html` + `app.css` + `app.js`, pas de build) |

Source **versionnée** ; les sorties (`output/`, `output/lab/`) restent **gitignorées**.

## Partager la station avec Naly (tunnel)

La station bind **127.0.0.1** — un **tunnel** la relaie sans changer ça : elle reste loopback,
`cloudflared` y accède en local et l'expose à une URL. Naly voit alors **ta station live** (mêmes
données, avant/après, statut, commentaires — en direct via le flux SSE). Une seule source de vérité = ta machine.

```bash
# 1. lance la station avec un mot de passe + autorise le domaine du tunnel
BACKOFFICE_PASSWORD='choisis-un-mdp' BACKOFFICE_ALLOWED_HOST='.trycloudflare.com' npm run backoffice
#    (ou pose-les dans .env : BACKOFFICE_PASSWORD=… puis BACKOFFICE_ALLOWED_HOST=.trycloudflare.com)

# 2. dans un AUTRE terminal, ouvre le tunnel (cloudflared est déjà installé)
cloudflared tunnel --url http://127.0.0.1:4000
#    → te donne une URL https://xxxx.trycloudflare.com

# 3. envoie l'URL + le mot de passe à Naly. Elle ouvre → le navigateur demande le mot de passe → elle est dans TON backoffice.
```

- `BACKOFFICE_ALLOWED_HOST` : `.trycloudflare.com` (avec le point devant) autorise **tout sous-domaine**
  cloudflare — pratique car l'URL d'un tunnel rapide **change à chaque lancement**. Pour une **URL stable** :
  un tunnel **nommé** cloudflared (compte Cloudflare + DNS) → mets alors le **domaine exact**.
- **Mot de passe OBLIGATOIRE** avant d'exposer : sans `BACKOFFICE_PASSWORD`, la station démarre quand même
  mais **avertit en rouge** (host externe autorisé sans auth = salle de contrôle ouverte à qui a l'URL).
- Auth = **HTTP Basic sur HTTPS** (le tunnel chiffre) ; le navigateur la rejoue automatiquement sur les
  iframes de preview et le flux live. En local **sans** `BACKOFFICE_PASSWORD` : aucune auth (inchangé).
- **Ta machine doit rester allumée** tant que Naly regarde (c'est ta station qui sert).

