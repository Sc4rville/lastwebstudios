#!/usr/bin/env bash
# start.sh · lance la station SANS friction.
#   - relance proprement SA PROPRE station précédente (même dépôt, même port) pour reprendre le port 4000 ;
#     ne touche JAMAIS à une autre station de la machine (cf. station-lib.sh : pidfile + vérification)
#   - ouvre le navigateur tout seul quand c'est prêt (LWS_NO_OPEN=1 pour s'en passer)
#   - Ctrl-C arrête. Les variables d'env (BACKOFFICE_PORT/PASSWORD/ALLOWED_HOST) passent normalement.
set -uo pipefail
cd "$(dirname "$0")/../.."   # racine du repo
ROOT="$(pwd -P)"
PORT="${BACKOFFICE_PORT:-4000}"
# shellcheck source=station-lib.sh
. backoffice/reviewpipe/station-lib.sh

# 1. libérer le port : arrêter NOTRE station précédente, et elle seule
stop_our_station
if port_busy; then echo "ℹ le port $PORT est déjà pris par un autre process : la station prendra le suivant libre."; fi

# 2. ouvrir le navigateur dès que le port répond (en tâche de fond)
if [ "${LWS_NO_OPEN:-0}" != "1" ]; then
  ( for _ in $(seq 1 40); do
      if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then
        (xdg-open "http://127.0.0.1:$PORT/" || open "http://127.0.0.1:$PORT/") >/dev/null 2>&1
        break
      fi
      sleep 0.5
    done ) &
fi

# 3. démarrer la station : exec → ce shell DEVIENT le serveur (un seul pid, celui du pidfile), Ctrl-C l'arrête
echo $$ > "$PIDFILE"
exec node --import tsx backoffice/reviewpipe/serve.ts
