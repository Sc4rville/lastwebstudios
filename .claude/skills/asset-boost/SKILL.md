---
name: asset-boost
description: Improve a prospect's visual assets BEFORE composing — upscale low-res/ugly photos, clean the logo (remove background), widen a photo for a hero band, and (last resort) generate ATMOSPHERIC/abstract fillers — via the Higgsfield MCP. The asset-quality maillon between parse and compose. Use when assets are low-res, ugly, too few, or missing, or the user says "upscale", "améliore les photos", "génère des visuels", "remove bg du logo". Honesty rule: enhance the REAL assets ; never fabricate fake photos of THEIR work.
user-invocable: true
argument-hint: "<prospectId>"
license: Apache 2.0
metadata:
  status: active
---

> ✅ **STANDARD — toujours actif** (décision 2026-06-20). asset-boost tourne sur **CHAQUE site** :
> au moins une photo boostée par site, systématiquement (plus d'opt-in « jusqu'à la 1re vente »).
> Le seul cran coûteux gardé conditionnel = le **héro vidéo** (couche cinématique, réservée aux
> prospects chauds **score > 65**, cf. `web-cinematics`).

> ⚙️ **MOTEURS (à jour 2026-10-24, fait foi sur le reste de ce fichier)** : en batch (`compose-batch.workflow.js`),
> l'**image** passe par `node worker/openai-image.mjs` (OpenAI en direct, `LWS_IMAGE=openai|none`,
> `OPENAI_IMAGE_BASE_URL`, `OPENAI_IMAGE_MODEL`) et la **vidéo** par `node worker/hero-cli.mjs` (CLI Higgsfield,
> `LWS_VIDEO=higgsfield|none`). Le lanceur passe `args.image` / `args.video` ; un moteur à `none` est sauté, jamais
> remplacé, et le minimum « une photo boostée » ne s'applique que si un moteur image est disponible. Les sections
> **Higgsfield MCP** ci-dessous valent pour un usage interactif (session avec le MCP), pas pour le batch headless.

Le maillon **ASSET-BOOST** : un composer brillant sur des **photos pourries** rend un site moyen. Avant de
composer, on **remonte la qualité visuelle** du prospect. C'est le complément « génération/upscale » de la
curation (garder/écarter) : ici on **répare et on comble**.

```
parse (assets bruts) → diagnose → ★ asset-boost (AUDIT → upscale/relight/borderless/vidéo) → composer
```

⚠ **Câblé dans le pipeline** : le maillon tourne dans `compose-batch.workflow.js` (phase **Assets**, entre
diagnose et compose). Plus un orphelin.

## Étape 0 — l'AUDIT déterministe (toujours, zéro crédit)
`node design/scripts/asset-audit.mjs <id>` → écrit `data/assets/<id>/_audit.json` : pour chaque photo la
résolution native, HD ou pas, le ratio, l'aptitude **borderless**, l'**héro candidat**, et l'`action`
mécanique (`crop-ok` / `upscale+relight` / `thumbnail`). **C'est lui qui dit quoi booster** — tu n'estimes pas à l'œil.

