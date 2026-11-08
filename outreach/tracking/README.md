# Self-hosted outreach tracking (click + one-click unsubscribe)

The **cockpit** (`npm run backoffice`, `backoffice/reviewpipe/serve.ts`) serves the tracking itself under `/t/`.
There is no Supabase edge function any more: it was not versioned and had been answering 402 since the quota freeze.

```
email (sequencer)                       cockpit, public, no password                    sequencer (tick)
  rewritten link ───── click ─────────▶ GET  /t/c/<token>  → click event + 302 ─────┐
  List-Unsubscribe ─── Gmail button ──▶ POST /t/u/<token>  → unsub event           ├─▶ outreach_events (database)
  "one click is enough" footer ─ link ▶ GET  /t/u/<token>  → page + button (POST)  │   or data/sequencer/events.jsonl
                                                                                    └─▶ click = escalation unlocked
                                                                                        unsubscribe = exit
```

## The tokens (`links.ts`, pure computation)
- **click**: `/t/c/<id22>.<base64url url>.<16-char signature>`. The destination URL is **inside** the token and
  **signed** (HMAC-SHA256 of `trackingId + url`, `LWS_TRACK_SECRET`). So the cockpit only redirects to
  URLs it put in an email itself (audit finding F-3: no more open redirect through `?u=`).
- **unsubscribe**: `/t/u/<id22>.<16-char signature>`. The signature carries a type prefix: a click token is
  not an unsubscribe.
- `id22` = the send's `trackingId` (UUID, `data/sequencer/sends.jsonl`) in base64url, validated when decoded.

## The endpoint (`endpoint.ts`)
| request | response |
|---|---|
| valid `GET /t/c/<token>` | `302` to the signed URL + a `click` event (a scanner user agent → `suspect`, ignored by the escalation) |
| `HEAD /t/c/<token>` | `302` with no event (mail gateways probe with HEAD) |
| forged / malformed token / `?u=…` | `403` / `400`, no redirect, nothing recorded |
| `GET /t/u/<token>` | a **confirmation** page with a button: nothing is recorded (a scanner unsubscribes nobody) |
| `POST /t/u/<token>` + `List-Unsubscribe=One-Click` | an `unsub` event (RFC 8058: Gmail's / Yahoo's native button); body > 1 KB → `413` |
| no `LWS_TRACK_SECRET` | `404`: nothing can be verified, so nothing is tracked or redirected |

Caps (`events.ts`, `CAPS`): 20 events of one type per send, user agent and URL truncated, fallback file
capped at 20 MB. Beyond that: refused without an error. A click that arrives less than 60 s after the send is counted as a
scanner by the sequencer.

## The email (`outreach/scripts/lib/smtp.ts`)
`buildMessage()` builds the **complete** message, identical in dry-run and for real: rewritten links, a legal footer
with the unsubscribe link, the headers `List-Unsubscribe: <https…>, <mailto:…>` and
`List-Unsubscribe-Post: List-Unsubscribe=One-Click`. In dry-run, the sequencer writes it as an `.eml` in
`data/sequencer/outbox/`: what you review is exactly what would go out.

## Setting it up
```bash
# on the cockpit AND on the sequencer's machine (the same secret)
TRACK_BASE=https://cockpit.agency.example      # the cockpit's public URL (https in production)
LWS_TRACK_SECRET=$(openssl rand -base64 48)    # ≥ 32 characters
```
If either is missing: no link is rewritten, unsubscribing is by replying "STOP" + the `mailto:` header only.
With a database (`DATABASE_URL`), the cockpit and the sequencer share the `outreach_events` table (`db/schema.sql`);
without one (everything on one machine), they share `data/sequencer/events.jsonl`.

## Proof
`test/outreach/tracking.test.ts` (tokens, caps, RFC 8058) and `test/funnel.e2e.test.ts` (the film's funnel
end to end: signed click → escalation unlocked, one-click unsubscribe, F-3, 0 calls to the transport in dry-run).
