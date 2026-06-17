import { useEffect, useState } from 'react'

/** True when the browser exposes immersive-vr (Quest, etc.). */
export async function checkWebXRVrSupport(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.xr) {
        return false
    }
    try {
        return await navigator.xr.isSessionSupported('immersive-vr')
    } catch {
        return false
    }
}

/** Warm the lazy Garden chunk on XR-capable devices. */
export function prefetchGardenXrModule(): void {
    void import('@/garden/GardenXrOverlay')
}

/**
 * null while probing; true/false after. Prefetches garden bundle when supported.
 */
export function useWebXRSupport(): boolean | null {
    const [supported, setSupported] = useState<boolean | null>(null)

    useEffect(() => {
        let cancelled = false
        void checkWebXRVrSupport().then((ok) => {
            if (cancelled) {
                return
            }
            setSupported(ok)
            if (ok) {
                prefetchGardenXrModule()
            }
        })
        return () => {
            cancelled = true
        }
    }, [])

    return supported
}
