# compose-worker — prompt de l'agent du WORKER (headless, sur le plan)

> Ce fichier est le **prompt** passé à `claude -p` par `worker/worker.ts` quand un batch en mode
> **composer** est dépilé. Tu tournes **sans humain** (headless) et **sur le plan** (token OAuth, pas
> l'API). Tu ES Claude Code dans le repo lastwebstudios, avec l'outil **Workflow** disponible.
>
> **Décide et exécute. Ne pose aucune question. Ne demande aucune confirmation.** Si une donnée manque,
> prends le défaut raisonnable décrit ici et continue. À la fin, imprime un résumé d'une ligne.

## Paramètres du batch (injectés)

- **Date du batch** : `{{DATE}}`  (le dossier de sortie sera `output/sites/<id>/{{DATE}}-composer/`)
- **Métier ciblé** : `{{INDUSTRY}}`
- **Limite** : `{{LIMIT}}` prospects
- **Seed explicite** : `{{SEED}}`
- **Force (porte ignorée)** : `{{FORCE}}`
- **Batch id** : `{{BATCH_ID}}`
- **IDS (RERUN)** : `{{IDS}}` — si c'est une liste d'ids, c'est un RE-RUN sur des prospects EXISTANTS.
- **Modèles par rôle** (packages/llm/models.ts) : `{{MODELS}}`
- **Langue des sites** : `{{LANGUAGE}}` (pays `{{COUNTRY}}`, agency.config.json) : les playbooks sont en français, le site se produit dans cette langue
- **Moteurs média** : image `{{IMAGE}}` · vidéo `{{VIDEO}}` · boost `{{BOOST}}` (calculés par le worker depuis
  LWS_IMAGE / LWS_VIDEO et les clés présentes : `none` = moteur coupé, jamais une panne)

## Ta mission, étape par étape

> ⚡ **RERUN (prioritaire) — si `{{IDS}}` est une liste d'ids** (≠ « (aucun… ») : NE FAIS NI choix de métier,
> NI scraping, NI exclusion des déjà-faits. Ce sont des prospects EXISTANTS à **re-composer avec le composer
> ACTUEL**. Vérifie juste que chacun a `data/prospects/<id>.json` + `data/assets/<id>/avant.png`, puis saute
> DIRECTEMENT à l'étape 5 : lance le Workflow `compose-batch` avec `args.ids` = cette liste et la date `{{DATE}}`.
> Le dossier `output/sites/<id>/{{DATE}}-composer/` est une **nouvelle version** (n'écrase pas l'ancienne).
> **Ignore les étapes 1-4 dans ce cas.**

Tu appliques la recette de `architecture/orchestration/compose-batch.md` (lis-la si besoin). En bref :

1. **Choisir la cible (métier) + alimenter le seed — LE SCRAPING EN AMONT.**
   - Si un **seed explicite** est donné (≠ « (défaut) »), utilise-le tel quel.
   - Sinon si un **métier** est donné (≠ « (seed par défaut) ») → c'est la cible.
   - Sinon (**AUTO**) → choisis la cible **automatiquement** : lance `npm run radar` (il classe les métiers
     par ticket × web-décisif × vivier vendable × récurrent, en lisant le learning) et prends le **mieux
     classé qui est câblé/scrapable** et pas déjà épuisé. À défaut d'info exploitable : `cuisiniste` (défaut sûr).
   - **Puis SCRAPE la cible si ses leads ne sont pas déjà là** (c'est l'amont, gratuit et légal) :
     cherche `data/raw/<metier>s.seed.csv` ; s'il manque / est maigre → `npm run scrape -- <metier> fr`
     (sources OSM + SIRENE + récupération tél/email). Ça produit le seed/registre exploitable par le pipeline.

2. **NE PRENDRE QUE DES PROSPECTS NEUFS (suivi fait / pas-fait — IMPORTANT).** Le but n'est PAS de
   refaire des sites déjà produits. Avant le lead-engine :
   - Établis l'ensemble **DÉJÀ FAIT** = tout prospect qui a déjà un dossier `output/sites/<id>/` (toute
     version, composer OU template-fill). Liste-le : `ls output/sites/ 2>/dev/null`.
   - Parcours le seed dans l'ordre et **retiens les {{LIMIT}} premiers `id` (slug `nom-ville`) qui ne sont
     PAS dans l'ensemble déjà-fait**. Ce sont tes prospects NEUFS à traiter.
   - Si tu n'en trouves pas assez de neufs (seed épuisé) → **scrape plus** : `npm run scrape -- <metier> fr`,
     puis recommence la sélection. Si vraiment plus rien de neuf → imprime « 0 prospect neuf » et termine
     proprement (succès, rien à faire — on a tout fait sur ce métier).
   Construis un mini-seed filtré (les lignes du CSV correspondant à ces `id` neufs) pour l'étape suivante.

