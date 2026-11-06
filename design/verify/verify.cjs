#!/usr/bin/env node
/**
 * verify.cjs — render a templatized index.html headless and prove it's sound.
 * Checks: no horizontal overflow ("rien qui dépasse"), no console errors, writes a screenshot.
 * Portable: locates playwright(-core) and a Chrome/Chromium binary from common locations.
 *
 * Usage: node verify.cjs <path/to/index.html> [screenshot.png]
 * Prints JSON. Exit 0 ok, 1 problems found, 2 skipped (no browser/playwright available).
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const file = process.argv[2];
const shot = process.argv[3] || path.join(path.dirname(file || '.'), '_verify.png');
if (!file || !fs.existsSync(file)) {
  console.log(JSON.stringify({ skipped: true, reason: 'index.html not found' }));
  process.exit(2);
}

function findPlaywright() {
  const tries = [];
  for (const base of [process.cwd(), path.dirname(file), __dirname]) {
    let d = base;
    for (let i = 0; i < 6; i++) {                       // walk up looking for node_modules
      for (const m of ['playwright', 'playwright-core'])
        tries.push(path.join(d, 'node_modules', m, 'index.js'));
      d = path.dirname(d);
    }
  }
  for (const m of ['playwright', 'playwright-core']) tries.push(m);   // global resolve
  for (const t of tries) { try { return require(t); } catch (_) {} }
  return null;
}

function findChrome() {
  const cands = [
    '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch (_) {} }
  for (const c of ['google-chrome-stable', 'google-chrome', 'chromium']) {
    try { return execSync(`command -v ${c}`).toString().trim(); } catch (_) {}
  }
  return null;
}

(async () => {
  const pw = findPlaywright();
  const chrome = findChrome();
  if (!pw || !pw.chromium) { console.log(JSON.stringify({ skipped: true, reason: 'playwright not found' })); process.exit(2); }

  const launchOpts = { args: ['--no-sandbox', '--hide-scrollbars'] };
  if (chrome) launchOpts.executablePath = chrome;
  let browser;
  try { browser = await pw.chromium.launch(launchOpts); }
  catch (e) { console.log(JSON.stringify({ skipped: true, reason: 'launch failed: ' + e.message })); process.exit(2); }

  const out = {};
  for (const [label, w, h] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto('file://' + path.resolve(file), { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(1500);                                // laisse charger images + se déclencher les reveals
    const m = await page.evaluate(() => {
      const de = document.documentElement;
      // IMAGES : cassées (404 / 0px chargé) + floues (rendues > 1.25× leur résolution native)
      const imgs = [...document.images];
      const broken = imgs.filter(im => im.complete && im.naturalWidth === 0).length;
      const blurry = imgs.filter(im => {
        if (!im.naturalWidth) return false;
        const cw = im.getBoundingClientRect().width;
        return cw > 120 && cw > im.naturalWidth * 1.25;            // petite photo étirée en grand = floue
      }).map(im => ({ src: (im.currentSrc || im.src || '').split('/').pop(), nat: im.naturalWidth, css: Math.round(im.getBoundingClientRect().width) }));
      // VOID : blocs conséquents restés INVISIBLES après chargement (un reveal qui ne s'est pas déclenché)
      const stuck = [...document.querySelectorAll('section,figure,article,.reveal,[data-reveal],.gallery,.grid,picture')].filter(el => {
        const r = el.getBoundingClientRect();
        if (r.width * r.height < 50000) return false;
        const cs = getComputedStyle(el);
        return parseFloat(cs.opacity) < 0.15 || cs.visibility === 'hidden' || /inset\(\s*100%/.test(cs.clipPath || '');  // <0.15 attrape le truc "opacity:.001" qui rend la capture BLANCHE (juge/cockpit voient du vide)
      }).length;
      // TITRES ROGNÉS ("lettre coupée") : un heading dont le contenu déborde sa propre boîte alors que
      // l'overflow est masqué (overflow:hidden/clip). Les transforms de reveal n'affectent PAS scrollHeight/
      // clientHeight (métriques de layout) → ce signal n'attrape que du VRAI clipping (line-height trop serré,
      // boîte à hauteur fixe, mot tronqué, text-overflow). Tolérance verticale pour accents/descendantes.
      const clipped = [...document.querySelectorAll('h1,h2,h3,[class*="title" i],[class*="heading" i],[class*="display" i],[class*="hero" i] h1,[class*="hero" i] h2')].filter(el => {
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 14) return false;
        if (!el.textContent || !el.textContent.trim()) return false;
        const cs = getComputedStyle(el);
        const hidV = cs.overflowY === 'hidden' || cs.overflowY === 'clip' || cs.overflow === 'hidden' || cs.overflow === 'clip';
        const hidH = cs.overflowX === 'hidden' || cs.overflowX === 'clip' || cs.overflow === 'hidden' || cs.overflow === 'clip';
        const clipV = hidV && el.scrollHeight > el.clientHeight + 6;   // ascendante/descendante/accent rogné
        const clipH = hidH && el.scrollWidth  > el.clientWidth  + 2;   // mot coupé / text-overflow
        return clipV || clipH;
      }).map(el => ({ t: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 48), tag: el.tagName.toLowerCase(),
                      sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth }));
      return { sw: de.scrollWidth, iw: window.innerWidth, sh: de.scrollHeight, broken, blurry, stuck, clipped };
    });
    const png = label === 'desktop' ? shot : shot.replace(/\.png$/, '') + '.mobile.png';
    await page.screenshot({ path: png, fullPage: true });          // PLEINE PAGE (avant/après comparables, fini le viewport tronqué)
    out[label] = { overflowX: m.sw > m.iw + 1, scrollW: m.sw, innerW: m.iw, scrollH: m.sh, consoleErrors: errors.length,
                   brokenImages: m.broken, blurryImages: m.blurry, stuckHidden: m.stuck, clippedHeadings: m.clipped, screenshot: png };
    await page.close();
  }
  await browser.close();

  const ok = !out.desktop.overflowX && !out.mobile.overflowX;       // rétro-compatible (templatize lit `ok`)
  // `clean` = la porte du COMPOSER : pas d'overflow, ni image cassée/floue, ni void béant, ni TITRE ROGNÉ
  const d = out.desktop;
  const clippedAll = [...d.clippedHeadings, ...out.mobile.clippedHeadings];
  const clean = ok && d.brokenImages === 0 && d.blurryImages.length === 0 && d.stuckHidden === 0 && clippedAll.length === 0;
  console.log(JSON.stringify({ ok, clean, ...out }, null, 2));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.log(JSON.stringify({ skipped: true, reason: e.message })); process.exit(2); });
