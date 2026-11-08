/**
 * insights.ts · what the cockpit says about a prospect's current site, in plain English, from the engine's
 * codes (audit, score reasons, diagnosis). The data of a French prospect stays French ; these phrases are chrome,
 * generated here from codes, never raw strings (no « pas responsive (pas de viewport) », no viewport / OG / meta
 * jargon). Deduplicated ; the call panel gets 3 to 6 bullets ; the sandbox's « Ask the agent » writes from the same
 * codes, so its counts always match its list.
 */
export type Insight = string
/** one problem the engine saw : a stable code, the tag a card shows, what the new site changes, and the sentence the
 *  cockpit's « Why it's on your list » says (the words before the colon are the point, the rest says what it means) */
export type Why = { code: string; tag: string; fix: string; say: string }
// « No HTTPS » → « no HTTPS » in a sentence (only the first letter : acronyms and names keep their case)
const lc = (t: string) => t ? t[0].toLowerCase() + t.slice(1) : t
const add = (out: string[], t?: string | null) => { const s = (t || "").trim(); if (s && !out.some((x) => x.toLowerCase() === s.toLowerCase()) && out.length < 6) out.push(s) }

// what each problem means to the owner, in one plain sentence (the cockpit bolds the words before the colon)
const SAY: Record<string, (tag: string) => string> = {
  mobile: () => "Doesn't work on a phone: tiny text, nothing to tap. The new site puts their number one tap away.",
  https: () => "No HTTPS: browsers mark the site as not secure.",
  dated: (t) => `${t.replace(/^Site from/, "Last updated in")}: it shows, and visitors notice.`,
  thin: () => "Almost no content: a visitor can't tell what they do.",
  photos: () => "No photos of their work: nothing to show customers what they get.",
  contact: () => "No way to reach them from the site: no form, no email, no phone link.",
  email: () => "No email on the site: a customer can only call.",
  google: () => "Hard to find on Google: search results get no description of what they do.",
  tech: () => "Built on dated technology: slow, and hard to update.",
  buttons: (t) => `${t}: visitors click and nothing happens.`,
  form: () => "Broken contact form: messages from customers go nowhere.",
  slow: () => "Slow to load: visitors leave before it opens.",
}
/** the problems the engine saw (the gate's reasons + the audit), as codes, at most 4, most telling first */
export function whyCodes(sheet: any): Why[] {
  const out: Why[] = []
  const push = (code: string, tag: string, fix: string) => { if (!out.some((w) => w.code === code)) out.push({ code, tag, fix, say: SAY[code] ? SAY[code](tag) : `${tag}: the new site fixes it.` }) }
  const reasons: string[] = Array.isArray(sheet?.score?.reasons) ? sheet.score.reasons : []
  const txt = reasons.join(" | ").toLowerCase()
  const a = sheet?.audit || {}
  if (/responsive|viewport|mobile/.test(txt) || a.mobile?.hasViewportMeta === false || a.mobile?.brokenMobile) push("mobile", "No mobile version", "it works on a phone")
  if (/https/.test(txt) || a.https === false) push("https", "No HTTPS", "it is secure (HTTPS)")
  const yr = /(?:maj|mise à jour|updated)\s*:?\s*(\d{4})/.exec(txt)?.[1] || (a.strengths?.copyrightYear && a.strengths.stale ? String(a.strengths.copyrightYear) : null)
  if (yr) push("dated", `Site from ${yr}`, `it looks current (not like ${yr})`)
  if (/peu de contenu|page très pauvre|thin/.test(txt)) push("thin", "Almost no content", "it says clearly what you do")
  if (/aucune photo|pas de photo|no photo/.test(txt) || (Array.isArray(sheet?.assets?.photos) && sheet.assets.photos.length === 0 && /photo/.test(txt))) push("photos", "No photos", "it shows your work")
  if (a.contact && !a.contact.hasForm && !a.contact.hasMailto && !a.contact.hasTel) push("contact", "No way to contact them online", "customers can reach you from it")
  else if (!sheet?.identity?.email && (a.form?.present === false || /e-?mail/.test(txt))) push("email", "No email on the site", "customers can write to you from it")
  if (/seo pauvre|\bmeta\b|description|\bog\b/.test(txt) || a.seo?.hasMetaDesc === false) push("google", "Invisible on Google", "Google can read it")
  if (/jquery|socle technique|daté|dated/.test(txt)) push("tech", "Dated technology", "it runs on current technology")
  if (a.buttons?.dead?.length) push("buttons", `${a.buttons.dead.length} dead button${a.buttons.dead.length === 1 ? "" : "s"}`, "every button works")
  if (a.form?.status === "broken") push("form", "Broken contact form", "the contact form works")
  if (a.perf?.loadMs > 4000 || a.loadMs > 4000) push("slow", "Slow to load", "it loads fast")
  return out.slice(0, 4)
}
/** why the engine picked them, as the short tags the cards show */
export function whyTags(sheet: any): string[] { return whyCodes(sheet).map((w) => w.tag) }

