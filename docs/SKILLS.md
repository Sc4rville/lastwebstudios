# Skills — index by category

Every skill **lives in `.claude/skills/`** (versioned) and is invoked from there (`/<name>`).
This doc only **lists them by category**, to spot quickly "what does what".
The method → `docs/PHILOSOPHY.md`.

**The exact count (checked by `test/docs.test.ts`)**: `.claude/skills/` holds **15 folders** =
**13 Claude Code skills** (a `SKILL.md` with frontmatter, invocable as `/<name>`) +
**2 prompt modules** (a `prompt.md` alone, run by the runner `packages/utils/run-skill.ts`:
`generate-savior`, `structuration`) +
**0 internal skills**.

The skills are written in English; the content they generate (sites, briefs, emails, call scripts) is written in the
agency's language (`agency.config.json › language`).


## Lead engine (find/qualify/read the prospects)
| skill | role |
|-------|------|
| `/structuration` *(via the runner)* | scraped raw text → a clean `ProspectSheet` fiche |
| `/find-brief` | **the search brief**: "20 plumbers and roofers around Austin" → `{trades, place, country, count, mix}` for the engine (role fast, every `LWS_LLM` way); called by the cockpit (the "Tell the agency what you're after" field); in the sandbox a deterministic parser answers |
| `/radar-industries` *(test)* | scores the **TRADES** (not the prospects) → which verticals to target, and **creates** an industry end to end (`npm run radar`); see `design/industries/RADAR.md` |
| `/visual-scoring-gate` *(test)* | the NEED axis of scoring: screenshots + LLM judge the beauty; called by `scoreProspect()` when the free gate turns a site down (`npm run gate`) |

## Design — library-first: extract → compose (see `docs/DESIGN-ENGINE.md`)
**EXTRACT** (feeds the `design/` catalogue)
| skill | role |
|-------|------|

**THINKING** (before composing)
| skill | role |
|-------|------|
| `/diagnose` *(test)* | analyses the prospect's **current site** (`avant.png` + fiche) → a **brief** (what it is / what's wrong / angle + moves) written into the fiche; the composer follows it |
| `/asset-boost` *(test)* | raises the **visual quality** before compose (upscale / relight / reframe / logo remove-bg / generated atmospheric background) via Higgsfield — **improves the real, fabricates nothing** |
| `/web-cinematics` *(test)* | the **cinematic** layer (the "$10k film on scroll"): thinking by trade → storyboard → AI key frames (GPT Image 2 for packaging) → video motion (Seedance/Kling); **generates**, where asset-boost **improves the real**; consumed by the composer |

**COMPOSE** (draws from the catalogue)
| skill | role |
|-------|------|
| `/composer` *(test)* | **free composer**: fiche + **brief** → a targeted bespoke site (latitude + mantras + verdict), no mould |
| `/frontend-design` | the **aesthetic philosophy** (anti-AI-slop) the composer follows; type/colour/motion/icons |

**GATE** (after compose)
| skill | role |
|-------|------|
| `/beauty-gate` *(test)* | a **neutral & blind** before/after judge → PASS if the new one is **clearly more beautiful**, otherwise an **automatic loopback** (recompose, cap 2: `GATE_MAX_LOOPS` in `compose-batch.workflow.js`) |

**Template-fill** (secondary route, proven)
| skill | role |
|-------|------|
| `/review` | applies the comments left in the generated sites' `control.md` |

## Distribution — show & contact
| skill | role |
|-------|------|
| `/account-research` *(test)* | intel before the call: reads our data (fiche/scoring/diagnose/competitor) + web → a **brief** + a **customised call script** → `npm run research:save` → shown in the `/outreach` CRM (the call script section) |
| `generate-savior` *(prompt.md, via a script)* | the **perfect email** (savior): a short, personalised and honest email per prospect (`npm run savior -- <id>` → `data/savior/<id>.json`), a hard-coded "zero em-dash" filter; it is step 1 of the sequencer |
| `/outreach-mail` *(test)* | targeted Gmail drafts (email verified with Playwright + **demo video link** in the email); `npm run outreach` / `:mark` |

## Learning — what the agency learns from you (D6)
| skill | role |
|-------|------|
| `/learn-taste` | **the owner's taste**: one piece of feedback on a built site (a comment, a rebuild request, a skip, a send to outreach) → 0 to 3 short, general, editable preferences ("Hero: the business's own photo, never a drawing"), or none for a one-off fix (role fast, every `LWS_LLM` way, `claude -p` on the subscription by default); called by the cockpit after each feedback (`backoffice/reviewpipe/learning.ts`), stored in `data/learning/taste.json` with their provenance; the composer and the edit agent receive the active ones; in the sandbox a deterministic distiller answers (`learning/scripts/taste.ts`) |



> A skill that complements another (e.g. impeccable's playbook) lives **in the skill's folder**
> (`.claude/skills/<skill>/`), not in `docs/`.
