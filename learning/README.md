# learning — la boucle d'apprentissage (maillon 9)

> Ferme le cercle du pipeline : les **retours terrain** (un prospect a-t-il répondu ? signé ?) recalibrent
> les **règles du scoring**. Le scoring **lit** ces règles, ne les écrit jamais (cf. `docs/ARCHITECTURE.md`
> § dépendances). C'est l'unique exception au cloisonnement des blocs, assumée et documentée.

## Le cycle

```
  scoring ──▶ outreach ──▶ ISSUE (sent/reply/meeting/won/lost)
     ▲                          │
     │   learning/rules/rules.json   ◀── npm run learn ◀── data/outcomes.jsonl ◀── npm run learn:record
     └──────────────────────────────┘
```

1. **Enregistrer un retour** — `npm run learn:record -- <id> <won|lost|reply|meeting|sent> [industry]`
   Couple l'issue aux **features** qui l'ont prédite (axes + signaux du HTML, lus dans la fiche) →
   une ligne dans `data/outcomes.jsonl`. Automatique : le séquenceur écrit `sent` au 1er vrai mail (jamais en
   dry-run) et `reply` à la réponse, le CRM écrit `meeting`, `won` et `lost`.
2. **Recalculer les règles** — `npm run learn`
   Lit tous les retours → écrit `learning/rules/rules.json` + un rapport lisible `learning/analysis/report.md`.
   **Un essai par prospect** : son état final (l'étape la plus avancée : won/lost > meeting > reply > sent ; l'heure
   ne départage qu'à étape égale, la box et le cockpit n'ont pas la même horloge). Un RDV
   suivi d'un « perdu » vaut 0, une vente compte une fois, quel que soit le nombre de lignes laissées en route.
3. **Le scoring applique** — `score.ts` charge les règles via `learning/scripts/rules.ts` au prochain run.

## Ce qui est appris (et comment on évite de sur-réagir)

| | source | effet | garde-fou |
|---|---|---|---|
| **valeur-ticket par métier** | taux de conversion réel du métier vs la moyenne | delta sur la baseline `value` | borné **±15**, atténué par la confiance `n/(n+8)` |
| **poids des signaux gratuits** | lift d'un signal (présent vs absent) sur la conversion | multiplicateur du bonus | borné **0.5–1.5**, atténué par `min(n)/(min(n)+5)` |

**Anti-petit-N (le point clé).** Chaque ajustement est multiplié par une **confiance** qui tend vers 0
quand l'échantillon est minuscule : 2 retours ne bougent quasiment rien, il faut du volume pour déplacer
une baseline. **La boucle affine, elle ne remplace pas** le prior humain.

**Dégradation propre.** Pas de fichier de règles (clone frais, aucun retour) → `loadRules()` renvoie `{}`
→ le scoring tourne **exactement** sur ses baselines. La boucle ne peut jamais casser la porte.

## La boucle DESIGN (notation 0-100 → poids design)

À côté de la boucle commerciale (won/lost) ci-dessus, une seconde source nourrit l'apprentissage : le
**jugement esthétique de l'opérateur**. Dans le cockpit (inspecteur, section « notation »), chaque site
généré est noté **0-100 sur plusieurs axes** — `global`, `typo`, `layout`, `animation`, `couleurs`,
`contenu` — avec un « pourquoi » optionnel par axe. Les jauges écrivent dans `generations.scores_json`.

```
  composer ──▶ site généré ──▶ NOTATION (jauges cockpit, scores_json)
     ▲                              │
     │     data/learning/weights.json   ◀── npm run learn:weights
     └──────────(un jour : le composer lit ces poids)──────────┘
```

- **`npm run learn:weights`** lit toutes les générations notées + leurs métadonnées (template,
  industrie via JOIN `prospects`) → agrège les **moyennes par axe, par template, par industrie** dans
  `data/learning/weights.json`. C'est un **miroir** : il met en évidence ce qui plaît (haut score) vs pas.
- **Comment le composer le lira un jour.** Au moment de choisir un template / une paire de fontes / un
  angle, il consultera `weights.json` pour préférer ce qui a historiquement bien noté et éviter ce qui a
  déçu — la boucle d'auto-amélioration du design (lecture seule, comme le scoring lit `rules.json`).
- **Point d'extension : poids PAR FONTE.** `weights.json` réserve déjà un `byFont` (vide pour l'instant) ;
  dès que la fonte d'une gen sera persistée, il se remplira tout seul (cf. `scripts/weights.ts`).

## Fichiers

- `scripts/types.ts` — issues, poids, forme des règles (la forme appartient au scoring).
- `scripts/record.ts` — enregistre un retour (`npm run learn:record`).
- `scripts/learn.ts` — recalcule les règles + rapport (`npm run learn`) ; `buildRules()` est pur/testable.
- `scripts/rules.ts` — `loadRules()`, lu par le scoring (le seul pont `learning → scoring`).
- `scripts/weights.ts` — agrège les notations design en poids (`npm run learn:weights`).
- `rules/rules.json` · `analysis/report.md` — **générés** (gitignorés, rebuildables via `npm run learn`).
- `data/outcomes.jsonl` — les retours bruts (bus `data/`, gitignoré).
- `data/learning/weights.json` — **généré** (gitignoré) : poids design, rebuildable via `npm run learn:weights`.
