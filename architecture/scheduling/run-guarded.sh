#!/usr/bin/env bash
# run-guarded.sh — runs a pipeline job ROBUSTLY (see cron.md).
#
#   - flock -n     : no overlap (two runs would collide on data/ and output/).
#   - absolute npm : a scheduler's PATH (cron/systemd) is minimal; /usr/bin/npm does NOT exist here
#                    (npm lives in nvm). It is resolved properly.
#   - .env         : cd into the repo → run-skill.ts finds the key (loadEnvFile relative to the cwd).
#   - repo         : derived from the script's location (<repo>/architecture/scheduling/), no hard-coded path;
#                    LWS_REPO=<path> forces another repo.
#   - state        : writes data/logs/last-<job>.json → the backoffice (/api/schedule) reads the last run/exit.
#   - THE CAGE     : emergency stop set (STOP file, or the cockpit's button seen by `npm run cage -- check`)
#                    → the job does not start (exit 0, "skipped":"STOP" in last-<job>.json). Every timer.
#
# Usage: run-guarded.sh <jobName> <npmScript> [args...]
#   daily pipeline     : run-guarded.sh pipeline pipeline
#   review every 30 min: run-guarded.sh review   review:batch
#   sequencer          : run-guarded.sh sequencer sequencer tick
#   nightly learning   : run-guarded.sh learn learn
set -euo pipefail

REPO="${LWS_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$REPO"
mkdir -p data/logs

JOB="${1:?usage: run-guarded.sh <jobName> <npmScript> [args...]}"
SCRIPT="${2:?npmScript missing}"
shift 2 || true

# resolve npm: $NPM_BIN > command -v npm > the latest installed nvm
NPM="${NPM_BIN:-}"
[ -z "$NPM" ] && NPM="$(command -v npm 2>/dev/null || true)"
[ -z "$NPM" ] && NPM="$(ls -t "$HOME"/.nvm/versions/node/*/bin/npm 2>/dev/null | head -1 || true)"
[ -z "$NPM" ] && { echo "npm not found (nvm not resolved)"; exit 127; }
export PATH="$(dirname "$NPM"):$PATH"   # tsx/node resolved by the npm scripts

STAMP="$(date -Iseconds)"
LAST="data/logs/last-${JOB}.json"
LOG="data/logs/${JOB}-$(date +%F).log"
LOCK="${LWS_LOCK_DIR:-/tmp}/lws-${JOB}.lock"   # LWS_LOCK_DIR: somewhere other than /tmp (tests, several repos)

# flock -n: a run of the same job is already going → exit cleanly (no waiting, no overlap)
exec 9>"$LOCK"
if ! flock -n 9; then
  # DO NOT overwrite last-<job>.json: it must keep the status of the last REAL run (read by the backoffice).
  echo "[$STAMP] $JOB already running (lock) — skipped (last-$JOB.json kept)." >> "$LOG"
  exit 0
fi

# THE CAGE: STOP set → no scheduled job starts (the file first, without node; then the cockpit's flag in the database)
STOPPED=""
if [ -e "${LWS_STOP_FILE:-STOP}" ]; then
  STOPPED="STOP file"
else
  set +e
  "$NPM" run --silent cage -- check >> "$LOG" 2>&1
  CHECK=$?
  set -e
  if [ "$CHECK" -eq 3 ]; then STOPPED="the cockpit's STOP"
  elif [ "$CHECK" -ne 0 ]; then echo "[$STAMP] ⚠ cage check unreadable (exit $CHECK): the job starts, its own guards apply" >> "$LOG"; fi
fi
if [ -n "$STOPPED" ]; then
  echo "[$STAMP] ⏹ $JOB skipped: $STOPPED (to resume: rm STOP, or Resume in the cockpit)" >> "$LOG"
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
echo "[$END] $JOB finished (exit $CODE)" >> "$LOG"
exit $CODE
