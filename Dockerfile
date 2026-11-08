# Backoffice (cockpit de review) — image pour Hetzner/Coolify.
# Ne fait tourner QUE le serveur de review (pas Playwright/screenshots → image légère).
# Le pipeline lourd (scrape/score/compose) se lance à part (cron / commande), pas dans cette image.
FROM node:24-slim

WORKDIR /app

# Playwright est une dépendance du repo mais le cockpit n'a pas besoin des navigateurs → on saute le download
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY . .

# bind 0.0.0.0 pour être joignable par le proxy de Coolify (sinon loopback = injoignable)
ENV BACKOFFICE_HOST=0.0.0.0
ENV BACKOFFICE_PORT=4000
EXPOSE 4000

CMD ["npx", "tsx", "backoffice/reviewpipe/serve.ts"]
