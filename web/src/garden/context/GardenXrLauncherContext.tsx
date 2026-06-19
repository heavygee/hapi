import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useWebXRSupport } from '@/garden/hooks/useWebXRSupport'

type GardenXrLauncherContextValue = {
    webXRSupported: boolean | null
    overlayOpen: boolean
    openOverlay: () => void
    closeOverlay: () => void
}

const GardenXrLauncherContext = createContext<GardenXrLauncherContextValue | null>(null)

export function GardenXrLauncherProvider({ children }: { children: ReactNode }) {
    const webXRSupported = useWebXRSupport()
    const [overlayOpen, setOverlayOpen] = useState(false)

    const openOverlay = useCallback(() => {
        setOverlayOpen(true)
    }, [])

    const closeOverlay = useCallback(() => {
        setOverlayOpen(false)
    }, [])

    const value = useMemo(
        () => ({ webXRSupported, overlayOpen, openOverlay, closeOverlay }),
        [webXRSupported, overlayOpen, openOverlay, closeOverlay],
    )

    return (
        <GardenXrLauncherContext.Provider value={value}>
            {children}
        </GardenXrLauncherContext.Provider>
    )
}

export function useGardenXrLauncher(): GardenXrLauncherContextValue {
    const ctx = useContext(GardenXrLauncherContext)
    if (!ctx) {
        throw new Error('useGardenXrLauncher must be used within GardenXrLauncherProvider')
    }
    return ctx
}

export function useGardenXrLauncherOptional(): GardenXrLauncherContextValue | null {
    return useContext(GardenXrLauncherContext)
}
