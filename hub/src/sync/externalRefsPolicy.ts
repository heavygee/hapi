/**
 * Policy helpers for metadata.externalRefs under githubPrAwareness.
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
    const next = { ...(metadata as Record<string, unknown>) }
    delete next.externalRefs
    return next
}
