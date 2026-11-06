# compose-batch — l'orchestrateur du COMPOSER (la vraie voie sur-mesure)

> ⚠ **Le composer n'est PAS `npm run pipeline`.** `npm run pipeline` = template-fill (poliform pour
> tous = clones). Pour des sites **sur mesure, uniques, premium**, c'est CE chemin-ci.

## Pourquoi un doc et pas un `npm run`
Le composer **n'est pas un script déterministe** : c'est un **agent** qui, par prospect, lit la fiche +
le catalogue + les vraies sections et **écrit un site bespoke** (HTML+CSS sur mesure). Ça ne se réduit pas à un
appel de fonction comme `fillSite()`. Donc il s'**orchestre en agents** (un par prospect), via l'outil
Workflow — lancé par Claude, pas par npm. D'où ce doc + le script de référence
`architecture/orchestration/compose-batch.workflow.js`.

## La chaîne, par prospect
```
diagnose (avant.png + fiche → brief : beauté/10, problèmes, angle, moves)
  → asset-boost (Higgsfield) : asset-audit déterministe → upscale/relight si pas HD, héro borderless net,
                               + VIDÉO DE HÉRO si opportunité > 65/100 (assets d'abord → storyboard)
    → composer (slim) : COMBINE de vraies SECTIONS (design/sections/) + 1 paire de fonts imposée + archétype ;
                        motion RETENUE (3 max) ; logo géré ; design-system, pas un prompt-mur
      → FILET DÉTERMINISTE : lint.mjs (em-dash/assets/fonts) + verify.cjs (overflow/images/void) = clean
        → juge À L'AVEUGLE avant/après (A/B alterné, _after.png PLEINE PAGE ; PASS si nettement plus beau, sinon LOOPBACK, cap 2)
```

## Règles transverses (naly, 25/06/2026)

- **⭐ PREUVE SOCIALE — on la GARDE et on l'AWWWARDIFIE.** Si le prospect a déjà sur son site des
  **avis** (Google/Trustpilot mis en avant, note + nombre), des **témoignages clients** (surtout en
  **vidéo** : YouTube/Vimeo), des **marques partenaires**, une **prise de RDV** → ce sont ses forces,
  on ne les jette JAMAIS en refaisant le site. Le **diagnose** les détecte et les écrit dans la fiche
  (`content.reviews`, `content.googleRating`, `content.testimonialVideos`, `content.brands`) ; le
  **composer** les ré-intègre en sections soignées, niveau Awwwards. Awwwards OUI, mais on garde la
  substance du prospect et on la sublime. (Argument de vente : « votre site est bon, on garde vos
  forces et on les élève ».)
- **🖼 IMAGE = OpenAI gpt-image-2 EN DIRECT, plus Higgsfield.** L'asset-boost génère/édite les images
  via `node worker/openai-image.mjs` (clé `OPENAI_API_KEY`, bien moins cher). **Higgsfield reste
  UNIQUEMENT pour la vidéo** (kling). On **arrête les upscales Higgsfield à l'infini** (gaspillage).
  Chaque moteur est **optionnel** (`args.image` / `args.video` = `none`, depuis `LWS_IMAGE` / `LWS_VIDEO`) :
  sans moteur, le site se compose avec les vraies photos, jamais d'échec du maillon.

> **Architecture (audit 2026-06-17)** : on a retiré le prompt-mur (9 Ko → ~4 Ko) et fusionné les juges.
> La **mécanique** (ce qu'on suppliait : em-dash, assets, fonts, void, flou) est désormais **garantie par
> des scripts** (`lint.mjs`/`verify.cjs`), pas par des avertissements. Le composer a l'espace pour le goût ;
> le beauty-gate aveugle est le **seul** juge esthétique. Moins de contexte, moins de juges, plus de fiabilité.

## Recette (ce qu'un agent fait)
1. **Prérequis : prospects parsés** (fiche `data/prospects/<id>.json` + `data/assets/<id>/avant.png`).
   Si pas fait : `SEED=<seed.csv> DESIGN=0 FORCE=1 npm run pipeline` (lead-engine SEUL, pas de template-fill).
2. **Lister les `id`** prêts (fiche + avant.png), exclure les déjà composés (`output/sites/<id>/*-composer`).
3. **`Read design/fonts/pairings.json`** → récupère son tableau `pairings` (la SOURCE UNIQUE des paires).
4. **Lancer l'orchestrateur** `compose-batch.workflow.js` via l'outil **Workflow**, en passant tout en
   **`args`** (le script ne hardcode plus rien — les scripts Workflow n'ont ni disque ni `Date.now()`) :
   ```
   Workflow({ scriptPath: "architecture/orchestration/compose-batch.workflow.js",
              args: { date: "<YYYY-MM-DD>", ids: [<les id>], pairings: <le tableau de pairings.json>,
                      scores: { "<id>": 72, ... },   // optionnel : opportunité /100 → décide la vidéo de héro (>65)
                      boost: true,                   // false = audit seul, aucune génération
                      image: "openai" | "none",      // moteur image du boost (worker/openai-image.mjs)
                      video: "higgsfield" | "none",  // héros vidéo (worker/hero-cli.mjs)
                      models: { smart, fast, judge },// modèles par rôle (packages/llm/models.ts) ; absent = modèle de session
                      sync: true } })                // false = rien ne part vers le bucket ni la base (first-site)
   ```
   Il assigne **une paire de fonts distincte + un archétype par site** (jamais la `blacklist.txt`) →
   diversité **par construction** (anti-convergence : sans ça, l'agent retombe sur ~6 fonts "tendance").
5. **Résultat** : `output/sites/<id>/<date>-composer/` (visible en haut du backoffice). Verdict du juge
   aveugle + diversité (nb de fonts distinctes) à rapporter.

> Pourquoi `args` et pas une liste dans le fichier : avant, `date` + `ids` + une **copie** des pairings
> étaient figés dans le script (snapshot d'un run, et la copie des pairings **divergeait** du JSON
> canonique). Désormais une seule source (`pairings.json`), zéro édition du script entre deux runs.

Sans l'outil Workflow (abonnement Pro sans « Dynamic workflows », vieille CLI, Claude Code sur un modèle local) :
`architecture/orchestration/workflow-local.ts` exécute **le même script** en Node, un `claude -p` par agent
(mêmes prompts, mêmes schémas, même boucle). C'est le moteur `local` de `npm run first-site`.

## Comment un opérateur le déclenche
Le plus court, pour UN site : **`npm run first-site -- <url> --name "<nom>" --city <ville> --industry <métier>`**
(score → parse → fiche → ce Workflow, boost coupé, sans sync ; rapport `first-site.json` dans le dossier du site).

Dis à Claude : **« compose les prospects de `<seed>` avec le composer »** (ou « lance le composer sur
le top N »). Claude fait la recette ci-dessus. **Ne dis pas « lance le pipeline »** si tu veux du
sur-mesure — ça, c'est le template-fill.

## Coût / échelle (honnête)
~0,15-0,18 $/site (Opus). Un batch de 20 ≈ 2-3 $ + ~40 min. Sujet à la **limite de session** (un gros
batch peut la taper → reprendre en `resume`). Opt-in : c'est de l'orchestration multi-agents.

## Prouvé
2 batches : **15/15** puis **19/19** PASS au beauty-gate ; **33 fonts distinctes** sur 19 (vs ~6 avant
la diversité forcée), 0 Reckless, em-dashes 304→10. Voir `sessions/scarville.md` (2026-06-09/10).
