/**
 * stream-events.ts · traduit un évènement `claude -p --output-format stream-json` en UNE ligne lisible
 * (journal du batch dans le cockpit, sortie de first-site). "" = bruit à ignorer.
 * Partagé par worker/worker.ts et scripts/first-site.ts.
 */
export function readableEvent(line: string): string {
  let e: any
  try { e = JSON.parse(line) } catch { return "" } // ligne non-JSON (bruit) → ignorée
  if (e.type === "assistant" && e.message?.content) {
    const out: string[] = []
    for (const c of e.message.content) {
      if (c.type === "text" && typeof c.text === "string" && c.text.trim()) {
        out.push("💬 " + c.text.trim().split("\n")[0].slice(0, 140))
      } else if (c.type === "tool_use") {
        const i = c.input || {}
        if (c.name === "Bash") out.push("▸ " + String(i.command || "").replace(/\s+/g, " ").slice(0, 90))
        else if (c.name === "Write" || c.name === "Edit" || c.name === "MultiEdit")
          out.push("✍️ " + String(i.file_path || "").replace(/^.*\/output\//, "output/").replace(/^.*\/data\//, "data/"))
        else if (c.name === "Workflow") out.push("⚙️ compose-batch (orchestrateur d'agents)…")
        // « Task » = nom de l'outil sous-agent jusqu'aux CLI 2.1.2xx, « Agent » ensuite : on lit les deux
        else if (c.name === "Agent" || c.name === "Task") out.push("🤖 sous-agent : " + String(i.description || i.subagent_type || "").slice(0, 80))
        else if (c.name === "Read" || c.name === "Glob" || c.name === "Grep") { /* lecture = bruit, on saute */ }
        else out.push("· " + c.name)
      }
    }
    return out.join("  ·  ")
  }
  if (e.type === "result") return e.is_error ? "✗ " + String(e.result || "erreur").slice(0, 140) : "✓ " + String(e.result || "terminé").slice(0, 140)
  return "" // system / tool_result → bruit
}
