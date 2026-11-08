/**
 * test-send.ts · sends ONE test email through the Gmail API (service account) to check the whole chain
 * after the domain-wide delegation. A REAL SEND: only with LWS_LIVE_SEND=1 (otherwise sendMail refuses).
 * Usage: LWS_LIVE_SEND=1 npx tsx outreach/scripts/test-send.ts <inbox> <recipient>
 * E.g.:  LWS_LIVE_SEND=1 npx tsx outreach/scripts/test-send.ts camille@your-agency.example you@your-company.example
 */
import { sendMail } from "./lib/smtp.ts"
import { agency } from "../../packages/shared/agency.mjs"

const [inbox, to] = process.argv.slice(2).filter((a) => !a.startsWith("-"))
if (!inbox || !to) { console.error("usage: LWS_LIVE_SEND=1 npx tsx outreach/scripts/test-send.ts <inbox> <recipient>"); process.exit(1) }

const a = agency()
await sendMail({
  inbox,
  to,
  subject: `Test infra ${a.name} ✓`,
  body: "A quick sending test through the Gmail API (service account, domain-wide delegation). If you are reading this in your inbox, the whole chain works: authentication + sending on behalf of the mailbox.",
  senderName: a.mail.senderName,
  trackingId: "test-0001",
})
console.log(`✅ test email sent: ${inbox} → ${to}`)
