/**
 * package.ts — turns a verified demo into a portable DELIVERABLE (distribution block). Mechanical, zero LLM.
 *
 * distribution/packages/<id>/
 *   site/          the demo, self-contained (relative assets → opens offline or on any static host)
 *   before.png     their current site          ← the argument
 *   after.png      the demo                    ← the proof
 *   index.html     a before/after slider page  ← the preview link IS the pitch
 *   manifest.json  who, why (score reasons), what was built
 *
 * The atelier never contacts anyone by itself: outreach is drafted for a human to review and send.
 *
 * Export : packageDemo(id)     CLI : npm run package -- <prospectId>
 */
import { cp, mkdir, rm, writeFile, readFile, copyFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { ProspectSheet } from "../../packages/shared/prospect.ts"
import { siteDir } from "../../design/scripts/compose.ts"

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)

function comparePage(sheet: ProspectSheet): string {
  const name = esc(sheet.identity.name)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name} — before / after</title>
<style>
  :root { --ink: #111; --paper: #f4f1ea; --accent: #ff5a1f; }
  * { box-sizing: border-box; margin: 0; }
  body { background: var(--ink); color: var(--paper); font: 14px/1.5 ui-monospace, "Chivo Mono", monospace; }
  header { display: flex; justify-content: space-between; align-items: center; padding: 18px 28px; letter-spacing: .14em; text-transform: uppercase; font-size: 11px; }
  header a { color: var(--accent); text-decoration: none; }
  .cmp { position: relative; margin: 0 28px 28px; height: calc(100vh - 80px); overflow: hidden; border: 1px solid #333; user-select: none; }
  .cmp img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: top center; pointer-events: none; }
  .cmp .before { clip-path: inset(0 calc(100% - var(--x, 50%)) 0 0); background: #d9d4cc; }
  .bar { position: absolute; top: 0; bottom: 0; left: var(--x, 50%); width: 2px; background: var(--accent); }
  .bar::after { content: "⟷"; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 44px; height: 44px; border-radius: 50%; background: var(--accent); color: var(--ink); display: grid; place-items: center; font-size: 18px; }
  .tag { position: absolute; top: calc(50% - 14px); padding: 6px 10px; background: rgba(0,0,0,.7); font-size: 11px; letter-spacing: .16em; text-transform: uppercase; }
  .tag.b { left: 16px; } .tag.a { right: 16px; color: var(--accent); }
</style>
</head>
<body>
<header><span>${name} · ${esc(sheet.identity.city)} — score ${sheet.score.value}/100 (${sheet.score.tier})</span><a href="site/index.html">Open the demo ↗</a></header>
<div class="cmp" id="cmp">
  <img src="after.png" alt="After: the demo">
  <img class="before" src="before.png" alt="Before: their current site">
  <div class="bar"></div>
  <span class="tag b">Before</span><span class="tag a">After</span>
</div>
<script>
  const cmp = document.getElementById("cmp")
  const set = (x) => cmp.style.setProperty("--x", Math.max(0, Math.min(100, x)) + "%")
  cmp.addEventListener("pointermove", (e) => { const r = cmp.getBoundingClientRect(); set(((e.clientX - r.left) / r.width) * 100) })
</script>
</body>
</html>
`
}

export async function packageDemo(id: string): Promise<string> {
  const site = siteDir(id)
  const sheet: ProspectSheet = JSON.parse(await readFile(join("data", "prospects", `${id}.json`), "utf8"))
  const verdict = JSON.parse(await readFile(join(site, "verify.json"), "utf8"))
  if (!verdict.pass) throw new Error(`package: ${id} did not pass the verify gate — nothing leaves the atelier`)

  const out = join("distribution", "packages", id)
  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })
  await cp(site, join(out, "site"), {
    recursive: true,
    filter: (src) => !/(verify\.json|build\.json|hero\.png|after\.png|mobile\.png)$/.test(src),
  })
  await copyFile(join("data", sheet.existing.screenshot!), join(out, "before.png"))
  await copyFile(join(site, "after.png"), join(out, "after.png"))
  await writeFile(join(out, "index.html"), comparePage(sheet))
  await writeFile(
    join(out, "manifest.json"),
    JSON.stringify(
      {
        id,
        name: sheet.identity.name,
        city: sheet.identity.city,
        industry: sheet.industry,
        currentSite: sheet.existing.url,
        score: { value: sheet.score.value, tier: sheet.score.tier, expectedValue: sheet.score.expectedValue, reasons: sheet.score.reasons },
        services: sheet.content.services,
        packagedAt: new Date().toISOString(),
        outreach: { drafted: false, sent: false, note: "drafted for human review only — never sent automatically" },
      },
      null,
      2,
    ),
  )
  return out
}

// --- CLI ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [id] = process.argv.slice(2)
  if (!id) {
    console.error("usage: npm run package -- <prospectId>")
    process.exit(1)
  }
  console.log(`✓ packaged → ${await packageDemo(id)}`)
}
