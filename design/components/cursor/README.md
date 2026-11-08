# Cursor — a custom "Awwwards" cursor

A sharp dot that follows to the pixel + a ring that **trails** (RAF easing), in `mix-blend-mode: difference`
(it inverts what it hovers → readable on light AND dark). **Magnetic** on buttons, **grows + shows a label** on
links. **Zero dependencies, ~2 KB, self-contained** (no CDN — consistent with the lws sites).

## Putting it on a site
```html
<link rel="stylesheet" href="cursor.css">
<script src="cursor.js" defer></script>
```
Set the site's accent in the CSS: `:root{ --cz-accent: <the site's colour> }`.

## Marking elements (optional)
- `data-magnetic` (or `data-magnetic="0.45"`) → the element **attracts** the cursor (main CTAs).
- `data-cursor="view"` → the ring **grows** and shows the label on hover (cards, galleries).

## Guard-rails (already handled)
- **Touch** (`pointer: coarse`) and **`prefers-reduced-motion`** → the native cursor is kept, the script doesn't
  turn on. Accessibility OK, no mobile regression.
- Max `z-index` + `pointer-events:none` → never blocks clicks.

Demo: open `demo.html`. Possible variants (to derive): an image trail, multiple dots, a blurred halo.
