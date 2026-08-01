/**
 * Server-side write authorization for Overseer converse.
 *
 * Write tools must not run merely because the model asked — untrusted tool
 * results (inbox titles, worker output) are fed back as `user` messages and can
 * prompt-inject a relay/disposition. Authorization comes from the operator's
 * latest utterance and/or an explicit client `allowWrites` flag — never from
 * model-selected tools alone.
 */

import { isOverseerWriteTool, type OverseerWriteToolName } from './overseerEntity'

export type OverseerWriteAuthorization = {
    /** Tools the operator's message (or explicit flag) authorized for this turn. */
    allowed: ReadonlySet<OverseerWriteToolName>
    /** True when the client sent allowWrites: true (admin console / voice confirm). */
    explicitClientFlag: boolean
}

const RELAY_INTENT =
    /\b(ping|relay|nudge|wake)\b|\btell\b[\s\S]{0,80}\b(session|worker|peer|agent|him|her|them|it)\b|\b(message|ask|send)\b[\s\S]{0,80}\b(session|worker|peer|agent)\b/i

const DISPOSITION_INTENT =
    /\b(snooze|dismiss|reopen|dispose)\b|\bmark\b[\s\S]{0,40}\bdone\b|\b(resolve|done with)\b/i

/** Detect which write classes the latest operator message authorizes. */
export function detectOperatorWriteTools(operatorText: string): Set<OverseerWriteToolName> {
    const allowed = new Set<OverseerWriteToolName>()
    const text = operatorText.trim()
    if (!text) return allowed
    if (RELAY_INTENT.test(text)) allowed.add('ping_session')
    if (DISPOSITION_INTENT.test(text)) allowed.add('record_disposition')
    return allowed
}

export function resolveOverseerWriteAuthorization(opts: {
    latestOperatorText: string
    allowWrites?: boolean
}): OverseerWriteAuthorization {
    if (opts.allowWrites === true) {
        return {
            allowed: new Set<OverseerWriteToolName>(['ping_session', 'record_disposition']),
            explicitClientFlag: true
        }
    }
    return {
        allowed: detectOperatorWriteTools(opts.latestOperatorText),
        explicitClientFlag: false
    }
}

export function isWriteToolAuthorized(
    tool: string,
    auth: OverseerWriteAuthorization
): boolean {
    if (!isOverseerWriteTool(tool)) return true
    return auth.allowed.has(tool)
}
