import { useCallback, useEffect, useState } from 'react'
import {
    OPERATOR_DOCK_PREF_KEY,
    OPERATOR_DOCK_SECRET_KEY,
    disableOperatorDockFromSettings,
    enableOperatorDockWithSecret,
    isOperatorDockPrefEnabled,
    probeOperatorDockSecret
} from '@/lib/operator-dock-pref'

function readStoredSecret(): string {
    try {
        return (localStorage.getItem(OPERATOR_DOCK_SECRET_KEY) || '').trim()
    } catch {
        return ''
    }
}

function clearStoredSecret(): void {
    try {
        localStorage.removeItem(OPERATOR_DOCK_SECRET_KEY)
    } catch {
        // ignore
    }
}

export function useOperatorDock(): {
    operatorDockEnabled: boolean
    awaitingGateSecret: boolean
    gateDraft: string
    gateError: string | null
    gateBusy: boolean
    setGateDraft: (value: string) => void
    setOperatorDockEnabled: (value: boolean) => void
    submitGateSecret: () => Promise<void>
    cancelGateSecret: () => void
} {
    const [operatorDockEnabled, setState] = useState(isOperatorDockPrefEnabled)
    const [awaitingGateSecret, setAwaiting] = useState(false)
    const [gateDraft, setGateDraft] = useState('')
    const [gateError, setGateError] = useState<string | null>(null)
    const [gateBusy, setGateBusy] = useState(false)

    useEffect(() => {
        const onStorage = (event: StorageEvent) => {
            if (event.key !== OPERATOR_DOCK_PREF_KEY && event.key !== OPERATOR_DOCK_SECRET_KEY) return
            setState(isOperatorDockPrefEnabled())
        }
        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    const cancelGateSecret = useCallback(() => {
        setAwaiting(false)
        setGateDraft('')
        setGateError(null)
        setGateBusy(false)
    }, [])

    const submitGateSecret = useCallback(async () => {
        setGateBusy(true)
        setGateError(null)
        const result = await enableOperatorDockWithSecret(gateDraft)
        setGateBusy(false)
        if (result.ok) {
            setState(true)
            cancelGateSecret()
            return
        }
        setGateError(result.message)
        setGateDraft('')
    }, [gateDraft, cancelGateSecret])

    const setOperatorDockEnabled = useCallback((value: boolean) => {
        if (!value) {
            disableOperatorDockFromSettings()
            setState(false)
            cancelGateSecret()
            return
        }

        // Quest: never use window.prompt. Probe stored secret; otherwise show in-page field.
        void (async () => {
            setGateBusy(true)
            setGateError(null)
            const existing = readStoredSecret()
            if (existing) {
                const probe = await probeOperatorDockSecret(existing)
                if (probe.ok) {
                    const result = await enableOperatorDockWithSecret(existing)
                    setGateBusy(false)
                    if (result.ok) {
                        setState(true)
                        return
                    }
                }
                clearStoredSecret()
            }
            setGateBusy(false)
            setGateDraft('')
            setAwaiting(true)
        })()
    }, [cancelGateSecret])

    return {
        operatorDockEnabled,
        awaitingGateSecret,
        gateDraft,
        gateError,
        gateBusy,
        setGateDraft,
        setOperatorDockEnabled,
        submitGateSecret,
        cancelGateSecret
    }
}
