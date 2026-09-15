/**
 * One-line $skill discovery copy.
 *
 * Cursor / Kimi / generic ACP: do **not** prepend this onto user turns — that
 * path looks like prompt injection (tiann/hapi#1095). Those flavors rely on the
 * `skill_lookup` MCP tool description (and Cursor's native `~/.cursor/mcp.json`
 * overlay where session/new mcpServers are ignored).
 *
 * Grok / OpenCode remote: no durable system-prompt channel, so this one-liner
 * rides the existing first-turn title prepend. Keep it a single sentence; never
 * attach AGENT_NOTIFY_SUMMARY there (#1095/#1096). Full session-summary for
 * those flavors is #89.
 */
export const SKILL_LOOKUP_INSTRUCTION =
    'When a user message starts with "$name", call HAPI\'s skill_lookup tool with "name" (without "$") before acting.'
