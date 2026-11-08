/**
 * The cockpit's design system, read from its files (the browser half is test/e2e/audit.test.ts) : one typeface loaded
 * at every weight it uses, the tokens, a lime primary that never fades into a disabled lime, an error toast that reads,
 * billing on the same stylesheet ; and the times the call panel offers (« Tomorrow 10:00 », « 10:00 AM » in the US).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

// the browser's own module (plain JS, no types) : loaded as it is served
const LOCALE = "../../backoffice/reviewpipe/public/locale.js"
const { L, setLocale, time, weekday } = await import(LOCALE) as { L: Record<string, unknown>; setLocale: (a: object) => void; time: (ms: number) => string; weekday: (ms: number, w?: string) => string }

const PUB = "backoffice/reviewpipe/public"
const css = readFileSync(`${PUB}/app.css`, "utf8")
// the body of the rule whose selector list is exactly `sel` (at the start of a line or right after another rule)
const rule = (sel: string): string => { const m = new RegExp(`(?:^|[\\n}])${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\{([^}]*)\\}`).exec(css); assert.ok(m, `no rule ${sel}`); return m[1] }

test("one typeface: Host Grotesk as a variable font (400, 500 and 600 all real), JetBrains Mono for numbers, no Space Grotesk", () => {
  assert.match(css, /font-family:"Host Grotesk"; font-weight:300 800; src:url\("\/designfont\/host-grotesk\/host-grotesk-var\.woff2"\)/)
  assert.doesNotMatch(css, /Space Grotesk|host-grotesk-(400|600)\.woff2/)
  const families = new Set([...css.matchAll(/font-family:\s*"([^"]+)"/g)].map((m) => m[1]))
  assert.deepEqual([...families].sort(), ["Host Grotesk", "JetBrains Mono"])
  assert.match(rule("body"), /font:var\(--t14\)\/1\.45 var\(--font\)/, "UI line-height 1.45")
  assert.match(rule(".script"), /line-height:1\.6/, "long text 1.6")
})

test("tokens (the studio): surfaces, glass, hairlines, one lime with its soft and line, header 60, radii 8 / 10 / 14 / 18 / 24 / 999", () => {
  const root = rule(":root")
  for (const t of ["--bg:#09090b", "--bg2:#111114", "--bg3:#18181c", "--line:rgba(255,255,255,.07)", "--line2:rgba(255,255,255,.13)", "--accent:#d8ff3e", "--accent-hover:#e5ff70", "--accent-ink:#121603", "--accent-soft:rgba(216,255,62,.12)", "--accent-line:rgba(216,255,62,.45)", "--frame:#0c0c0f", "--top:60px", "--r-chip:8px", "--r:10px", "--r-thumb:14px", "--r-card:18px", "--r-sheet:24px", "--pill:999px"]) assert.ok(root.includes(t), t)
  for (const s of ["--s1:4px", "--s2:8px", "--s3:12px", "--s4:16px", "--s5:24px", "--s6:32px", "--s7:48px"]) assert.ok(root.includes(s), s)
  // glass is chrome over content ; a layer that floats over content and must stay readable is solid
  assert.match(root, /--glass:rgba\(22,22,26,\.66\)/); assert.match(root, /--solid:#1b1b20/)
  assert.match(rule(".dropdown"), /background:var\(--solid\)/, "the menu is solid")
  // the lime is never a colour picked by hand outside the tokens
  assert.equal([...css.matchAll(/#d8ff3e|#e5ff70/gi)].length, 2)
})

test("components: the primary (inset highlight, hover), a disabled state without opacity, a readable error toast, steps as one segmented control", () => {
  assert.match(rule(".btn.primary"), /background:var\(--accent\);color:var\(--accent-ink\).*font-weight:600;box-shadow:inset/)
  assert.match(rule(".btn.primary:hover"), /background:var\(--accent-hover\)/)
  const disabled = css.slice(css.indexOf(".btn:disabled,"), css.indexOf("a.btn.disabled"))
  assert.doesNotMatch(disabled, /opacity/, "disabled is a state, not a fade")
  assert.match(disabled, /\.btn\.primary:disabled[^{]*\{background:var\(--bg3\)/)
  for (const t of ["--bad-bg:#2a1113", "--bad-ink:#ffb4b4", "--bad-line:rgba(255,107,107,.35)"]) assert.ok(rule(":root").includes(t), t)
  assert.match(rule(".toast.bad"), /background:var\(--bad-bg\);color:var\(--bad-ink\);border-color:var\(--bad-line\)/)
  assert.match(rule(".steps"), /height:42px;.*border-radius:var\(--pill\)/)
  assert.doesNotMatch(css, /\.steps \.arrow/, "no hand-drawn arrows")
  assert.match(rule(".steps a i"), /background:transparent/, "count badges are neutral")
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[^}]*animation:none !important/, "the motion honours reduced motion")
  const index = readFileSync(`${PUB}/index.html`, "utf8")
  assert.match(index, /<div class="dropdown" id="menuDrop" role="menu" hidden>[\s\S]*What the agency learned[\s\S]*<hr>[\s\S]*Billing/)
})

test("billing reads app.css: no token, font or colour of its own", () => {
  const html = readFileSync(`${PUB}/billing.html`, "utf8")
  const style = (/<style>([\s\S]*?)<\/style>/.exec(html) || [])[1] || ""
  assert.match(html, /<link rel="stylesheet" href="\/app\.css">/)
  assert.doesNotMatch(style, /--[a-z0-9-]+\s*:|@font-face|Space Grotesk|#[0-9a-f]{3,6}\b|\.seg button/i)
})

test("the call panel's times: 10:00 in France, 10:00 AM in the US, the weekday in full", () => {
  const was = { ...L }
  try {
    const t = new Date(2026, 10, 9, 10, 0, 0).getTime() // a Monday, 10:00 local
    setLocale({ country: "FR", locale: "fr-FR", currency: "EUR" })
    assert.equal(time(t), "10:00"); assert.equal(weekday(t, "long"), "Monday"); assert.equal(weekday(t), "Mon")
    setLocale({ country: "US", locale: "en-US", currency: "USD" })
    assert.match(time(t), /^10:00\sAM$/); assert.match(time(t + 5 * 3600_000), /^3:00\sPM$/); assert.equal(weekday(t, "long"), "Monday")
    assert.equal(time(0), "")
  } finally { Object.assign(L, was) }
})
