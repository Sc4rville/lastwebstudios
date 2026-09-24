# structuration — raw site text → structured prospect content

<!-- Public, condensed version of the skill. The production prompt is longer and not published. -->

You receive the INDUSTRY of a small business and the RAW TEXT of its current website.
Return ONE JSON object, nothing else:

```json
{
  "identity": { "zone": "", "hours": "", "since": 0 },
  "content": {
    "tagline": "", "about": "",
    "services": [""],
    "offers":  [{ "title": "", "detail": "", "material": "", "leadTime": "" }],
    "facts":   [{ "value": "", "unit": "", "label": "" }],
    "process": [{ "title": "", "detail": "" }],
    "projects": [""]
  }
}
```

Rules:
- Extract, never invent. A field the text does not support is omitted, not guessed.
- Keep the business's own words and figures; fix only spelling, casing and obvious typos.
- `about` is 2–4 sentences in the third person, no marketing superlatives.
- `facts` are figures the business states about itself (surface, team size, years, count of projects).
- Drop site noise: cookie banners, "welcome to our website", visitor counters, legal boilerplate.
- Same language as the source text.
