export const meta = {
  name: 'compose-batch',
  description: 'Per prospect: diagnose -> asset-boost (image OpenAI + hero video Higgsfield, each optional) -> composer (slim brief, real harvested SECTIONS + one font pair, RESTRAINED motion) -> deterministic net (lint+verify) -> SIGHTED self-review (le composer Read ses captures et patche, oeil du peintre) -> blind beauty-gate (loopback cap 2)',
  phases: [
    { title: 'Diagnose', detail: 'beauty_before + brief from the live site' },
    { title: 'Assets', detail: 'asset-audit + relight image (OpenAI, args.image) EN PARALLÈLE ; hero video DÉTERMINISTE via hero-cli (Higgsfield kling3_0_turbo, args.video), ~4 min, ZÉRO best-of-N. args.turbo → vidéo aux chauds seulement ; chaque moteur peut être none' },
    { title: 'Compose+Gate', detail: 'composer from real section catalog + 1 font pair, restrained motion -> lint+verify (deterministic) -> AUTO-REVUE VISUELLE (Read ses captures, patch ciblé) -> BLIND A/B judge, loopback cap 2' },
    { title: 'Sync', detail: 'push CHAQUE site dès qu\'il est composé (incrémental, pas en fin de batch)' },
  ],
}

// ── Tout ce qui VARIE vient de `args` (le lanceur le fournit) — rien de figé dans le script ──
//   args.date     : "YYYY-MM-DD" (les scripts Workflow n'ont pas Date.now() → injectée)
//   args.ids      : string[] des prospects prêts (fiche + avant.png)
//   args.pairings : le TABLEAU de design/fonts/pairings.json VERBATIM (1 paire imposée / site → diversité)
//   args.scores   : { id: opportunité 0-100 } (optionnel → décide la vidéo de héro ; sinon lue dans la fiche)
//   args.boost    : bool (défaut true) → maillon asset-boost (image + vidéo) ; false = audit seul, aucune génération
//   args.image    : "openai" | "none" (défaut "openai") → moteur image du boost (worker/openai-image.mjs) ; none = vraies photos telles quelles
//   args.video    : "higgsfield" | "none" (défaut "higgsfield") → héros vidéo (worker/hero-cli.mjs) ; none = héros photo
//   args.models   : { smart, fast, judge } (facultatif) → modèles par rôle (packages/llm/models.ts : le script ne lit pas l'env).
//                   judge = diagnose, auto-revue, juge aveugle ; smart = composer. Absent = modèle de la session.
//   args.sync     : bool (défaut true) → pousse chaque site vers le bucket + la DB partagée (scripts/sync-site.ts) ; false = local seul
const A = typeof args === "string" ? (() => { try { return JSON.parse(args) } catch { return {} } })() : (args || {})
const date = A?.date
const IDS = A?.ids ?? []
const PAIRINGS = A?.pairings ?? []
const SCORES = A?.scores ?? {}
const BOOST = A?.boost !== false
const IMAGE = A?.image === 'none' ? 'none' : 'openai'
const VIDEO = A?.video === 'none' ? 'none' : 'higgsfield'
const SYNC = A?.sync !== false
const LANGUAGE = (typeof A?.language === 'string' && A.language) ? A.language : 'fr'   // langue des contenus générés (agency.config.json › language) ; les playbooks restent en français
const COUNTRY = (typeof A?.country === 'string' && A.country) ? A.country : 'FR'
const LANG_LINE = `LANGUE DU SITE : ${LANGUAGE} (pays ${COUNTRY}). Les playbooks et ces consignes sont en français : produis TOUT le contenu du site (navigation, titres, textes, CTA, pied de page, formats de téléphone/adresse) en ${LANGUAGE}, quoi qu'il arrive.`
const MODELS = (A?.models && typeof A.models === 'object') ? A.models : {}
const withModel = (role) => (typeof MODELS[role] === 'string' && MODELS[role]) ? { model: MODELS[role] } : {}
const CINEMATIC = A?.cinematic !== false   // VIDÉO POUR TOUS par défaut (2026-06-20) : la couche web-cinematics tourne sur chaque prospect, quel que soit le score. cinematic:false → revient au gate score > 65.
const TURBO = A?.turbo === true            // MODE RAPIDE (opt-in) : vidéo réservée aux prospects CHAUDS (score>65), image-héros boostée pour les froids → coupe ~28 min sur les froids. Off par défaut (on respecte "vidéo pour tous").
const GATE_MAX_LOOPS = 2 // beauty-gate : compose → juge, au plus 2 tours (docs/SKILLS.md, beauty-gate/SKILL.md disent pareil, vérifié par test/docs.test.ts)
if (!date || !IDS.length || !PAIRINGS.length) {
  throw new Error('compose-batch: fournis args={date, ids:[...], pairings:[...]} (pairings = design/fonts/pairings.json lu par le lanceur). Voir compose-batch.md.')
}

