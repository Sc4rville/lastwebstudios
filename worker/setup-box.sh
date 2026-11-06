#!/usr/bin/env bash
# setup-box.sh — installe LE WORKER sur la box (Hetzner). À lancer EN SSH sur le serveur, une fois.
#
# Idempotent : relançable sans casse. Fait : Node + Claude Code + le repo + Playwright + le service
# systemd. La SEULE étape interactive qui reste de TON côté : `claude setup-token` (le token du PLAN)
# et coller DATABASE_URL — le script te guide.
#
#   ssh root@<IP-de-la-box>
#   # (récupère le repo une 1re fois pour avoir ce script, ou copie-le)
#   git clone https://github.com/<toi>/lastwebstudios.git ~/lws && cd ~/lws
#   bash worker/setup-box.sh
#
set -euo pipefail

LWS_DIR="${LWS_DIR:-$HOME/lws}"
REPO="${LWS_REPO:-https://github.com/<toi>/lastwebstudios.git}"
NODE_MAJOR="${NODE_MAJOR:-24}"

say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()  { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn(){ printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }

# ── 1. Node ───────────────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]; then
  say "Installation de Node $NODE_MAJOR (NodeSource)…"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
ok "Node $(node -v) · npm $(npm -v)"

# ── 2. Claude Code (la CLI) ─────────────────────────────────────────────────────
if ! command -v claude >/dev/null 2>&1; then
  say "Installation de Claude Code…"
  npm install -g @anthropic-ai/claude-code
fi
ok "Claude Code : $(claude --version 2>/dev/null || echo 'installé')"

# ── 3. Le repo ──────────────────────────────────────────────────────────────────
if [ ! -d "$LWS_DIR/.git" ]; then
  say "Clone du repo dans $LWS_DIR…"
  git clone "$REPO" "$LWS_DIR"
else
  say "Mise à jour du repo ($LWS_DIR)…"
  git -C "$LWS_DIR" pull --ff-only || warn "git pull non fast-forward — à régler à la main"
fi
cd "$LWS_DIR"

say "npm install…"
npm install

# ── 4. Playwright + navigateurs (le scraping / avant.png) ───────────────────────
say "Playwright + Chromium (+ deps système)…"
npx playwright install --with-deps chromium

# ── 5. .env (DATABASE_URL + token plan + clé API) ───────────────────────────────
if [ ! -f "$LWS_DIR/.env" ]; then
  say "Création de $LWS_DIR/.env"
  cat > "$LWS_DIR/.env" <<'EOF'
# Le pooler Supabase (IPv4) — Supabase → Settings → Database → Connection pooling (session mode)
DATABASE_URL=postgresql://postgres.<ref>:MOT_DE_PASSE@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
# Le token du PLAN (généré par `claude setup-token`) — fait tourner le composer sur l'abonnement, pas l'API
CLAUDE_CODE_OAUTH_TOKEN=
# La clé API — pour l'extraction cheap (structuration) que le composer relance ; négligeable
ANTHROPIC_API_KEY=
EOF
  warn "Édite $LWS_DIR/.env : colle le vrai DATABASE_URL, la clé API, ET le token plan (étape 6)."
else
  ok ".env déjà présent (non écrasé)"
fi

# ── 6. Le token du PLAN (interactif — TON étape) ────────────────────────────────
if ! grep -q '^CLAUDE_CODE_OAUTH_TOKEN=.\+' "$LWS_DIR/.env" 2>/dev/null; then
  warn "Token plan manquant. Lance :   claude setup-token"
  warn "puis colle la valeur dans $LWS_DIR/.env  →  CLAUDE_CODE_OAUTH_TOKEN=..."
  warn "(c'est ce qui fait tourner la génération SUR LE PLAN et pas sur l'API au token)"
fi

# ── 7. Service systemd utilisateur ──────────────────────────────────────────────
say "Installation du service systemd (lws-worker)…"
mkdir -p "$HOME/.config/systemd/user"
# WorkingDirectory adapté au vrai chemin du repo
sed "s|WorkingDirectory=%h/lws|WorkingDirectory=$LWS_DIR|; s|%h/lws/.env|$LWS_DIR/.env|" \
  "$LWS_DIR/worker/lws-worker.service" > "$HOME/.config/systemd/user/lws-worker.service"
loginctl enable-linger "$USER" 2>/dev/null || warn "enable-linger a échoué (le service ne survivra pas au logout) — relance en root si besoin"
systemctl --user daemon-reload

ok "Installé. Une fois le .env complété (DATABASE_URL + CLAUDE_CODE_OAUTH_TOKEN) :"
cat <<EOF

  systemctl --user enable --now lws-worker     # démarre + au boot
  systemctl --user status lws-worker           # vérifier qu'il tourne
  journalctl --user -u lws-worker -f           # suivre les logs en direct

Test rapide : depuis le cockpit, clique « lancer un batch » → le worker doit le dépiler ici.
EOF
