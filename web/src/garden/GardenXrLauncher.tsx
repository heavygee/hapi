import { lazy, Suspense, type ReactNode } from 'react'
import { GardenXrLauncherProvider, useGardenXrLauncher } from '@/garden/context/GardenXrLauncherContext'

const GardenXrOverlayLazy = lazy(() => import('@/garden/GardenXrOverlay'))

/** Convenience wrap — prefer Provider + OverlayHost in App for soup-friendly merges. */
export function GardenXrLauncher(props: { children: ReactNode }) {
    return (
        <GardenXrLauncherProvider>
            {props.children}
            <GardenXrOverlayHost />
        </GardenXrLauncherProvider>
    )
}

/** Lazy-loads the Garden overlay; entry buttons live in page headers (not over the composer). */
export function GardenXrOverlayHost() {
    const { overlayOpen, closeOverlay } = useGardenXrLauncher()

    if (!overlayOpen) {
        return null
    }

    return (
        <Suspense
            fallback={(
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black text-sm text-slate-300">
                    Loading Garden…
                </div>
            )}
        >
            <GardenXrOverlayLazy onClose={closeOverlay} />
        </Suspense>
    )
}

export { GardenXrLauncherProvider, useGardenXrLauncher } from '@/garden/context/GardenXrLauncherContext'
