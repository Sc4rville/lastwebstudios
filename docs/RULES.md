# Project rules

## Rule 1 — Keep the repository clean

Everyone tidies after their own work.

- the root holds only relevant files and folders: no install residue, exports or drafts;
- **generated** files (scraped assets, captures, builds, sheets, plans, logs) stay out of git (`.gitignore`);
- a folder exists only when it serves; no empty folder "just in case";
- temporary work files are deleted at the end of a task.

## Rule 2 — Naming and layout

Everything is sorted by **nature**, and names say what the thing does.

- **`scripts/`** = mechanics, no model call. One script is one `.ts` file named by a **verb**: `parse.ts`, `score.ts`.
- **`.claude/skills/`** = judgment, one model call. One skill is a **folder** named by its **job**, in two forms:
  - `SKILL.md` with a frontmatter (`name`, `description` = what and when, `user-invocable`): invocable as `/<name>`,
    used by the agents (`composer`, `diagnose`, `beauty-gate`, `account-research`…);
  - `prompt.md`, optionally with a `schema.json`: called by a script through `packages/utils/run-skill.ts`, named
    inputs, strict JSON output (`structuration`, `generate-savior`…).
- **Data** lives in `data/`, never inside a block: `raw/`, `assets/`, `prospects/`, `sequencer/`, `logs/`.
- Code file and folder names: lowercase, kebab-case, no spaces, no accents.

## Rule 3 — One README per folder

The explanation of a folder lives in its `README.md`, not in a file with an invented name. Documentation is
written in English, and so are the user interface, the logs, the code comments and the skills; the copy the
product generates for a business (sites, emails, call scripts) is in the agency's language (`agency.config.json ›
language`).

## Rule 4 — Docs stay compact

Readable at once: **tables over paragraphs**, short lists, the essential. A document that does not fit on a
screen has missed its goal.

## Rule 5 — Docs tell the truth

A document that lies sends the next person the wrong way. Every variable the product reads is in
`docs/CONFIGURATION.md` and, commented out, in `.env.example`; every command is in its folder's README; every
number comes from a run or from the code. `test/docs.test.ts` checks the skill count and the judge cap against the
code. Update the doc in the same commit as the change.

## Rule 6 — Professional tone

Several people read these documents. Affirmative sentences (say what the thing does), no slang, no decorative
emoji. Professional does not mean verbose (Rule 4).

## Rule 7 — Fictional data only

Anything added as an example, fixture or sample is invented: businesses, people, towns, `.example` domains
(RFC 2606), French phone numbers in the ARCEP ranges reserved for fiction, artwork made from scratch.
`node scripts/oss/scan.mjs .` must report nothing real; CI runs it.

## Rule 8 — The cage is not negotiable

No code path sends a mail outside `outreach/scripts/lib/smtp.ts` and the two switches (`config.dryRun: false`
and `LWS_LIVE_SEND=1`). STOP, the daily budget, the breaker, the locks and the opt-out registry are not weakened
to make a feature easier.
