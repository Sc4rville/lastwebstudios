# telegram — notification & prompt-back bot

A Telegram bot that **sends you each new build** (screenshot + clickable public link) and
lets you **reply to comment** on a site — your message lands in its `control.md`, applied at the
next `review:batch`. It is the station, in your pocket. SCRIPT (no LLM).

## Setup (2 min)
1. Telegram → **@BotFather** → `/newbot` → copy the **token**.
2. Add it to `.env` at the repository root:
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC-...
   ```
3. Start it: `npm run telegram`, then **send the bot a message**: it logs your chat id (refused) → add it to
   `TELEGRAM_ALLOWED_CHAT_IDS` in `.env` → restart. The bot is closed by default: it serves only the chats on that list.

## What it does
- **Read-only preview**: serves `output/sites/` (GET `/preview/*` only) on `:4100`, exposed through a
  **cloudflared tunnel** → link `https://…trycloudflare.com/preview/<id>/<date>/index.html`. The full
  backoffice is **never** tunnelled (its write APIs stay private).
- **Announces** each new build: screenshot (playwright) + link + `template · content`.
- **Prompt-back**: reply to a build (or just write) → the text is **added** to the
  site's `control.md` → `review:batch` (cron) applies it. Telegram = the loop's remote control.

## Dependencies
- `cloudflared` (tunnel, free, no account) in the PATH or `~/.local/bin/`. **Missing → screenshot-only**
  (notifications as images, no public link).
- `playwright` (already a dependency) for the screenshots.

State (known chats, builds already announced): `output/.telegram.json` (gitignored). The token lives
in `.env` (gitignored). None of it is versioned.
