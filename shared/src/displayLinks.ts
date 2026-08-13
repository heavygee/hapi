/**
 * display_links payload: clickable http(s) URLs constructed outside the model.
 *
 * Stored href bytes must equal the caller-constructed string. Do not canonicalize
 * via `new URL().href` (that can add trailing slashes / lowercase hosts).
 */

export const DISPLAY_LINKS_PAYLOAD_TYPE = 'display-links' as const

export const MAX_DISPLAY_LINKS = 20
export const MAX_DISPLAY_LINK_HREF_LENGTH = 2048
export const MAX_DISPLAY_LINK_TITLE_LENGTH = 255

const DENY_SCHEMES = new Set(['javascript', 'data', 'vbscript', 'file'])

export type DisplayLink = {
    href: string
    title?: string
}

export type DisplayLinksPayload = {
    type: typeof DISPLAY_LINKS_PAYLOAD_TYPE
    urls: DisplayLink[]
    id: string
}

/**
 * Extract a scheme the same way markdown-text classifyScheme does: up to two
 * decodeURIComponent passes, then strip ASCII controls/whitespace from the
 * scheme name so `java\nscript:` cannot bypass the deny list.
 */
export function displayLinkScheme(href: string): string | null {
    let value = href.trimStart()
    for (let i = 0; i < 2; i++) {
        try {
            const next = decodeURIComponent(value)
            if (next === value) break
            value = next
        } catch {
            break
        }
    }
    const colonIndex = value.indexOf(':')
    if (colonIndex <= 0) return null
    const boundaryIdx = value.search(/[/?#]/)
    if (boundaryIdx >= 0 && boundaryIdx < colonIndex) return null
    return value.slice(0, colonIndex).replace(/[\x00-\x1F\x7F\s]/g, '').toLowerCase()
}

export function isDisplayableHttpHref(href: string): boolean {
    if (typeof href !== 'string') return false
    if (href.length === 0 || href.length > MAX_DISPLAY_LINK_HREF_LENGTH) return false
    const scheme = displayLinkScheme(href)
    if (scheme === null) return false
    if (DENY_SCHEMES.has(scheme)) return false
    if (scheme !== 'http' && scheme !== 'https') return false
    try {
        const parsed = new URL(href.trim())
        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
        return false
    }
}

function normalizeTitle(title: unknown): string | undefined {
    if (typeof title !== 'string') return undefined
    const trimmed = title.trim()
    if (!trimmed) return undefined
    return trimmed.length > MAX_DISPLAY_LINK_TITLE_LENGTH
        ? trimmed.slice(0, MAX_DISPLAY_LINK_TITLE_LENGTH)
        : trimmed
}

export function parseDisplayLink(input: unknown): DisplayLink | null {
    if (typeof input === 'string') {
        const href = input.trim()
        if (!isDisplayableHttpHref(href)) return null
        return { href }
    }
    if (!input || typeof input !== 'object') return null
    const record = input as Record<string, unknown>
    const rawHref = record.href ?? record.url
    if (typeof rawHref !== 'string') return null
    const href = rawHref.trim()
    if (!isDisplayableHttpHref(href)) return null
    const title = normalizeTitle(record.title)
    return title ? { href, title } : { href }
}

export function parseDisplayLinksInput(input: unknown): DisplayLink[] {
    if (!Array.isArray(input)) {
        throw new Error('display_links requires urls: [{ href, title? }]')
    }
    if (input.length === 0) {
        throw new Error('display_links requires at least one URL')
    }
    if (input.length > MAX_DISPLAY_LINKS) {
        throw new Error(`display_links accepts at most ${MAX_DISPLAY_LINKS} URLs`)
    }
    const urls: DisplayLink[] = []
    for (const item of input) {
        const parsed = parseDisplayLink(item)
        if (!parsed) {
            throw new Error('display_links rejected a URL (http/https only; javascript/data/vbscript/file denied)')
        }
        urls.push(parsed)
    }
    return urls
}

export function safeParseDisplayLinksInput(input: unknown): DisplayLink[] {
    if (!Array.isArray(input)) return []
    const urls: DisplayLink[] = []
    for (const item of input.slice(0, MAX_DISPLAY_LINKS)) {
        const parsed = parseDisplayLink(item)
        if (parsed) urls.push(parsed)
    }
    return urls
}

export function buildDisplayLinksPayload(args: {
    urls: DisplayLink[]
    id: string
}): DisplayLinksPayload {
    return {
        type: DISPLAY_LINKS_PAYLOAD_TYPE,
        urls: args.urls,
        id: args.id,
    }
}
