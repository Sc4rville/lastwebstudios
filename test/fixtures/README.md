# Test fixtures

Everything here is **fictional and made from scratch** (night of 2026-10-24): no real business, person, address, photo or
capture. Phone numbers in the ARCEP ranges reserved for fiction (`01 99 00 …`, `02 61 91 …`,
`03 53 01 …`), emails on `.example` (RFC 2606), SIREN numbers as `0000000xx`, made-up towns. Reusable by
the tests, the demos and the open-source edition's sandbox.

| folder | content | used by |
|---|---|---|
| `bin/claude` | **fake** `claude` (Claude Code CLI): `json` and `stream-json` output, `FAKE_CLAUDE_LOG` log, simulated plan limit, interrupted composer build (`FAKE_CLAUDE_MKDIR`) | every test that goes through the plan path or the worker |
| `bin/codex` | **fake** `codex` (Codex CLI): `login status`, `exec` answering with the fake `claude`'s data, `FAKE_CODEX_LOG` log | the codex path tests |
| `sites/orvane-piscines/` | the dated **old site** (2014-2016) of the fictional prospect "Orvane Piscines": tables, scrolling banner, a fake local jQuery 1.x, no viewport, © 2016, 8 home-made SVG illustrations, portfolio and contact pages | score, parse, pipeline, first-site (WP2) |
| `sites/empty-site/` | an almost empty page **with no contact at all** | reachability gate |
| `sirene/` | simulated answers from the Recherche d'entreprises API (ceased namesake, true namesake, same name other town) | company, score, pipeline |
| `seeds/orvane.seed.csv` | pipeline seed in the `name,city,website,phone,industry,email` format | pipeline |
| `scores/` | real scorer output (`npm run score`, `VISUAL=0`, no SIREN) on the two sites above | demos, Machine view (WP3) |
| `workspace/agency/` | a miniature agency to copy over a workspace: 3 `ProspectSheet` records (pool builder, carpenter, kitchen designer without an email), a composer site and a template-fill site already built, assets | cockpit, CRM, sequencer, worker, Telegram |

The fixture content itself (French businesses, sites and copy) is French on purpose: it is the French demo's fiction.

Regenerate `scores/`: serve `sites/<x>/` on a local port, then
`LWS_SIRENE=0 VISUAL=0 npx tsx leadengine/2_scoring/scripts/score.ts <id> http://127.0.0.1:<port>/ [trade]`
in a throwaway folder (the score is written to `data/raw/<id>.score.json`).
