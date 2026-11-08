# outreach · distribution (link 8, early stage)

A rebuilt site is worthless if nobody sees it. This block turns a prospect into a **Gmail draft ready to
review and send**, addressed to the **right person** (an email verified on the real site, never guessed).

## Who does what
- **Deterministic** (`scripts/`, zero LLM, zero sending): find the real contact, compose, write a
  record. That is what `npm run outreach` does.
- **Agent** (the `outreach-mail` skill, the only one holding the Gmail/MCP connector): push the record into
  Gmail as a **draft**. The Gmail connector is tied to the **claude.ai session**, not to the cockpit or the box.

## Scripts
| script | role |
|--------|------|
| `npm run outreach:contacts -- <url>` | resolves a site's REAL contact (Playwright): mailto/tel, Cloudflare email protection, JSON-LD, text fallback; **domain affinity** (the prospect's domain > free mail > webmaster); returns source + confidence. Nothing found = empty. |
| `npm run outreach -- <target>` | PREPARE: for each prospect (id \| `id1,id2` \| `♥N` \| `loved` \| `all`), checks the contact, resolves the new site's link, composes the draft, writes `data/outreach/<id>.json`. Prints `READY_TO_DRAFT` / `TO CHECK`. |
| `npm run outreach:mark -- <id> <draftId>` | writes the Gmail draft id and status back into the record (called by the skill after `create_draft`). |

## The whole flow (multi-select)
```
npm run outreach -- ♥3              # prepares every red ♥ (checks the email, composes)
→ READY_TO_DRAFT: id1,id2,…         # email verified, ready
→ outreach-mail skill: create_draft (MCP) for each ready id → Gmail drafts (never sent)
```
Or, from the cockpit: mark the prospects with ♥, then ask the agent "create the red ♥ drafts".

## Config (`.env`, optional)
- `OUTREACH_SITE_BASE` · public base of the previews (cockpit/tunnel) → the new site's link is
  filled in automatically (`<base>/preview/<id>/<build>/index.html`). Otherwise a link placeholder to fill in.
- `OUTREACH_FROM_NAME` · first name in the signature (default `[Your first name]`, `[Votre prénom]` for a French agency).
- `DATABASE_URL` · only needed to target by ♥ (otherwise pass ids).

## Guardrails
- **Never sends** (drafts only, reviewed by a human). **Never invents an email** (not verified
  on the site = not drafted, flagged). The verified contact is saved in the prospect's record (additive, reversible).
- `data/outreach/` is gitignored (transient state, rebuildable).
