/**
 * json.ts · gets the JSON out of a model's answer, even when wrapped in text, ``` or reasoning.
 * It is the FALLBACK when the way has no native structured output (or the model didn't fill it).
 */

/** Every balanced top-level JSON object in the text, in order (strings are honoured). */
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
  try { return JSON.parse(cleaned) } catch { /* look for an object in the text */ }
  // the LAST object that parses: a model that reasons before answering puts the answer at the end
  for (const c of balancedObjects(cleaned).reverse()) {
    try { return JSON.parse(c) } catch { /* next */ }
  }
  throw new Error("The skill's answer is not JSON:\n" + raw.slice(0, 500))
}
