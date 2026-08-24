/** Identify which app issued POST /sessions/:id/abort (journal-friendly). */
export function describeAbortClient(headers: Headers): string {
    const surface = headers.get('x-hapi-surface')?.trim()
    const userAgent = headers.get('user-agent')?.trim()
    if (surface && userAgent) return `${surface} | ${userAgent}`
    return surface || userAgent || 'unknown'
}
