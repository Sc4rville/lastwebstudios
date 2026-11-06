/**
 * claude-args.ts · les arguments de `claude -p` des agents du worker (composer, édition, recherche).
 * Module sans effet de bord (importable par les tests et par npm run doctor).
 *
 * On DÉCLARE les outils autorisés (`--allowedTools …`) plutôt que `--permission-mode bypassPermissions` /
 * `--dangerously-skip-permissions` : ce dernier est REFUSÉ par Claude Code quand le process tourne en root (la
 * box est en root), et le contourner (IS_SANDBOX) serait un trou de sécu.
 * Depuis Claude Code 2.1.302, `claude -p` démarre en mode Manual : un outil soumis à permission et NON listé est
 * refusé (en silence pour un sous-agent). Noms à jour (tools-reference, 24/10/2026) : `Agent` (ex-`Task`, sans
 * permission requise, listé pour être explicite), `Workflow` et `Skill` (permission requise) ; plus de `MultiEdit`
 * (retiré) ni de `TodoWrite` (désactivé au profit de TaskCreate…, sans permission). Glob/Grep sont absents par
 * défaut sous Linux (la recherche passe par Bash) : les lister ne coûte rien et sert les autres plateformes.
 * `--strict-mcp-config` : aucun serveur MCP n'est chargé (ni le `.mcp.json` du dépôt, qui pointe sur Supabase, ni
 * les connecteurs claude.ai d'une machine connectée par /login : sonde du 24/10, une session `claude -p` y voyait
 * Gmail send_message, Calendar, Drive…). Le composer n'en utilise aucun (image et vidéo passent par des CLI).
 * Surchargeable : WORKER_CLAUDE_ARGS="…".
 */
export const DEFAULT_CLAUDE_ARGS = "-p --strict-mcp-config --allowedTools Bash Read Write Edit Glob Grep Agent Workflow Skill WebFetch WebSearch"

/** Outils retirés ou renommés : un WORKER_CLAUDE_ARGS qui les cite est périmé (signalé par npm run doctor). */
export const STALE_TOOLS: Record<string, string> = { MultiEdit: "retiré (Edit suffit)", Task: "renommé Agent", TodoWrite: "désactivé (TaskCreate…)" }

export function workerClaudeArgs(env: Record<string, string | undefined> = process.env): string[] {
  return (env.WORKER_CLAUDE_ARGS || DEFAULT_CLAUDE_ARGS).split(/\s+/).filter(Boolean)
}
