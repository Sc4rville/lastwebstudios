# Test fixtures

Tout ici est **fictif et fait de zéro** (nuit du 2026-10-24) : aucune entreprise, personne, adresse, photo ou
capture réelle. Téléphones dans les plages ARCEP réservées à la fiction (`01 99 00 …`, `02 61 91 …`,
`03 53 01 …`), e-mails en `.example` (RFC 2606), SIREN en `0000000xx`, communes inventées. Réutilisables par
les tests, les démos et la sandbox de l'édition open source.

| dossier | contenu | utilisé par |
|---|---|---|
| `bin/claude` | **faux** `claude` (Claude Code CLI) : sorties `json` et `stream-json`, journal `FAKE_CLAUDE_LOG`, limite de plan simulée, chantier composer interrompu (`FAKE_CLAUDE_MKDIR`) | tout test qui passe par le chemin plan ou le worker |
| `sites/orvane-piscines/` | le **vieux site** daté (2014-2016) du prospect fictif « Orvane Piscines » : tableaux, bandeau défilant, jQuery 1.x local factice, pas de viewport, © 2016, 8 illustrations SVG maison, pages réalisations et contact | score, parse, pipeline, first-site (WP2) |
| `sites/empty-site/` | une page quasi vide **sans aucun contact** | porte de joignabilité |
| `sirene/` | réponses simulées de l'API Recherche d'entreprises (homonyme cessé, vrai homonyme, même nom autre ville) | company, score, pipeline |
| `seeds/orvane.seed.csv` | seed du pipeline au format `name,city,website,phone,industry,email` | pipeline |
| `scores/` | sorties réelles du scorer (`npm run score`, `VISUAL=0`, sans SIREN) sur les deux sites ci-dessus | démos, vue Machine (WP3) |
| `workspace/agency/` | une agence miniature à copier par-dessus un workspace : 3 fiches `ProspectSheet` (pisciniste, menuisier, cuisiniste sans e-mail), un site composer et un site template-fill générés, des assets | cockpit, CRM, séquenceur, worker, Telegram |

Régénérer `scores/` : servir `sites/<x>/` sur un port local, puis
`LWS_SIRENE=0 VISUAL=0 npx tsx leadengine/2_scoring/scripts/score.ts <id> http://127.0.0.1:<port>/ [métier]`
dans un dossier jetable (le score est écrit dans `data/raw/<id>.score.json`).
