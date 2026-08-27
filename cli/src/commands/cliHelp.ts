import chalk from 'chalk'

/**
 * Operator/agent-facing product help for `hapi --help`.
 * Default `hapi` with no args still launches Claude; that must not steal this text.
 */
export function formatHapiCliHelp(): string {
    return `
${chalk.bold('hapi')} - local-first hub + CLI for coding agents

${chalk.bold('Identity:')}
  hapi version           Semver, artifact generation, hub target, skew yes/no
  hapi --version         Same probe line as version (\`hapi version: x.y.z\`)

${chalk.bold('Hub / fleet:')}
  hapi auth              Login, status, token
  hapi hub               Start the API + web hub
  hapi runner            Background daemon (spawn + self-upgrade)
  hapi doctor            Diagnostics

${chalk.bold('Sessions / peers:')}
  hapi                   Start Claude Code (default)
  hapi cursor|codex|pi|opencode|kimi|grok|copilot|agy
  hapi resume [id]       Resume a local HAPI session
  hapi ping-peer         Message another session (prefer MCP ping_peer in-session)
  hapi inspect-peer      Read another session (no resume)
  hapi spawn-peer        Create a peer session and deliver a remit
  hapi job               Attach outliving process work to a session
  hapi mcp               MCP stdio bridge
  hapi notify            Push a notification
  hapi link-pr           Attach a GitHub PR to this session

${chalk.bold('Claude session flags:')}
  hapi claude --help     Claude Code pass-through flags
  hapi --yolo            Start Claude with bypassPermissions

${chalk.bold('Upgrade:')}
  Fleet auto-upgrade pulls a hub-built CLI onto each runner. Same semver can
  still be behind if soup generation hashes differ. Use \`hapi version\`.
`.trimStart()
}
