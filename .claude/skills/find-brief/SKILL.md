---
name: find-brief
description: Turns the owner's free-text request ("20 plumbers and roofers around Austin", "a mix of trades near Lyon") into a lead-engine brief {trades, place, country, count, mix}. Run by packages/utils/run-skill.ts (role fast); the cockpit calls it from the Find prospects field.
user-invocable: false
---
See prompt.md and schema.json. The cockpit (`POST /api/brief`) calls this through `runSkill`; in the sandbox a deterministic parser (`backoffice/reviewpipe/brief.ts`) answers instead, with no model.
