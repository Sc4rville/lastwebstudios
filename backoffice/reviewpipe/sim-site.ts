/**
 * sim-site.ts · the SANDBOX builds a site FOR THAT prospect: a small bespoke static site from its own data (name,
 * trade, place, phone, services, palette, language) with a template per trade family, and a dated-looking « old
 * site » rendered the same way (2009 style). Captures (desktop + mobile) through Playwright when it is available.
 */
import { copyFileSync, mkdirSync, readdirSync, writeFileSync, existsSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { familyOf } from "./sim-data.ts"
import type { PromptPref, SiteTaste, Traits } from "../../learning/scripts/taste.ts"

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string))
const T = {
  en: { quote: "Get a free quote", call: "Call", services: "What we do", about: "About", areas: "Serving", hours: "Hours", contact: "Contact", home: "Home", promo: "SPRING PROMOTION", welcome: "Welcome to our website", visitors: "Visitors", updated: "Last updated", reply: "We answer within a day.", estimate: "Free estimate, no obligation", heroes: { pool: "Your pool, built to last.", kitchen: "A kitchen designed around you.", wood: "Craft in every piece of wood.", roof: "A roof you can trust for decades.", garden: "Gardens that grow with you.", build: "We build what you imagine.", home: "Done right, the first time.", service: "Done right, the first time.", care: "Care that takes its time.", event: "Days people remember.", auto: "Driven by detail.", other: "Quality work, locally." } },
  fr: { quote: "Demander un devis", call: "Appeler", services: "Nos prestations", about: "Qui sommes-nous", areas: "Secteur", hours: "Horaires", contact: "Contact", home: "Accueil", promo: "PROMOTION PRINTEMPS", welcome: "Bienvenue sur notre site", visitors: "Visiteurs", updated: "Dernière mise à jour", reply: "Réponse sous 24 h.", estimate: "Devis gratuit, sans engagement", heroes: { pool: "Votre piscine, pensée pour durer.", kitchen: "Une cuisine dessinée autour de vous.", wood: "Le bois, travaillé avec soin.", roof: "Un toit solide pour des décennies.", garden: "Des jardins qui vous ressemblent.", build: "Nous bâtissons ce que vous imaginez.", home: "Bien fait, du premier coup.", service: "Bien fait, du premier coup.", care: "Prendre le temps de bien soigner.", event: "Des jours dont on se souvient.", auto: "Le soin du détail.", other: "Un travail de qualité, près de chez vous." } },
}
// the headline of the trades people search most : a plumber is not sold « comfort, installed right »
const HERO_TRADE: Record<string, { en: string; fr: string }> = {
  plombier: { en: "Leaks fixed, water hot, same day.", fr: "Fuites réparées, eau chaude, le jour même." },
  electricien: { en: "Safe wiring, done to code.", fr: "Une installation sûre, aux normes." },
  chauffagiste: { en: "Warm winters, cool summers.", fr: "Bien au chaud l'hiver, au frais l'été." },
  peintre: { en: "Clean lines, lasting colour.", fr: "Des finitions nettes, des couleurs qui durent." },
  serrurier: { en: "Locked out? We're on our way.", fr: "Porte claquée ? On arrive." },
  nettoyage: { en: "Spotless, every single visit.", fr: "Impeccable, à chaque passage." },
  desinsectisation: { en: "Pests gone, for good.", fr: "Les nuisibles, partis pour de bon." },
  cloturiste: { en: "Fences that stand straight for years.", fr: "Des clôtures droites, pour des années." },
  solier: { en: "Floors you'll love walking on.", fr: "Des sols où il fait bon marcher." },
  "entrepreneur-general": { en: "Your remodel, on time and on budget.", fr: "Vos travaux, dans les délais et le budget." },
  "couvreur-zingueur": { en: "A roof you can trust for decades.", fr: "Un toit solide pour des décennies." },
}
type Lang = keyof typeof T
export function pickLang(language: string): Lang { return language === "fr" ? "fr" : "en" }
/** the trade's name in the site's language (data of the engine), for the about line */
function tradeWord(sheet: any, lang: Lang): string {
  const k = String(sheet.industry || "")
  const map: Record<string, [string, string]> = { pisciniste: ["pool builder", "pisciniste"], cuisiniste: ["kitchen designer", "cuisiniste"], menuisier: ["carpenter", "menuisier"], "couvreur-zingueur": ["roofer", "couvreur"], paysagiste: ["landscaper", "paysagiste"], plombier: ["plumber", "plombier"], electricien: ["electrician", "électricien"], peintre: ["painter", "peintre"], chauffagiste: ["heating and cooling company", "chauffagiste"], "entrepreneur-general": ["general contractor", "entreprise générale du bâtiment"] }
  const m = map[k]; return m ? m[lang === "fr" ? 1 : 0] : (lang === "fr" ? "artisan" : "local business")
}
/**
 * The new site : one page built from the prospect's own facts (name, trade, place, phone, services, hours) in its
 * palette and its language. Typographic : no clip-art standing in for photos, no invented figures — a demo build
 * shows only what the engine knows about them (a real run adds their own photos and words).
 */
