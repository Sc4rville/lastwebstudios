# Tracking outreach auto-hébergé (clic + désinscription 1-clic)

Le **cockpit** (`npm run backoffice`, `backoffice/reviewpipe/serve.ts`) sert lui-même le tracking sous `/t/`.
Il n'y a plus d'edge function Supabase : elle n'était pas versionnée et répondait 402 depuis le gel du quota.

```
mail (séquenceur)                       cockpit, public, sans mot de passe              séquenceur (tick)
  lien réécrit ─────── clic ──────────▶ GET  /t/c/<jeton>  → évènement click + 302 ─┐
  List-Unsubscribe ─── bouton Gmail ──▶ POST /t/u/<jeton>  → évènement unsub       ├─▶ outreach_events (base)
  pied « un clic suffit » ── lien ────▶ GET  /t/u/<jeton>  → page + bouton (POST)  │   ou data/sequencer/events.jsonl
                                                                                    └─▶ clic = escalade débloquée
                                                                                        désinscription = sortie
```

## Les jetons (`links.ts`, calcul pur)
- **clic** : `/t/c/<id22>.<url base64url>.<signature 16>`. L'URL de destination est **dans** le jeton et
  **signée** (HMAC-SHA256 de `trackingId + url`, `LWS_TRACK_SECRET`). Le cockpit ne redirige donc que vers des
  URL qu'il a lui-même mises dans un mail (finding F-3 de l'audit : fini la redirection ouverte `?u=`).
- **désinscription** : `/t/u/<id22>.<signature 16>`. La signature porte un préfixe de type : un jeton de clic ne
  vaut pas désinscription.
- `id22` = le `trackingId` de l'envoi (UUID, `data/sequencer/sends.jsonl`) en base64url, validé au décodage.

## L'endpoint (`endpoint.ts`)
| requête | réponse |
|---|---|
| `GET /t/c/<jeton>` valide | `302` vers l'URL signée + évènement `click` (user-agent de scanner → `suspect`, ignoré par l'escalade) |
| `HEAD /t/c/<jeton>` | `302` sans évènement (les passerelles mail sondent en HEAD) |
| jeton forgé / mal formé / `?u=…` | `403` / `400`, aucune redirection, rien d'enregistré |
| `GET /t/u/<jeton>` | page de **confirmation** avec un bouton : rien n'est enregistré (un scanner ne désinscrit personne) |
| `POST /t/u/<jeton>` + `List-Unsubscribe=One-Click` | évènement `unsub` (RFC 8058 : le bouton natif de Gmail / Yahoo) ; corps > 1 Ko → `413` |
| sans `LWS_TRACK_SECRET` | `404` : rien n'est vérifiable, donc rien n'est suivi ni redirigé |

Plafonds (`events.ts`, `CAPS`) : 20 évènements d'un même type par envoi, user-agent et URL tronqués, fichier de
repli borné à 20 Mo. Au-delà : refusé sans erreur. Un clic arrivé moins de 60 s après l'envoi est compté comme un
scanner par le séquenceur.

## Le mail (`outreach/scripts/lib/smtp.ts`)
`buildMessage()` construit le message **complet**, identique en dry-run et en réel : liens réécrits, pied légal
avec le lien de désinscription, en-têtes `List-Unsubscribe: <https…>, <mailto:…>` et
`List-Unsubscribe-Post: List-Unsubscribe=One-Click`. En dry-run, le séquenceur l'écrit en `.eml` dans
`data/sequencer/outbox/` : ce qu'on relit est exactement ce qui partirait.

## Régler
```bash
# sur le cockpit ET sur la machine du séquenceur (le même secret)
TRACK_BASE=https://cockpit.agence.example      # l'URL publique du cockpit (https en prod)
LWS_TRACK_SECRET=$(openssl rand -base64 48)    # ≥ 32 caractères
```
L'un des deux manque : aucun lien réécrit, désinscription par réponse « STOP » + en-tête `mailto:` seulement.
Avec une base (`DATABASE_URL`), cockpit et séquenceur partagent la table `outreach_events` (`db/schema.sql`) ;
sans base (tout sur une machine), ils partagent `data/sequencer/events.jsonl`.

## Preuves
`test/outreach/tracking.test.ts` (jetons, plafonds, RFC 8058) et `test/funnel.e2e.test.ts` (le funnel du film
de bout en bout : clic signé → escalade débloquée, désinscription 1-clic, F-3, 0 appel au transport en dry-run).
