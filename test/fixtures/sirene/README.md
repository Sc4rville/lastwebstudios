# sirene fixtures

**Fictional** answers from the Recherche d'entreprises API (`recherche-entreprises.api.gouv.fr/search`), in the API's
real format, to test `leadengine/1_scraping/scripts/company.ts` offline (`LWS_SIRENE_URL` pointed at a
fake local server). No real SIREN, name or address: SIREN numbers as `0000000xx`, made-up towns.

| file | scenario |
|---|---|
| `homonym-ceased.json` | "Orvane Piscines" searched, the API only returns ANOTHER, ceased company that shares the trade word "piscines" (the historical false positive) |
| `true-match.json` | the true namesake: same distinctive name, same town and postcode, active |
| `same-name-other-city.json` | same distinctive name but another town, ceased: no corroboration, no decision |
