#!/usr/bin/env bash
# start.sh · `npm run backoffice` : the cockpit, with no friction.
#   - restarts OUR previous cockpit (same repository, same port) so it gets port 4000 back ; never touches another
#     cockpit on this machine (station-lib.sh : a pidfile and a check of the process)
#   - a port held by another program : the next free one, and THAT is the one printed and opened
#   - no DATABASE_URL : an embedded Postgres on disk (data/pglite) so Find prospects, the call list and the jobs work on
#     a laptop (LWS_LOCAL_DB=0 to go without)
#   - opens the browser when it is ready (LWS_NO_OPEN=1 to skip) ; Ctrl-C stops it
set -uo pipefail
cd "$(dirname "$0")/../.."   # the repository root
ROOT="$(pwd -P)"
PORT="${BACKOFFICE_PORT:-4000}"
# shellcheck source=station-lib.sh
. backoffice/reviewpipe/station-lib.sh

# 1. free the port : stop OUR previous cockpit, and only ours
stop_our_station
if port_busy; then
  WANTED="$PORT"
  for _ in $(seq 1 100); do PORT=$((PORT + 1)); port_busy || break; done
  echo "ℹ Port $WANTED is busy (another program): using $PORT."
  PIDFILE="$LWS_RUN_DIR/station-$PORT.pid"
fi
export BACKOFFICE_PORT="$PORT"
export LWS_LOCAL_DB="${LWS_LOCAL_DB:-1}"

# 2. open the browser on the port the cockpit really listens on, as soon as it answers (in the background)
if [ "${LWS_NO_OPEN:-0}" != "1" ]; then
  ( for _ in $(seq 1 60); do
      if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/api/run" 2>/dev/null; then
        (xdg-open "http://127.0.0.1:$PORT/" || open "http://127.0.0.1:$PORT/") >/dev/null 2>&1
        break
      fi
      sleep 0.5
    done ) &
fi

# 3. start the cockpit : exec → this shell BECOMES the server (one pid, the pidfile's), Ctrl-C stops it
echo $$ > "$PIDFILE"
exec node --import tsx backoffice/reviewpipe/serve.ts