// Les archétypes de layout ne vivent QUE here (colonne vertébrale visuelle imposée / site → anti-jumeaux).
const ARCHETYPES = ["hero-split (texte à gauche, image plein-bleed à droite)", "image plein écran + titre superposé bas", "typographie GÉANTE (le titre EST le hero), image secondaire", "liste éditoriale numérotée asymétrique", "manifeste centré, espace généreux, peu d'images", "colonne latérale fixe + contenu qui défile", "grille décalée avec chevauchements", "bandes pleine largeur alternées clair/sombre"]

const BRIEF = { type: 'object', properties: { beauty_before: { type: 'object', properties: { score: { type: 'number' }, why: { type: 'string' } } }, what: { type: 'string' }, problems: { type: 'array', items: { type: 'string' } }, angle: { type: 'string' }, moves: { type: 'array', items: { type: 'string' } } }, required: ['beauty_before', 'angle'] }
const ASSETS = { type: 'object', properties: { boosted: { type: 'array', items: { type: 'string' } }, heroVideo: { type: 'boolean' }, notes: { type: 'string' } }, required: ['notes'] }
const COMPOSE = { type: 'object', properties: { ok: { type: 'boolean' }, path: { type: 'string' }, fontPair: { type: 'string' }, lintClean: { type: 'boolean' }, verifyClean: { type: 'boolean' }, notes: { type: 'string' } }, required: ['ok'] }
const VERDICT = { type: 'object', properties: { more_beautiful: { type: 'string', enum: ['A', 'B', 'tie'] }, margin: { type: 'string', enum: ['much', 'somewhat', 'tie'] }, reasons: { type: 'array', items: { type: 'string' } } }, required: ['more_beautiful', 'margin', 'reasons'] }

const diagnosePrompt = (id) => `${LANG_LINE} Le brief aussi est écrit en ${LANGUAGE}.\n⏱ DÉMARRE LE CHRONO DE GEN — exécute d'abord en Bash : date +%s > data/assets/${id}/_start.epoch  (c'est l'instant T0 de cette génération). Puis exécute /diagnose pour "${id}" (lis .claude/skills/diagnose/SKILL.md). Lis data/prospects/${id}.json ET Read data/assets/${id}/avant.png (leur site actuel). Produis le brief (beauty_before /10 honnête, what, problems concrets vus sur l'image, angle, moves). ÉCRIS-le dans la fiche sous "brief" (sans casser le JSON) et retourne-le.
⭐ PREUVE SOCIALE À PRÉSERVER (règle naly) : repère sur leur site actuel ce qu'ils ont déjà de PRÉCIEUX et qu'on doit GARDER + awwwardifier — avis Google/Trustpilot mis en avant (note + nb), témoignages clients (surtout en VIDÉO : YouTube/Vimeo), marques partenaires, prise de RDV. Si la fiche (\`content.reviews\`/\`content.googleRating\`/\`content.testimonialVideos\`/\`content.brands\`) ne les contient pas encore, AJOUTE-les dans la fiche (scrape la page si besoin : note Google, 2-3 avis réels, IDs YouTube des témoignages) pour que le composer les réutilise. On ne jette JAMAIS la preuve sociale d'un prospect.`

