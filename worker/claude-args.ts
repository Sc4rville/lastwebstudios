/**
 * claude-args.ts · the `claude -p` arguments of the worker's agents (composer, edit, research).
 * A module without side effects (importable by the tests and by npm run doctor).
 *
 * The allowed tools are DECLARED (`--allowedTools …`) rather than `--permission-mode bypassPermissions` /
 * `--dangerously-skip-permissions`: the latter is REFUSED by Claude Code when the process runs as root (the
 * box runs as root), and getting around it (IS_SANDBOX) would be a security hole.
 * Since Claude Code 2.1.302, `claude -p` starts in Manual mode: a permission-gated tool that is NOT listed is
 * refused (silently for a sub-agent). Up-to-date names (tools-reference, 10/24/2026): `Agent` (formerly `Task`, no
 * permission needed, listed to be explicit), `Workflow` and `Skill` (permission needed); no more `MultiEdit`
 * (removed) nor `TodoWrite` (disabled in favour of TaskCreate…, no permission). Glob/Grep are absent by
 * default on Linux (search goes through Bash): listing them costs nothing and serves the other platforms.
 * `--strict-mcp-config`: no MCP server is loaded (neither the repo's `.mcp.json`, which points at Supabase, nor
 * the claude.ai connectors of a machine signed in with /login: a probe on 10/24, a `claude -p` session there saw
 * Gmail send_message, Calendar, Drive…). The composer uses none (images and video go through CLIs).
 * Can be overridden: WORKER_CLAUDE_ARGS="…".
 */
export const DEFAULT_CLAUDE_ARGS = "-p --strict-mcp-config --allowedTools Bash Read Write Edit Glob Grep Agent Workflow Skill WebFetch WebSearch"

/** Removed or renamed tools: a WORKER_CLAUDE_ARGS that names them is out of date (flagged by npm run doctor). */
export const STALE_TOOLS: Record<string, string> = { MultiEdit: "removed (Edit is enough)", Task: "renamed Agent", TodoWrite: "disabled (TaskCreate…)" }

export function workerClaudeArgs(env: Record<string, string | undefined> = process.env): string[] {
  return (env.WORKER_CLAUDE_ARGS || DEFAULT_CLAUDE_ARGS).split(/\s+/).filter(Boolean)
}
