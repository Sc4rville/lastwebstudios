# Skills — index par catégorie

Tous les skills **vivent dans `.claude/skills/`** (versionnés) et s'invoquent de là (`/<nom>`).
Ce doc se limite à les **lister par catégorie**, pour repérer rapidement "qui sert à quoi".
La méthode → `docs/PHILOSOPHY.md`.

**Le compte exact (vérifié par `test/docs.test.ts`)** : `.claude/skills/` contient **14 dossiers** =
**12 skills Claude Code** (un `SKILL.md` avec frontmatter, invocables en `/<nom>`) +
**2 modules de prompt** (`prompt.md` seul, lancés par le runner `packages/utils/run-skill.ts` :
`generate-savior`, `structuration`) +
**0 skill interne**.


## Lead engine (trouver/qualifier/lire les prospects)
| skill | rôle |
|-------|------|
| `/structuration` *(via runner)* | texte brut scrapé → fiche `ProspectSheet` propre |
| `/find-brief` | **le brief de recherche** : « 20 plombiers et couvreurs autour d'Austin » → `{trades, place, country, count, mix}` pour le moteur (rôle fast, toutes les voies `LWS_LLM`) ; appelé par le cockpit (champ « Tell the agency what you're after ») ; en sandbox un parseur déterministe répond |
| `/radar-industries` *(test)* | score les **MÉTIERS** (pas les prospects) → quelles verticales viser, et **crée** une industrie de bout en bout (`npm run radar`) ; voir `design/industries/RADAR.md` |
| `/visual-scoring-gate` *(test)* | l'axe BESOIN du scoring : screenshots + LLM jugent la beauté ; appelé par `scoreProspect()` si la porte gratuite recale (`npm run gate`) |

## Design — library-first : extract → compose (cf. `docs/DESIGN-ENGINE.md`)
**EXTRACT** (alimente le catalogue `design/`)
| skill | rôle |
|-------|------|

**RÉFLEXION** (avant de composer)
| skill | rôle |
|-------|------|
| `/diagnose` *(test)* | analyse le **site actuel** du prospect (`avant.png` + fiche) → **brief** (c'est quoi / ce qui cloche / angle + moves) écrit dans la fiche ; le composer le suit |
| `/asset-boost` *(test)* | remonte la **qualité visuelle** avant compose (upscale / relight / recadrage / remove-bg logo / fond généré atmosphérique) via Higgsfield — **améliore le réel, ne fabrique pas** |
| `/web-cinematics` *(test)* | la couche **cinématique** (le « $10k film au scroll ») : réflexion par métier → storyboard → key-frames IA (GPT Image 2 si packaging) → motion vidéo (Seedance/Kling) ; **génère**, là où asset-boost **améliore le réel** ; consommé par le composer |

**COMPOSE** (pioche le catalogue)
| skill | rôle |
|-------|------|
| `/composer` *(test)* | **free composer** : fiche + **brief** → site sur mesure ciblé (latitude + mantras + verdict), sans moule |
| `/frontend-design` | la **philosophie esthétique** (anti-AI-slop) que le composer suit ; typo/couleur/motion/icônes |

**GATE** (après compose)
| skill | rôle |
|-------|------|
| `/beauty-gate` *(test)* | juge **neutre & aveugle** avant/après → PASS si le nouveau est **nettement plus beau**, sinon **loopback auto** (recompose, cap 2 : `GATE_MAX_LOOPS` dans `compose-batch.workflow.js`) |

**Template-fill** (voie secondaire, prouvée)
| skill | rôle |
|-------|------|
| `/review` | applique les commentaires laissés dans les `control.md` des sites générés |

## Distribution — montrer & contacter
| skill | rôle |
|-------|------|
| `/account-research` *(test)* | intel avant l'appel : lit nos données (fiche/scoring/diagnose/competitor) + web → **brief** + **script d'appel customisé** → `npm run research:save` → s'affiche dans le CRM `/outreach` (« 📞 Script d'appel ») |
| `generate-savior` *(prompt.md, via script)* | le **mail parfait** (savior) : un mail court, personnalisé et honnête par prospect (`npm run savior -- <id>` → `data/savior/<id>.json`), filtre « zéro tiret cadratin » en dur ; c'est l'étape 1 du séquenceur |
| `/outreach-mail` *(test)* | brouillons Gmail ciblés (email vérifié Playwright + **lien vidéo démo** dans le mail) ; `npm run outreach` / `:mark` |



> Un skill complémentaire d'un autre (ex. le playbook d'impeccable) vit **dans le dossier du skill**
> (`.claude/skills/<skill>/`), pas dans `docs/`.
