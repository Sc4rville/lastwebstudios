#!/usr/bin/env bash
# run-guarded.sh — lance un job du pipeline de façon ROBUSTE (cf. cron.md).
#
#   - flock -n     : pas de chevauchement (deux runs se télescoperaient sur data/ et output/).
#   - npm en absolu: le PATH d'un scheduler (cron/systemd) est minimal ; /usr/bin/npm n'existe PAS ici
#                    (npm vit dans nvm). On le résout proprement.
#   - .env         : on cd dans le repo → run-skill.ts trouve la clé (loadEnvFile relatif au cwd).
#   - repo         : déduit de l'emplacement du script (<repo>/architecture/scheduling/), aucun chemin en dur ;
#                    LWS_REPO=<chemin> force un autre dépôt.
#   - état         : écrit data/logs/last-<job>.json → le backoffice (/api/schedule) lit dernier run/exit.
#   - LA CAGE      : arrêt d'urgence posé (fichier STOP, ou bouton du cockpit vu par `npm run cage -- check`)
#                    → le job ne part pas (exit 0, "skipped":"STOP" dans last-<job>.json). Tous les timers.
#
# Usage : run-guarded.sh <jobName> <npmScript> [args...]
#   pipeline quotidien : run-guarded.sh pipeline pipeline
#   review toutes 30min: run-guarded.sh review   review:batch
#   séquenceur         : run-guarded.sh sequencer sequencer tick
#   learning de nuit   : run-guarded.sh learn learn
set -euo pipefail

REPO="${LWS_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$REPO"
mkdir -p data/logs

JOB="${1:?usage: run-guarded.sh <jobName> <npmScript> [args...]}"
SCRIPT="${2:?npmScript manquant}"
shift 2 || true

# résoudre npm : $NPM_BIN > command -v npm > dernier nvm installé
NPM="${NPM_BIN:-}"
[ -z "$NPM" ] && NPM="$(command -v npm 2>/dev/null || true)"
[ -z "$NPM" ] && NPM="$(ls -t "$HOME"/.nvm/versions/node/*/bin/npm 2>/dev/null | head -1 || true)"
[ -z "$NPM" ] && { echo "npm introuvable (nvm non résolu)"; exit 127; }
export PATH="$(dirname "$NPM"):$PATH"   # tsx/node résolus par les scripts npm

STAMP="$(date -Iseconds)"
LAST="data/logs/last-${JOB}.json"
LOG="data/logs/${JOB}-$(date +%F).log"
LOCK="${LWS_LOCK_DIR:-/tmp}/lws-${JOB}.lock"   # LWS_LOCK_DIR : ailleurs que /tmp (tests, plusieurs dépôts)

# flock -n : un run du même job tourne déjà → on sort proprement (pas d'attente, pas de chevauchement)
exec 9>"$LOCK"
if ! flock -n 9; then
  # NE PAS écraser last-<job>.json : il doit garder le statut du dernier VRAI run (lu par le backoffice).
  echo "[$STAMP] $JOB déjà en cours (lock) — sauté (last-$JOB.json conservé)." >> "$LOG"
  exit 0
fi

# LA CAGE : STOP posé → aucun job planifié ne part (fichier d'abord, sans node ; puis le drapeau du cockpit en base)
STOPPED=""
if [ -e "${LWS_STOP_FILE:-STOP}" ]; then
  STOPPED="fichier STOP"
else
  set +e
  "$NPM" run --silent cage -- check >> "$LOG" 2>&1
  CHECK=$?
  set -e
  if [ "$CHECK" -eq 3 ]; then STOPPED="STOP du cockpit"
  elif [ "$CHECK" -ne 0 ]; then echo "[$STAMP] ⚠ cage check illisible (exit $CHECK) : le job part, ses propres gardes jouent" >> "$LOG"; fi
fi
if [ -n "$STOPPED" ]; then
  echo "[$STAMP] ⏹ $JOB sauté : $STOPPED (reprendre : rm STOP, ou « reprendre » au cockpit)" >> "$LOG"
  printf '{"job":"%s","ts":"%s","started":"%s","exit":0,"skipped":"STOP","log":"%s"}\n' "$JOB" "$(date -Iseconds)" "$STAMP" "$LOG" > "$LAST"
  exit 0
fi

echo "[$STAMP] $JOB → npm run $SCRIPT $*" >> "$LOG"
set +e
"$NPM" run "$SCRIPT" -- "$@" >> "$LOG" 2>&1
CODE=$?
set -e

END="$(date -Iseconds)"
printf '{"job":"%s","ts":"%s","started":"%s","exit":%d,"log":"%s"}\n' "$JOB" "$END" "$STAMP" "$CODE" "$LOG" > "$LAST"
echo "[$END] $JOB terminé (exit $CODE)" >> "$LOG"
exit $CODE
