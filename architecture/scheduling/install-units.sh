#!/usr/bin/env bash
# install-units.sh — installs the 24/7 machine's systemd USER units (see cron.md, docs/GUIDE.md §8).
#
# Copies the repo's units into ~/.config/systemd/user/ (LWS_UNIT_DIR for another folder), reloads systemd,
# then enables ONLY the groups asked for. Nothing sends email while LWS_LIVE_SEND=1 stays commented out
# in the unit concerned (warmup, sequencer): this script never uncomments it.
#
#   architecture/scheduling/install-units.sh                     # installs everything, enables nothing
#   architecture/scheduling/install-units.sh --enable core       # worker + Station + nightly learning
#   architecture/scheduling/install-units.sh --enable core --enable auto   # + the nightly composer batch
#   architecture/scheduling/install-units.sh --dry-run --enable core       # says what it would do, touches nothing
#
# Groups (--enable, repeatable):
#   core      lws-worker.service · lws-cockpit.service · lws-learn.timer
#   auto      lws-batch.timer (one composer batch per night, LWS_BATCH_SIZE / LWS_BATCH_ARGS) · lws-scrape.timer
#   warmup    lws-warmup.timer (dry-run while LWS_LIVE_SEND=1 is commented out in lws-warmup.service)
#   outreach  lws-sequencer.timer (the same: dry-run + two keys for a real send)
#   review    lws-review.timer (pending control.md comments) · pipeline: lws-pipeline.timer — the template-fill path,
#             PRIVATE EDITION only (not in the open source edition: the composer builds through lws-batch.timer)
#   telegram  lws-telegram.service (review bot, closed by default: TELEGRAM_ALLOWED_CHAT_IDS)
#
# Guardrails: refuses root (the worker runs agents with Bash: a dedicated user, see GUIDE §4; LWS_ALLOW_ROOT=1
# to force it); flags a repo somewhere other than ~/lws (the units say %h/lws), a missing linger (the timers would
# not run without an open session) and SYSTEM lws-* timers already present (two timers = two sends).
# SYSTEMCTL / LOGINCTL: the binaries to use (tests). Idempotent: safe to run again.
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
    --enable) [ $# -ge 2 ] || { echo "✗ --enable <group>" >&2; exit 64; }; GROUPS_ON+=("$2"); shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "✗ unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

say()  { printf '%s\n' "$*"; }
warn() { printf '⚠ %s\n' "$*"; }
run()  { if [ "$DRY" = 1 ]; then say "  (dry-run) $*"; else "$@"; fi; }

if [ "$(id -u)" = 0 ] && [ "${LWS_ALLOW_ROOT:-0}" != 1 ]; then
  echo "✗ refusing to run as root: create a dedicated user (sudo adduser --disabled-password lws) and run this script as that user." >&2
  echo "  (the worker gives Bash to agents: as root, they own the machine. LWS_ALLOW_ROOT=1 to override.)" >&2
  exit 77
fi

# the shipped units (lws-sync.* belongs to the team's own box: not here)
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
    review|pipeline) # the template-fill path (private edition): units absent from the open source edition
      [ -e "$REPO/architecture/scheduling/lws-$1.timer" ] || { echo "✗ group $1: the template-fill path, absent from this edition (the composer builds through lws-batch.timer)" >&2; return 1; }
      echo "lws-$1.timer" ;;
    telegram) echo "lws-telegram.service" ;;
    none) echo "" ;;
    *) return 1 ;;
  esac
}
ENABLE=()
for g in "${GROUPS_ON[@]+"${GROUPS_ON[@]}"}"; do
  u="$(group_units "$g")" || { echo "✗ unknown group: $g (core | auto | warmup | outreach | review | pipeline | telegram)" >&2; exit 64; }
  for x in $u; do ENABLE+=("$x"); done
done

say "▶ lastwebstudios units → $UNIT_DIR (${#UNITS[@]} files)"
[ "$REPO" = "$HOME/lws" ] || [ "$(readlink -f "$HOME/lws" 2>/dev/null)" = "$REPO" ] || \
  warn "the repo is in $REPO, the units expect it in ~/lws: ln -s \"$REPO\" ~/lws"
run mkdir -p "$UNIT_DIR"
for f in "${UNITS[@]}"; do run cp "$f" "$UNIT_DIR/$(basename "$f")"; done
run "$SYSTEMCTL" --user daemon-reload

for x in "${ENABLE[@]+"${ENABLE[@]}"}"; do
  if [ "$x" = lws-warmup.timer ] || [ "$x" = lws-sequencer.timer ]; then
    say "  $x: in DRY-RUN (nothing goes out) while Environment=LWS_LIVE_SEND=1 stays commented out in ${x%.timer}.service"
  fi
  run "$SYSTEMCTL" --user enable --now "$x"
done

# the checks that prevent silent failures
ME="${USER:-$(id -un)}"
if ! "$LOGINCTL" show-user "$ME" -p Linger 2>/dev/null | grep -q '=yes'; then
  warn "linger missing: without it, the timers stop when you log out. Once, with an admin account: sudo loginctl enable-linger $ME"
fi
if ls /etc/systemd/system/lws-*.timer >/dev/null 2>&1; then
  warn "SYSTEM lws-* timers already exist (/etc/systemd/system): do not enable the same ones here (two ticks = duplicate sends)"
fi

say "✓ installed. Follow: systemctl --user list-timers 'lws-*' · journalctl --user -u lws-worker -f · npm run cage"
[ ${#ENABLE[@]} -eq 0 ] && say "  nothing is enabled: run again with --enable core (then auto, warmup, outreach when you are ready)"
exit 0
