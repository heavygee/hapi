/**
 * Fail-closed policy for scheme-less markdown hrefs in chat.
 *
 * Product rule (#1452): never paint a clickable control that SPA-404s.
 * Prefer session file preview when the target looks like a workspace file;
 * known in-app routes stay navigable; everything else path-like is inert text.
 */

import { COMMON_FILE_EXTENSIONS } from '@/lib/remark-file-path-links'

export type MarkdownHrefDecision =
    | { action: 'navigate' }
    | { action: 'file'; path: string }
    | { action: 'inert' }

const SPA_ROOT_PREFIXES = ['/settings', '/sessions', '/browse', '/share'] as const

export function splitHrefMeta(href: string): { path: string; suffix: string } {
    const hashIdx = href.indexOf('#')
    const queryIdx = href.indexOf('?')
    let cut = -1
    if (hashIdx >= 0 && queryIdx >= 0) cut = Math.min(hashIdx, queryIdx)
    else if (hashIdx >= 0) cut = hashIdx
    else if (queryIdx >= 0) cut = queryIdx
    if (cut < 0) return { path: href, suffix: '' }
    return { path: href.slice(0, cut), suffix: href.slice(cut) }
}

function stripLineSuffix(value: string): string {
    return value.replace(/:\d+(?::\d+)?$/, '')
}

function isWindowsAbsolutePath(value: string): boolean {
    return /^[A-Za-z]:[\\/]/.test(value)
}

export function hasKnownFileExtension(value: string): boolean {
    const path = stripLineSuffix(value).toLowerCase()
    const dot = path.lastIndexOf('.')
    if (dot < 0 || dot === path.length - 1) return false
    const ext = path.slice(dot + 1)
    return COMMON_FILE_EXTENSIONS.has(ext)
}

export function isKnownSpaHref(href: string): boolean {
    if (href.startsWith('#') || href.startsWith('?')) return true
    if (href.startsWith('//')) return false
    const { path } = splitHrefMeta(href)
    if (path === '/' || path === '') return true
    return SPA_ROOT_PREFIXES.some((root) => path === root || path.startsWith(`${root}/`))
}

export function inferHomeDir(workspacePath: string): string | null {
    const posix = workspacePath.match(/^(\/(?:home|Users)\/[^/]+)/)
    if (posix) return posix[1]
    const win = workspacePath.match(/^([A-Za-z]:[\\/]Users[\\/][^\\/]+)/i)
    if (win) return win[1]
    return null
}

export function expandTildePath(path: string, workspacePath: string | null | undefined): string | null {
    if (path !== '~' && !path.startsWith('~/')) return null
    if (!workspacePath) return null
    const home = inferHomeDir(workspacePath)
    if (!home) return null
    if (path === '~') return home
    const sep = home.includes('\\') && !home.includes('/') ? '\\' : '/'
    const rest = path.slice(2).replace(/\\/g, '/')
    if (sep === '\\') return `${home}\\${rest.replace(/\//g, '\\')}`
    return `${home}/${rest}`
}

export function isWithinWorkspace(absPath: string, workspacePath: string): boolean {
    const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
    const target = norm(absPath)
    const root = norm(workspacePath)
    return target === root || target.startsWith(`${root}/`)
}

function isRepoRelativeCandidate(path: string): boolean {
    if (path.includes('://')) return false
    if (path.startsWith('/') || path.startsWith('~/') || path === '~') return false
    if (path.startsWith('../') || path.includes('/../')) return false
    if (isWindowsAbsolutePath(path)) return hasKnownFileExtension(path)
    return hasKnownFileExtension(path)
}

function looksPathLike(path: string): boolean {
    if (!path) return false
    if (path === '~' || path.startsWith('~/') || path.startsWith('./') || path.startsWith('../')) return true
    if (path.startsWith('/') || isWindowsAbsolutePath(path)) return true
    if (path.includes('/') || path.includes('\\')) return true
    return hasKnownFileExtension(path)
}

/**
 * Classify a scheme-less markdown href for the chat <A> renderer.
 *
 * @param workspacePath session metadata.path when available (enables ~/ expansion + containment)
 */
export function classifyNoSchemeHref(
    href: string,
    options: { workspacePath?: string | null } = {}
): MarkdownHrefDecision {
    const trimmed = href.trim()
    if (!trimmed) return { action: 'inert' }

    // Protocol-relative URLs keep browser navigation (existing policy).
    if (trimmed.startsWith('//')) return { action: 'navigate' }

    if (isKnownSpaHref(trimmed)) return { action: 'navigate' }

    const { path: rawPath } = splitHrefMeta(trimmed)
    const path = stripLineSuffix(rawPath)
    const workspacePath = options.workspacePath ?? null

    if (isRepoRelativeCandidate(path)) {
        return { action: 'file', path }
    }

    if (isWindowsAbsolutePath(path) && hasKnownFileExtension(path)) {
        if (workspacePath && !isWithinWorkspace(path, workspacePath)) {
            return { action: 'inert' }
        }
        return { action: 'file', path }
    }

    if (path.startsWith('/') && hasKnownFileExtension(path)) {
        if (workspacePath && !isWithinWorkspace(path, workspacePath)) {
            return { action: 'inert' }
        }
        return { action: 'file', path }
    }

    if (path.startsWith('~/') || path === '~') {
        if (!hasKnownFileExtension(path)) return { action: 'inert' }
        const expanded = expandTildePath(path, workspacePath)
        if (!expanded) return { action: 'inert' }
        if (workspacePath && !isWithinWorkspace(expanded, workspacePath)) {
            return { action: 'inert' }
        }
        return { action: 'file', path: expanded }
    }

    if (looksPathLike(path)) return { action: 'inert' }

    // Non-path leftovers (rare bare tokens) — do not invent SPA routes.
    return { action: 'inert' }
}
