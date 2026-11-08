# learning — what the agency learns, and how it gets better

> Three loops close the circle of the pipeline. Each one is **bounded** (it refines, it never replaces your judgement),
> **said in plain words** in the cockpit (« What the agency learned »), and **never claims anything on a tiny sample**.
> The scoring reads its rules, the composer and the edit agent read your preferences, the outreach drafts read the
> openings that work; none of them ever writes back (see `docs/ARCHITECTURE.md` § dependencies).

| loop | from | to | where |
|---|---|---|---|
| **Taste** | your feedback on a built site: a comment, a rebuild, a skip, a send to outreach | short, editable **preferences** the next builds and edits apply, and each site says which it applied | `scripts/taste.ts`, `.claude/skills/learn-taste/`, `data/learning/taste.json` |
| **Picks** | sales outcomes: reply, meeting, won, lost | which prospects are worth building first (the trade's value in the scoring) | `scripts/record.ts`, `scripts/learn.ts`, `rules/rules.json`, `scripts/picks.ts` |
| **Words** | which first email / call opening got replies or meetings | the next drafts lean on the winner, bounded, explained | `scripts/words.ts`, `data/savior/<id>.json › angle`, `data/learning/words.json` |

## Taste — your feedback becomes preferences (decision D6)

```
  a site ── comment / rebuild request / skip / send to outreach
     │
     ▼ distilled : the learn-taste skill (role fast, any LWS_LLM way : `claude -p` on your subscription by default) ;
     │             in the sandbox a deterministic distiller (the RULES of scripts/taste.ts), no model
  data/learning/taste.json ── preferences with their provenance (which site, which words), a confidence that grows each
     │                         time you say it again (count / (count + 2)), an on/off switch, the feedback log (undo)
     ▼ the ACTIVE ones : on, the most confident first, at most 10
  composer (compose-batch.workflow.js › args.preferences : the worker, the built-in engine, the Workflow and local
  engines, first-site, the sandbox's builds) · edit agent (worker/edit-worker.md)
     │
     ▼ each built site records which preferences it applied : .lws-taste.json next to its index.html, the line
       `- preferences : p-…` of its control.md, first-site.json › preferences
```

- **General, never a one-off fix.** « Put their own photo in the hero, not a drawing » becomes *Hero: the business's
  own photo of their work, never a drawing or a stock image*; « fix the typo in the phone number » teaches nothing.
- **Recurrence.** Said again (same rule, or the skill says it is the same as an existing one) → one more source, the
  count and the confidence go up. Said the opposite (dark pages after light pages) → the older one is switched off,
  said in « I'll remember: … Instead of: … », and comes back if you undo.
- **Your clicks, carefully.** What you send to outreach, skip or rebuild is kept with each site's traits (light or
  dark, photo or type hero). A trait becomes a preference only after **5 decisions** that agree (3 in 4), **with a
  contrast** (sites of the other kind were shown too), and **never against a preference you said** in words.