// ── MAILLON ASSET-BOOST : des visuels NETS avant de composer, sans inventer leur travail ──
//    Deux moteurs séparés (décision naly 25/06) : IMAGE = OpenAI en direct (worker/openai-image.mjs), VIDÉO = Higgsfield
//    (worker/hero-cli.mjs). Chacun peut être coupé (args.image / args.video = 'none') : le maillon ne l'exige JAMAIS.
const heroVideoWanted = (score) => BOOST && VIDEO !== 'none' && ((CINEMATIC && !TURBO) || score > 65)
const assetPrompt = (id, score) => `Maillon ASSET-BOOST pour "${id}" — lis .claude/skills/asset-boost/SKILL.md. On améliore les VRAIES photos du prospect (jamais de fausse réalisation).
⚙️ MOTEURS DISPONIBLES POUR CE BATCH (imposés par le lanceur, ne cherche pas d'autre moteur) :
  • IMAGE : ${!BOOST || IMAGE === 'none' ? `**AUCUN** (${!BOOST ? 'boost désactivé' : "args.image='none'"}). Ne génère et n'édite AUCUNE image (ni OpenAI, ni Higgsfield, ni MCP). Les vraies photos restent telles quelles : la curation et le recadrage se feront au composer (object-fit / aspect-ratio / object-position).` : `**OpenAI en direct** via \`node worker/openai-image.mjs\` (clé OPENAI_API_KEY de .env). Édition/relight/recadrage d'une VRAIE photo (image→image) : \`node worker/openai-image.mjs --prompt "..." --image data/assets/${id}/<photo> --out data/assets/${id}/<nom>-relight.png --size 1536x1024 --quality high\` (référence la vraie réalisation, jamais inventer). Tailles : 1536x1024 (paysage), 1024x1536 (portrait), 1024x1024. Sortie : un PNG dans --out + un JSON {ok,...} sur stdout. Code 3 = moteur désactivé → continue sans. **N'utilise PAS Higgsfield pour l'image.**`}
  • VIDÉO : ${heroVideoWanted(score) ? `**Higgsfield** (kling3_0_turbo) via \`node worker/hero-cli.mjs\`, une seule commande (étape 3).` : `**AUCUNE** (${!BOOST ? 'boost désactivé' : VIDEO === 'none' ? "args.video='none'" : `score ${score || '?'}/100 ≤ 65`}) : pas de vidéo de héros, la plus belle vraie photo porte le héros.`}
⚡ VITESSE (CRITIQUE — cette étape DOIT tenir en ~6-8 min) : lance les éditions d'image INDÉPENDANTES **EN PARALLÈLE** (plusieurs commandes dans le MÊME message, ou en arrière-plan), puis attends le lot UNE fois. Le séquentiel est ce qui faisait 28 min.
1. \`node design/scripts/asset-audit.mjs ${id}\` puis Read data/assets/${id}/_audit.json (résolution, HD, héro candidat, borderless).
${BOOST && IMAGE !== 'none' ? `2. Pour CHAQUE photo dont \`action != "crop-ok"\` : relight + recadrage par \`openai-image.mjs --image\` (exposition, balance, lumière, netteté ; on corrige la lumière, on ne change pas le lieu). Vise une photo BORDERLESS nette pour le héros (élargie au ratio plein-bleed sans déformer ni inventer). Si une photo est déjà HD, ne la re-traite pas.
   **Minimum : le HÉROS passe au moins une fois par ce relight** (si le prospect a au moins une photo). Si le moteur répond code 3 ou échoue, note-le et CONTINUE : un site sans photo boostée n'est pas un échec du batch.` : `2. (moteur image coupé) Note dans _boost.json quelles photos sont faibles (à reshooter côté client) et lesquelles conviennent au héros. Aucune génération.`}
3. ${heroVideoWanted(score) ? `HERO VIDÉO — **DÉTERMINISTE & RAPIDE (~4 min)**. ⚠ NE FAIS **PAS** de best-of-N, NE génère **PAS** de keyframes à la main, NE juge **PAS** d'images en boucle. Tu exécutes **UNE SEULE commande Bash** :
   \`node worker/hero-cli.mjs ${id} <industrie>\`  (industrie = champ \`industry\` de data/prospects/${id}.json)
   → ça anime AUTOMATIQUEMENT la meilleure photo boostée du prospect (**image→vidéo = leur vraie réalisation qui BOUGE**) en **kling3_0_turbo**, et dépose data/assets/${id}/hero.mp4 + hero-poster.jpg + _cinematics.json. Le composer détecte hero.mp4 et le pose en fond de héros. **C'est TOUT pour la vidéo.** Si la commande sort avec un code ≠ 0 (3 = moteur désactivé), retourne heroVideo:false SANS bloquer.` : `PAS de vidéo de héros pour ce site (cf. moteurs ci-dessus) : n'appelle PAS hero-cli.`}
4. Trace dans data/assets/${id}/_boost.json (source, action, généré o/n, hero.mp4 o/n) ET écris le NOMBRE **\`credits_spent\`** = total des crédits / coûts de CE site (0 si aucun moteur) dans _boost.json → le dashboard l'affiche par site.
${BOOST ? '' : '(MODE AUDIT SEUL : exécute les étapes 1, 2 et 4 sans aucune génération, puis retourne.)'}
Retourne {boosted:[fichiers traités], heroVideo:bool, notes}.`