export function renderNewSite(sheet: any, language: string, o: { effects?: Set<string>; photo?: string } = {}): string {
  const lang = pickLang(language), L = T[lang], fam = (sheet._sim?.family as string) || familyOf(sheet.industry || "")
  // the owner's preferences the demo can show (planTaste below) : each one changes something you can see
  const fx = o.effects || new Set<string>(), has = (k: string) => fx.has(k)
  const pal = sheet._sim?.palette || { a: "#1f2a37", b: "#c9a66b", bg: "#f6f3ec" }
  const id = sheet.identity || {}, name = esc(id.name || sheet.id)
  // « Austin, TX 78704 » in the US, « 69003 Lyon » in France
  const city = esc(id.state ? `${id.city}, ${[id.state, id.zip].filter(Boolean).join(" ")}` : [id.zip, id.city].filter(Boolean).join(" "))
  // their services as titles (« Piscines béton sur mesure », never « piscines béton sur mesure »)
  const cap = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t)
  const raw: string[] = Array.isArray(sheet.content?.services) ? sheet.content.services.map((x: unknown) => String(x)) : []
  const services = raw.map(cap)
  // in a sentence they read as written, the first one capitalised (« Leak repair, drain cleaning: we handle it »)
  const inText = raw.slice(0, 3).map((x, i) => (i && !/^[A-Z]{2,}/.test(x) ? x.charAt(0).toLowerCase() + x.slice(1) : cap(x))).join(", ")
  const phone = esc(id.phone || ""), tel = String(id.phone || "").replace(/[^\d+]/g, "")
  const trade = tradeWord(sheet, lang)
  // no stock phrase : the headline says what they do and where, the line under it their own services and hours
  const what = raw[0] && raw[0].length <= 22 ? raw[0] : trade
  const hero = has("concrete") ? (lang === "fr" ? `${cap(what)} à ${id.city || ""}.` : `${cap(what)} in ${id.city || ""}.`) : HERO_TRADE[sheet.industry]?.[lang] || (L.heroes as any)[fam] || L.heroes.other
  const lede = has("concrete") ? `${esc(inText || cap(trade))}.${id.hours ? ` ${lang === "fr" ? "Ouvert" : "Open"} ${esc(id.hours)}.` : ""}` : has("short") ? L.reply : `${L.estimate}. ${L.reply}`
  const about = has("short") || has("concrete")
    ? (lang === "fr" ? `${name} est ${/^[aeiouéè]/i.test(trade) ? "une" : "un"} ${esc(trade)} installé à ${esc(id.city || "")}.${has("short") ? "" : services.length ? ` ${esc(inText)}.` : ""}` : `${name} is a ${esc(trade)} based in ${esc(id.city || "")}.${has("short") ? "" : services.length ? ` ${esc(inText)}.` : ""}`)
    : lang === "fr"
      ? `${name} est ${/^[aeiouéè]/i.test(trade) ? "une" : "un"} ${esc(trade)} installé à ${esc(id.city || "")}.${services.length ? ` ${esc(inText)} : on s'occupe de tout, du premier appel à la fin du chantier.` : ""} ${L.reply}`
      : `${name} is a ${esc(trade)} based in ${esc(id.city || "")}.${services.length ? ` ${esc(inText)}: we handle it from the first call to the last detail.` : ""} ${L.reply}`
  const rating = Number(sheet.audit?.strengths?.googleRating || sheet.content?.googleRating || 0), reviews = Number(sheet.audit?.strengths?.reviewCount || sheet.content?.reviewCount || 0)
  const areas = has("areas") ? (lang === "fr" ? `${esc(id.city || "")} et les communes autour` : `${esc(id.city || "")} and the towns around it`) : esc(id.city || "")
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name} · ${esc(id.city || "")}</title>
<style>:root{--a:${pal.a};--b:${pal.b};--bg:${pal.bg}}*{box-sizing:border-box}body{margin:0;font:17px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#17181a;background:var(--bg)}a{color:inherit}
header{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:22px 6vw}.brand{font-weight:750;letter-spacing:-.02em;font-size:20px;color:var(--a);white-space:nowrap}nav{display:flex;align-items:center;gap:26px;white-space:nowrap}nav a{color:#3a3b3f;text-decoration:none;font-weight:500;font-size:15px}
.cta{display:inline-flex;align-items:center;background:var(--a);color:#fff !important;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600;white-space:nowrap}
.hero{padding:9vh 6vw 7vh;max-width:1320px;display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:5vw;align-items:center}
.visual{position:relative;min-height:440px;border-radius:28px;background:var(--a);color:#fff;padding:36px;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;box-shadow:0 30px 60px -32px rgba(0,0,0,.45)}
.visual::after{content:"";position:absolute;right:-18%;top:-18%;width:70%;aspect-ratio:1;border-radius:50%;background:var(--b);opacity:.35}
.words{position:relative;z-index:1;display:flex;flex-direction:column;gap:6px}.words span{font-size:clamp(26px,2.6vw,40px);font-weight:750;letter-spacing:-.03em;line-height:1.08}.words span:nth-child(2){opacity:.72}.words span:nth-child(3){opacity:.48}
.facts{position:relative;z-index:1;background:#fff;color:#17181a;border-radius:18px;padding:18px 20px;display:flex;flex-direction:column;gap:2px;font-size:15px}.facts b{font-size:17px;color:var(--a)}.facts span{color:#5a5b60}.eyebrow{display:inline-block;font-size:14px;font-weight:600;color:var(--a);background:color-mix(in srgb,var(--b) 28%,transparent);padding:6px 12px;border-radius:999px;margin-bottom:22px}
.hero h1{font-size:clamp(40px,6.4vw,88px);line-height:1;letter-spacing:-.04em;margin:0 0 24px;max-width:14ch;color:#121316}.hero h1 em{font-style:normal;color:var(--a)}
.hero p{font-size:20px;color:#45464b;max-width:44ch;margin:0}.acts{display:flex;flex-wrap:wrap;gap:16px;margin-top:34px;align-items:center}.tel{font-weight:700;text-decoration:none;font-size:19px;color:var(--a);white-space:nowrap}
.band{margin:0 6vw;padding:26px 0;border-top:1px solid rgba(0,0,0,.1);border-bottom:1px solid rgba(0,0,0,.1);display:flex;flex-wrap:wrap;gap:12px 40px;color:#45464b;font-size:16px}.band b{color:#121316}
section{padding:72px 6vw}h2{font-size:clamp(28px,3.4vw,40px);letter-spacing:-.03em;margin:0 0 28px;line-height:1.1}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px}.card{background:#fff;border-radius:18px;padding:26px 24px;border:1px solid rgba(0,0,0,.06)}.card b{display:block;font-size:20px;letter-spacing:-.01em;margin-bottom:8px}.card span{color:#5a5b60;font-size:15px}
.card i{display:block;width:28px;height:4px;border-radius:4px;background:var(--b);margin-bottom:18px}
#about p{max-width:62ch;font-size:19px;color:#36373b;margin:0}
.contact{margin:0 6vw 72px;background:var(--a);color:#fff;border-radius:28px;padding:56px 6vw;display:flex;flex-wrap:wrap;gap:24px;align-items:center;justify-content:space-between}.contact h2{margin:0;color:#fff}.contact .cta{background:#fff;color:var(--a) !important}.contact p{margin:6px 0 0;opacity:.85}
footer{padding:28px 6vw 40px;color:#6a6b70;font-size:14px}
@media(max-width:860px){.hero{grid-template-columns:1fr}.visual{min-height:300px}}
@media(max-width:760px){header{padding:16px 5vw}nav a:not(.cta){display:none}.hero{padding:7vh 5vw 6vh}.band,.contact{margin-left:5vw;margin-right:5vw}section{padding:52px 5vw}}
@media(max-width:520px){header .cta:not(.phone){display:none}.brand{white-space:normal}}
${has("photo") && o.photo ? `.visual.photo{padding:0;gap:0;background:#fff;justify-content:flex-start}.visual.photo::after{display:none}.visual.photo .shot{flex:1;min-height:320px;background:url("${esc(o.photo)}") center/cover no-repeat}.visual.photo .facts{border-radius:0;padding:18px 22px 20px}@media(max-width:860px){.visual.photo .shot{min-height:240px}}` : ""}
${has("phoneTop") ? `@media(max-width:520px){header .cta.phone{padding:9px 14px;font-size:14px}}` : ""}
${has("dark") ? `body{background:#0f1114;color:#eceef1}.hero h1{color:#f4f5f7}.hero p,#about p,.band{color:#b9bcc3}.band{border-color:rgba(255,255,255,.12)}.band b{color:#f4f5f7}.card{background:#171a1f;border-color:rgba(255,255,255,.08)}.card span{color:#a9adb5}nav a{color:#c9ccd2}.brand,.tel,.hero h1 em{color:var(--b)}.eyebrow{color:#f4f5f7}footer{color:#8d9199}` : ""}
${has("bigText") ? `body{font-size:19px}.hero p{font-size:22px}#about p{font-size:21px}.card span{font-size:17px}` : ""}
${has("serif") ? `.hero h1,h2,.brand{font-family:Georgia,"Times New Roman",serif;letter-spacing:-.01em}` : ""}
.rating{margin-top:22px;font-size:16px;color:inherit;opacity:.85}</style></head>
<body><header><div class="brand">${name}</div><nav><a href="#services">${L.services}</a><a href="#about">${L.about}</a>${has("phoneTop") && phone ? `<a class="cta phone" href="tel:${tel}">${L.call} ${phone}</a>` : `<a class="cta" href="#contact">${L.quote}</a>`}</nav></header>
<main><div class="hero"><div><span class="eyebrow">${esc(cap(trade))} · ${esc(id.city || "")}</span><h1>${esc(hero)}</h1><p>${lede}</p><div class="acts"><a class="cta" href="#contact">${L.quote}</a>${phone ? `<a class="tel" href="tel:${tel}">${L.call} ${phone}</a>` : ""}</div>${has("reviews") && rating ? `<p class="rating">★ ${rating.toFixed(1)} ${lang === "fr" ? "sur Google" : "on Google"}${reviews ? ` · ${reviews} ${lang === "fr" ? "avis" : "reviews"}` : ""}</p>` : ""}</div>
${has("photo") && o.photo ? `<div class="visual photo"><div class="shot" role="img" aria-label="${esc(lang === "fr" ? `Une réalisation de ${id.name || ""}` : `Work by ${id.name || ""}`)}"></div><div class="facts"><b>${name}</b><span>${city}</span>${id.hours ? `<span>${esc(id.hours)}</span>` : phone ? `<span>${phone}</span>` : ""}</div></div>` : `<div class="visual" aria-hidden="true"><div class="words">${(services.length ? services.slice(0, 3) : [cap(trade), String(id.city || "")]).map((w) => `<span>${esc(w)}</span>`).join("")}</div><div class="facts"><b>${name}</b><span>${city}</span>${id.hours ? `<span>${esc(id.hours)}</span>` : phone ? `<span>${phone}</span>` : ""}</div></div>`}</div>
${has("short") ? "" : `<div class="band"><span>${L.areas} <b>${areas}</b></span>${id.hours ? `<span>${L.hours} <b>${esc(id.hours)}</b></span>` : ""}${phone ? `<span><b>${phone}</b></span>` : ""}</div>`}
${services.length ? `<section id="services"><h2>${L.services}</h2><div class="grid">${services.map((sv) => `<div class="card"><i></i><b>${esc(sv)}</b></div>`).join("")}</div></section>` : ""}
<section id="about"><h2>${L.about}</h2><p>${about}</p></section>
<div class="contact" id="contact"><div><h2>${L.quote}</h2><p>${has("areas") ? areas : city}${phone ? ` · ${phone}` : ""}</p></div>${phone ? `<a class="cta" href="tel:${tel}">${L.call} ${phone}</a>` : id.email ? `<a class="cta" href="mailto:${esc(id.email)}">${esc(id.email)}</a>` : ""}</div></main>
<footer>${name} · ${city}${id.email ? ` · <a href="mailto:${esc(id.email)}">${esc(id.email)}</a>` : ""}</footer></body></html>`
}
// every old site is dated, but each in its own way : four 2008–2014 small-business skeletons (a dotted blue one, a wood
// one, a grey one with a broken form, a Comic Sans one with a guestbook), each in several colourways ; a trade family
// draws its own clip-art in the gallery. Six cards of one search never look alike.
type OldKind = "blue" | "wood" | "gray" | "aqua"
const OLD_KINDS: OldKind[] = ["blue", "wood", "gray", "aqua"]
const OLD_COLOURS: Record<OldKind, string[][]> = { // c1, c1b, c2, c3, c4
  blue: [["#1c64a8", "#0e4a85", "#f7941d", "#9fd9f7", "#cfeefe"], ["#7b1fa2", "#4a148c", "#ffc107", "#e1bee7", "#f3e5f5"], ["#2b7a2b", "#1d5a1d", "#e8c60c", "#e2d36a", "#f3e9a0"], ["#8b1a1a", "#5a0f0f", "#ffcc00", "#e0cfa8", "#f1e3c6"]],
  wood: [["#6b3f1f", "#4a2a12", "#b8860b"], ["#2e4a1f", "#1c3012", "#c9a227"], ["#5a3a22", "#3b2513", "#d4a017"], ["#3a4a8c", "#232f63", "#c9a227"]],
  gray: [["#8b1a1a", "#111", "#8b1a1a", "#4a1414"], ["#1f3f7a", "#111", "#1f3f7a", "#2c3c58"], ["#2e7d32", "#1b1b1b", "#2e7d32", "#2b452c"], ["#0277bd", "#111", "#0277bd", "#0d4560"]],
  aqua: [["#0a7cb8", "#05507c", "#ffd400", "#cfeefe", "#9fd9f7"], ["#1565c0", "#0d47a1", "#ffeb3b", "#e3f2fd", "#bbdefb"], ["#00897b", "#00695c", "#ff7043", "#e0f7fa", "#b2ebf2"], ["#5b2c83", "#3a1a57", "#ffcc00", "#e7dcf3", "#d6c5ea"]],
}
const hashOf = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h }
function oldLook(sheet: any): { kind: OldKind; c: string[] } {
  const h = hashOf(String(sheet.id || sheet.identity?.name || ""))
  const kind = OLD_KINDS[h % OLD_KINDS.length]
  return { kind, c: OLD_COLOURS[kind][(h >>> 4) % OLD_COLOURS[kind].length] }
}
/** a small clip-art of the trade's work (the era's « photo gallery » : home-made drawings, never a photo) */
function clip(fam: string, i: number): string {
  const sky = ["#9fd3f5", "#f7c47f", "#c8b6f2"][i % 3]
  const s = (body: string) => `<svg viewBox="0 0 120 80" preserveAspectRatio="none">${body}</svg>`
  if (fam === "pool") return s(`<rect width="120" height="80" fill="${sky}"/><circle cx="96" cy="18" r="8" fill="#fff6b0"/><rect y="44" width="120" height="36" fill="#d9c79c"/><rect x="14" y="50" width="92" height="22" fill="#2aa3d8"/><path d="M18 58q6-4 12 0t12 0 12 0 12 0 12 0 12 0" stroke="#fff" fill="none" stroke-width="2"/>`)
  if (fam === "home") return s(`<rect width="120" height="80" fill="#e6e6e6"/><path d="M0 20h120M0 40h120M0 60h120M30 0v80M60 0v80M90 0v80" stroke="#cfcfcf"/><path d="M10 ${30 + i * 4}h50v30h50" stroke="#b87333" stroke-width="7" fill="none"/><circle cx="60" cy="${30 + i * 4}" r="7" fill="#c40"/>`)
  if (fam === "kitchen") return s(`<rect width="120" height="80" fill="#efe6d6"/><rect x="8" y="8" width="104" height="22" fill="${["#7a5a3a", "#3f5f7a", "#5a7a4a"][i % 3]}"/><rect x="8" y="42" width="104" height="6" fill="#ddd"/><rect x="8" y="48" width="104" height="26" fill="${["#7a5a3a", "#3f5f7a", "#5a7a4a"][i % 3]}"/><rect x="52" y="34" width="18" height="8" fill="#aaa"/>`)
  if (fam === "wood") return s(`<rect width="120" height="80" fill="#c99a62"/>${[0, 1, 2, 3].map((k) => `<rect y="${k * 20}" width="120" height="19" fill="${(k + i) % 2 ? "#b88a5a" : "#a67a4b"}"/>`).join("")}<rect x="40" y="18" width="40" height="46" fill="#6b4a2a"/><rect x="45" y="23" width="30" height="36" fill="#d9b98c"/>`)
  if (fam === "garden") return s(`<rect width="120" height="80" fill="${sky}"/><rect y="44" width="120" height="36" fill="#78a85f"/><circle cx="${30 + i * 20}" cy="40" r="16" fill="#4f7f45"/><rect x="${28 + i * 20}" y="44" width="4" height="14" fill="#6b4a2a"/><circle cx="96" cy="58" r="5" fill="#e34"/>`)
  return s(`<rect width="120" height="80" fill="${sky}"/><rect y="56" width="120" height="24" fill="#7cb342"/><rect x="34" y="40" width="52" height="30" fill="#fff3d6"/><path d="M26 42 60 16l34 26z" fill="${["#8d3b2a", "#3b4a5a", "#6b3f1f"][i % 3]}"/><rect x="54" y="52" width="12" height="18" fill="#7a4a2a"/>`)
}
const OLD_T = {
  en: {
    nav: ["Home", "About Us", "Our Services", "Photo Gallery", "Testimonials", "Contact Us"], navShort: ["HOME", "OUR WORK", "SERVICES", "PRICES", "CONTACT"], navGray: ["HOME", "SERVICES", "SPECIALS", "CONTACT"], navAqua: ["Home", "About", "Services", "Gallery", "Links", "Contact"],
    since: (t: string, y: number) => `Quality ${t} service since ${y} !`, promo: "*** SPRING SPECIAL : 10% OFF FOR SENIORS AND VETERANS *** ASK US ABOUT OUR FINANCING ***", callToday: "Call Today !",
    welcome: (n: string) => `Welcome to the ${n} web site !`, years: (n: string, k: number, town: string) => `For over ${k} years, <b>${n}</b> has been proudly serving ${town} and the surrounding areas. We are a family owned and operated business and we take pride in every job, big or small. Our team is fully licensed and insured.`,
    free: "We offer FREE estimates and competitive prices. Customer satisfaction is our #1 priority !! Please browse our web site and do not hesitate to contact us.",
    services: "Our Services", projects: "Recent Projects", enlarge: "Click on a picture to enlarge. More pictures coming soon !", estimate: "Request your FREE estimate !", callUs: (p: string, m: string) => `Call us at <u>${p}</u> or e-mail <u>${m}</u>`, contactBtn: "Contact Us &raquo;",
    hoursT: "Business Hours", hours: "Monday - Friday<br>8:00am - 5:00pm<br>Saturday by appointment<br>Closed Sunday", accept: "We Accept", pay: "Cash - Check - Visa - MasterCard", visitor: "You are visitor # ", best: "Best viewed with Internet Explorer 8 at 1024x768", rights: "All Rights Reserved",
    woodSlogan: (t: string, town: string, y: number) => `${t} - ${town} - since ${y}`, woodHours: "Mon to Fri, 8am - 5pm", news: "News", newsText: "We will be closed from Dec 22 to Jan 2 for the holidays. Merry Christmas !", visitors: "Visitors",
    woodWelcome: (n: string, t: string, town: string) => `Welcome to ${n}, ${t} in ${town}`, woodAbout: (n: string, y: number, town: string) => `Since ${y}, <b>${n}</b> has served the homeowners of ${town} and the area. Every job is done by our own team with quality materials and old fashioned customer service. Free estimates.`,
    ourWork: "Some of our work", seeAll: "&raquo; Click here to see all our work", why: "Why choose us", whyText: "Licensed and insured. Family owned. No job too big or too small. References available on request.", freeEst: "Free Estimates",
    grayH: (n: string, t: string, town: string, y: number) => `${n} : your ${t} in ${town} since ${y}`, offer: (y: number) => `SPECIAL OFFER ${y} : $25 OFF any service call when you mention this web site !!!`,
    grayAbout: (n: string, t: string, town: string) => `Welcome on our new web site. ${n} offers residential and commercial ${t} services in ${town} and nearby. Licensed, bonded and insured. Free estimates.`,
    contact: "Contact", tel: "Tel", open: "Open Monday to Friday<br>8am - 5pm", yourName: "Your name :", yourPhone: "Your phone :", yourMsg: "Your message :", send: "Send", broken: "The form is temporarily unavailable, please call us.", design: "Web design : Local Web Solutions",
    aquaSlogan: (town: string, t: string) => `~ The ${town} ${t} You Can Trust ~`, booking: (y: number, p: string) => `Now booking for ${y} !!! Call ${p} for a FREE in-home consultation !!! Now booking for ${y} !!!`, uc: "UNDER CONSTRUCTION",
    aquaWelcome: "Welcome !", aquaText: (n: string, town: string, y: number) => `Thank you for visiting the home page of <b>${n}</b>. We have been serving ${town} since ${y}. Please take a look around and sign our guestbook !`, guest: "Sign our Guestbook !", viewGuest: "View our Guestbook", updated: (y: number, m: string) => `This site was last updated on 03/14/${y} - Webmaster : ${m}`,
  },
  fr: {
    nav: ["Accueil", "Qui sommes-nous", "Nos prestations", "Photos", "Témoignages", "Contact"], navShort: ["ACCUEIL", "RÉALISATIONS", "PRESTATIONS", "TARIFS", "CONTACT"], navGray: ["ACCUEIL", "PRESTATIONS", "PROMOS", "CONTACT"], navAqua: ["Accueil", "L'entreprise", "Prestations", "Galerie", "Liens", "Contact"],
    since: (t: string, y: number) => `Votre ${t} depuis ${y} !`, promo: "*** PROMOTION DE PRINTEMPS : -10 % SUR TOUT DEVIS SIGNÉ EN AVRIL *** PAIEMENT EN 3 FOIS SANS FRAIS ***", callToday: "Appelez-nous !",
    welcome: (n: string) => `Bienvenue sur le site de ${n} !`, years: (n: string, k: number, town: string) => `Depuis plus de ${k} ans, <b>${n}</b> intervient à ${town} et dans les environs. Entreprise familiale, nous mettons le même soin dans chaque chantier, petit ou grand. Assurance décennale.`,
    free: "Devis GRATUIT et prix compétitifs. La satisfaction de nos clients est notre priorité n°1 !! N'hésitez pas à parcourir notre site et à nous contacter.",
    services: "Nos prestations", projects: "Nos dernières réalisations", enlarge: "Cliquez sur une photo pour l'agrandir. D'autres photos bientôt !", estimate: "Demandez votre devis GRATUIT !", callUs: (p: string, m: string) => `Appelez le <u>${p}</u> ou écrivez à <u>${m}</u>`, contactBtn: "Nous contacter &raquo;",
    hoursT: "Horaires", hours: "Du lundi au vendredi<br>8h - 18h<br>Samedi sur rendez-vous<br>Fermé le dimanche", accept: "Paiements acceptés", pay: "Espèces - Chèque - Carte bleue", visitor: "Vous êtes le visiteur n° ", best: "Site optimisé pour Internet Explorer 8 en 1024x768", rights: "Tous droits réservés",
    woodSlogan: (t: string, town: string, y: number) => `${t} - ${town} - depuis ${y}`, woodHours: "Du lundi au vendredi, 8h - 18h", news: "Actualités", newsText: "Fermeture annuelle du 22 décembre au 2 janvier. Joyeuses fêtes !", visitors: "Visiteurs",
    woodWelcome: (n: string, t: string, town: string) => `Bienvenue chez ${n}, ${t} à ${town}`, woodAbout: (n: string, y: number, town: string) => `Depuis ${y}, <b>${n}</b> accompagne les particuliers de ${town} et des environs. Tous nos chantiers sont réalisés par notre propre équipe, avec des matériaux de qualité. Devis gratuit.`,
    ourWork: "Quelques réalisations", seeAll: "&raquo; Cliquez ici pour voir toutes nos réalisations", why: "Pourquoi nous choisir", whyText: "Artisans assurés. Entreprise familiale. Pas de petit chantier. Références sur demande.", freeEst: "Devis gratuit",
    grayH: (n: string, t: string, town: string, y: number) => `${n} : votre ${t} à ${town} depuis ${y}`, offer: (y: number) => `OFFRE SPÉCIALE ${y} : -25 € sur votre intervention en mentionnant ce site !!!`,
    grayAbout: (n: string, t: string, town: string) => `Bienvenue sur notre nouveau site. ${n}, ${t} pour les particuliers et les professionnels à ${town} et alentours. Devis gratuit.`,
    contact: "Contact", tel: "Tél", open: "Ouvert du lundi au vendredi<br>8h - 18h", yourName: "Votre nom :", yourPhone: "Votre téléphone :", yourMsg: "Votre message :", send: "Envoyer", broken: "Le formulaire est momentanément indisponible, merci de nous appeler.", design: "Création : Web Solutions Locales",
    aquaSlogan: (town: string, t: string) => `~ Votre ${t} de confiance à ${town} ~`, booking: (y: number, p: string) => `Réservations ${y} ouvertes !!! Appelez le ${p} pour un devis GRATUIT à domicile !!! Réservations ${y} ouvertes !!!`, uc: "SITE EN CONSTRUCTION",
    aquaWelcome: "Bienvenue !", aquaText: (n: string, town: string, y: number) => `Merci de visiter le site de <b>${n}</b>. Nous sommes à votre service à ${town} depuis ${y}. Bonne visite, et n'oubliez pas de signer notre livre d'or !`, guest: "Signez notre livre d'or !", viewGuest: "Voir le livre d'or", updated: (y: number, m: string) => `Dernière mise à jour du site : 14/03/${y} - Webmaster : ${m}`,
  },
}
const OLD_CSS = `*{box-sizing:border-box}html,body{margin:0;min-height:100vh}p,h1,h2,ul{margin:0}svg{display:block}
#cap{width:max-content;margin:0 auto;padding:18px 28px 40px;min-height:100vh}
.o{color:#333;font:11px/1.4 Verdana,"DejaVu Sans",sans-serif}
.o-wrap{width:860px;margin:0 auto;background:#fff;min-height:760px}
.o ul{padding-left:18px;margin:4px 0 6px}.o li{margin:2px 0}.o p{margin:0 0 8px}
.o-gal{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:6px 0}.o-gal i{display:block;height:96px;border:3px ridge #cfcfcf;background:#eee}.o-gal svg{width:100%;height:100%}
.o-counter{background:#000;color:#21ff21;font:11px "Courier New","DejaVu Sans Mono",monospace;padding:4px 6px;letter-spacing:2px}
.o-foot{font-size:9.5px;color:#666;text-align:center;padding:10px;border-top:1px solid #ccc}
body.o-blue{background:radial-gradient(var(--o3) 1.7px,transparent 1.9px) 0 0/7px 7px,var(--o4)}
.o-blue .o-wrap{box-shadow:0 0 0 1px rgba(0,0,0,.35),4px 4px 0 rgba(0,0,0,.25)}
.o-blue .o-head{height:122px;background:linear-gradient(var(--o1),var(--o1b));display:flex;align-items:center;gap:16px;padding:0 22px;color:#fff}
.o-blue .o-logo{width:70px;height:70px;border-radius:50%;overflow:hidden;border:3px solid #fff;flex:none}.o-blue .o-logo svg{width:100%;height:100%}
.o-blue .o-title{font:italic bold 32px "Trebuchet MS","DejaVu Sans",sans-serif;text-shadow:2px 2px 0 rgba(0,0,0,.4)}
.o-blue .o-slogan{font:13px Verdana,"DejaVu Sans",sans-serif;color:#ffe45c;margin-top:2px}
.o-blue .o-phone{margin-left:auto;text-align:right;font-size:12px;color:#ffe45c;white-space:nowrap}.o-blue .o-phone b{font-size:20px;color:#fff}
.o-blue .o-nav{background:var(--o2);font:bold 11px Verdana,"DejaVu Sans",sans-serif;color:#fff;padding:5px 12px}.o-blue .o-nav span{margin:0 7px;text-decoration:underline}
.o-blue .o-promo{font:bold 10px Verdana,"DejaVu Sans",sans-serif;color:#d40000;padding:4px 10px;background:#fffbd6;border-bottom:1px dashed #d8b84a;white-space:nowrap;overflow:hidden}
.o-blue .o-cols{display:flex;gap:14px;padding:14px}.o-blue .o-main{flex:1}
.o-blue h1{font:bold 15px Verdana,"DejaVu Sans",sans-serif;color:var(--o1);border-bottom:1px dotted var(--o2);padding-bottom:4px;margin-bottom:8px}
.o-blue h2{font:bold 12px Verdana,"DejaVu Sans",sans-serif;color:var(--o2);margin:12px 0 4px}
.o-blue .o-side{width:236px}.o-blue .o-box{border:1px dashed var(--o1);padding:8px;margin-bottom:12px;font-size:10.5px;background:#f2f8ff}.o-blue .o-box b{display:block;font-size:12px;color:var(--o1);margin-bottom:4px}
.o-blue .o-btn{display:inline-block;margin-top:6px;background:var(--o2);color:#fff;font-weight:bold;padding:3px 10px;border:2px outset #fff}
.o-blue .o-best,.o-blue .o-small{font-size:9.5px;color:#777;margin-top:8px}
body.o-wood{background:repeating-linear-gradient(90deg,var(--o1) 0 3px,var(--o1b) 3px 7px,var(--o1) 7px 11px)}
.o-wood{font-family:"Times New Roman","Liberation Serif",serif;font-size:12px;color:#3a2a1a}
.o-wood .o-wrap{background:#fbf3e0;border:6px solid #d9c49a;outline:2px solid #6b4a2a}
.o-wood .o-head{display:flex;align-items:center;gap:16px;padding:18px 22px;background:linear-gradient(#fff8e6,#efdcb3);border-bottom:3px double #8a6a3a}
.o-wood .o-logo{width:72px;height:72px;border:3px solid var(--o1);overflow:hidden;flex:none}.o-wood .o-logo svg{width:100%;height:100%}
.o-wood .o-title{font:bold 28px "Times New Roman","Liberation Serif",serif;color:var(--o1b)}.o-wood .o-slogan{font-style:italic;color:#7a5a32}
.o-wood .o-phone{margin-left:auto;text-align:right;font:bold 24px "Times New Roman","Liberation Serif",serif;color:#b00000;white-space:nowrap}.o-wood .o-phone small{display:block;font:11px Arial,"Liberation Sans",sans-serif;color:#6b5a40}
.o-wood .o-nav{display:flex;gap:2px;background:var(--o1b);padding:4px 10px}.o-wood .o-nav span{color:#f5e6c8;font:bold 10px Arial,"Liberation Sans",sans-serif;padding:3px 12px;letter-spacing:.5px}.o-wood .o-nav .on{background:var(--o2);color:#fff}
.o-wood .o-cols{display:flex;gap:16px;padding:14px}.o-wood .o-left{width:200px;background:#f3e5c4;border:1px solid #c9ad7a;padding:0 0 8px}
.o-wood .o-lh{background:var(--o1);color:#fff;font:bold 11px Arial,"Liberation Sans",sans-serif;padding:3px 8px;margin:8px 0 4px}
.o-wood .o-left p,.o-wood .o-left ul{padding-left:22px;padding-right:8px;font-size:11px}.o-wood .o-left p{padding-left:8px}
.o-wood .o-new{background:#c00;color:#fff;font:bold 9px Arial,"Liberation Sans",sans-serif;padding:0 3px}.o-wood .o-left .o-counter{margin:4px 8px}
.o-wood .o-main{flex:1}.o-wood h1{font:italic bold 19px "Times New Roman","Liberation Serif",serif;color:var(--o1b);margin-bottom:8px}
.o-wood h2{font:bold 13px Arial,"Liberation Sans",sans-serif;color:var(--o1);border-bottom:1px solid #c9ad7a;margin:12px 0 6px}
.o-wood .o-gal{grid-template-columns:repeat(5,1fr)}.o-wood .o-gal i{height:62px;border:1px solid #8a6a3a;padding:2px;background:#fff}
body.o-gray{background:var(--o4,#6a6a6a)}.o-gray{font:11px/1.35 Arial,"Liberation Sans",sans-serif}
.o-gray .o-wrap{width:800px;border-top:4px solid var(--o1)}
.o-gray .o-head{display:flex;align-items:center;gap:12px;padding:14px 18px;background:#f4f4f4;border-bottom:3px solid var(--o1)}
.o-gray .o-logo{width:54px;height:54px;border-radius:50%;overflow:hidden;background:var(--o1);flex:none}.o-gray .o-logo svg{width:100%;height:100%}
.o-gray .o-title{font:bold 22px Arial,"Liberation Sans",sans-serif;color:#222;letter-spacing:1px}.o-gray .o-addr{margin-left:auto;font-size:10px;color:#555;text-align:right;white-space:nowrap}
.o-gray .o-nav{background:#222;padding:4px 12px;display:flex;gap:16px}.o-gray .o-nav span{color:#eee;font:bold 10px Arial,"Liberation Sans",sans-serif}
.o-gray .o-cols{display:flex;gap:14px;padding:12px 14px}.o-gray .o-main{flex:1}.o-gray .o-h1{font-weight:bold;font-size:13px;color:var(--o1);margin-bottom:6px}
.o-gray .o-offer{border:1px solid #d9b100;background:#fff7c2;padding:5px 8px;font-weight:bold;font-size:10px;margin-bottom:8px}
.o-gray .o-sec{background:#e8e8e8;font-weight:bold;padding:3px 6px;margin:10px 0 4px}.o-gray .o-gal{grid-template-columns:repeat(2,1fr)}.o-gray .o-gal i{height:110px;border:1px solid #999}
.o-gray .o-side{width:220px;font-size:10px}.o-gray .o-side label{display:block;margin-top:5px}.o-gray .o-in{display:block;height:16px;border:1px solid #888;background:#fff;box-shadow:inset 1px 1px 0 #ccc}.o-gray .o-ta{height:56px}
.o-gray .o-sub{display:inline-block;margin-top:5px;padding:2px 10px;border:1px solid #777;background:linear-gradient(#fff,#ddd)}.o-gray .o-tiny{font-size:8.5px;color:#999;margin-top:6px}
.o-gray .o-foot{background:#333;color:#bbb;border:0}
body.o-aqua{background:linear-gradient(var(--o4),var(--o5))}.o-aqua{font:12px/1.4 "Comic Sans MS","DejaVu Sans",sans-serif;color:#123}
.o-aqua .o-wrap{width:880px;border:4px ridge var(--o1);background:#fff}.o-aqua .o-head{background:linear-gradient(90deg,var(--o1),var(--o1b));padding:18px;text-align:center}
.o-aqua .o-title{font:bold 36px Georgia,"DejaVu Serif",serif;color:var(--o2);text-shadow:3px 3px 0 #000,0 0 12px rgba(255,255,255,.7)}.o-aqua .o-slogan{color:#fff;font-style:italic;font-size:14px}
.o-aqua .o-marq{background:#000;color:#ff0;font-weight:bold;padding:3px 0;white-space:nowrap;overflow:hidden;font-size:11px}
.o-aqua .o-t{width:100%;border-collapse:collapse}.o-aqua td{vertical-align:top;padding:10px}
.o-aqua .o-nav{width:150px;background:var(--o4);border-right:2px solid var(--o1)}.o-aqua .o-nav span{display:block;margin:0 0 6px;padding:4px 6px;background:linear-gradient(#fff,var(--o5));border:2px outset #fff;color:var(--o1b);font-weight:bold;text-align:center}
.o-aqua .o-uc{margin-top:14px;padding:6px 2px;text-align:center;font:bold 10px Arial,"Liberation Sans",sans-serif;background:repeating-linear-gradient(45deg,#ffd400 0 8px,#111 8px 16px);color:#fff;text-shadow:1px 1px 0 #000}
.o-aqua h1{font:bold 22px Georgia,"DejaVu Serif",serif;color:var(--o1);margin-bottom:6px}.o-aqua h2{font:bold 15px Georgia,"DejaVu Serif",serif;color:var(--o1b);margin:10px 0 4px}
.o-aqua .o-gal i{height:120px;border:4px double var(--o1)}.o-aqua .o-guest{color:#00e}`
/**
 * The old site : a 2008–2014 small-business page (one of four skeletons, in its own colours), a fixed-width page in
 * the middle of a tiled background, with what those sites had : a promotion still running, a photo gallery of
 * home-made drawings, a visitor counter, a guestbook or a broken form, « under construction », a dated footer.
 * The capture takes the page itself (#cap), never a wide screen of wallpaper around it.
 */
export function renderOldSite(sheet: any, language: string): string {
  const lang = pickLang(language), L = OLD_T[lang], id = sheet.identity || {}
  const n = esc(id.name || sheet.id), town = esc(id.city || ""), phone = esc(id.phone || "")
  const fam = (sheet._sim?.family as string) || familyOf(sheet.industry || "")
  const trade = esc(tradeWord(sheet, lang)), Trade = trade ? trade[0].toUpperCase() + trade.slice(1) : trade
  const where = esc(id.state ? `${id.city}, ${[id.state, id.zip].filter(Boolean).join(" ")}` : [id.zip, id.city].filter(Boolean).join(" "))
  const h = hashOf(String(sheet.id || id.name || ""))
  const yr = Number(sheet.audit?.strengths?.copyrightYear) || 2008 + (h % 6)
  const since = Number(sheet._sim?.since) || Math.min(yr - 4, 1990 + (h % 15))
  let host = ""; try { host = new URL(String(sheet.existing?.url || "")).hostname } catch { /* */ }
  const mail = esc(id.email || `info@${host || "example.example"}`)
  const services: string[] = (Array.isArray(sheet.content?.services) ? sheet.content.services : []).map((s: unknown) => String(s))
  const li = services.map((s) => `<li>${esc(s)}</li>`).join("")
  const { kind, c } = oldLook(sheet)
  const gal = (ix: number[]) => `<div class="o-gal">${ix.map((i) => `<i>${clip(fam, i)}</i>`).join("")}</div>`
  let page = ""
  if (kind === "blue") page = `<div class="o-wrap"><div class="o-head"><div class="o-logo">${clip(fam, 0)}</div><div><div class="o-title">${n}</div><div class="o-slogan">${L.since(trade, since)}</div></div><div class="o-phone">${L.callToday}<br><b>${phone}</b></div></div>
<div class="o-nav">${L.nav.map((x) => `<span>${x}</span>`).join("|")}</div><div class="o-promo">${L.promo}</div>
<div class="o-cols"><div class="o-main"><h1>${L.welcome(n)}</h1><p>${L.years(n, Math.max(3, yr - since), town)}</p><p>${L.free}</p><h2>${L.services}</h2><ul>${li}</ul><h2>${L.projects}</h2>${gal([0, 1, 2, 1, 2, 0])}<p class="o-small">${L.enlarge}</p></div>
<div class="o-side"><div class="o-box"><b>${L.estimate}</b>${L.callUs(phone, mail)}<div class="o-btn">${L.contactBtn}</div></div><div class="o-box"><b>${L.hoursT}</b>${L.hours}</div><div class="o-box"><b>${L.accept}</b>${L.pay}</div><div class="o-counter">${L.visitor}00${4000 + (h % 5000)}</div><div class="o-best">${L.best}</div></div></div>
<div class="o-foot">${L.nav.slice(0, 4).join(" | ")}<br>Copyright &copy; ${yr} ${n} - ${L.rights} - ${where}</div></div>`
  else if (kind === "wood") page = `<div class="o-wrap"><div class="o-head"><div class="o-logo">${clip(fam, 1)}</div><div><div class="o-title">${n}</div><div class="o-slogan">${L.woodSlogan(Trade, town, since)}</div></div><div class="o-phone">${phone}<small>${L.woodHours}</small></div></div>
<div class="o-nav">${L.navShort.map((x, i) => `<span${i ? "" : ' class="on"'}>${x}</span>`).join("")}</div>
<div class="o-cols"><div class="o-left"><div class="o-lh">${L.services}</div><ul>${li}<li>${L.freeEst}</li></ul><div class="o-lh">${L.news}</div><p><span class="o-new">NEW</span> ${L.newsText}</p><div class="o-lh">${L.visitors}</div><div class="o-counter">00${4000 + (h % 5000)}</div></div>
<div class="o-main"><h1>${L.woodWelcome(n, trade, town)}</h1><p>${L.woodAbout(n, since, town)}</p><h2>${L.ourWork}</h2>${gal([0, 1, 2, 0, 1])}<p><u>${L.seeAll}</u></p><h2>${L.why}</h2><p>${L.whyText}</p></div></div>
<div class="o-foot">&copy; ${yr} ${n} - ${where}</div></div>`
  else if (kind === "gray") page = `<div class="o-wrap"><div class="o-head"><div class="o-logo">${clip(fam, 2)}</div><div class="o-title">${esc(String(id.name || sheet.id).toUpperCase())}</div><div class="o-addr">${where}<br>${L.tel} : ${phone}</div></div>
<div class="o-nav">${L.navGray.map((x) => `<span>${x}</span>`).join("")}</div>
<div class="o-cols"><div class="o-main"><div class="o-h1">${L.grayH(esc(String(id.name || sheet.id).toUpperCase()), trade, town, since)}</div><div class="o-offer">${L.offer(yr)}</div><p>${L.grayAbout(n, trade, town)}</p><div class="o-sec">${L.services}</div><ul>${li}</ul>${gal([0, 1])}</div>
<div class="o-side"><div class="o-sec">${L.contact}</div><p>${L.tel} : ${phone}<br>${L.open}</p><label>${L.yourName}</label><span class="o-in"></span><label>${L.yourPhone}</label><span class="o-in"></span><label>${L.yourMsg}</label><span class="o-in o-ta"></span><span class="o-sub">${L.send}</span><p class="o-tiny">${L.broken}</p></div></div>
<div class="o-foot">&copy; ${yr} ${n} - ${town} - ${L.rights} - ${L.design}</div></div>`
  else page = `<div class="o-wrap"><div class="o-head"><div class="o-title">${n}</div><div class="o-slogan">${L.aquaSlogan(town, trade)}</div></div><div class="o-marq">${L.booking(yr + 1, phone)}</div>
<table class="o-t"><tr><td class="o-nav">${L.navAqua.map((x) => `<span>${x}</span>`).join("")}<div class="o-uc">${L.uc}</div></td>
<td class="o-main"><h1>${L.aquaWelcome}</h1><p>${L.aquaText(n, town, since)}</p>${gal([2, 0, 1])}<h2>${L.services}</h2><ul>${li}</ul><p class="o-guest"><u>${L.guest}</u> &nbsp; <u>${L.viewGuest}</u></p></td></tr></table>
<div class="o-foot">${L.updated(yr, mail)}</div></div>`
  const vars = kind === "blue" ? `--o1:${c[0]};--o1b:${c[1]};--o2:${c[2]};--o3:${c[3]};--o4:${c[4]}` : kind === "aqua" ? `--o1:${c[0]};--o1b:${c[1]};--o2:${c[2]};--o4:${c[3]};--o5:${c[4]}` : `--o1:${c[0]};--o1b:${c[1]};--o2:${c[2]};--o4:${c[3] || "#6a6a6a"}`
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${n} - ${L.nav[0]}</title><style>:root{${vars}}${OLD_CSS}</style></head>
<body class="o o-${kind}"><div id="cap">${page}</div></body></html>`
}
// the drawing (no browser) keeps the simple 2009 look, each in its own colours
const OLD_SVG_LOOKS = [
  { bg: "#e9e2c9", dot: "%23d9c38a", top: ["#5b78b5", "#2d4c8c"], nav: "#c5b06d", line: "#7a6a3a", side: "#f3ecd2", h: "#2d4c8c", font: "Georgia,serif" },
  { bg: "#cfe3cf", dot: "%23a9c9a9", top: ["#3f8f4f", "#1f5f2f"], nav: "#9fcf7f", line: "#2f6f3f", side: "#eef7e6", h: "#1f5f2f", font: "\"Trebuchet MS\",sans-serif" },
  { bg: "#e4d4e8", dot: "%23c9b0cf", top: ["#8a4f9a", "#5a2a6a"], nav: "#d9a9d9", line: "#5a2a6a", side: "#f6eef8", h: "#6a2a7a", font: "\"Comic Sans MS\",cursive" },
  { bg: "#d8d8d8", dot: "%23bdbdbd", top: ["#9a2a2a", "#601010"], nav: "#e0b040", line: "#601010", side: "#f2f2f2", h: "#901818", font: "Impact,sans-serif" },
  { bg: "#d6e6f2", dot: "%23b2cde2", top: ["#1f8fbf", "#0a5a8a"], nav: "#9fd0ef", line: "#0a5a8a", side: "#eef6fc", h: "#0a5a8a", font: "Tahoma,sans-serif" },
  { bg: "#f2e2c2", dot: "%23e0c890", top: ["#d07a1a", "#8a4a0a"], nav: "#f0c070", line: "#8a4a0a", side: "#fbf1dc", h: "#8a4a0a", font: "\"Times New Roman\",serif" },
]
function oldSvgLook(sheet: any) { let h = 0; for (const c of String(sheet.id || sheet.identity?.name || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0; return { ...OLD_SVG_LOOKS[h % OLD_SVG_LOOKS.length], right: (h >> 3) % 2 === 1 } }
/** the old site as a picture with no browser at all (an SVG of its 2009 layout): the thumbnail is never empty */
export function renderOldSiteSvg(sheet: any, language: string): string {
  const L = T[pickLang(language)], id = sheet.identity || {}, name = esc(id.name || sheet.id)
  const services: string[] = Array.isArray(sheet.content?.services) ? sheet.content.services.slice(0, 4) : []
  const yr = sheet.audit?.strengths?.copyrightYear || 2009
  const k = oldSvgLook(sheet)
  const sx = k.right ? 908 : 332, mx = k.right ? 350 : 560
  const nav = [L.home, L.services, L.about, L.contact].map((t, i) => `<rect x="${330 + i * 195}" y="150" width="190" height="34" fill="${k.nav}" stroke="${k.line}"/><text x="${425 + i * 195}" y="172" font-size="14" font-weight="700" text-anchor="middle">${esc(t)}</text>`).join("")
  const lines = services.map((sv, i) => `<text x="${mx + 20}" y="${400 + i * 30}" font-size="17">• ${esc(sv)}</text>`).join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" width="860" height="900" viewBox="290 0 860 900" font-family="Verdana,Arial,sans-serif" fill="#222">
<rect width="1440" height="900" fill="${k.bg}"/><rect x="330" y="30" width="780" height="840" fill="#fff" stroke="${k.line}" stroke-width="3"/>
<rect x="332" y="32" width="776" height="112" fill="${k.top[1]}"/><text x="356" y="104" font-family="${k.font.replace(/"/g, "")}" font-size="34" font-weight="700" fill="#fff">${name}</text>
${nav}<rect x="${sx}" y="190" width="200" height="678" fill="${k.side}"/><text x="${sx + 18}" y="230" font-size="15" font-weight="700">${esc(L.contact)}</text><text x="${sx + 18}" y="256" font-size="14">${esc(id.phone || "")}</text>
<rect x="${sx + 18}" y="290" width="164" height="22" fill="#000"/><text x="${sx + 26}" y="306" font-family="monospace" font-size="13" fill="#0f0">${esc(L.visitors)}: 004871</text><rect x="${sx + 18}" y="330" width="164" height="100" fill="#ccc"/>
<rect x="${mx}" y="210" width="530" height="30" fill="#ffd700"/><text x="${mx + 14}" y="231" font-size="15" font-weight="700" fill="#c00">${esc(L.promo)} ${yr} !!!</text>
<text x="${mx}" y="290" font-size="19" font-weight="700" fill="${k.h}">${esc(L.welcome)}</text><text x="${mx}" y="322" font-size="15">${name} - ${esc(id.city || "")}.</text>
<text x="${mx}" y="372" font-size="19" font-weight="700" fill="${k.h}">${esc(L.services)}</text>${lines}
<text x="${mx}" y="740" font-size="12" fill="#888">${esc(L.updated)}: ${yr}</text></svg>`
}
/** desktop + mobile captures through Playwright (one browser for a whole job) ; false when the browser is missing */
/** `selector` : capture that element (the page itself), not the viewport ; `url` : open that address instead of `html` */
export type Capturer = { shot: (html: string, outPng: string, o?: { mobile?: string; fullPage?: boolean; width?: number; height?: number; selector?: string; url?: string }) => Promise<boolean>; close: () => Promise<void> }
export async function openCapturer(): Promise<Capturer> {
  let browser: any = null
  try { const pw = await import("playwright"); browser = await pw.chromium.launch() } catch { browser = null }
  const one = async (html: string, out: string, width: number, height: number, fullPage: boolean, selector = "", url = "") => {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
    try {
      const page = await ctx.newPage()
      if (url) await page.goto(url, { waitUntil: "load" }); else await page.setContent(html, { waitUntil: "load" })
      mkdirSync(dirname(out), { recursive: true })
      const el = selector ? page.locator(selector).first() : null
      if (el && await el.count()) await el.screenshot({ path: out }); else await page.screenshot({ path: out, fullPage })
    } finally { await ctx.close() }
  }
  return {
    shot: async (html, outPng, o = {}) => {
      if (!browser) return false
      try { await one(html, outPng, o.width || 1440, o.height || 900, !!o.fullPage, o.selector, o.url); if (o.mobile) await one(html, o.mobile, 390, 844, !!o.fullPage, "", o.url); return true } catch { return false }
    },
    close: async () => { try { await browser?.close() } catch { /* */ } },
  }
}
export async function capture(html: string, outPng: string, o: { mobile?: string; fullPage?: boolean } = {}): Promise<boolean> {
  const c = await openCapturer()
  try { return await c.shot(html, outPng, o) } finally { await c.close() }
}
/** the « before » of a prospect: a real capture when a browser is there, else the SVG drawing of the same page */
export async function captureOldSite(cap: Capturer, sheet: any, language: string, dir: string): Promise<"png" | "svg"> {
  mkdirSync(dir, { recursive: true })
  // captured as a visitor of the era sees it (a 1024 px screen), the PAGE itself (#cap : the fixed-width page and a
  // margin of its tiled background, never a wide screen of wallpaper) ; and on a phone (390), where the fixed page
  // overflows : the « before » of the Mobile view
  if (await cap.shot(renderOldSite(sheet, language), join(dir, "avant.png"), { width: 1024, height: 768, selector: "#cap", fullPage: true, mobile: join(dir, "avant.mobile.png") })) return "png"
  writeFileSync(join(dir, "avant.svg"), renderOldSiteSvg(sheet, language))
  return "svg"
}
export function writeSite(dir: string, html: string): void { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "index.html"), html) }
export const hasCapture = (p: string) => existsSync(p)
/** the language a business speaks : the demo's own mark, else what its address and phone say (a US state → English,
 *  a French phone or a French 5-digit postcode → French), else the agency's. Its site, its emails and the call
 *  script are in that language (a French business never gets « Your pool, built to last. » from a US agency). */
export function prospectLang(sheet: any, agencyLanguage: string): string {
  if (sheet?._sim?.lang) return String(sheet._sim.lang)
  const id = sheet?.identity || {}
  if (id.state || /^\+1|^\(\d{3}\)/.test(String(id.phone || ""))) return "en"
  if (/^(\+33|0\d)[\s.]?\d{2}/.test(String(id.phone || "")) || (/^\d{5}$/.test(String(id.zip || id.postalCode || "")) && !id.state)) return "fr"
  return agencyLanguage
}
export const siteLang = prospectLang
/** the country a business is in, from its own sheet (a US state or a NANP phone → US, a French phone or postcode → FR),
 *  "" when the sheet does not say : Hands-off and the cards compare it with the agency's country */
export function prospectCountry(sheet: any): string {
  const id = sheet?.identity || {}
  if (typeof id.country === "string" && /^[A-Za-z]{2}$/.test(id.country)) return id.country.toUpperCase()
  if (id.state || /^\+1|^\(\d{3}\)/.test(String(id.phone || ""))) return "US"
  if (/^(\+33|0\d)[\s.]?\d{2}/.test(String(id.phone || "")) || (/^\d{5}$/.test(String(id.zip || id.postalCode || "")) && !id.state)) return "FR"
  return ""
}


// ── the owner's preferences in a demo build (D6 : the sandbox honours them VISIBLY) ─────────────────────────────────
/** what each canonical preference changes in a demo site ; a preference with no key (free words) can't be shown */
const EFFECT: Record<string, string> = {
  "hero-own-photo": "photo", "hero-type": "type", "no-stock-phrases": "concrete", "phone-top": "phoneTop", "light-pages": "light", "dark-pages": "dark",
  "short-copy": "short", "reviews-up": "reviews", "bigger-text": "bigText", "serif-headlines": "serif", "calm-motion": "calm", "brand-colours": "brand",
  "service-area": "areas", "no-emoji": "noEmoji", prices: "prices",
}
const OPPOSITE: Record<string, string> = { photo: "type", type: "photo", light: "dark", dark: "light" }
export type TastePlan = { effects: Set<string>; applied: PromptPref[]; skipped: (PromptPref & { why: string })[]; traits: Traits }
/**
 * Which of the active preferences this demo site applies, in their order (the most confident first) : the ones the
 * demo can show, unless the business has nothing to show it with (no phone, no reviews) or a stronger preference says
 * the opposite. Each skip says why, in plain words.
 */
export function planTaste(sheet: any, prefs: PromptPref[], o: { photo?: boolean } = {}): TastePlan {
  const effects = new Set<string>(), applied: PromptPref[] = [], skipped: (PromptPref & { why: string })[] = []
  const id = sheet?.identity || {}
  for (const p of prefs) {
    const fx = p.key ? EFFECT[p.key] : undefined
    if (!fx) { skipped.push({ ...p, why: "The demo can't show this one: a real build applies it" }); continue }
    const opp = OPPOSITE[fx]
    if (opp && effects.has(opp)) { skipped.push({ ...p, why: "A stronger preference says the opposite" }); continue }
    // their own photo only when there is a real one (a picture, never a drawing standing in for it) : the demo's
    // fictional businesses have none, so it is kept for real builds and said so, never claimed over an illustration
    if (fx === "photo" && !o.photo) { skipped.push({ ...p, why: "Noted for real builds: the demo has no photo of theirs" }); continue }
    if (fx === "phoneTop" && !id.phone) { skipped.push({ ...p, why: "No phone number on their site" }); continue }
    if (fx === "reviews" && !Number(sheet?.audit?.strengths?.googleRating || sheet?.content?.googleRating || 0)) { skipped.push({ ...p, why: "No reviews on their site" }); continue }
    if (fx === "prices" && !(Array.isArray(sheet?.content?.prices) && sheet.content.prices.length)) { skipped.push({ ...p, why: "No prices on their site" }); continue }
    effects.add(fx); applied.push(p)
  }
  const bg = String(sheet?._sim?.palette?.bg || "#f6f3ec")
  const traits: Traits = { tone: effects.has("dark") || luminance(bg) < 0.4 ? "dark" : "light", hero: effects.has("photo") ? "photo" : "type" }
  return { effects, applied, skipped, traits }
}
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim()); if (!m) return 1
  const n = parseInt(m[1], 16); return ((n >> 16) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255
}
// a PHOTO is a picture file : an .svg is a drawing (the demo's fictional sites are drawn), never passed off as a photo
const PHOTO_EXT = /\.(png|jpe?g|webp)$/i
/**
 * Their own photo for a demo build : one from their sheet's assets (data/assets/<id>/photo-*), else from their old site
 * (data/old-sites/<id>/img, never a logo, a badge, a background tile or a captioned picture), as a real picture file ;
 * "" when they have none (then the hero keeps its words, and the photo preference waits for a real build).
 */
export function findOwnPhoto(sheet: any, root = "."): string {
  const id = String(sheet?.id || "")
  const pick = (dir: string, re: RegExp) => { try { return readdirSync(dir).filter((f) => PHOTO_EXT.test(f) && re.test(f)).sort().map((f) => join(dir, f))[0] || "" } catch { return "" } }
  return pick(join(root, "data", "assets", id), /^photo/i) || pick(join(root, "data", "old-sites", id, "img"), /^(?!.*(logo|tile|badge|icon|bg|background|caption|banner)).*/i)
}
/** copies their photo into the site ; its path relative to the site */
export function ownPhoto(src: string, siteDir: string): string {
  mkdirSync(join(siteDir, "assets"), { recursive: true })
  const name = basename(src)
  copyFileSync(src, join(siteDir, "assets", name))
  return `assets/${name}`
}
/**
 * A demo build that honours the active preferences : the site rendered with the effects it can show, their photo copied
 * in when the hero should carry it, and its record (.lws-taste.json) : given, applied, skipped with why, its traits.
 */
export function renderWithTaste(sheet: any, language: string, siteDir: string, prefs: PromptPref[], by = "demo", root = "."): { html: string; record: SiteTaste } {
  const src = findOwnPhoto(sheet, root)
  const plan = planTaste(sheet, prefs, { photo: !!src })
  const photo = plan.effects.has("photo") ? ownPhoto(src, siteDir) : undefined
  const html = renderNewSite(sheet, language, { effects: plan.effects, photo })
  return { html, record: { at: new Date().toISOString(), by, given: prefs, applied: plan.applied, skipped: plan.skipped, traits: plan.traits } }
}