- **Safety.** A preference's words came from a person and go into the prompt of an agent that has tools: they are
  fenced as data (`<owner_preferences>`), one clean bounded line each, valid ids only, at most 10; the agent is told
  they never override the rules (real content only, the site's language, the checks) and never ask to run anything.
- **The 24/7 worker on another machine** reads the active preferences from the shared database (`meta ›
  learning.taste`, mirrored by the cockpit) when it is newer than its own file.

## Picks — which prospects answer (the scoring rules)

1. **Record an outcome** — `npm run learn:record -- <id> <won|lost|reply|meeting|sent> [industry]`. Automatic: the
   sequencer writes `sent` at the first real email (never in test mode) and `reply` at the answer; the CRM writes
   `meeting`, `won` and `lost`. One line in `data/outcomes.jsonl` (+ a mirror in the database), with the features the
   scoring saw (axes, signals).
2. **Recompute the rules** — `npm run learn` (nightly timer), and **at once** after each outcome the cockpit records
   (`refreshRules`). **One trial per prospect**: its final state (won/lost > meeting > reply > sent).
3. **The scoring applies them** at its next run (`scripts/rules.ts › loadRules`, the only bridge learning → scoring).

| learned | source | effect | guard |
|---|---|---|---|
| ticket value per trade | the trade's real conversion vs the average | delta on the `value` baseline | bounded **±15**, shrunk by `n/(n+8)` |
| weight of the free signals | lift of a signal (present vs absent) on conversion | multiplier of its bonus | bounded **0.5–1.5**, shrunk by `min(n)/(min(n)+5)` |

In the cockpit (`scripts/picks.ts`): « Roofers answer 3× more often than pool builders (6 of 10 roofers answered, 2 of
10 pool builders) », « Roofers are picked first now » only when the rules file really moves them, and below **5
businesses per trade** one line says how many there are and how many it takes. No rules file (fresh clone) → `{}` →
the scoring runs exactly on its human baselines: the loop can never break the gate.

## Words — which opening gets answers

Each first email records its opening (`data/savior/<id>.json › angle`: « It's already built », « More calls from
phones », « Your work deserves it »), each lead on the call list gets one call opening (`data/learning/words.json`:
« I built you a new site », « Customers on a phone », « What is a new customer worth? »). Replies (email) and meetings
(call) are counted per opening. The next drafts take each opening **in turn** until every one has **5 tries**, then
**lean on the winner** (ahead by 10 points, at least 2 wins) for **6 in 10** of the next ones; the others keep going out
so the comparison stays honest. Each choice carries its reason (`angleWhy`, `callAngle.why`).

## The design scores (0–100 gauges)

Next to the sales loop, `npm run learn:weights` aggregates the operator's 0–100 scores per axis (`generations.
scores_json`) into `data/learning/weights.json` (averages and n per axis, template, industry; `byFont` reserved). A
mirror, not a decision maker: the taste loop above is what reaches the composer today.

## The cockpit's API (backoffice/reviewpipe/learning.ts)

- `GET /api/learning` — `{ summary, active, preferences[], picks{items, note, total}, words{email, call} }`, every item
  a plain sentence with its evidence and sample size.
- `GET /api/learning/site?id&date` — « Built with 3 of your preferences » and which (plus the skipped ones and why).
- `POST /api/learning/feedback {id, date?, kind, text}` — « I'll remember: … » + an undo id (no edit job).
- `POST /api/learning/undo {undo}` · `POST /api/learning/preference {id, on}` / `{id, text}` / `{id, delete: true}` /
  `{text}` · `DELETE /api/learning/preference?id=`.
- `POST /api/refill` (Apply a comment), `POST /api/status` (with an optional `reason`) and `POST /api/batch` (a rebuild,
  with an optional `feedback`) answer `remember` too. With the skill, `remember.pending` is true and the preferences
  arrive over SSE: `{type: "learning", undo, remember}`.

## Files

- `scripts/types.ts` — outcomes, weights, the rules' shape (the shape belongs to the scoring).
- `scripts/record.ts` — records an outcome (`npm run learn:record`).
- `scripts/learn.ts` — recomputes the rules + report (`npm run learn`, `refreshRules()`); `buildRules()` is pure.
- `scripts/rules.ts` — `loadRules()`, read by the scoring.
- `scripts/taste.ts` — the preferences: deterministic distiller, store, prompt block, a site's record, the database mirror.
- `scripts/picks.ts` — the picks in plain sentences (the n < 5 guard).
- `scripts/words.ts` — the openings: stats, the bounded choice, the sentences, the call openers.
- `scripts/weights.ts` — the design scores (`npm run learn:weights`).
- Generated (gitignored): `rules/rules.json`, `analysis/report.md`, `data/outcomes.jsonl`, `data/learning/taste.json`,
  `data/learning/words.json`, `data/learning/weights.json`.
