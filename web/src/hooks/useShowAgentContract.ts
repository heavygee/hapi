import { useCallback, useEffect, useState } from 'react'

/** Default: strip the machine contract from chat render (Half A invisibility). */
export const DEFAULT_SHOW_AGENT_CONTRACT = false

export const SHOW_AGENT_CONTRACT_STORAGE_KEY = 'hapi-show-agent-contract'

/** Same-tab listeners (storage events only fire cross-tab). */
export const SHOW_AGENT_CONTRACT_EVENT = 'hapi:show-agent-contract'

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

function parseShowAgentContract(raw: string | null): boolean {
    return raw === 'true'
}

export function getInitialShowAgentContract(): boolean {
    return parseShowAgentContract(safeGetItem(SHOW_AGENT_CONTRACT_STORAGE_KEY))
}

/**
 * When true, the session chat UI leaves `AGENT_NOTIFY_SUMMARY` (and any
 * leading inline contract prefix) visible so the operator can verify emission.
 * Default false = strip for human render (raw store unchanged either way).
 */
export function useShowAgentContract(): {
    showAgentContract: boolean
    setShowAgentContract: (value: boolean) => void
} {
    const [showAgentContract, setShowAgentContractState] = useState<boolean>(getInitialShowAgentContract)

    useEffect(() => {
        if (!isBrowser()) {
            return
        }

        const onStorage = (event: StorageEvent) => {
            if (event.key !== SHOW_AGENT_CONTRACT_STORAGE_KEY) {
                return
            }
            setShowAgentContractState(parseShowAgentContract(event.newValue))
        }

        const onLocal = () => {
            setShowAgentContractState(getInitialShowAgentContract())
        }

        window.addEventListener('storage', onStorage)
        window.addEventListener(SHOW_AGENT_CONTRACT_EVENT, onLocal)
        return () => {
            window.removeEventListener('storage', onStorage)
            window.removeEventListener(SHOW_AGENT_CONTRACT_EVENT, onLocal)
        }
    }, [])

    const setShowAgentContract = useCallback((value: boolean) => {
        setShowAgentContractState(value)

        if (value === DEFAULT_SHOW_AGENT_CONTRACT) {
            safeRemoveItem(SHOW_AGENT_CONTRACT_STORAGE_KEY)
        } else {
            safeSetItem(SHOW_AGENT_CONTRACT_STORAGE_KEY, String(value))
        }

        if (isBrowser()) {
            window.dispatchEvent(new Event(SHOW_AGENT_CONTRACT_EVENT))
        }
    }, [])

    return { showAgentContract, setShowAgentContract }
}
