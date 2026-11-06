// Génère : (1) les SVG curseurs nets par thème, (2) cursor.css (curseur net data-URI + halo, self-contained),
// (3) une galerie. Source de vérité unique du système curseur. Lancer : node design/components/cursor/_gen-cursors.mjs
import { mkdirSync, writeFileSync } from "node:fs"
const DIR = "design/components/cursor"
mkdirSync(DIR + "/cursors", { recursive: true })

// flèche curseur sharp (hotspot = pointe haut-gauche, 5 3). viewBox 28.
const ARROW = "M5 3 L5 24 L10.6 18.7 L14.2 26.4 L17.6 24.8 L14 17.4 L21.4 17.4 Z"

// a/b = dégradé flèche · stroke = contour · glow = halo (transparent = pas de halo, sobre)
const THEMES = [
  { key: "ocean",  name: "Piscine — aqua",            a: "#5ff0ff", b: "#0bb6d6", stroke: "#063b48", glow: "#2fd4e6", glowSize: 210 },
  { key: "gold",   name: "Lieu de réception — or",     a: "#ffe39a", b: "#e0a52a", stroke: "#5a3d05", glow: "#f2c862", glowSize: 185 },
  { key: "forest", name: "Paysagiste — vert",          a: "#9be88a", b: "#3fae57", stroke: "#0e3a1c", glow: "#6fd08a", glowSize: 195 },
  { key: "wood",   name: "Artisan/charpente — bois",   a: "#d8a86a", b: "#9c5a26", stroke: "#3a2110", glow: "transparent", glowSize: 180 },
  { key: "slate",  name: "Premium/défaut — graphite",  a: "#7a8696", b: "#2b313b", stroke: "#0a0d11", glow: "transparent", glowSize: 180 },
  { key: "snow",   name: "Clair/épuré — blanc",        a: "#ffffff", b: "#dfe6ec", stroke: "#1a2630", glow: "transparent", glowSize: 180 },
  { key: "coral",  name: "Chaleureux — corail",        a: "#ff9d8a", b: "#ef5d57", stroke: "#5c1410", glow: "#ff8a7a", glowSize: 185 },
  { key: "violet", name: "Créatif — violet",           a: "#d3b6ff", b: "#8b5cf6", stroke: "#2c1a52", glow: "#b18cff", glowSize: 190 },
]

// 20px = taille d'un vrai curseur (pas 28 = trop gros). PAS de filtre d'ombre (= flou) : juste dégradé + contour NET.
const svg = (t) => `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 28 28">
<defs><linearGradient id="g-${t.key}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.a}"/><stop offset="1" stop-color="${t.b}"/></linearGradient></defs>
<path d="${ARROW}" fill="url(#g-${t.key})" stroke="${t.stroke}" stroke-width="1.6" stroke-linejoin="round"/></svg>`

const dataUri = (t) => "data:image/svg+xml," + encodeURIComponent(svg(t)).replace(/'/g, "%27").replace(/"/g, "%22")

// 1) fichiers SVG (utiles à part)
for (const t of THEMES) writeFileSync(`${DIR}/cursors/${t.key}.svg`, svg(t))

// 2) cursor.css — curseur NET thématisé (cursor:url inline = self-contained, net à toute résolution) + halo.
//    `cursor` est hérité → s'applique partout ; les liens/boutons gardent leur pointer (voulu).
const css = `/* cursor.css — GÉNÉRÉ par _gen-cursors.mjs (ne pas éditer à la main). Curseur NET par thème
   (cursor:url SVG inline, self-contained) + halo doux qui suit. Thème via <html data-cz-theme="ocean|gold|…">.
   Le curseur natif est REMPLACÉ par une flèche sharp thématisée ; les liens gardent le pointer système. */
.cz-glow{position:fixed;top:0;left:0;z-index:2147483646;pointer-events:none;
  width:var(--cz-glow-size,180px);height:var(--cz-glow-size,180px);
  margin:calc(var(--cz-glow-size,180px)/-2) 0 0 calc(var(--cz-glow-size,180px)/-2);
  border-radius:50%;background:radial-gradient(circle,var(--cz-glow,transparent) 0%,transparent 66%);
  opacity:.42;filter:blur(8px);will-change:transform;transition:opacity .35s ease,width .35s ease,height .35s ease}
html.cz-hover .cz-glow{opacity:.62;width:calc(var(--cz-glow-size,180px)*1.15);height:calc(var(--cz-glow-size,180px)*1.15)}
${THEMES.map((t) => `html[data-cz-theme="${t.key}"]{cursor:url('${dataUri(t)}') 4 2,auto;--cz-glow:${t.glow};--cz-glow-size:${t.glowSize}px}`).join("\n")}
`
writeFileSync(`${DIR}/cursor.css`, css)

// 3) galerie (voir les formes + sentir au survol)
const cell = (t) => `<div class="c" style="cursor:url('${dataUri(t)}') 4 2,auto">
  <div class="big">${svg(t).replace('width="20" height="20"', 'width="84" height="84"')}</div>
  <div class="lbl"><b>${t.key}</b><br><span>${t.name}</span></div></div>`
writeFileSync(`${DIR}/_gallery.html`, `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;background:#0e0f12;color:#e8eaed;font:15px/1.4 system-ui;padding:32px}
  h1{font-weight:300;font-size:24px;margin:0 0 4px}p{color:#9aa0a8;margin:0 0 26px}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;max-width:1100px}
  .c{background:#181a1f;border:1px solid #2a2e36;border-radius:14px;padding:24px;display:flex;flex-direction:column;align-items:center;gap:14px}
  .c:hover{border-color:#3f4654}.big{height:88px;display:grid;place-items:center}
  .lbl{text-align:center}.lbl b{text-transform:uppercase;letter-spacing:.08em;font-size:13px}.lbl span{color:#9aa0a8;font-size:12px}
  .light .c{background:#fff;border-color:#dde3e8;color:#222}.light .lbl span{color:#667}
</style><h1>Curseurs SVG nets — par thème métier</h1><p>Survole : le curseur change (sharp). Flèche affichée en grand pour voir la forme.</p>
<div class="grid">${THEMES.map(cell).join("")}</div>
<h1 style="margin-top:40px">Sur fond clair</h1><div class="grid light">${THEMES.map(cell).join("")}</div>`)

console.log(`✓ ${THEMES.length} curseurs + cursor.css (net+halo) + galerie → ${DIR}/`)
