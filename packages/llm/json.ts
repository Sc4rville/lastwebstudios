/**
 * json.ts · récupère le JSON d'une réponse de modèle, même entouré de texte, de ``` ou de raisonnement.
 * C'est le REPLI quand la voie n'a pas de sortie structurée native (ou quand le modèle ne l'a pas remplie).
 */

/** Tous les objets JSON équilibrés au premier niveau du texte, dans l'ordre (les chaînes sont respectées). */
function balancedObjects(t: string): string[] {
  const out: string[] = []
  let depth = 0, start = -1, inStr = false, esc = false
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === "\\") esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') { if (depth > 0) inStr = true; continue }
    if (ch === "{") { if (depth === 0) start = i; depth++ }
    else if (ch === "}" && depth > 0) { depth--; if (depth === 0 && start >= 0) { out.push(t.slice(start, i + 1)); start = -1 } }
  }
  return out
}

export function parseJson(text: string): any {
  const raw = String(text ?? "")
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const cleaned = (fence ? fence[1] : raw).trim()
  try { return JSON.parse(cleaned) } catch { /* on cherche un objet dans le texte */ }
  // le DERNIER objet qui parse : un modèle qui raisonne avant de répondre met la réponse à la fin
  for (const c of balancedObjects(cleaned).reverse()) {
    try { return JSON.parse(c) } catch { /* suivant */ }
  }
  throw new Error("Réponse du skill non-JSON :\n" + raw.slice(0, 500))
}