// ── COMPOSER (slim) : assemble de VRAIES sections + 1 paire de fonts ; motion RETENUE ; filet déterministe ──
const composePrompt = (id, brief, p, arch, tone, critique) => `${LANG_LINE}\n\nCompose le site SUR-MESURE de "${id}". Tu es le directeur artistique : vise un site qu'on poserait sur Awwwards sans rougir, à partir du contenu RÉEL du prospect.

LIS (courts — c'est tout ton cadre) : .claude/skills/frontend-design/SKILL.md (la direction esthétique, anti « IA générique ») + le playbook du métier (champ \`industry\` de data/prospects/${id}.json → design/industries/<industry>/playbook.md : il donne les SECTIONS et le concept propres au métier).

DIRECTION (du diagnose) : ${brief ? brief.angle : ''}. Corrige : ${brief && brief.problems ? brief.problems.slice(0, 3).join(' · ') : ''}.${critique ? `\n⚠ Tentative précédente jugée PAS nettement plus belle : ${critique}. Recompose NETTEMENT mieux (ne répète pas le même geste).` : ''}

MATÉRIAUX IMPOSÉS (ne reconverge PAS vers du générique) :
• Fonts : ${p ? `${p.display} (display) × ${p.body} (texte)` : 'une paire DISTINCTIVE du catalogue'} — self-host les woff2 depuis design/fonts/<slug>/ DANS fonts/ du site (avec le OFL.txt de la famille s'il existe, renommé <slug>-OFL.txt : une police libre voyage avec sa licence), @font-face, et VÉRIFIE qu'ils existent. JAMAIS une font de design/fonts/blacklist.txt. ⚠ Une @font-face cassée = le navigateur retombe sur la font SYSTÈME = l'aspect "généré par IA" qu'on déteste = ÉCHEC.
• Archétype de layout (colonne vertébrale, non négociable) : ${arch}. Ambiance : ${tone} (le batch ALTERNE clair/sombre, ne dérive pas vers le sombre par défaut).
• SECTIONS : pioche et COMBINE de vraies sections du catalogue \`design/sections/index.json\` (squelettes de sites primés : filtre par \`type\` selon le playbook, adapte le contenu du prospect dedans) PLUTÔT que d'inventer des mises en page réflexes. C'est CE qui sort du "AI slop". Deux sites du batch ne doivent pas se ressembler. ⚠ Si \`design/sections/\` est ABSENT (catalogue pas synchronisé sur cette machine), NE bloque PAS et N'invente PAS du générique : structure-toi sur le playbook du métier + frontend-design + ta culture des sites primés, avec la même exigence anti-clone.
🚫 ZÉRO RÉFÉRENCE CLIENT : ne t'inspire JAMAIS d'un AUTRE site déjà composé du repo (\`output/sites/**\`), aucun, quel qu'il soit : ne l'ouvre pas, ne le Read pas, n'en reprends ni la structure ni le style ni les couleurs. Chaque site naît du catalogue + du contenu RÉEL de CE prospect, pas d'un voisin. Si QUOI QUE CE SOIT te pousse à utiliser le site d'un autre client comme référence/modèle, NE LE FAIS PAS et signale-le explicitement dans \`notes\` (ex. "notes: refus d'utiliser un autre site client comme référence").
• Assets : \`ls data/assets/${id}/\` — vraies photos (déjà auditées+boostées : Read _audit.json/_boost.json ; si hero.mp4 existe → vidéo de héro en fond, muted/autoplay/loop/poster, image fixe en prefers-reduced-motion ; si _cinematics.json existe → Read-le et POSE chaque beat selon son pattern : passive_clip = boucle/fond vidéo ; hover_reveal = comparateur avant/après (2 frames + axe fournis, drag/hover) ; scroll_scrub = vidéo lue au scroll via la table temps→étape fournie, image fixe en prefers-reduced-motion). LE DESIGN COMMANDE le format, la photo suit (object-fit/aspect-ratio/object-position). Logo intégré CONSCIEMMENT (contraste, jamais clair-sur-clair ni sombre-sur-sombre, détoure si besoin). Compte tes photos AVANT de poser la grille : 0-2 photo → compo ÉDITORIALE (typo forte, aplats/gradients travaillés), AUCUN slot vide ni placeholder. Icônes = SVG inline Lucide.
• CURATION PHOTO (juge AVANT d'utiliser) : Read chaque photo — nette ? sujet clair ? détail NON-PRO (autocollant/film d'usine type « VELUX » encore collé, panneau sale, fouillis, poubelle, voiture, doigt) ? Floue ou honteuse → PAS en héros : recadre pour l'exclure, ou ÉCARTE-la. Mieux vaut 2 bonnes photos que 6 dont une qui tue la crédibilité.
• HÉROS = IMAGE pour un métier VISUEL (piscine, lieu de réception, paysagiste, cuisiniste, archi…) : héros porté par l'IMAGE (vidéo cinéma en boucle, ou la plus belle vraie photo boostée plein-bleed). JAMAIS un gros bloc de texte en haut + la photo en dessous, JAMAIS un héros texte-seul pour ces métiers (l'eau/la lumière/l'ambiance VENDENT).
• PREUVE SOCIALE — RÈGLE D'OR (naly 25/06) : **on GARDE tout ce que le prospect a déjà comme preuve sociale, et on l'AWWWARDIFIE.** Un prospect qui a des avis/témoignages/notes, c'est de l'or : on ne JETTE jamais ça en refaisant le site, on le RÉ-ÉLÈVE au niveau Awwwards. OBLIGATOIRE si la fiche en a — Read data/prospects/${id}.json :
   (a) \`content.googleRating\` / \`content.reviews\` (Google, Trustpilot, etc.) → section AVIS soignée : la note + le nb d'avis (ex. "Excellent · 84 avis Google") + 2-3 cartes d'avis RÉELS de la fiche (nom, date, texte, étoiles). JAMAIS un avis/nom/texte inventé qui n'est pas dans la fiche.
   (b) \`content.testimonialVideos\` → section TÉMOIGNAGES VIDÉO. Les valeurs peuvent être : des **.mp4 locaux** (data/assets/${id}/, à COPIER en \`assets/\`, balise \`<video>\` poster + controls, lecture au clic, pas d'autoplay) OU des **URLs/ID YouTube/Vimeo** (→ \`<iframe>\` d'embed propre, ou une vignette poster cliquable façade-cinéma qui charge l'iframe au clic = plus rapide). Mets-en PLUSIEURS si la fiche en a plusieurs (carrousel ou grille).
   (c) \`content.brands\` → bandeau MARQUES PARTENAIRES (logos texte propres).
   Place ces blocs en partie basse, avant le CTA final. C'est CE qui sépare un vrai site d'un template, et c'est notre promesse : "votre site est bon, on garde vos forces et on les sublime".

GARDE-FOUS (non négociables) : une grande idée par page · type franc (1 paire, échelle franche) · l'espace travaille (marges généreuses > déco) · grille STRICTE (cellules alignées, rien qui flotte) · 1 CTA clair above-fold répété en clôture · contenu RÉEL only (0 lorem, 0 service inventé) · mobile = même hiérarchie · contraste AA · **EXPLOITE LA LARGEUR : aligné à gauche / grilles asymétriques par défaut ; NE centre PAS les paragraphes des sections du bas dans une colonne étroite (centré-étroit = réflexe paresseux, réservé aux moments forts : manifeste, CTA final). Une bande pleine largeur (borderless) de temps en temps respire.**
🚫 ZÉRO TELL IA : (a) PAS d'« eyebrow à tiret » — le petit kicker en capitales précédé d'une LIGNE déco (\`::before\`/\`::after\` fine ligne) ou d'un tiret « —— LABEL » : c'est LE signe « généré par IA », le lint le REFUSE. Kicker nu, ou pas de kicker. (b) PAS d'em-dash (—) dans la copie (le lint strippe, mais n'en mets pas). (c) PAS le tic « les 2 derniers mots du titre en italique » par réflexe.

MOTION — RETENUE (le piège c'est le TROP, pas le trop peu) : 3 mouvements MAX, cohérents (entrée héro · reveal de section · 1 accent), easing doux, ça doit POSER pas partir partout. CSS scroll-driven d'abord (animation-timeline + @supports) + prefers-reduced-motion. GSAP seulement si indispensable, et alors depuis le CDN jsDelivr (jamais un fichier gsap*.js copié dans le site : licence non libre). ⚠ JAMAIS un état initial qui masque à 100% (opacity:0 / clip-path:inset(100%) piloté par IntersectionObserver) sans filet : le contenu est VISIBLE par défaut, l'anim n'est qu'un léger plus (translate de quelques px + fade depuis **≥ .35** — JAMAIS opacity:0 NI .001 : sinon la capture pleine page + le juge aveugle + la vignette du cockpit voient du BLANC = site qui paraît cassé ; le verify REFUSE désormais opacity<.15 sur les grands blocs). Hover net sur les éléments interactifs (lift/zoom/underline, ~.2s).

🅰 TITRES SANS GLITCH — PRIORITÉ ABSOLUE CETTE PASSE (le défaut récurrent = lettres COUPÉES ou qui SE CHEVAUCHENT dans les titres). Zéro tolérance :
   • \`line-height\` des gros titres ≥ 1.0 (display serré) / ≥ 1.05 dès qu'il y a des accents (é à ü) ou des descendantes (g j p q y). JAMAIS \`overflow:hidden\`/\`clip\` sur un titre OU son conteneur direct si ça peut rogner une lettre/accent/descendante. (Pour un reveal en masque de ligne : c'est le wrapper qui a overflow:hidden et le titre qui se TRANSLATE — le transform ne rogne rien au repos ; vérifie qu'au repos le titre tient à 100%.)
   • \`letter-spacing\` négatif LÉGER seulement (≥ -0.03em). Au-delà, les glyphes se chevauchent. Pas de \`word-spacing\` négatif.
   • Le titre TIENT dans sa boîte à **1440px ET à 390px** : aucun mot tronqué, pas de \`text-overflow:clip/ellipsis\` sur un titre, pas de \`white-space:nowrap\` qui force un débordement. Utilise \`clamp()\` pour la taille (descend assez bas en mobile) et autorise le retour à la ligne.
   • @font-face CHARGÉE avant le rendu (la font de fallback a d'autres métriques → titre qui déborde/chevauche). Les woff2 existent localement (le lint le vérifie) ; ajoute \`font-display:swap\` proprement.
   • Le verify.cjs REFUSE désormais tout titre rogné (champ \`clippedHeadings\` desktop ET mobile) EN PLUS de l'overflow : si verify liste un titre, corrige (line-height ↑ / taille ↓ / retire l'overflow:hidden / clamp) et RELANCE jusqu'à \`clean:true\`. C'est éliminatoire, comme l'overflow.

SORTIE : output/sites/${id}/${date}-composer/index.html self-contained, offline (CSS inline, fonts + photos COPIÉES en local relatif \`assets/…\` ; ZÉRO chemin disque \`../../data/…\`). control.md (template: composer, note la paire de fonts + l'archétype + le verdict).

AVANT DE RENDRE — LE FILET DÉTERMINISTE (obligatoire, c'est lui qui remplace les 1000 avertissements) :
1. \`node design/scripts/lint.mjs output/sites/${id}/${date}-composer/index.html --fix\` → doit finir \`clean:true\` (0 em-dash, 0 asset en chemin disque, 0 @font-face absente). Corrige ce qu'il liste, relance.
2. \`node design/verify/verify.cjs output/sites/${id}/${date}-composer/index.html output/sites/${id}/${date}-composer/_after.png\` → doit donner \`clean:true\` (0 overflow, 0 image cassée/floue, 0 void béant, **0 titre rogné = champ \`clippedHeadings\` vide en desktop ET mobile**). Un défaut → corrige et relance jusqu'à clean.
Retourne {ok, path, fontPair, lintClean, verifyClean, notes}.`

