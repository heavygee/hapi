import { useCallback, useEffect, useState } from 'react'

export const DEFAULT_SHOW_ATTENTION_SESSIONS_ONLY = false

function getShowAttentionSessionsOnlyStorageKey(): string {
    return 'hapi-show-attention-sessions-only'
}

function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function safeGetItem(key: string): string | null {
    if (!isBrowser()) {
        return null
    }
    try {
        return localStorage.getItem(key)
    } catch {
        return null
    }
}

function safeSetItem(key: string, value: string): void {
    if (!isBrowser()) {
        return
    }
    try {
        localStorage.setItem(key, value)
    } catch {
        // Ignore storage errors
    }
}

function safeRemoveItem(key: string): void {
    if (!isBrowser()) {
        return
    }
    try {
        localStorage.removeItem(key)
    } catch {
        // Ignore storage errors
    }
}

function parseShowAttentionSessionsOnly(raw: string | null): boolean {
    if (raw === 'true') {
        return true
    }
    return DEFAULT_SHOW_ATTENTION_SESSIONS_ONLY
}

export function getInitialShowAttentionSessionsOnly(): boolean {
    return parseShowAttentionSessionsOnly(safeGetItem(getShowAttentionSessionsOnlyStorageKey()))
}

export function useShowAttentionSessionsOnly(): {
    showAttentionSessionsOnly: boolean
    setShowAttentionSessionsOnly: (value: boolean) => void
} {
    const [showAttentionSessionsOnly, setShowAttentionSessionsOnlyState] = useState<boolean>(
        getInitialShowAttentionSessionsOnly
    )

    useEffect(() => {
        if (!isBrowser()) {
            return
        }

        const onStorage = (event: StorageEvent) => {
            if (event.key !== getShowAttentionSessionsOnlyStorageKey()) {
                return
            }
            setShowAttentionSessionsOnlyState(parseShowAttentionSessionsOnly(event.newValue))
        }

        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    const setShowAttentionSessionsOnly = useCallback((value: boolean) => {
        setShowAttentionSessionsOnlyState(value)

        if (value === DEFAULT_SHOW_ATTENTION_SESSIONS_ONLY) {
            safeRemoveItem(getShowAttentionSessionsOnlyStorageKey())
        } else {
            safeSetItem(getShowAttentionSessionsOnlyStorageKey(), String(value))
        }
    }, [])

    return { showAttentionSessionsOnly, setShowAttentionSessionsOnly }
}
