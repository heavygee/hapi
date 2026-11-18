/**
 * Codex-specific system prompt for local mode.
 *
 * This prompt instructs Codex to call the hapi__change_title function
 * to set appropriate chat session titles.
 */

import { trimIdent } from '@/utils/trimIdent';
import { buildSessionCitationSteerInstruction, SESSION_CITATION_DISABLED_STEER } from '@hapi/protocol/sessionCitation';
import { isPeerToolsDisabled } from '@/modules/common/peerTools';
import { isNameOnceAgentTitlePolicy } from '@/modules/common/agentTitlePolicy';
import { withSessionJobInstruction } from '@/modules/common/sessionJobInstruction';
import { withSessionSummaryInstruction } from '@/modules/common/sessionSummaryInstruction';

const PEER_STEER = isPeerToolsDisabled() ? SESSION_CITATION_DISABLED_STEER : buildSessionCitationSteerInstruction({
    inspectTool: 'functions.hapi__inspect_peer',
    pingTool: 'functions.hapi__ping_peer',
    listPeersTool: 'functions.hapi__list_peers',
    spawnTool: 'functions.hapi__spawn_peer',
});

/**
 * Title instruction for Codex to call the hapi MCP tool.
 * Note: Codex exposes MCP tools under the `functions.` namespace,
 * so the tool is called as `functions.hapi__change_title`.
 */
export const TITLE_INSTRUCTION = trimIdent(`
    Use the title tool sparingly. For a new chat, call it once after the user's initial request is clear, and set a concise task title.
    Prefer calling functions.hapi__change_title.
    If that exact tool name is unavailable, call an equivalent alias such as hapi__change_title, mcp__hapi__change_title, or hapi_change_title.
    Do not rename the chat for routine progress, substeps, implementation details, or a slightly better wording.
    Rename only when the user's primary objective changes substantially and the existing title would be misleading.
    ${PEER_STEER}
`);

const NAME_ONCE_TITLE_INSTRUCTION = trimIdent(`
    If the session already has a title, do not call the title tool.
    Only when the session is still untitled, call it once after the user's initial request is clear, and set a concise task title.
    Prefer calling functions.hapi__change_title.
    If that exact tool name is unavailable, call an equivalent alias such as hapi__change_title, mcp__hapi__change_title, or hapi_change_title.
    Do not rename later for progress, substeps, wording polish, or objective drift — the hub locks the first title.
    ${PEER_STEER}
`);

/**
 * The system prompt to inject via developer_instructions in local mode.
 * Session-summary contract and agent title policy are resolved at call time.
 */
export function getCodexSystemPrompt(env: NodeJS.ProcessEnv = process.env): string {
    const title = isNameOnceAgentTitlePolicy(env) ? NAME_ONCE_TITLE_INSTRUCTION : TITLE_INSTRUCTION
    return withSessionSummaryInstruction(withSessionJobInstruction(title), env)
}

/** Alias kept for existing call sites / tests that expect a string constant name. */
export const codexSystemPrompt = TITLE_INSTRUCTION
