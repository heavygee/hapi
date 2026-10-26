/**
 * Policy helpers for metadata.externalRefs under githubPrAwareness.
 */

import { ExternalRefsSchema } from '@hapi/protocol/schemas'

/**
 * Only `github_pr` entries are gated by PR awareness — `github_issue` refs
 * (the `hapi link-issue` CLI command, the MCP `link_issue` tool, Boards'
 * spawn-and-link flow) are deliberately always-on with no opt-in toggle
 * (hapi#235/#238 operator decision: "unless someone uses it, they're not
 * gonna see it"). A kind-blind delete of the whole key here used to also
 * silently erase `github_issue` refs written via `link_issue`'s socket
 * write path whenever PR awareness was off, defeating that tool's
 * always-on design intent (review finding).
 */
export function stripExternalRefsWhenAwarenessDisabled(metadata: unknown, awarenessEnabled: boolean): unknown {
    if (awarenessEnabled) {
        return metadata
    }
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return metadata
    }
    if (!('externalRefs' in metadata)) {
        return metadata
    }
    const refs = (metadata as Record<string, unknown>).externalRefs
    const next = { ...(metadata as Record<string, unknown>) }
    if (!Array.isArray(refs)) {
        // Not array-shaped at all — leave rejection to externalRefsInMetadataValid
        // downstream rather than guess at a partial filter here.
        delete next.externalRefs
        return next
    }
    next.externalRefs = refs.filter(ref => !(ref && typeof ref === 'object' && (ref as { kind?: unknown }).kind === 'github_pr'))
    return next
}

export function externalRefsInMetadataValid(metadata: unknown): boolean {
    if (!metadata || typeof metadata !== 'object') {
        return true
    }
    const refs = (metadata as Record<string, unknown>).externalRefs
    if (refs === undefined) {
        return true
    }
    return ExternalRefsSchema.safeParse(refs).success
}
