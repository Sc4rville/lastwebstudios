# Scheduling

Quand lancer la machine, **de façon robuste**. Sept jobs planifiés, plus deux services permanents : le worker
(`worker/lws-worker.service`) et la Station (`backoffice/reviewpipe/lws-cockpit.service`). Le pas-à-pas complet sur
une box neuve (utilisateur dédié, linger, logs, cage) : `docs/GUIDE.md` §8.

| job | quoi | cadence (timer fourni) |
|-----|------|------------------------|
| **scrape**    | `npm run scrape -- cuisiniste all` : nouveaux prospects OSM (francophonie), dédup par registre | 1×/semaine (lundi 02:00) |
| **pipeline**  | `npm run pipeline` : voie template-fill (score→…→animate) — édition privée seulement (hors édition open source) | 1×/jour (03:00) |
| **review**    | `npm run review:batch` : commentaires `control.md` via l'éditeur chirurgical — édition privée seulement (l'édition open source passe par le worker : job `edit`) | toutes les 30 min |
| **sequencer** | `npm run sequencer -- tick` : réponses lues (réponse = Hot Lead), clics et désinscriptions du tracking, disjoncteur, envois dus | toutes les 20 min, lun-ven 08:00-18:40 (Paris) |
| **learn**     | `npm run learn` : les issues du CRM (Signature, Perdu, RDV, réponses) re-pondèrent la porte de scoring | chaque nuit, 01:30 (Paris) |
| **batch**     | `npm run batch -- composer $LWS_BATCH_SIZE $LWS_BATCH_ARGS` : empile un batch composer pour le worker (métier AUTO par le radar si `LWS_BATCH_ARGS` est vide) : **c'est ce qui rend l'agence automatique** | chaque nuit, 00:30 (Paris) |
| **warmup**    | `npm run warmup -- tick` : les boîtes s'écrivent et se répondent (rampe 2 → 20/boîte/jour), en dry-run tant que `LWS_LIVE_SEND=1` est commenté dans l'unité | toutes les heures, 08:15-19:15 (Paris) |

Le scrape lit son métier et sa zone dans `LWS_SCRAPE_ARGS` (défaut `cuisiniste all`, à poser dans `.env`).

> ⚠️ **Tout passe par le wrapper `run-guarded.sh`** : ne PAS appeler `npm` directement depuis un
> scheduler. Le wrapper règle quatre pièges réels :
> 1. **Chevauchement** : `flock -n` empêche deux runs du même job de se télescoper sur `data/`/`output/`.
> 2. **`npm` introuvable** : sous cron/systemd le `PATH` est minimal et **`/usr/bin/npm` n'existe pas**
>    (npm vit dans nvm : `~/.nvm/versions/node/<v>/bin/npm`). Le wrapper le résout (`NPM_BIN` pour forcer).
> 3. **`.env`** : il `cd` dans le dépôt (déduit de son propre emplacement, `LWS_REPO` pour forcer) → chaque
>    script trouve `.env` (`process.loadEnvFile()` relatif au cwd).
> 4. **La cage** : arrêt d'urgence posé (fichier `STOP` à la racine, ou bouton STOP du cockpit, lu par
>    `npm run cage -- check`) → le job ne part pas (exit 0, `"skipped":"STOP"` dans `last-<job>.json`).

## Run once (à la main)
```bash
npm run pipeline
# ou, exactement comme le scheduler (verrou + résolution npm + cage + écriture de l'état) :
architecture/scheduling/run-guarded.sh pipeline  pipeline
architecture/scheduling/run-guarded.sh review    review:batch
architecture/scheduling/run-guarded.sh sequencer sequencer tick
architecture/scheduling/run-guarded.sh learn     learn
```

## Recommandé : systemd user timers
Les unités sont versionnées dans ce dossier et **ne sont pas installées par défaut** :
`lws-{scrape,pipeline,review,sequencer,learn,batch,warmup}.{service,timer}` + `lws-alert@.service` (dead-man's-switch :
sur échec d'un job, journalise dans `data/logs/ALERT.log`, `notify-send` si dispo, et POST texte vers `LWS_ALERT_URL`
si elle est posée : un sujet ntfy, l'URL `/fail` d'un check healthchecks.io, un webhook). Chaque service porte
`Environment=PATH=%h/.local/bin:…` : Claude Code installé en natif (`~/.local/bin/claude`) est trouvé sous systemd.

**Chemins** : aucune unité ne porte de chemin en dur, elles utilisent `%h/lws` (`%h` = ton HOME), la disposition
de la box (`worker/setup-box.sh` clone dans `~/lws`). Si ton dépôt est ailleurs : `ln -s /chemin/du/depot ~/lws`.

