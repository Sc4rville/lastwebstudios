#!/usr/bin/env bash
# install-units.sh — installe les unités systemd UTILISATEUR de la machine 24/7 (cf. cron.md, docs/GUIDE.md §8).
#
# Copie les unités du dépôt dans ~/.config/systemd/user/ (LWS_UNIT_DIR pour un autre dossier), recharge systemd,
# puis active SEULEMENT les groupes demandés. Rien n'envoie de mail tant que LWS_LIVE_SEND=1 n'est pas décommenté
# dans l'unité concernée (warmup, séquenceur) : ce script ne le fait jamais.
#
#   architecture/scheduling/install-units.sh                     # installe tout, n'active rien
#   architecture/scheduling/install-units.sh --enable core       # worker + Station + learning de nuit
#   architecture/scheduling/install-units.sh --enable core --enable auto   # + le batch composer de chaque nuit
#   architecture/scheduling/install-units.sh --dry-run --enable core       # dit ce qu'il ferait, ne touche à rien
#
# Groupes (--enable, répétable) :
#   core      lws-worker.service · lws-cockpit.service · lws-learn.timer
#   auto      lws-batch.timer (un batch composer par nuit, LWS_BATCH_SIZE / LWS_BATCH_ARGS) · lws-scrape.timer
#   warmup    lws-warmup.timer (en dry-run tant que LWS_LIVE_SEND=1 est commenté dans lws-warmup.service)
#   outreach  lws-sequencer.timer (idem : dry-run + deux clés pour un envoi réel)
#   review    lws-review.timer (commentaires control.md en attente) · pipeline : lws-pipeline.timer — voie template-fill,
#             ÉDITION PRIVÉE seulement (absents de l'édition open source : le composer construit via lws-batch.timer)
#   telegram  lws-telegram.service (bot de review, fermé par défaut : TELEGRAM_ALLOWED_CHAT_IDS)
#
# Garde-fous : refuse root (le worker lance des agents avec Bash : un utilisateur dédié, cf. GUIDE §4 ; LWS_ALLOW_ROOT=1
# pour forcer) ; signale un dépôt ailleurs que ~/lws (les unités disent %h/lws), le linger absent (les timers ne
# tourneraient pas sans session ouverte) et des timers lws-* SYSTÈME déjà présents (deux timers = deux envois).
# SYSTEMCTL / LOGINCTL : binaires à utiliser (tests). Idempotent : relançable sans casse.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT_DIR="${LWS_UNIT_DIR:-$HOME/.config/systemd/user}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
LOGINCTL="${LOGINCTL:-loginctl}"
DRY=0
GROUPS_ON=()

usage() { sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; }
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --enable) [ $# -ge 2 ] || { echo "✗ --enable <groupe>" >&2; exit 64; }; GROUPS_ON+=("$2"); shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "✗ option inconnue : $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

say()  { printf '%s\n' "$*"; }
warn() { printf '⚠ %s\n' "$*"; }
run()  { if [ "$DRY" = 1 ]; then say "  (dry-run) $*"; else "$@"; fi; }

if [ "$(id -u)" = 0 ] && [ "${LWS_ALLOW_ROOT:-0}" != 1 ]; then
  echo "✗ refus de tourner en root : crée un utilisateur dédié (sudo adduser --disabled-password lws) et lance ce script en tant que lui." >&2
  echo "  (le worker donne Bash à des agents : en root, ils ont la machine. LWS_ALLOW_ROOT=1 pour passer outre.)" >&2
  exit 77
fi

# les unités livrées (lws-sync.* reste propre à la box de l'équipe : pas ici)
UNITS=()
for f in "$REPO"/architecture/scheduling/lws-*.service "$REPO"/architecture/scheduling/lws-*.timer \
         "$REPO"/worker/lws-worker.service "$REPO"/worker/lws-telegram.service "$REPO"/backoffice/reviewpipe/lws-cockpit.service; do
  [ -e "$f" ] && UNITS+=("$f")
done

group_units() {
  case "$1" in
    core) echo "lws-worker.service lws-cockpit.service lws-learn.timer" ;;
    auto) echo "lws-batch.timer lws-scrape.timer" ;;
    warmup) echo "lws-warmup.timer" ;;
    outreach) echo "lws-sequencer.timer" ;;
    review|pipeline) # voie template-fill (édition privée) : unités absentes de l'édition open source
      [ -e "$REPO/architecture/scheduling/lws-$1.timer" ] || { echo "✗ groupe $1 : voie template-fill, absente de cette édition (le composer construit via lws-batch.timer)" >&2; return 1; }
      echo "lws-$1.timer" ;;
    telegram) echo "lws-telegram.service" ;;
    none) echo "" ;;
    *) return 1 ;;
  esac
}
ENABLE=()
for g in "${GROUPS_ON[@]+"${GROUPS_ON[@]}"}"; do
  u="$(group_units "$g")" || { echo "✗ groupe inconnu : $g (core | auto | warmup | outreach | review | pipeline | telegram)" >&2; exit 64; }
  for x in $u; do ENABLE+=("$x"); done
done

say "▶ unités lastwebstudios → $UNIT_DIR (${#UNITS[@]} fichiers)"
[ "$REPO" = "$HOME/lws" ] || [ "$(readlink -f "$HOME/lws" 2>/dev/null)" = "$REPO" ] || \
  warn "le dépôt est dans $REPO, les unités l'attendent dans ~/lws : ln -s \"$REPO\" ~/lws"
run mkdir -p "$UNIT_DIR"
for f in "${UNITS[@]}"; do run cp "$f" "$UNIT_DIR/$(basename "$f")"; done
run "$SYSTEMCTL" --user daemon-reload

for x in "${ENABLE[@]+"${ENABLE[@]}"}"; do
  if [ "$x" = lws-warmup.timer ] || [ "$x" = lws-sequencer.timer ]; then
    say "  $x : en DRY-RUN (rien ne part) tant que Environment=LWS_LIVE_SEND=1 reste commenté dans ${x%.timer}.service"
  fi
  run "$SYSTEMCTL" --user enable --now "$x"
done

# les vérifications qui évitent les pannes silencieuses
ME="${USER:-$(id -un)}"
if ! "$LOGINCTL" show-user "$ME" -p Linger 2>/dev/null | grep -q '=yes'; then
  warn "linger absent : sans lui, les timers s'arrêtent à ta déconnexion. Une fois, avec un compte admin : sudo loginctl enable-linger $ME"
fi
if ls /etc/systemd/system/lws-*.timer >/dev/null 2>&1; then
  warn "des timers lws-* SYSTÈME existent déjà (/etc/systemd/system) : n'active pas les mêmes ici (deux ticks = des envois en double)"
fi

say "✓ installé. Suivre : systemctl --user list-timers 'lws-*' · journalctl --user -u lws-worker -f · npm run cage"
[ ${#ENABLE[@]} -eq 0 ] && say "  rien n'est activé : relance avec --enable core (puis auto, warmup, outreach quand tu es prêt)"
exit 0
