# Scoring model

But : faut-il investir un site + un pitch sur ce prospect, et va-t-on le closer ?

## 2 gates (échec = score 0, écarté)
- **FIT** : bonne industrie, indépendant (hors chaîne), business actif.
- **FEASIBILITY** : assez de contenu/photos pour bâtir une démo de qualité.

## 5 axes (chacun noté /100, pondéré)

| poids | axe | la question |
|:---:|---|---|
| **30** | BESOIN | son site actuel est-il faible ? (juge visuel) |
| **25** | LEVIER | un meilleur site changerait quoi pour lui ? (vend-il via le web ?) |
| **20** | VALEUR | peut-il payer ? un client gagné rembourse-t-il largement ? |
| **15** | CLOSABILITÉ | joignable (ligne du dirigeant), TPE = décideur unique |
| **10** | EXPANSION | potentiel futur (réservation, e-commerce, app, récurrent) |

**Score = Σ (axe × poids) / 100**, mis à 0 si une gate échoue.
Paliers : `hot ≥ 60 · warm ≥ 35 · cold < 35`.

## Order (le coûteux en dernier) — **modèle complet câblé (2026-06-13)**
1. **gratuit** : `techProbe()` (besoin technique + faisabilité, HTML brut) + CLOSABILITÉ (tél/email
   récupérés au scraping) + LEVIER/VALEUR/EXPANSION (baselines métier, `industries.ts`).
2. **moyen** : BESOIN visuel (screenshots + LLM, `visual-gate.ts`) — appelé SEULEMENT si le besoin
   technique est faible (< 60) ; `besoin = max(tech, visuel)`. `VISUAL=0` le coupe.
3. **cher** *(à venir)* : VALEUR fine (CA via Pappers/SIREN) + EXPANSION affinée — sur les retenus.

Les 5 axes sont assemblés et pondérés dans `model.ts` (`buildAxes` → `weighted`). La porte appelle
`scoreProspect(id, url, {industry, phone, email, effectif?})`.

**Taxonomie** : tout métier passe par `normalizeIndustry()` (`industries.ts` = vocabulaire canonique
UNIQUE ; alias `piscine→pisciniste`, `couverture→couvreur-zingueur`…). Hors-table = signalé, jamais
silencieux (avant : fallback générique `value 50` muet — 1/3 du portefeuille scoré à l'aveugle).

**Gates supplémentaires** : joignabilité (ni email ni tél → jamais `hot`, plafonné warm) ; le signal
**AUDIT** (`3_parsing/audit.ts` : lenteur réelle, chevauchements, images mortes…) est réinjecté dans le
besoin (`besoinFromAudit`, `besoin = max(tech, visuel, audit)`).

**Re-score du portefeuille** (`rescore.ts`, `npm run rescore [-- <id..>]`) : guérison OFFLINE des fiches
existantes — normalise la taxonomie, remplace les scores placeholder, rebâtit axes + `expectedValue`
(le tri par €) avec toutes les gates. À lancer après un changement de modèle ou un audit ; puis
`npm run reindex`.

**Axes différenciés par prospect (pas juste par métier).** Levier/valeur/expansion partent d'une
baseline métier MAIS sont ajustés par des **signaux gratuits lus dans le HTML** (même fetch que la
sonde) : galerie/portfolio + CTA devis + réseaux → **levier** ; sur-mesure/premium/showroom +
multi-agences → **valeur** ; e-commerce/réservation/blog → **expansion**. Un site vitrine inerte
(ni galerie ni CTA) est pénalisé en levier. Résultat : un vrai **classement** entre prospects d'un
même métier (vérifié : 5 cuisinistes de levier 70 à 98 selon l'usage réel du site).

### Gates
- **FIT** : métier connu + indépendant (chaînes déjà exclues au scraping).
- **FEASIBILITY** : assez de contenu/images pour bâtir une démo. Site mort ou trop pauvre → plafonné
  à `warm` (refonte manuelle depuis zéro, rien à parser/cloner), jamais envoyé en prod auto.

## Output
`value` + `tier` + `axes` (les 5 notes) + `reasons` + `accroche` (faiblesse n°1 → angle du mail).
