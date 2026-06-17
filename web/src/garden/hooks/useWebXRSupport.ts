import { useEffect, useState } from 'react'
import { isQuestBrowser } from '@/garden/utils/questBrowser'

/** True when immersive-vr is available (Quest Browser, etc.). */
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

/** Garden XR affordances: Quest Browser only, with working immersive-vr. */
export async function checkGardenXrAvailable(userAgent?: string): Promise<boolean> {
    if (!isQuestBrowser(userAgent)) {
        return false
    }
    return checkWebXRVrSupport()
}

/** Warm the lazy Garden chunk on Quest when XR is available. */
export function prefetchGardenXrModule(): void {
    void import('@/garden/GardenXrOverlay')
}

/**
 * null while probing; true/false after. Prefetches garden bundle on Quest when supported.
 */
export function useWebXRSupport(): boolean | null {
    const [supported, setSupported] = useState<boolean | null>(null)

    useEffect(() => {
        let cancelled = false
        void checkGardenXrAvailable().then((ok) => {
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
