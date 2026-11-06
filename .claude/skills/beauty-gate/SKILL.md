---
name: beauty-gate
description: The "much more beautiful" gate after composing. Screenshots the newly composed site, then a NEUTRAL context-free judge compares it BLIND against the prospect's original site (avant.png) — not told which is which, no business context, no brief — and decides if the new design is CLEARLY more beautiful. If it is not, automatic loopback : re-compose with the judge's critique, until the new wins decisively (or a loop cap). Triggers: "beauty-gate <prospect>", "is the new site much more beautiful", "check the redesign beats the original", "juge avant/après". Not the human review (control.md) nor the design itself (composer).
user-invocable: true
argument-hint: "<prospectId> [date]"
license: Apache 2.0
metadata:
  status: test
---

> ⚠ **MODE TEST** (cf. `/skilldraft` §6) — skill jeune : préviens avant usage, jamais en auto/non surveillé.
> Promotion après ≥3 usages validés.

La **beauty-gate** : le garde-fou qui garantit que le nouveau site est **beaucoup plus beau** que l'ancien,
jugé par un **œil neutre et aveugle**. C'est le verifier qui ferme la boucle `compose` :

```
composer → ★ beauty-gate (juge avant/après en aveugle) → PASS ✔  |  FAIL → loopback → recompose
```

## Entrée
- `data/assets/<id>/avant.png` — le **site original** du prospect.
- `output/sites/<id>/<date>/index.html` — le **site composé** (le plus récent si `date` omis).

## Déroulé
1. **Capture** le site composé : `node design/verify/verify.cjs <site>/index.html <site>/_after.png`
   (pleine page : tu peux aussi faire une capture pleine page dédiée). Tu as donc 2 images : `avant.png` et `_after.png`.
2. **Juge NEUTRE et AVEUGLE** — spawn un **sous-agent** (`general-purpose`) à qui tu donnes **uniquement les
   2 images**, étiquetées **A** et **B** dans un **ordre que tu alternes** (parfois l'ancien en A, parfois en B),
   **sans aucun contexte** (pas le métier, pas le brief, pas de « nouveau/ancien »). Prompt type :
   > « Voici deux maquettes de page d'accueil, A et B. Juge **uniquement le design visuel** (beauté,
   > hiérarchie, typographie, finition, confiance, modernité). Laquelle est la plus belle, et de combien :
   > **A≫B / A>B / égalité / B>A / B≫A** ? Donne 2-3 raisons. Ne devine pas le métier. »
3. **Mappe** A/B → ancien/nouveau. **PASS uniquement si le NOUVEAU gagne nettement** (`≫`, « beaucoup plus
   beau »). Un simple `>` ou une égalité = **FAIL**.
4. **FAIL → loopback automatique** : relance `/composer <id>` en lui passant **la critique du juge** comme
   feedback (« le nouveau n'est pas nettement plus beau parce que X, Y → corrige »), recompose, re-capture,
   re-juge. **Cap : 2 boucles** (`GATE_MAX_LOOPS` dans `architecture/orchestration/compose-batch.workflow.js`) ; si toujours FAIL au bout de 2, **s'arrêter et le signaler à l'humain**
   (ne pas boucler à l'infini, ne pas truquer le verdict).
5. **Logue** dans le `control.md` du site : `beauty_before` (de `diagnose`) vs verdict de la gate (gagnant +
   marge + nb de boucles).

## Garde-fous
- **Vraiment aveugle** : le sous-agent ne reçoit **que les pixels** + un prompt neutre. Alterner l'ordre A/B
  évite le biais de position. C'est ce qui rend le « beaucoup plus beau » crédible (pas auto-complaisant).
- **Honnêteté > vert** : si après 2 boucles ça ne passe pas, le dire (le composer/diagnose a un vrai problème
  à corriger) — jamais forcer un PASS.
- C'est l'**embryon du gate visuel** (juger la beauté) et le point d'ancrage de la **boucle d'apprentissage**
  (les critiques répétées du juge → règles pour le composer).
