# Fonts library (OFL only)

> The composer's library of **free** fonts (SIL Open Font License 1.1). Each file comes from the official Fontsource
> npm package (a mirror of the Google Fonts files), a pinned version, a sha256 fingerprint in `oss.lock.json`, the
> licence text `OFL.txt` in the family's folder. Check: `node scripts/oss/fonts.mjs`; regenerate:
> `node scripts/oss/fonts.mjs --fetch`. The pairs imposed on the composer: `pairings.json` (a distinct heading
> font per site, nothing from `blacklist.txt`).

The generated sites self-host their pair's woff2 files (the site's `fonts/`): redistributing an OFL font is allowed
as long as its licence goes with it (the composer copies `OFL.txt` too). To add a family: list it in
`scripts/oss/fonts.mjs` (Fontsource id), run `--fetch` again, then use it in a pair.

**31 families** · Latin subset (accents, Œ œ, € included).

| family | category | weights | licence · source |
|---|---|---|---|
| **Host Grotesk** (`host-grotesk`) | sans-serif | 300-800 (variable), 300, 400, 600 | OFL-1.1 · [OFL.txt](host-grotesk/OFL.txt) · Fontsource 5.3.0 |
| **Bricolage Grotesque** (`bricolage-grotesque`) | sans-serif | 200-800 (variable) | OFL-1.1 · [OFL.txt](bricolage-grotesque/OFL.txt) · Fontsource 5.3.0 |
| **Archivo** (`archivo`) | sans-serif | 100-900 (variable) | OFL-1.1 · [OFL.txt](archivo/OFL.txt) · Fontsource 5.3.0 |
| **Syne** (`syne`) | sans-serif | 400-800 (variable) | OFL-1.1 · [OFL.txt](syne/OFL.txt) · Fontsource 5.3.0 |
| **Unbounded** (`unbounded`) | sans-serif | 200-900 (variable) | OFL-1.1 · [OFL.txt](unbounded/OFL.txt) · Fontsource 5.3.0 |
| **Space Grotesk** (`space-grotesk`) | sans-serif | 300-700 (variable), 400, 500, 600, 700 | OFL-1.1 · [OFL.txt](space-grotesk/OFL.txt) · Fontsource 5.3.0 |
| **Familjen Grotesk** (`familjen-grotesk`) | sans-serif | 400-700 (variable) | OFL-1.1 · [OFL.txt](familjen-grotesk/OFL.txt) · Fontsource 5.3.0 |
| **Fraunces** (`fraunces`) | serif | 100-900 (variable), 100-900 italic (variable) | OFL-1.1 · [OFL.txt](fraunces/OFL.txt) · Fontsource 5.3.0 |
| **Cormorant Garamond** (`cormorant-garamond`) | serif | 300-700 (variable), 300-700 italic (variable) | OFL-1.1 · [OFL.txt](cormorant-garamond/OFL.txt) · Fontsource 5.3.0 |
| **Newsreader** (`newsreader`) | serif | 200-800 (variable), 200-800 italic (variable) | OFL-1.1 · [OFL.txt](newsreader/OFL.txt) · Fontsource 5.3.0 |
| **Bodoni Moda** (`bodoni-moda`) | serif | 400-900 (variable), 400-900 italic (variable) | OFL-1.1 · [OFL.txt](bodoni-moda/OFL.txt) · Fontsource 5.3.0 |
| **Source Serif 4** (`source-serif-4`) | serif | 200-900 (variable), 200-900 italic (variable) | OFL-1.1 · [OFL.txt](source-serif-4/OFL.txt) · Fontsource 5.3.0 |
| **Instrument Serif** (`instrument-serif`) | serif | 400, 400 italic | OFL-1.1 · [OFL.txt](instrument-serif/OFL.txt) · Fontsource 5.3.0 |
| **DM Serif Display** (`dm-serif-display`) | serif | 400, 400 italic | OFL-1.1 · [OFL.txt](dm-serif-display/OFL.txt) · Fontsource 5.3.0 |
| **Young Serif** (`young-serif`) | serif | 400 | OFL-1.1 · [OFL.txt](young-serif/OFL.txt) · Fontsource 5.3.0 |
| **Geist** (`geist`) | sans-serif | 100-900 (variable), 300, 400 | OFL-1.1 · [OFL.txt](geist/OFL.txt) · Fontsource 5.3.0 |
| **Instrument Sans** (`instrument-sans`) | sans-serif | 400-700 (variable) | OFL-1.1 · [OFL.txt](instrument-sans/OFL.txt) · Fontsource 5.3.0 |
| **Manrope** (`manrope`) | sans-serif | 200-800 (variable) | OFL-1.1 · [OFL.txt](manrope/OFL.txt) · Fontsource 5.3.0 |
| **Figtree** (`figtree`) | sans-serif | 300-900 (variable) | OFL-1.1 · [OFL.txt](figtree/OFL.txt) · Fontsource 5.3.0 |
| **Work Sans** (`work-sans`) | sans-serif | 100-900 (variable) | OFL-1.1 · [OFL.txt](work-sans/OFL.txt) · Fontsource 5.3.0 |
| **IBM Plex Sans** (`ibm-plex-sans`) | sans-serif | 100-700 (variable) | OFL-1.1 · [OFL.txt](ibm-plex-sans/OFL.txt) · Fontsource 5.3.0 |
| **DM Sans** (`dm-sans`) | sans-serif | 100-900 (variable) | OFL-1.1 · [OFL.txt](dm-sans/OFL.txt) · Fontsource 5.3.0 |
| **Schibsted Grotesk** (`schibsted-grotesk`) | sans-serif | 400-900 (variable) | OFL-1.1 · [OFL.txt](schibsted-grotesk/OFL.txt) · Fontsource 5.3.0 |
| **Onest** (`onest`) | sans-serif | 100-900 (variable) | OFL-1.1 · [OFL.txt](onest/OFL.txt) · Fontsource 5.3.1 |
| **Plus Jakarta Sans** (`plus-jakarta-sans`) | sans-serif | 200-800 (variable) | OFL-1.1 · [OFL.txt](plus-jakarta-sans/OFL.txt) · Fontsource 5.3.0 |
| **JetBrains Mono** (`jetbrains-mono`) | monospace | 100-800 (variable), 400, 500, 700 | OFL-1.1 · [OFL.txt](jetbrains-mono/OFL.txt) · Fontsource 5.3.0 |
| **Chivo Mono** (`chivo-mono`) | monospace | 100-900 (variable) | OFL-1.1 · [OFL.txt](chivo-mono/OFL.txt) · Fontsource 5.3.0 |
| **Geist Mono** (`geist-mono`) | monospace | 100-900 (variable) | OFL-1.1 · [OFL.txt](geist-mono/OFL.txt) · Fontsource 5.3.0 |
| **IBM Plex Mono** (`ibm-plex-mono`) | monospace | 400, 500 | OFL-1.1 · [OFL.txt](ibm-plex-mono/OFL.txt) · Fontsource 5.3.0 |
| **DM Mono** (`dm-mono`) | monospace | 400, 500 | OFL-1.1 · [OFL.txt](dm-mono/OFL.txt) · Fontsource 5.3.0 |
| **Space Mono** (`space-mono`) | monospace | 400, 700 | OFL-1.1 · [OFL.txt](space-mono/OFL.txt) · Fontsource 5.3.0 |