// a contact is a person's name (data, any language) : kept only when it looks like one, never a sentence
const personName = (s: unknown): string | null => { const t = String(s || "").trim(); return t && t.length <= 60 && !/[.!?:;]/.test(t) && t.split(/\s+/).length <= 6 ? t : null }

/** what to say on the phone, site in hand : 3 to 6 bullets, all English chrome around the prospect's own data */
export function insights(sheet: any, research: any, rec: any): Insight[] {
  const out: string[] = []
  const name = sheet?.identity?.name || "them"
  const tags = whyTags(sheet)
  if (tags.length) add(out, `Their site today: ${tags.map(lc).join(", ")}.`)
  const who = personName(research?.contact) || personName(sheet?.identity?.contact)
  if (who) add(out, `Ask for ${who}.`)
  if (rec?.competitor?.name) add(out, `A competitor nearby, ${rec.competitor.name}${rec.competitor.city ? ` (${rec.competitor.city})` : ""}, already has a modern site.`)
  const svc: string[] = Array.isArray(sheet?.content?.services) ? sheet.content.services.filter((x: unknown) => typeof x === "string" && x.trim() && x.length <= 48) : []
  // their own words stay theirs (a French business lists French services) : quoted, so they read as data, not as our sentence
  if (svc.length) add(out, `What they sell, in their words: “${svc.slice(0, 3).join("”, “")}”${svc.length > 3 ? " and more" : ""}. The new site puts that first.`)
  if (sheet?.identity?.hours) add(out, `Opening hours on their site: “${sheet.identity.hours}”. Call in those hours.`)
  if (sheet?.audit?.strengths?.googleRating) add(out, `${sheet.audit.strengths.googleRating}★ on Google (${sheet.audit.strengths.reviewCount || 0} reviews): worth putting on the site.`)
  // the way in, said as it is : phone only, or nothing at all (never « the phone is the only door » with no phone)
  if (!sheet?.identity?.email && !rec?.to) {
    if (sheet?.identity?.phone || rec?.phone) add(out, `No email for ${name}: the phone is the only door.`)
    else out.unshift(`No phone and no email on their site: find a contact before you call, or skip ${name}.`) // first : nothing else matters until then
  }
  // never fewer than 3 : the two things true of every call, site in hand
  for (const tip of ["Show the new site next to the old one while you talk.", "Ask what a new customer is worth to them before you give a price."]) if (out.length < 3) add(out, tip)
  return out.slice(0, 6)
}

