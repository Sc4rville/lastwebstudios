#!/usr/bin/env bash
# share.sh · `npm run share`: your cockpit and your built sites on a public https link, in ONE command, through a
#   Cloudflare quick tunnel (cloudflared). Starts the cockpit with a password and the tunnel's host allowed, then
#   prints the links. The cockpit itself stays behind the password; a built site (/preview/…) opens without one, so
#   a business owner can see the site you built for them. Keep the terminal open; Ctrl-C stops everything.
#   Password: set BACKOFFICE_PASSWORD in .env to keep the same one; otherwise one is generated.
set -uo pipefail
cd "$(dirname "$0")/../.."
ROOT="$(pwd -P)"
PORT="${BACKOFFICE_PORT:-4000}"
# shellcheck source=station-lib.sh
. backoffice/reviewpipe/station-lib.sh
PASS="${BACKOFFICE_PASSWORD:-$(head -c12 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c10)}"

command -v cloudflared >/dev/null 2>&1 || { echo "✗ cloudflared is not installed: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"; exit 1; }
stop_our_station   # only OUR cockpit on this port (never a global pkill)

SRV=""; TUN=""
cleanup() { echo; echo "↩ stopping the share…"; kill "$SRV" "$TUN" 2>/dev/null; }
trap cleanup EXIT INT TERM

echo "→ starting the cockpit…"
LWS_LOCAL_DB="${LWS_LOCAL_DB:-1}" BACKOFFICE_PASSWORD="$PASS" BACKOFFICE_ALLOWED_HOST=".trycloudflare.com" \
  node --import tsx backoffice/reviewpipe/serve.ts >/tmp/lws-station.log 2>&1 &
SRV=$!
echo "$SRV" > "$PIDFILE"   # the next start.sh / share.sh knows how to stop it, and it only
# any answer counts (the cockpit answers 401 behind its password)
for _ in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null && break; sleep 0.5; done

echo "→ opening the tunnel…"
cloudflared tunnel --url "http://127.0.0.1:$PORT" >/tmp/lws-tunnel.log 2>&1 &
TUN=$!
URL=""
for _ in $(seq 1 60); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/lws-tunnel.log | head -1)
  [ -n "$URL" ] && break; sleep 0.5
done

echo
if [ -n "$URL" ]; then
  echo "  Your cockpit   $URL   (user lws, password $PASS)"
  echo "  Your built sites, one public link each (no password: send it to the business owner):"
  n=0
  for d in output/sites/*/; do
    [ -d "$d" ] || continue
    id=$(basename "$d"); last=""
    for v in "$d"*/; do [ -f "${v}index.html" ] && last=$(basename "$v"); done
    [ -n "$last" ] || continue
    echo "    $id   $URL/preview/$id/$last/index.html"
    n=$((n + 1)); [ "$n" -ge 12 ] && { echo "    … (the Open button above a site in Sites gives you any other one)"; break; }
  done
  [ "$n" -eq 0 ] && echo "    none yet: build one (npm run first-site -- --sample), then share again"
  echo "  The links last while this terminal stays open · Ctrl-C stops the share"
else
  echo "✗ could not read the tunnel's address: see /tmp/lws-tunnel.log"
fi
wait
