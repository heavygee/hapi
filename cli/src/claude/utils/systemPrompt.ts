import { trimIdent } from "@/utils/trimIdent";
import { buildSessionCitationSteerInstruction, SESSION_CITATION_DISABLED_STEER } from "@hapi/protocol/sessionCitation";
import { isPeerToolsDisabled } from "@/modules/common/peerTools";
import { buildAgentTitleSteer, isNameOnceAgentTitlePolicy } from "@/modules/common/agentTitlePolicy";
import { shouldIncludeCoAuthoredBy } from "./claudeSettings";
import { DISPLAY_IMAGE_PROMPT_CLAUDE, DISPLAY_MEDIA_PROMPT_CLAUDE, DISPLAY_VIDEO_PROMPT_CLAUDE } from "@/modules/common/displayImagePrompt";
import { withSessionJobInstruction } from "@/modules/common/sessionJobInstruction";
import { withSessionSummaryInstruction } from "@/modules/common/sessionSummaryInstruction";
import { SET_VOICE_MODE_PROMPT_CLAUDE, withVoiceModeInstruction } from "@/modules/common/voiceModeInstruction";

const PEER_STEER = isPeerToolsDisabled() ? SESSION_CITATION_DISABLED_STEER : buildSessionCitationSteerInstruction({
    inspectTool: 'mcp__hapi__inspect_peer',
    pingTool: 'mcp__hapi__ping_peer',
    listPeersTool: 'mcp__hapi__list_peers',
    spawnTool: 'mcp__hapi__spawn_peer',
    searchPeersTool: 'mcp__hapi__search_peers',
    searchContentTool: 'mcp__hapi__search_content',
});

const TITLE_ALLOW_RENAME = 'Use the title tool sparingly. For a new chat, call the tool "mcp__hapi__change_title" once after the user\'s initial request is clear, and set a concise task title. Do not rename the chat for routine progress, substeps, implementation details, or a slightly better wording. Rename only when the user\'s primary objective changes substantially and the existing title would be misleading.';

/**
 * Base system prompt shared across all configurations (allow_rename default).
 */
const BASE_SYSTEM_PROMPT = (() => trimIdent(`
    ${TITLE_ALLOW_RENAME}
    ${DISPLAY_IMAGE_PROMPT_CLAUDE}
    ${DISPLAY_VIDEO_PROMPT_CLAUDE}
    ${DISPLAY_MEDIA_PROMPT_CLAUDE}
    ${SET_VOICE_MODE_PROMPT_CLAUDE}
    ${PEER_STEER}
`))();

function buildBaseSystemPrompt(env: NodeJS.ProcessEnv = process.env): string {
    if (!isNameOnceAgentTitlePolicy(env)) return BASE_SYSTEM_PROMPT;
    return trimIdent(`
        ${buildAgentTitleSteer('mcp__hapi__change_title', env)}
        ${DISPLAY_IMAGE_PROMPT_CLAUDE}
        ${DISPLAY_VIDEO_PROMPT_CLAUDE}
        ${DISPLAY_MEDIA_PROMPT_CLAUDE}
        ${SET_VOICE_MODE_PROMPT_CLAUDE}
        ${PEER_STEER}
    `);
}

/**
 * Co-authored-by credits to append when enabled
 */
const CO_AUTHORED_CREDITS = (() => trimIdent(`
    When making commit messages, you SHOULD also give credit to HAPI like so:

    <main commit message>

    via [HAPI](https://hapi.run)

    Co-Authored-By: HAPI <noreply@hapi.run>
`))();

/**
 * Resolve the Claude append-system-prompt text.
 * Co-Authored-By is read once from Claude settings; session-summary contract
 * and agent title policy are resolved at call time so hub toggle / env apply
 * after session bootstrap.
 */
export function getSystemPrompt(env: NodeJS.ProcessEnv = process.env): string {
    const includeCoAuthored = shouldIncludeCoAuthoredBy();
    const basePrompt = buildBaseSystemPrompt(env);
    const base = includeCoAuthored
        ? basePrompt + '\n\n' + CO_AUTHORED_CREDITS
        : basePrompt;
    return withSessionSummaryInstruction(withVoiceModeInstruction(withSessionJobInstruction(base)), env);
}
