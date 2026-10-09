import { useCallback, useEffect, useState } from 'react'

function getTodoBoardSelectionStorageKey(): string {
    return 'hapi-todo-board-selection'
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

export function getInitialTodoBoardSelection(): string | null {
    const raw = safeGetItem(getTodoBoardSelectionStorageKey())
    return raw && raw.trim().length > 0 ? raw : null
}

/** Last-selected board persists across reopening To-Do mode (hapi#235). */
export function useTodoBoardSelection(): {
    selectedBoardId: string | null
    setSelectedBoardId: (id: string) => void
} {
    const [selectedBoardId, setSelectedBoardIdState] = useState<string | null>(getInitialTodoBoardSelection)

    useEffect(() => {
        if (!isBrowser()) {
            return
        }

        const onStorage = (event: StorageEvent) => {
            if (event.key !== getTodoBoardSelectionStorageKey()) {
                return
            }
            setSelectedBoardIdState(event.newValue && event.newValue.trim().length > 0 ? event.newValue : null)
        }

        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    const setSelectedBoardId = useCallback((id: string) => {
        setSelectedBoardIdState(id)
        safeSetItem(getTodoBoardSelectionStorageKey(), id)
    }, [])

    return { selectedBoardId, setSelectedBoardId }
}
