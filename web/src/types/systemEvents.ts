/** Hub `/api/system-events` row (camelCase as returned by the store mapper). */
export type SystemEventRow = {
    id: number
    ts: number
    sourceKind: string
    sourceRef: string | null
    eventType: string
    attentionCandidate: number
    summary: string
    artifactRefs: string | null
    provenance: string | null
    relatedSessionId: string | null
    payloadJson: string | null
    severity: number | null
}

export type SystemEventsResponse = {
    total: number
    events: SystemEventRow[]
}
