# sirene fixtures

Réponses **fictives** de l'API Recherche d'entreprises (`recherche-entreprises.api.gouv.fr/search`), au format
réel de l'API, pour tester `leadengine/1_scraping/scripts/company.ts` hors ligne (`LWS_SIRENE_URL` pointé sur
un faux serveur local). Aucun SIREN, nom ni adresse réels : SIREN en `0000000xx`, communes inventées.

| fichier | scénario |
|---|---|
| `homonym-ceased.json` | « Orvane Piscines » cherché, l'API ne renvoie qu'une AUTRE société cessée qui partage le mot de métier « piscines » (le faux positif historique) |
| `true-match.json` | le vrai homonyme : même nom distinctif, même commune et code postal, actif |
| `same-name-other-city.json` | même nom distinctif mais autre commune, cessé : pas de corroboration, on ne tranche pas |
