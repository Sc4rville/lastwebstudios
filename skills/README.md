# skills/

A **skill** is encapsulated know-how that costs an LLM call: a folder with a `prompt.md`, run by
`packages/utils/llm.ts`. Anything deterministic is a **script**, not a skill — that split is the one rule
of the codebase, so you always know which steps cost money.

| skill | task class | input → output | public here |
|---|---|---|---|
| `structuration` | extract | raw site text → structured content of the ProspectSheet | condensed prompt |
| `copywriter` | design | sheet + industry profile → framing copy of the demo | condensed prompt |
| visual gate | extract | screenshots of a "technically fine" site → visual need 0–100 | described only |
| diagnose | design | current site + sheet → a design brief (what it is, what's wrong, the angle) | described only |
| composer | design | brief + design catalog → a bespoke page | described only |
| beauty gate | design | before/after, judged blind → pass, or back to the composer | described only |
| distill | strategy | human corrections → durable rules, design mantras, new skills | described only |

The prompts published here are short, working versions written for this repository. The production
prompts of the atelier stay private.

Offline, every skill is answered from `demo/replay/<skill>/<prospect-id>.json`; with `LLM_API_KEY` set,
the same code calls any OpenAI-compatible endpoint, meters the spend and honours the budget ceilings.