const COUNT = ["", "One thing", "Two things", "Three things", "Four things"]
const list = (xs: string[], and = "and") => xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${and} ${xs[xs.length - 1]}`
// what the new site changes, in French (the email goes to a French business in French)
const FIX_FR: Record<string, string> = { mobile: "il s'affiche bien sur téléphone", https: "il est sécurisé (HTTPS)", dated: "il a l'air d'aujourd'hui", thin: "il dit clairement ce que vous faites", photos: "il montre votre travail", contact: "vos clients vous joignent depuis le site", email: "vos clients peuvent vous écrire depuis le site", google: "Google peut le lire", tech: "il repose sur une technique actuelle", buttons: "chaque bouton fonctionne", form: "le formulaire de contact fonctionne", slow: "il se charge vite" }
const COUNT_FR = ["", "Une chose", "Deux choses", "Trois choses", "Quatre choses"]
const TAG_FR: Record<string, string> = { mobile: "pas de version mobile", https: "pas de HTTPS", thin: "presque pas de contenu", photos: "aucune photo", contact: "aucun moyen de les contacter en ligne", email: "pas d'e-mail sur le site", google: "invisible sur Google", tech: "une technique datée", form: "un formulaire de contact en panne", slow: "lent à charger" }
/**
 * The sandbox's answer to « Ask the agent » (a follow-up email or a call angle), written from the codes above, in the
 * language the email goes out in (`lang`: the prospect's, else the agency's) ; the number it says is the number of
 * things it lists. The real mode asks the model instead (generate-savior, in the agency's language).
 */
/** why an email of the sequence is held, for the call panel's Email tab : plain English, no file path, no internal word
 *  (the sequencer's own `detail` is a log line, French, with a path : never shown) */
export function heldSay(w: { step?: string; reason?: string }, steps: { id: string; source?: string }[]): { step: string; reason: string; say: string } {
  const step = String(w?.step || ""), source = steps.find((s) => s.id === step)?.source || ""
  const say = w?.reason === "destinataire" ? "No valid email address for them: nothing goes out. Call them instead."
    : source === "savior" ? "First email not written yet: nothing goes out until it is written."
    : source === "demo" ? "The email with their personal demo isn't ready yet: it goes out once it is."
    : "The next email isn't written yet: it goes out once it is."
  return { step, reason: String(w?.reason || ""), say }
}
/** the sandbox's first email of the sequence (the real one is written by the generate-savior skill) : subject + body
 *  from the same codes, in the prospect's language, signed by the agency as it is now */
export function simulatedFirstEmail(sheet: any, signature = "", lang = "en", angle = "built-it"): { subject: string; body: string } {
  const [subjectLine, ...rest] = simulatedAsk(sheet, "email", signature, lang).split("\n\n")
  const out = { subject: subjectLine.replace(/^(Subject|Objet)\s*:\s*/, ""), body: rest.join("\n\n") }
  if (angle === "built-it") return out
  // the other openings (learning/scripts/words.ts) : the same facts, another first line — a gain or their work, never
  // a criticism of their current site
  const fr = String(lang).toLowerCase().startsWith("fr")
  const name = sheet?.identity?.name || (fr ? "votre entreprise" : "your business")
  const svc = Array.isArray(sheet?.content?.services) ? String(sheet.content.services[0] || "").trim() : ""
  const lines = out.body.split("\n\n")
  if (angle === "customers") {
    out.subject = fr ? `plus d'appels depuis les téléphones, ${name}` : `more calls from phones for ${name}`
    lines[1] = (fr ? "Aujourd'hui, la plupart de vos clients vous cherchent sur leur téléphone. " : "Most of your customers look for you on their phone now. ") + lines[1]
  } else if (angle === "craft") {
    out.subject = fr ? `${name}, à la hauteur de votre travail` : `${name}, at the level of your work`
    lines[1] = (fr ? `Votre travail${svc ? ` (« ${svc} »)` : ""} mérite un site au même niveau. ` : `Your work${svc ? ` (“${svc}”)` : ""} deserves a website at the same level. `) + lines[1]
  }
  out.body = lines.join("\n\n")
  return out
}
const DAYS_EN = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
const DAYS_FR = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
/** the day the owner asked for (« for next Tuesday », « mardi »), as its index 0–6, or -1 */
function askedDay(ask: string): number {
  const t = ask.toLowerCase()
  for (let i = 0; i < 7; i++) if (new RegExp(`\\b(${DAYS_EN[i]}|${DAYS_FR[i]})\\b`).test(t)) return i
  return -1
}
export function simulatedAsk(sheet: any, ask: string, signature = "", lang = "en"): string {
  const fr = String(lang).toLowerCase().startsWith("fr")
  const name = sheet?.identity?.name || (fr ? "votre entreprise" : "your business")
  const why = whyCodes(sheet).slice(0, 3)
  // what was asked shapes the answer : a follow-up reads as one, the day asked for is the day proposed
  const followUp = /follow|relance|again|remind|rappel|second|nouvelle fois/i.test(ask)
  const d = askedDay(ask)
  const when = fr ? (d >= 0 ? `${DAYS_FR[d]}` : "cette semaine") : (d >= 0 ? `on ${DAYS_EN[d][0].toUpperCase()}${DAYS_EN[d].slice(1)}` : "this week")
  if (/e-?mail|mail|follow|relance|courriel/i.test(ask)) {
    if (fr) {
      const fixes = why.length ? `${COUNT_FR[why.length]} qui change${why.length === 1 ? "" : "nt"} pour vous : ${list(why.map((w) => FIX_FR[w.code] || w.fix), "et")}.` : "Il s'affiche bien sur téléphone et vos clients vous joignent facilement."
      if (followUp) return [`Objet : votre nouveau site, ${name}`, "Bonjour,", `Je reviens vers vous au sujet du nouveau site que j'ai construit pour ${name}. ${fixes}`, `Dix minutes au téléphone ${when}, ça vous irait ?`, signature].filter(Boolean).join("\n\n")
      return [`Objet : un nouveau site pour ${name}`, "Bonjour,", `J'ai construit un nouveau site pour ${name}, pour que vous le voyiez déjà terminé (pas une maquette). ${fixes}`, `Dix minutes au téléphone ${when}, ça vous irait ?`, signature].filter(Boolean).join("\n\n")
    }
    const fixes = why.length ? `${COUNT[why.length]} ${why.length === 1 ? "changes" : "change"} for you: ${list(why.map((w) => w.fix))}.` : "It works on a phone and makes it easy for customers to reach you."
    if (followUp) return [`Subject: following up on your new website`, "Hi,", `Following up on the new website I built for ${name}. ${fixes}`, `Would a 10-minute call ${when} work?`, signature].filter(Boolean).join("\n\n")
    return [`Subject: a new website for ${name}`, "Hi,", `I built a new website for ${name} so you can see it already done (not a mockup). ${fixes}`, `Would a 10-minute call ${when} work?`, signature].filter(Boolean).join("\n\n")
  }
  if (fr) {
    const first = why[0] ? (TAG_FR[why[0].code] || lc(why[0].tag)) : "pas de version mobile"
    return `Angle : ouvrez sur ce que leur site rate aujourd'hui (${first}), puis montrez le nouveau site à côté. Demandez ce que vaut un nouveau client pour eux avant tout chiffre.`
  }
  const first = why[0] ? lc(why[0].tag) : "it does not work on a phone"
  return `Angle: open with the one thing their site gets wrong today (${first}), then show the new site side by side. Ask what a new customer is worth to them before any number.`
}