3. **Lead-engine SEUL (pas de template-fill)** sur **les prospects NEUFS** (le mini-seed filtré, ou en
   pointant `SEED` dessus), pour produire fiches + `avant.png`. C'est ici que la **porte de scoring** filtre :
   ```
   SEED=<mini-seed-neufs> DESIGN=0 FORCE=1 npm run pipeline
   ```
   (DESIGN=0 = score→parse→fiche, AUCUN template-fill. FORCE=1 = on veut les fiches même si la porte
   jetterait — la sélection premium se fait au beauty-gate, pas ici.)
   Puis liste les `id` **prêts** : fiche `data/prospects/<id>.json` ET `data/assets/<id>/avant.png` présents.

4. **`Read design/fonts/pairings.json`** → récupère son tableau `pairings` (source unique des paires).

5. **Lancer l'orchestrateur** via l'outil **Workflow**, tout en `args`. Récupère l'**opportunité /100** de
   chaque prospect prêt (champ score de `data/prospects/<id>.json`) pour `scores`. Les **moteurs média et les
   modèles sont IMPOSÉS** par le worker (paramètres ci-dessus) : passe-les TELS QUELS, ne les devine pas.
   L'image passe par `node worker/openai-image.mjs` (OpenAI, moins cher que Higgsfield), la vidéo de héros par
   `node worker/hero-cli.mjs` (CLI Higgsfield, kling3_0_turbo) ; un moteur à `none` est simplement sauté
   (le composer construit avec les vraies photos). Ne remplace jamais un moteur coupé par un autre (MCP, etc.).
   ```
   Workflow({ scriptPath: "architecture/orchestration/compose-batch.workflow.js",
              args: { date: "{{DATE}}", ids: [<les id prêts>], pairings: <le tableau pairings>,
                      scores: { "<id>": <opportunité>, ... }, boost: {{BOOST}},
                      image: "{{IMAGE}}", video: "{{VIDEO}}", models: {{MODELS}}, language: "{{LANGUAGE}}", country: "{{COUNTRY}}" } })
   ```
   Par site : **diagnose → asset-boost (relight image + héros vidéo turbo, selon les moteurs) → composer
   (combine de vraies sections + 1 paire de fonts imposée, motion retenue) → filet déterministe (lint+verify)
   → beauty-gate aveugle** (PASS si « après » nettement plus beau, sinon LOOPBACK auto, cap 2).

6. **Résumé final, une ligne** : `batch {{BATCH_ID}} : X/Y PASS · Z fonts distinctes · sites dans
   output/sites/**/{{DATE}}-composer`. (Le worker réindexe ensuite tout seul → les sites apparaissent
   au cockpit.)

## Garde-fous

- **Headless** : ne JAMAIS attendre une entrée humaine. En cas de blocage, choisis le défaut et continue.
- **Sur le plan** : tu tournes sur le forfait (token OAuth). Si tu tapes la limite de session sur un gros
  batch, génère ce que tu peux, imprime ce qui reste, et termine sans erreur (le worker réindexe le partiel).
- **Ne touche pas** au scoring/scraping au-delà de ce qui est nécessaire à CE batch. Pas de refactor.
- **N'écris que** dans `output/`, `data/prospects/`, `data/assets/` (la génération). Rien d'autre.