// ── 👁 ŒIL DU PEINTRE — AUTO-REVUE VISUELLE : le composer Read SES PROPRES captures (_after.png desktop +
//    _after.mobile.png — DÉJÀ produites par verify, donc zéro rendu en plus) et corrige par PATCH CIBLÉ, jamais
//    par regénération. C'est exactement ce qui manquait : le peintre regarde sa toile pendant qu'il peint. 2 rounds
//    MAX (vitesse). En faisant passer le juge du 1er coup, ça REMPLACE des recompositions complètes (lentes) par
//    des patchs CSS (rapides) → plus beau ET plus rapide. ──
const SELFREVIEW = { type: 'object', properties: { improved: { type: 'boolean' }, rounds: { type: 'number' }, fixes: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } }, required: ['improved'] }
const selfReviewPrompt = (id) => `Tu viens de composer output/sites/${id}/${date}-composer/index.html. Maintenant REGARDE-LE et corrige-le comme un directeur artistique qui regarde sa maquette — c'est l'étape qui te manquait (avant tu composais à l'aveugle).

REGARDE D'ABORD (obligatoire) — Read les DEUX captures PLEINE PAGE de TON rendu (elles existent déjà, verify vient de les produire) :
  • output/sites/${id}/${date}-composer/_after.png         (desktop 1440)
  • output/sites/${id}/${date}-composer/_after.mobile.png  (mobile 390)

JUGE TON PROPRE RENDU sévèrement, en œil de designer — l'IMAGE, pas le code :
  • 🚨 NAVBAR AU REPOS (en haut, AVANT scroll) — DÉFAUT RÉCURRENT ÉLIMINATOIRE : les liens du menu ET LE LOGO sont-ils VISIBLES sur le fond DERRIÈRE eux ? Si le héros est CLAIR, des liens/logo CLAIRS = blanc-sur-blanc = INVISIBLES. Corrige SANS FAUTE : texte/logo sombres au repos (puis clairs au scroll si la nav devient sombre), ou pose un léger scrim dégradé sous la nav. Regarde le coin haut du _after.png : si tu ne LIS pas les liens ou ne VOIS pas le logo, c'est cassé.
  • 🚨 LOGO — il doit TOUJOURS se voir (jamais clair-sur-clair ni sombre-sur-sombre). Détoure/inverse/ajoute un fond si besoin. Un logo invisible = échec.
  • 🚨 HÉROS VIDÉO — si \`data/assets/${id}/hero.mp4\` existe, le héros DOIT être cette VIDÉO en fond (muted/autoplay/loop/poster), copiée dans \`assets/\` du site, PAS une image fixe. Vérifie qu'elle joue.
  • 🚨 HOVER PARTOUT — chaque élément interactif (liens nav, boutons, cartes, items de galerie, CTA) a un état :hover net (~.2s : couleur/underline/lift/zoom). Liste ceux qui n'en ont pas → ajoute-le. « Presque tout doit réagir au survol » (naly).
  • Hiérarchie : l'œil sait où aller ? le héros FRAPPE ? le titre porte ?
  • Rythme & espace : respirations régulières, pas de trou béant ni de section tassée, alignements francs ?
  • Couleur & contraste : palette harmonieuse, texte lisible partout, jamais clair-sur-clair ?
  • Finition : ça ressemble à un site PRIMÉ, ou ça sent le « généré par IA » (plat, générique, centré-étroit paresseux) ?
  • Héros / photos : l'image VEND ? cadrée, nette, plein-bleed quand il faut ?
  • Mobile : même hiérarchie, rien de cassé/tassé, titres entiers.

PUIS CORRIGE PAR PATCH CIBLÉ — tu touches au CSS/markup EXISTANT pour régler CE QUE TU VOIS (espacements, échelle typo,
contraste, cadrage du héros, alignements, la couleur qui jure). PAS de regénération, PAS de réécriture complète : tu
gardes le contenu RÉEL et la structure, tu élèves le rendu. Vise un truc qu'on poserait sur Awwwards.

UN SEUL ROUND (VITESSE — le beauty-gate juge ensuite) : patch les 2-3 défauts les plus visibles → \`node design/scripts/lint.mjs output/sites/${id}/${date}-composer/index.html --fix\`
(reste clean:true) → \`node design/verify/verify.cjs output/sites/${id}/${date}-composer/index.html output/sites/${id}/${date}-composer/_after.png\`
(reste clean:true : 0 overflow / image cassée / void / titre rogné) → STOP. N'introduis JAMAIS un défaut mécanique
(re-vérifie clean). Si dès le 1er regard c'est déjà excellent → 0 patch, retourne improved:false. Ne boucle pas pour gratter 5%.

Retourne {improved, rounds, fixes:[ce que tu as changé], notes}.`

