#!/usr/bin/env bash
# share.sh — partage la station avec Naly en UNE commande.
#   Lance la station (avec mot de passe + host tunnel autorisé) + cloudflared, puis affiche
#   le LIEN et le MOT DE PASSE à envoyer. Laisse le terminal ouvert ; Ctrl-C arrête tout.
#   Mot de passe : pose BACKOFFICE_PASSWORD dans .env pour qu'il soit STABLE ; sinon un est généré.
set -uo pipefail
cd "$(dirname "$0")/../.."
ROOT="$(pwd -P)"
PORT="${BACKOFFICE_PORT:-4000}"
# shellcheck source=station-lib.sh
. backoffice/reviewpipe/station-lib.sh
PASS="${BACKOFFICE_PASSWORD:-$(head -c12 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c10)}"

command -v cloudflared >/dev/null 2>&1 || { echo "✗ cloudflared introuvable. Installe-le d'abord."; exit 1; }
stop_our_station   # seulement NOTRE station sur ce port (jamais un pkill global)

SRV=""; TUN=""
cleanup() { echo; echo "↩ arrêt du partage…"; kill "$SRV" "$TUN" 2>/dev/null; }
trap cleanup EXIT INT TERM

echo "→ démarrage de la station…"
BACKOFFICE_PASSWORD="$PASS" BACKOFFICE_ALLOWED_HOST=".trycloudflare.com" \
  node --import tsx backoffice/reviewpipe/serve.ts >/tmp/lws-station.log 2>&1 &
SRV=$!
echo "$SRV" > "$PIDFILE"   # start.sh / share.sh suivants sauront l'arrêter, elle et elle seule
for _ in $(seq 1 40); do curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null && break; sleep 0.5; done

echo "→ ouverture du tunnel…"
cloudflared tunnel --url "http://127.0.0.1:$PORT" >/tmp/lws-tunnel.log 2>&1 &
TUN=$!
URL=""
for _ in $(seq 1 60); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/lws-tunnel.log | head -1)
  [ -n "$URL" ] && break; sleep 0.5
done

echo
if [ -n "$URL" ]; then
  echo "═══════════════════════════════════════════════"
  echo "  📨 À envoyer à Naly :"
  echo "     lien         : $URL"
  echo "     identifiant  : lws"
  echo "     mot de passe : $PASS"
  echo "  (laisse ce terminal ouvert · Ctrl-C = stopper le partage)"
  echo "═══════════════════════════════════════════════"
else
  echo "✗ pas réussi à récupérer l'URL du tunnel — voir /tmp/lws-tunnel.log"
fi
wait
