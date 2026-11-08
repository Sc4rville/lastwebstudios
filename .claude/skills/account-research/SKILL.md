---
name: account-research
description: Researches a prospect (company/person) and produces an actionable sales BRIEF + a customised CALL SCRIPT, wired to the lastwebstudios /outreach CRM. Use when the operator says "/account-research <id>", "research <company>", "intel on <prospect>", "who is <name> at <company>", "prepare the call for <id>", "look into <prospect>".
user-invocable: true
argument-hint: "<prospect-id> | <company name> | <url> | <person> at <company>"
license: Apache 2.0
metadata:
  status: test
---

# account-research — the intel before the call (distribution step)

Gives a complete picture of a prospect BEFORE calling them, and **produces the call script** the operator reads in
the CRM. Works standalone (web search); **much better** when wired to our data (fiche, scoring, diagnose, outreach
record) and the shared bucket/DB.

> **Our prospects = local small businesses** (pool builders, landscapers, wedding venues, kitchen makers,
> tradespeople), not scale-ups. So "key people" = the **owner/manager**; "news" = recent local activity, Google
> reviews, new jobs/showroom; "angle" = the **SEO gap** + the **competitor proof** + our promise (a site that WINS
> jobs). Adapt the generic B2B brief to that reality — don't over-format.

## Language
Brief and call script in the agency's language (`agency.config.json › language`; default French). In English, the script keeps the same structure ("CALL 0 — {business}", opener, proof, ask), with native sentences: "Hi, this is [your name] at [studio]. I'm calling because I've just built a website for [business] and wanted to show it to you."; local proof: "We already work with a few [trade]s around here."; closing: "Thirty seconds, I'll be quick." Never a word-for-word translation of the French script.

## Steps

### 1. Target
- **An `<id>` we know** (e.g. `orvane-piscines-valmont-sur-lys`, `atelier-brisane-sornac-le-haut`) → the standard case (a CRM lead).
- Otherwise: a **company name / a URL / a person** → generic research.

### 2. Our data FIRST (free, reliable, already there)
For an `<id>`, read before any web search:
- **Fiche** `data/prospects/<id>.json` (or the DB fallback `prospects.sheet_json`): identity (name, town, phone,
  email), existing site (`existing.url`), **diagnose brief** (what's wrong / angle), **scoring** (tier, axes).
- **Outreach record** `data/outreach/<id>.json`: **`competitor` (proof)**, **`seoIssue`**, verified email.
- (Optional) the composed site `output/sites/<id>/…` to recall what we are offering them.
These facts are the backbone of the brief and the script — the web search ENRICHES them, it doesn't replace them.

### 3. Web search (always)
- `"<name> <town>"` → site, Google Business Profile, presence.
- `"<name>" reviews` / Google reviews → reputation, review volume, sore points.
- `"<name>" news|job|project|hiring` → recent signals (90 days).
- `"<owner>" <name>` / LinkedIn → the person to talk to, their background.
- the **current site** (already diagnosed) → confirm the precise SEO gap.
For a bigger company: add funding/headcount/tech stack/key people (see the generic format below).

### 4. Synthesis → BRIEF + CALL SCRIPT
Produce **two things**:
1. **Brief** (short, actionable): who they are · why they need us · **the best angle** ·
   who to talk to · 2-3 recent signals · concerns/unknowns to dig into during discovery.
2. **Call script** (to READ during the call) — FOLLOW the agency's SALES SCRIPT (PDF in `docs/`), customised
   for THIS prospect:
   - **PITCH** (French agency, the script's own words): « Bonjour, [prénom] à l'appareil, directeur commercial chez
     lastwebstudios. Je suis bien avec [interlocuteur] ? Je vous contacte parce que j'ai créé mon agence de web design
     et on travaille avec pas mal de vos confrères dans le secteur [métier]. On leur permet d'augmenter leur taux de
     conversion de +7 %. J'ai jeté un œil au vôtre et je me suis permis de vous en développer un nouveau. Quand
     auriez-vous 10 min en visio pour que je vous le présente ? » (inject the contact + trade; add the SEO gap if
     relevant). In another language, write the native equivalent with the same moves (who you are, the trade
     peers, the result, the site already built, ask for 10 minutes on video).
   - **Objections: the CRAC method** (Dig → Rephrase → Argue → Check) — DIG first (get them talking).
     Cover the doc's 3 objections with their questions: "we already have a site", "it's too expensive", "not the
     right time". Keep it **spoken, short, in the agency's language, zero jargon**. (The cockpit already shows this
     base; you SHARPEN it.)

### 5. Persist → the CRM shows it (the bridge)
Write `data/research/<id>.json` (include the **decision-maker**: name `contact` + URL `linkedin`):
```json
{ "callScript": "CALL 0 — …\n\n…", "research": { "brief": "…", "angle": "…", "contact": "<owner/manager>", "linkedin": "https://www.linkedin.com/in/…", "people": "…", "news": ["…"] } }
```
> **Decision-maker**: find the owner/manager (LinkedIn, company registries such as Pappers/societe.com in France) →
> `contact` (name) + `linkedin` (profile URL, or failing that the company's LinkedIn page). Never invented; nothing
> reliable = empty.
then run **`npm run research:save -- <id>`** → upsert into `crm_leads` (shared DB) → the script + the brief
appear on the lead's card in **`/outreach`** (the call script section), locally AND on the box.
*(Without a known `<id>` — generic research — just show the brief + the script on screen, no persistence.)*

### 6. Report
Show the brief + the script in plain text, say they are saved (visible in the CRM), and the next step
(call from the Hot Lead column, read the script, then reach/unreach/meeting).

## Pipeline integration (see `/new-step`)
- **Thinking** (LLM + web) → it is a **skill** (here). The **mechanical** persistence step = `npm run
  research:save` (`outreach/scripts/research-save.ts`) → `crm_leads.call_script` + `research_json`.
- **Place in the funnel**: `lead-engine → composer → outreach (draft) → /account-research (intel + script)
  → CALL (CRM Hot Lead) → close`. Run it when a lead is **approved** (entered in the CRM at Call 0), or just
  before a call/follow-up. The CRM reads the result live.
- Related: `/out` (email drafts), the `/outreach` CRM, `/diagnose` (the site's technical brief).

## Generic format (bigger company / standalone)
If the target is not one of our small businesses (e.g. free research "research Stripe"), keep the spirit of the full
sales brief: Quick Take · Company Profile (size, funding, HQ) · Recent News · Hiring Signals · Key People
(+ talking points) · Tech Stack · Qualification (✅/⚠️/❓) · Recommended Approach (entry point, hook, discovery
questions) · Sources. But for our prospects, what matters = **angle + call script** above.
