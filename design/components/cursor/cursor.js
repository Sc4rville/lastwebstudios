/**
 * cursor.js — on NE touche PAS au curseur natif (il reste la flèche classique du système). On ajoute
 * UNIQUEMENT un halo doux qui le suit, coloré par thème (<html data-cz-theme="ocean|gold|forest|wood">).
 * Zéro faux-curseur. Off sur touch et prefers-reduced-motion. Sans thème (halo transparent) → rien d'ajouté.
 */
(() => {
  const fine = matchMedia("(pointer: fine)").matches
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches
  const root = document.documentElement
  if (!fine || calm || !root.dataset.czTheme) return     // tactile / reduced-motion / pas de thème → curseur natif seul

  const glow = document.createElement("div"); glow.className = "cz-glow"
  document.body.appendChild(glow)

  let mx = innerWidth / 2, my = innerHeight / 2, gx = mx, gy = my
  addEventListener("mousemove", (e) => { mx = e.clientX; my = e.clientY }, { passive: true })

  const lerp = (a, b, n) => a + (b - a) * n
  ;(function raf() {
    gx = lerp(gx, mx, 0.14); gy = lerp(gy, my, 0.14)     // suit en douceur (le halo, pas le curseur)
    glow.style.transform = `translate(${gx}px, ${gy}px)`
    requestAnimationFrame(raf)
  })()

  const SEL = "a, button, [data-cursor], [data-magnetic], input, textarea, select, summary, label"
  document.addEventListener("mouseover", (e) => { if (e.target.closest?.(SEL)) root.classList.add("cz-hover") }, { passive: true })
  document.addEventListener("mouseout", (e) => { if (e.target.closest?.(SEL)) root.classList.remove("cz-hover") }, { passive: true })
  document.addEventListener("mouseleave", () => { glow.style.opacity = "0" })
  document.addEventListener("mouseenter", () => { glow.style.opacity = "" })
})()
