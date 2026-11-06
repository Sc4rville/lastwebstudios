# Sample data (fictional cast)

Le **casting fictif** de LWS : ce que `npm run sandbox` charge pour montrer une agence qui tourne, sans clé, sans
compte et sans une seule donnée réelle. Tout est inventé : 8 prospects sur 3 métiers (pisciniste, menuisier,
cuisiniste), communes inventées, domaines en `.example` (RFC 2606), téléphones dans les plages ARCEP réservées à la
fiction (`01 99 00`, `02 61 91`, `03 53 01`, `04 65 71`, `05 36 49`, `06 39 98`), illustrations SVG faites de zéro.
L'agence elle-même est fictive aussi (`agency.config.example.json`, « Atelier Vélin »).

| quoi | où | d'où ça vient |
|---|---|---|
| le casting et son histoire (qui est à quel étage) | `cast.json` | écrit à la main |
| les vieux sites datés (2009, 2011, 2013) | `sites/<prospect>/` (+ `test/fixtures/sites/orvane-piscines/`) | faits de zéro |
| les scores de la porte | `data/raw/<id>.score.json` | **sorties réelles** de `score.ts` sur les vieux sites (VISUAL=0, sans SIREN), ou fictives |
| captures « avant », logos, photos | `data/assets/<id>/` | **sorties réelles** de `parse.ts` (Playwright) sur les vieux sites |
| les fiches `ProspectSheet` | `data/prospects/<id>.json` | des vrais runs (Orvane, Brisane) ou écrites à la main |
| le pool du scraper | `data/raw/prospects.scraped.csv` | fictif, même format que le vrai |
| les mails du séquenceur | `data/savior/`, `data/demo/` | fictifs (les vrais sont générés par `npm run savior`) |
| les sites construits | `examples/<prospect>/site/` | **vrais runs** de `npm run first-site` (plan Claude, juge aveugle PASS) |

| prospect | métier | étage |
|---|---|---|
| Orvane Piscines | pisciniste | gagné (clic, réponse, RDV, Signature) |
| Atelier Brisane | menuisier | perdu (désinscription en un clic) |
| Cuisines Lumeo | cuisiniste | en appel (pas d'e-mail : téléphone seulement) |
| Menuiserie Fréhaut | menuisier | en séquence (mail parfait parti) |
| Bassins de Quillanne | pisciniste | en build (batch en file) |
| Cuisines Aubrelle | cuisiniste | noté, retenu |
| Piscines Vélisande | pisciniste | noté |
| Atelier Doralis | menuisier | trouvé |

La sandbox copie ces fichiers dans un dossier jetable (`.sandbox/`), jamais dans `data/` : ton dépôt reste vide de
prospects. Régénérer les scores et captures : servir `sites/<x>/` en local, puis `npm run score -- <id> <url> <métier>`
et `parsePage()` (cf. `test/fixtures/README.md`).
