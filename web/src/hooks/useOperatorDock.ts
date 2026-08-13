import { useCallback, useEffect, useState } from 'react'
import {
    OPERATOR_DOCK_PREF_KEY,
    disableOperatorDockFromSettings,
    enableOperatorDockFromSettings,
    isOperatorDockPrefEnabled
} from '@/lib/operator-dock-pref'

export function useOperatorDock(): {
    operatorDockEnabled: boolean
    setOperatorDockEnabled: (value: boolean) => void
} {
    const [operatorDockEnabled, setState] = useState(isOperatorDockPrefEnabled)

    useEffect(() => {
        const onStorage = (event: StorageEvent) => {
            if (event.key !== OPERATOR_DOCK_PREF_KEY) return
            setState(isOperatorDockPrefEnabled())
        }
        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    const setOperatorDockEnabled = useCallback((value: boolean) => {
        if (value) {
            void enableOperatorDockFromSettings().then((ok) => {
                if (ok) setState(true)
            })
            return
        }
        disableOperatorDockFromSettings()
        setState(false)
    }, [])

    return { operatorDockEnabled, setOperatorDockEnabled }
}