**Installer en une commande** (`architecture/scheduling/install-units.sh` : copie, recharge, active les groupes demandés,
refuse root, signale le linger absent et les timers système en double ; `--dry-run` pour voir) :
```bash
architecture/scheduling/install-units.sh --enable core            # worker + Station + learning de nuit
architecture/scheduling/install-units.sh --enable auto            # + batch composer de nuit + scrape hebdo
architecture/scheduling/install-units.sh --enable warmup          # warmup (dry-run tant que LWS_LIVE_SEND est commenté)
architecture/scheduling/install-units.sh --enable outreach        # séquenceur (idem, + "dryRun": false pour le réel)
```

**Installer à la main** (`loginctl enable-linger "$USER"` une fois, pour que les timers tournent sans session ouverte) :
```bash
mkdir -p ~/.config/systemd/user
cp architecture/scheduling/lws-*.service architecture/scheduling/lws-*.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now lws-pipeline.timer lws-review.timer lws-scrape.timer lws-learn.timer
# le séquenceur : seulement quand le warmup est fini et le contenu prêt (il tourne en DRY-RUN tant que
# config.dryRun n'est pas false ET que Environment=LWS_LIVE_SEND=1 n'est pas décommenté dans son unité)
systemctl --user enable --now lws-sequencer.timer
```
Sur une box où ces jobs tournent déjà en timers **système** (root), n'installe pas la version utilisateur en plus :
deux timers = deux ticks = des envois en double.

**Monitorer :**
```bash
systemctl --user list-timers 'lws-*'                        # dernier + prochain run, en un coup d'œil
systemctl --user status lws-sequencer.service               # santé du dernier tick
journalctl --user -u lws-pipeline.service -n 50 --no-pager  # logs (journald, rotation auto)
journalctl --user -u lws-sequencer.service -f               # suivre en direct
cat data/logs/last-sequencer.json                           # l'état que lit le cockpit (/api/schedule)
npm run cage                                                # STOP, budget du jour, disjoncteur, mode d'envoi
```
> Le **cockpit montre cet état** : pastilles « pipe / review / seq / learn » dans la barre de la Station
> (vert = dernier run OK, rouge = échec, gris = sauté par un STOP), alimentées par `data/logs/last-<job>.json`
> (écrit par le wrapper) + `systemctl --user list-timers`. La vue **Machine** (`/#machine`) montre la cage.

**Arrêt d'urgence (tous les jobs, le worker, le warmup) :**
```bash
npm run cage -- stop "raison"     # ou : echo "raison" > STOP · ou le bouton STOP du cockpit
npm run cage -- resume            # puis : systemctl --user restart lws-worker (le worker sort sur STOP)
```

**Désactiver / retirer :**
```bash
systemctl --user disable --now lws-pipeline.timer lws-review.timer lws-scrape.timer lws-sequencer.timer lws-learn.timer
systemctl --user daemon-reload
```

## Repli : crontab (si pas de systemd)
Toujours via le wrapper (verrou + npm nvm + cage + état), **jamais** `/usr/bin/npm` en dur. Avec le dépôt dans `~/lws` :
```cron
0    3 * * *     $HOME/lws/architecture/scheduling/run-guarded.sh pipeline pipeline
*/30 * * * *     $HOME/lws/architecture/scheduling/run-guarded.sh review review:batch
30   1 * * *     $HOME/lws/architecture/scheduling/run-guarded.sh learn learn
*/20 8-18 * * 1-5 $HOME/lws/architecture/scheduling/run-guarded.sh sequencer sequencer tick
```
(cron lit l'heure de la machine : sur une box en UTC, décale le séquenceur d'une ou deux heures.)
```bash
crontab -e   # éditer    ·    crontab -l   # voir    ·    (retirer la ligne pour désactiver)
```

## Notes
- **Persistent=true** sur les timers : un run manqué (machine en veille) se rattrape au réveil.
- **Logs** : journald avec systemd (`journalctl --user --vacuum-time=14d` pour borner). Le wrapper écrit
  aussi `data/logs/<job>-<date>.log` (gitignoré) + `data/logs/last-<job>.json` (état machine-lisible).
- **Code de sortie** : un tick du séquenceur dont un envoi a échoué finit en code 1 (réessai au tick suivant,
  jamais de double envoi) → `lws-alert@` se déclenche ; un `dryRun:false` sans `LWS_LIVE_SEND=1` finit en code 2.
- **Healthcheck off-machine** (optionnel, garde le zéro-dép local) : un `HEALTHCHECK_URL` curlé en fin de
  run couvrirait le cas « la machine elle-même est éteinte » ; non câblé pour l'instant.
- La **station** (`npm run backoffice`) n'est pas un job planifié : elle lit `output/` en live (watcher +
  poller). Pour la garder allumée au boot : une unité systemd dédiée (optionnel).
```bash
# valider une expression de calendrier avant de l'installer
systemd-analyze calendar 'Mon..Fri *-*-* 08..18:00/20:00 Europe/Paris'
systemd-analyze calendar '*-*-* 01:30:00 Europe/Paris'
```
