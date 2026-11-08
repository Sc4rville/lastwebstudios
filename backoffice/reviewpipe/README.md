# reviewpipe — control station & review lab

The **control station**: the human review interface (link 4), merged into the repository. A single
`node:http` server (zero dependencies, run through `tsx`), bound to **127.0.0.1**, that serves the built sites
as live previews and exposes a thin API over the `control.md` files and the template library.

## Start
```bash
npm run backoffice          # → http://127.0.0.1:4000  (next free port if it is taken)
```

## Three pages (nav `station · lab · brain`, swipe ←→ / arrow keys)

**Station** — **live, clickable** previews of the sites in `output/sites/<id>/<date>/`, and the
**two-way** editor for `control.md`: what you write in *commentaire* is saved to the file
(only that section is touched); any change to the file (manual edit, `review:batch`, rebuild)
comes back into the UI **live** (SSE + `fs.watch`). Paste a screenshot (Ctrl-V) for visual feedback —
it lands next to `control.md` and the filler reads it as feedback.

**Lab** — template previews organised by category, **one `.md` note per template** to iterate
(in `output/lab/`, gitignored), **font pairings** (specimens from `video/fonts/`), template
excerpts, and the **area reserved for animations**.

**Brain** — the **agent's brain**: monitors the skills system as a funnel **ideas → in test →
active**. *Ideas* come from a `docs/skillstash.md` (absent from this edition: create it, one idea per line, tagged by category); "put to the test"
creates a **test-mode draft** in `.claude/skills/`. Each *skill* (`.claude/skills/`) has
a **prompt** (like a `control.md`) to request a change (to be applied later by an agent),
and skills in test have a **promote** button. You can also draft by hand. Everything is live (`fs.watch`
on `.claude/skills/`).

## Rebuild = batch (cron)
The station only writes comments. The rebuild is deferred: `npm run review:batch` scans the
`control.md` files with a non-empty comment and reruns the filler (which applies it, empties the section, bumps
the history). Schedule it with cron — see `architecture/scheduling/cron.md`. A manual **refill** button
also exists per site. The LLM work stays **in the filler**: this folder is a SCRIPT.

## Files
| file | role |
|---|---|
| `serve.ts` | the server (static routes `/preview` `/tpl` `/font`, JSON API, SSE `/events`, `fs.watch`) |
| `templates.ts` | the lab's extractors (templates, `@font-face`, excerpts, font specimens) |
| `skills.ts` | reads the brain: `.claude/skills/` skills (test/active status, feedback) + `skillstash` ideas |
| `apply-pending.ts` | the `review:batch` batch (cron): reruns the filler on pending comments |
| `public/` | the full-screen page (vanilla `index.html` + `app.css` + `app.js`, no build step) |

**Versioned** source; the outputs (`output/`, `output/lab/`) stay **gitignored**.

## Share the cockpit, or show a business owner their new site (tunnel)

The cockpit binds **127.0.0.1**; a **tunnel** relays it without changing that: `cloudflared` reaches it locally and
gives it a public https address. A teammate opens **your cockpit** (behind its password); a business owner opens
**the site you built for them** (`/preview/<prospect>/<date>/index.html`, read-only, no password).

```bash
npm run share        # the cockpit with a password + a Cloudflare quick tunnel; prints both links
```

By hand, the same thing:

```bash
# 1. the cockpit with a password, and the tunnel's domain allowed (or put both in .env)
BACKOFFICE_PASSWORD='pick-one' BACKOFFICE_ALLOWED_HOST='.trycloudflare.com' npm run backoffice
# 2. in ANOTHER terminal, the tunnel
cloudflared tunnel --url http://127.0.0.1:4000      # → https://xxxx.trycloudflare.com
```

- `BACKOFFICE_ALLOWED_HOST`: `.trycloudflare.com` (with the leading dot) allows **any** Cloudflare subdomain, handy
  because a quick tunnel's address **changes at every start**. For a **stable address**: a **named** cloudflared
  tunnel (a Cloudflare account and a DNS name), then the **exact domain**; or the always-on server (docs/GUIDE.md).
- **A password is MANDATORY** before exposing it: without `BACKOFFICE_PASSWORD` the cockpit still starts but **warns
  in red** (an external host allowed with no auth = your cockpit open to whoever has the link).
- Auth = **HTTP Basic over HTTPS** (the tunnel encrypts); the browser replays it on the preview frames and the live
  feed. Built sites (`/preview/…`) and their images stay public read-only, made to be shown.
- **Your machine must stay on** while someone looks: it is your cockpit that serves.