## Ce qu'on fait (Higgsfield MCP) — par ordre de préférence
1. **Améliorer le RÉEL en gardant l'AUTHENTICITÉ** (le défaut — leur vraie photo, juste mieux captée) :
   - **RÈGLE FERME — UPSCALE TOUT** : pars du principe que **toutes leurs photos sont floues**. **Chaque** image
     qui ira sur la landing passe par `upscale_image` (et toute photo `action != "crop-ok"` dans `_audit.json`
     → upscale **+ relight** obligatoire) — **jamais** une image basse-déf/terne servie telle quelle.
   - **JAMAIS un screenshot du site comme asset.** Si une vraie photo ne s'extrait pas proprement (verrouillée,
     en background CSS, recouverte d'UI…) : screenshot-la, PUIS Higgsfield (`remove_background` / modèle
     d'édition, consigne « retire le texte/les boutons/le HTML par-dessus ») pour **isoler le vrai visuel** —
     on sert l'image propre, **jamais** la capture d'écran avec l'interface du site.
   - **MINIMUM OBLIGATOIRE — au moins UNE photo boostée par site, toujours** : même si toutes les photos
     sont déjà HD, fais passer le **héro** par un relight/upscale fin + élargissement borderless. Zéro photo
     boostée sur un site (hors prospect à 0 photo) = le maillon a échoué.
   - **Upscale** — `upscale_image` (2K/4K) sur les basse-déf *(passer `width`/`height` de la source)*.
   - **Relight / corriger** — `models_explore` → modèle d'édition, photo en `medias` + consigne (expo,
     balance des blancs, lumière trop sombre/orange, débruitage). **On corrige la lumière, on ne change pas le lieu.**
   - **Resize BORDERLESS (important)** — pour un héro **plein-bleed net**, `outpaint_image` pour **élargir au
     ratio cible** (l'héro candidat de l'audit) sans déformer ni inventer. **Le DESIGN commande le format,
     l'asset suit** : mieux vaut une belle photo borderless nette qu'un grand bloc flou.
2. **Nettoyer le logo** — `remove_background` (fond sale/blanc qui jure → transparent) → règle logo-contraste.
3. **Générer — DERNIER recours, atmosphérique/abstrait SEULEMENT** — `generate_image` pour un **fond**
   (mesh, grain, texture, motif), **jamais** une fausse réalisation. Mood depuis le `playbook.md` du métier.

## Vidéo de héro — prospects à FORT potentiel (opportunité > 65/100)
Pour un prospect chaud, un **héro vidéo** fait passer le site dans une autre ligue. **Pars des ASSETS d'abord** :
1. **Image-source** : l'héro **boosté** (upscalé/relighté) = la **1re frame** → continuité avec leur vrai lieu.
2. **Storyboard** court (mouvement **lent**, 5-8 s, **bouclable**) écrit AVANT l'appel — `generate_video`
   (`models_explore` pour un modèle image→vidéo). **AUCUN texte incrusté dans la vidéo** : le JS posera le
   titre/CTA **par-dessus**.
3. **Conscient du JS par-dessus** (clé) : prévois une **zone de lisibilité** (côté ou bas calme, contraste
   suffisant pour un voile/overlay), mouvement qui ne combat pas le texte. Le composer la pose en fond
   (`muted/autoplay/loop/playsinline`, `poster` = image héro, **image fixe en `prefers-reduced-motion`**).
4. Sortie `data/assets/<id>/hero.mp4` (+ poster). `get_cost` avant — la vidéo coûte ; réservée aux > 65.

## ⚠ La ligne d'honnêteté (non négociable)
- **On améliore le réel ; on n'invente pas le portfolio.** Générer une « cuisine », un « domaine », une
  « piscine » photoréaliste et la faire passer pour **leur** travail = **mensonge** (et risque client). Interdit.
- Le généré = **fonds/textures/ambiances abstraits** uniquement, ou un visuel clairement décoratif.
- **Tracer** : tout asset upscalé/généré est noté dans `data/assets/<id>/_boost.json` (source, action,
  généré oui/non) → transparence + le composer sait ce qui est réel vs décoratif.

## Workflow Higgsfield (à savoir)
La source doit d'abord exister côté Higgsfield : `media_import_url` (depuis l'URL d'origine de la photo,
captée au parse) → `media_id` → `upscale_image`/`remove_background`/`outpaint_image` → récupérer le résultat
→ écrire dans `data/assets/<id>/` (suffixe `-2k`/`-cut`). *(Le `media_upload_widget` pour fichier local est
interactif → préférer `media_import_url` en headless.)* `get_cost:true` pour préflighter les crédits.

## Rapporte
Ce qui a été upscalé/nettoyé/généré (avec la trace), et ce qui reste faible (à reshooter côté client).