// JUGE À L'AVEUGLE : on ne dit PAS lequel est le nouveau, et on ALTERNE l'ordre A/B (anti-biais). _after.png est PLEINE PAGE (verify.cjs fullPage) → comparable à avant.png.
const judgePrompt = (id, newIsA) => `Juge de design NEUTRE et SÉVÈRE, À L'AVEUGLE. Deux maquettes de page d'accueil, "A" et "B" — tu n'es PAS informé de laquelle est récente ni de leur origine. Ne te laisse PAS influencer par les chemins de fichiers : juge l'IMAGE.
  • Image A : ${newIsA ? `output/sites/${id}/${date}-composer/_after.png` : `data/assets/${id}/avant.png`}
  • Image B : ${newIsA ? `data/assets/${id}/avant.png` : `output/sites/${id}/${date}-composer/_after.png`}
Read les DEUX images. Juge UNIQUEMENT le design visuel (beauté, hiérarchie, typo, finition, confiance, modernité). Retourne {more_beautiful:'A'|'B'|'tie', margin:'much'|'somewhat'|'tie', reasons}.`

// ── SYNC PAR SITE (TEMPS RÉEL) : dès qu'un site est composé, on le pousse vers la VM (bucket + reindex DB
//    partagée), de façon DÉTERMINISTE — le cockpit l'affiche sans attendre la fin du batch. ──
const syncPrompt = (id) => `Synchronise le site "${id}" vers la VM MAINTENANT (incrémental, PAS en fin de batch). En Bash, depuis la racine du repo, exécute EXACTEMENT :
  npx tsx scripts/sync-site.ts ${id} ${date}-composer
Ce script pousse le site COMPLET (index.html + photos + hero.mp4/webm/poster, même gitignorés) vers le bucket Supabase ET réindexe la génération dans la DB partagée → le cockpit de la VM la liste et la sert IMMÉDIATEMENT. Si une commande échoue (réseau), relance-la UNE fois. AFFICHE et retourne la ligne de timing qu'il imprime ("⏱ ${id} : <n> sec …").`

