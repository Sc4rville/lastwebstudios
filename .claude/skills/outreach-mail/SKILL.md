---
name: outreach-mail
description: Create ready-to-send Gmail DRAFTS for prospects (no copy-paste, no send) — verifies the REAL email + phone on the prospect's live site (Playwright), composes a personalized draft from the fiche + new-site link, and creates the draft in the operator's Gmail via the connector (MCP). Use when the operator says "create the email drafts", "crée les drafts mail", "send the outreach emails", "draft Gmail for <prospect>", "drafts for the red ♥", or wants to contact loved/selected prospects. The outreach step (distribution) after a site is composed.
user-invocable: true
argument-hint: "<prospectId | id1,id2,… | ♥1|♥2|♥3 | loved>"
license: Apache 2.0
metadata:
  status: test
---

> ⚠ **TEST MODE** — warn before use. **Creates DRAFTS** (never an automatic send) in the operator's mailbox
> → reversible (a draft can be deleted). Sending stays a human act (proofread in Gmail).

The **OUTREACH** step: a redone site is useless if it sleeps. This skill turns one (or several) prospect(s) into
**Gmail drafts ready to proofread and send** — zero copy-paste, **with the right recipient** (an email verified on
the real site, never guessed).

## ⚠ Architecture (good to know)
The **Gmail connector is tied to the claude.ai SESSION** (this agent), **NOT** to the cockpit (VM container)
nor to the worker (box). So **THIS agent creates the drafts**. The deterministic work (finding the real email,
composing) is done by a **script** (`npm run outreach`); the agent only has to push the result into Gmail via the
MCP. *(Full auto-send from the cockpit = Google OAuth on the VM server side, a separate project, not done — and a
send must stay proofread.)*

## Steps
1. **Target**: an `<id>`, a **list** `id1,id2,…`, a ♥ level (`♥1`/`♥2`/`♥3`), or `loved`
   (every `love>0`). *(Targeting by ♥ reads the DB — `DATABASE_URL` required; otherwise pass ids.)*
2. **Prepare (deterministic)**: run
   ```bash
   npm run outreach -- <target>
   ```
   The script opens each prospect's **real site** (Playwright), extracts the **real email + phone**
   (mailto/tel, Cloudflare email-protection, JSON-LD, text fallback; **domain affinity** → the prospect's address,
   not the webmaster's), composes a short draft and writes `data/outreach/<id>.json`.
   It prints **`READY_TO_DRAFT: id1,id2,…`** (verified email, ready) and **`TO CHECK (not drafted automatically): …`**
   (unconfirmed email → **we don't draft**, we flag it).
3. **Create the drafts** — for **each id in `READY_TO_DRAFT`**:
   - read `data/outreach/<id>.json` (`to`, `subject`, `body`);
   - create the draft:
     ```
     mcp__claude_ai_Gmail__create_draft({ to: [rec.to], subject: rec.subject, body: rec.body })
     ```
   - record the returned `id`: `npm run outreach:mark -- <id> <draftId>`.
4. **Do NOT draft** the `TO CHECK` ids (no verified email). Report the reason (`skipReason`) and, if the fiche has
   a candidate email, offer it for human confirmation. **Never invent an address.**
5. **Confirm**: `mcp__claude_ai_Gmail__list_drafts({ query: "subject:(refait OR refonte OR website)" })` →
   check the drafts really exist.
6. **Report** a table: prospect → email (source/confidence) · phone · site link · draft id,
   or the reason for the skip.

## Rules
- **Draft, never send.** The operator proofreads and sends from Gmail (one by one, or multi-select in Gmail).
  NEVER call a send tool.
- **A real email, verified on the site.** The script only keeps an email found on the real site
  (high/medium confidence). An email only present in the fiche, unconfirmed → **to check**, not drafted.
  Never a `contact@<domain>` put down at random.
- **The new site's link**: filled in automatically if **`OUTREACH_SITE_BASE`** is in `.env` (the public URL of the
  cockpit/preview, e.g. the cloudflared tunnel from `npm run share` or the box's domain). Otherwise the body carries
  a placeholder to complete — warn the operator.
- **Demo video in the email**: `draft.ts` records a demo (a cursor that **hovers** the interactions +
  **smooth scroll**, in a **browser mock-up**) via `design/scripts/demo-video.ts`, hosts it in the
  **Supabase bucket**, and pastes the **DIRECT link** into the body. Best-effort: needs the Supabase keys
  in the environment (present on the box; locally, configure them or run the outreach on the box). Reuses the
  video if it is already in the bucket. `OUTREACH_DEMO=0` to turn it off.
- **Multi-select** = pass a list of ids or a ♥ level; the script and the agent loop.

## Config (`.env`, optional)
- `OUTREACH_SITE_BASE` — public base of the previews → the site link is filled in automatically.
- `OUTREACH_FROM_NAME` — first name for the signature (default `[Your first name]`, or `[Votre prénom]` for a French agency).
- `DATABASE_URL` — required only to target by ♥ (otherwise pass ids).

## What it does NOT do (yet)
- Send (on purpose). Full auto-send = server-side OAuth (a separate distribution project).
- Wire in the field feedback: a `reply`/`meeting` can feed `npm run learn:record` (step 9).
