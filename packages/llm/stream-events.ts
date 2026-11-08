/**
 * stream-events.ts · turns a `claude -p --output-format stream-json` event into ONE readable line
 * (the batch log in the cockpit, first-site's output). "" = noise to ignore.
 * Shared by worker/worker.ts and scripts/first-site.ts.
 */
export function readableEvent(line: string): string {
  let e: any
  try { e = JSON.parse(line) } catch { return "" } // non-JSON line (noise) → ignored
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
        else if (c.name === "Workflow") out.push("⚙️ compose-batch (agent orchestrator)…")
        // "Task" = the sub-agent tool's name up to CLI 2.1.2xx, "Agent" afterwards: we read both
        else if (c.name === "Agent" || c.name === "Task") out.push("🤖 sub-agent: " + String(i.description || i.subagent_type || "").slice(0, 80))
        else if (c.name === "Read" || c.name === "Glob" || c.name === "Grep") { /* reading = noise, skip */ }
        else out.push("· " + c.name)
      }
    }
    return out.join("  ·  ")
  }
  if (e.type === "result") return e.is_error ? "✗ " + String(e.result || "error").slice(0, 140) : "✓ " + String(e.result || "done").slice(0, 140)
  return "" // system / tool_result → noise
}
