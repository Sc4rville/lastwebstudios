---
name: review
description: Applies the comments the operator left in the control.md files of generated sites (lastwebstudios). Scans output/sites/**/control.md, takes each non-empty comment into account, carries it out by planning intelligently and re-running the filler (which passes the comment as feedback), logs a skill in skillstash if a capability is missing, then empties the comment section while keeping the history. Use it when the user says "apply the comments", "applique les commentaires", "process the control.md files", "review the sites", or after annotating a generated site.
user-invocable: true
---

# /review — the per-site feedback loop (lastwebstudios)

Each generated site carries a **`control.md`** (written by the filler): metadata (template, generation time) +
**latest changes** (the `## dernières modif` section) + a **comment** section (`## commentaire`). The operator writes
in the comment section what they want changed on that site. This skill processes those comments. (The section
headings are a file format read by `packages/shared/control.ts`: keep them exactly as they are.)

## Steps

### 1 · Scan
List the `output/sites/**/control.md` files whose `## commentaire` section is **not empty**
(ignore the `<!-- … -->` help line). No comment → nothing to do.

### 2 · For each comment
1. **Read** the comment + the metadata (`id`, `template`).
2. **Plan**: can the comment be done by **re-running the filler**? The filler automatically re-reads the comment
   and passes it as `feedback` to the skill — so for anything about **content / mapping / photos / sections**, a
   re-run is enough. Otherwise, identify the right action (switch template, a targeted HTML edit…).
3. **Missing capability?** If the comment asks for something the pipeline can't do yet (a new kind of section, an
   effect, a data source, an image touch-up…) → **add a line to `docs/skillstash.md`** (the idea + the signal) and
   **do your best** with what exists.
4. **Carry it out**:
   - filler case: `npm run fill -- <id> <template>` — the filler applies the comment, records it under the
     latest changes, and **empties** the comment section. Nothing else to do on the `control.md` side.
   - non-filler case: carry out the action, then update `control.md` by hand (add a latest-changes line describing
     what was done, **empty** the comment section).
5. **Check**: a screenshot of the site (Playwright) — it is indeed the prospect, and the comment has been taken
   into account.

### 3 · Report
Per site: the comment processed, what was applied, and the skills logged in `skillstash` if any.

## Rules
- **The comment is king**: we apply it, we don't water it down.
- **Always finish** with the comment section **empty** and **one line added** to the latest changes.
- Only touch sites whose comment is not empty. Keep the history (last 3 lines).
- A capability that comes back ≥ 2 times in the comments → a real skill candidate (`skillstash`).
