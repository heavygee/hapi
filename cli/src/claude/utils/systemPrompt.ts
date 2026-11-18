import { trimIdent } from "@/utils/trimIdent";
import { buildSessionCitationSteerInstruction, SESSION_CITATION_DISABLED_STEER } from "@hapi/protocol/sessionCitation";
import { isPeerToolsDisabled } from "@/modules/common/peerTools";
import { buildAgentTitleSteer, isNameOnceAgentTitlePolicy } from "@/modules/common/agentTitlePolicy";
import { shouldIncludeCoAuthoredBy } from "./claudeSettings";
import { withSessionJobInstruction } from "@/modules/common/sessionJobInstruction";
import { withSessionSummaryInstruction } from "@/modules/common/sessionSummaryInstruction";

const PEER_STEER = isPeerToolsDisabled() ? SESSION_CITATION_DISABLED_STEER : buildSessionCitationSteerInstruction({
    inspectTool: 'mcp__hapi__inspect_peer',
    pingTool: 'mcp__hapi__ping_peer',
    listPeersTool: 'mcp__hapi__list_peers',
    spawnTool: 'mcp__hapi__spawn_peer',
});

/** Default allow_rename title + peer block (byte-stable when name_once is off). */
const BASE_SYSTEM_PROMPT = (() => trimIdent(`
    Use the title tool sparingly. For a new chat, call the tool "mcp__hapi__change_title" once after the user's initial request is clear, and set a concise task title. Do not rename the chat for routine progress, substeps, implementation details, or a slightly better wording. Rename only when the user's primary objective changes substantially and the existing title would be misleading.
    ${PEER_STEER}
`))();

function buildBaseSystemPrompt(env: NodeJS.ProcessEnv = process.env): string {
    if (!isNameOnceAgentTitlePolicy(env)) return BASE_SYSTEM_PROMPT;
    return trimIdent(`
        ${buildAgentTitleSteer('mcp__hapi__change_title', env)}
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
    return withSessionSummaryInstruction(withSessionJobInstruction(base), env);
}
