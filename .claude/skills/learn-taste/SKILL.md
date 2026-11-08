---
name: learn-taste
description: Distils one piece of the owner's feedback on a built site (a comment, a rebuild request, a skip, a send to outreach) into short, general, editable taste preferences ("Hero: the business's own photo, never a drawing"), or none when it is a one-off fix. Run by packages/utils/run-skill.ts (role fast, every LWS_LLM way, `claude -p` on the subscription by default); the cockpit calls it after each feedback (backoffice/reviewpipe/learning.ts).
user-invocable: false
---
See prompt.md and schema.json. The cockpit stores what it returns in data/learning/taste.json (with the site and the words it
came from, a confidence that grows each time it is said again, an on/off switch); the composer and the edit agent receive the
active preferences in their prompts. In the sandbox a deterministic distiller answers instead (learning/scripts/taste.ts ›
distillRules), with no model.
