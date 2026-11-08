# station-lib.sh · sourced by start.sh and share.sh: manage YOUR OWN station, never anyone else's.
# Before (audit 2026-10-24): `pkill -f 'reviewpipe/serve\.ts'` killed EVERY station on the machine
# (other checkouts, other sessions). Here: one pidfile per port, and a check that the process really is
# `reviewpipe/serve.ts` started from THIS repository before touching it.
# Expects: ROOT (the repository root, physical path) and PORT.

LWS_RUN_DIR="${LWS_RUN_DIR:-$ROOT/output/lab}"   # output/lab/ is gitignored
PIDFILE="$LWS_RUN_DIR/station-$PORT.pid"
mkdir -p "$LWS_RUN_DIR"

# true if $1 is OUR station: cmdline `reviewpipe/serve.ts` AND (on Linux) cwd = this repository
is_our_station() {
  local pid="$1"
  kill -0 "$pid" 2>/dev/null || return 1
  ps -p "$pid" -o args= 2>/dev/null | grep -q 'reviewpipe/serve\.ts' || return 1
  if [ -e "/proc/$pid/cwd" ]; then [ "$(readlink -f "/proc/$pid/cwd")" = "$ROOT" ] || return 1; fi
  return 0
}

# stops OUR previous station on this port (pidfile), and only that one
stop_our_station() {
  [ -f "$PIDFILE" ] || return 0
  local old; old="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [ -n "$old" ] && is_our_station "$old"; then
    kill "$old" 2>/dev/null && echo "↻ Previous cockpit stopped (pid $old)"
    for _ in $(seq 1 20); do kill -0 "$old" 2>/dev/null || break; sleep 0.1; done
  fi
  rm -f "$PIDFILE"
}

port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; }
