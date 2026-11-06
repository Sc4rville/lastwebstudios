**What changed, and why**

**How it was verified**

- [ ] `npm run typecheck`
- [ ] `npm test` (and `npm run test:pg` / `npm run test:e2e` when the change touches the database or the cockpit)
- [ ] a test covers the new behavior (for a bug: it fails on the old code)
- [ ] `node scripts/oss/scan.mjs .` reports nothing real
- [ ] docs updated (`docs/CONFIGURATION.md` for a variable, the folder's README for a command)
- [ ] no new way to send a mail outside `outreach/scripts/lib/smtp.ts` and the two switches
