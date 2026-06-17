import { lazy, Suspense, type ReactNode } from 'react'
import { GardenXrLauncherProvider, useGardenXrLauncher } from '@/garden/context/GardenXrLauncherContext'

const GardenXrOverlayLazy = lazy(() => import('@/garden/GardenXrOverlay'))

export function GardenXrLauncher(props: { children: ReactNode }) {
    return (
        <GardenXrLauncherProvider>
            {props.children}
            <GardenXrLauncherUi />
        </GardenXrLauncherProvider>
    )
}

function GardenXrLauncherUi() {
    const { webXRSupported, overlayOpen, openOverlay, closeOverlay } = useGardenXrLauncher()

    if (webXRSupported !== true) {
        return null
    }

    return (
        <>
            {!overlayOpen ? (
                <button
                    type="button"
                    className="fixed z-[90] bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] flex h-12 w-12 items-center justify-center rounded-full border border-sky-700 bg-sky-950/95 text-sm font-semibold text-sky-100 shadow-lg backdrop-blur-sm"
                    onClick={openOverlay}
                    aria-label="Open Garden XR"
                    title="Open Garden XR"
                >
                    XR
                </button>
            ) : null}
            {overlayOpen ? (
                <Suspense
                    fallback={(
                        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black text-sm text-slate-300">
                            Loading Garden…
                        </div>
                    )}
                >
                    <GardenXrOverlayLazy onClose={closeOverlay} />
                </Suspense>
            ) : null}
        </>
    )
}

export { useGardenXrLauncher } from '@/garden/context/GardenXrLauncherContext'
