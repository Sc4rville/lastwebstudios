/**
 * test-send.ts · envoie UN mail de test via l'API Gmail (compte de service) pour valider la chaîne
 * complète après la délégation domaine. ENVOI RÉEL : seulement avec LWS_LIVE_SEND=1 (sinon sendMail refuse).
 * Usage : LWS_LIVE_SEND=1 npx tsx outreach/scripts/test-send.ts <inbox> <destinataire>
 * Ex : LWS_LIVE_SEND=1 npx tsx outreach/scripts/test-send.ts camille@ton-agence.example toi@ta-boite.example
 */
import { sendMail } from "./lib/smtp.ts"
import { agency } from "../../packages/shared/agency.mjs"

const [inbox, to] = process.argv.slice(2).filter((a) => !a.startsWith("-"))
if (!inbox || !to) { console.error("usage : LWS_LIVE_SEND=1 npx tsx outreach/scripts/test-send.ts <inbox> <destinataire>"); process.exit(1) }

const a = agency()
await sendMail({
  inbox,
  to,
  subject: `Test infra ${a.name} ✓`,
  body: "Petit test d'envoi via l'API Gmail (compte de service, délégation domaine). Si tu lis ça dans ta boîte de réception, toute la chaîne fonctionne : authentification + envoi au nom de la boîte.",
  senderName: a.mail.senderName,
  trackingId: "test-0001",
})
console.log(`✅ mail de test envoyé : ${inbox} → ${to}`)
