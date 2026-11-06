# station-lib.sh · sourcé par start.sh et share.sh : gérer SA PROPRE station, jamais celle des autres.
# Avant (audit 2026-10-24) : `pkill -f 'reviewpipe/serve\.ts'` tuait TOUTES les stations de la machine
# (autres checkouts, autres sessions). Ici : un pidfile par port, et une vérification que le process est
# bien `reviewpipe/serve.ts` lancé depuis CE dépôt avant d'y toucher.
# Attend : ROOT (racine du dépôt, chemin physique) et PORT.

LWS_RUN_DIR="${LWS_RUN_DIR:-$ROOT/output/lab}"   # output/lab/ est gitignoré
PIDFILE="$LWS_RUN_DIR/station-$PORT.pid"
mkdir -p "$LWS_RUN_DIR"

# vrai si $1 est NOTRE station : cmdline `reviewpipe/serve.ts` ET (sous Linux) cwd = ce dépôt
is_our_station() {
  local pid="$1"
  kill -0 "$pid" 2>/dev/null || return 1
  ps -p "$pid" -o args= 2>/dev/null | grep -q 'reviewpipe/serve\.ts' || return 1
  if [ -e "/proc/$pid/cwd" ]; then [ "$(readlink -f "/proc/$pid/cwd")" = "$ROOT" ] || return 1; fi
  return 0
}

# arrête NOTRE station précédente sur ce port (pidfile), et elle seule
stop_our_station() {
  [ -f "$PIDFILE" ] || return 0
  local old; old="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [ -n "$old" ] && is_our_station "$old"; then
    kill "$old" 2>/dev/null && echo "↻ ancienne station arrêtée (pid $old)"
    for _ in $(seq 1 20); do kill -0 "$old" 2>/dev/null || break; sleep 0.1; done
  fi
  rm -f "$PIDFILE"
}

port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; }