phase('Diagnose')
const results = await pipeline(
  IDS,
  // 1 ── diagnose → brief
  (id, _o, i) => agent(diagnosePrompt(id), { label: `diagnose:${id}`, phase: 'Diagnose', schema: BRIEF, ...withModel('judge') }).then((brief) => ({ id, brief, i })),
  // 2 ── asset-boost (image OpenAI + vidéo Higgsfield, chacun coupable) : visuels nets avant compo
  async (prev) => {
    const { id } = prev
    const score = SCORES[id] ?? 0
    const a = await agent(assetPrompt(id, score), { label: `assets:${id}`, phase: 'Assets', schema: ASSETS })
    return { ...prev, assets: a }
  },
  // 3 ── composer + filet déterministe + beauty-gate (loopback cap GATE_MAX_LOOPS = 2)
  async (prev) => {
    const { id, brief, i } = prev
    const p = PAIRINGS[i % PAIRINGS.length]
    const arch = ARCHETYPES[i % ARCHETYPES.length]
    const tone = i % 2 === 0 ? 'CLAIR & lumineux (fond clair dominant)' : 'SOMBRE & cinématique (fond sombre dominant)'
    const newIsA = i % 2 === 0
    let critique = '', last = null
    for (let k = 0; k < GATE_MAX_LOOPS; k++) {
      const c = await agent(composePrompt(id, brief, p, arch, tone, critique), { label: `compose:${id}#${k + 1}`, phase: 'Compose+Gate', schema: COMPOSE, ...withModel('smart') })
      if (!c || !c.ok) { last = { id, pass: false, loops: k + 1, font: p && p.display, error: 'compose failed' }; break }
      // 👁 ŒIL DU PEINTRE : le composer Read SES captures et patche les défauts visuels AVANT le juge (sighted
      //    self-fix ciblé, pas de regen). Best-effort — ne bloque jamais le batch si la revue échoue.
      await agent(selfReviewPrompt(id), { label: `revue:${id}#${k + 1}`, phase: 'Compose+Gate', schema: SELFREVIEW, ...withModel('judge') }).catch(() => null)
      const v = await agent(judgePrompt(id, newIsA), { label: `judge:${id}#${k + 1}`, phase: 'Compose+Gate', schema: VERDICT, ...withModel('judge') })
      const newLabel = newIsA ? 'A' : 'B'
      const pass = v && v.more_beautiful === newLabel && v.margin === 'much'
      last = { id, pass, loops: k + 1, font: (c && c.fontPair) || (p && p.display), arch, before: brief && brief.beauty_before && brief.beauty_before.score, heroVideo: prev.assets && prev.assets.heroVideo, verdict: v }
      if (pass) break
      critique = v ? v.reasons.join(' · ') : 'pas assez beau'
    }
    return last
  },
  // 4 ── SYNC IMMÉDIAT du site (incrémental — l'opérateur le voit sans attendre la fin du batch)
  async (prev) => {
    if (SYNC && prev && prev.id && !prev.error) {
      try { await agent(syncPrompt(prev.id), { label: `sync:${prev.id}`, phase: 'Sync' }) } catch (_) { /* sync best-effort, ne bloque pas le batch */ }
    }
    return prev
  },
)

const clean = results.filter(Boolean)
const passed = clean.filter((r) => r.pass)
log(`compose-batch: ${passed.length}/${clean.length} PASS · fonts: ${[...new Set(clean.map(r => r.font))].length} distinctes · vidéos héro: ${clean.filter(r => r.heroVideo).length} · image=${BOOST ? IMAGE : 'off'} vidéo=${BOOST ? VIDEO : 'off'} sync=${SYNC}`)
return {
  engines: { boost: BOOST, image: BOOST ? IMAGE : 'none', video: BOOST ? VIDEO : 'none', sync: SYNC, models: MODELS },
  passed: passed.map((r) => ({ id: r.id, font: r.font, arch: r.arch, before: r.before, heroVideo: r.heroVideo, loops: r.loops, verdict: r.verdict })),
  failed: clean.filter((r) => !r.pass).map((r) => ({ id: r.id, font: r.font, loops: r.loops, verdict: r.verdict, why: r.error || (r.verdict && r.verdict.reasons && r.verdict.reasons.join(' · ')) })),
}
