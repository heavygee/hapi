import { useAppContext } from '@/lib/app-context'
import { useSessions } from '@/hooks/queries/useSessions'
import { GardenScene, GARDEN_BUILD, xrStore } from '@/garden/GardenScene'
import { GardenVoiceBridge } from '@/garden/GardenVoiceBridge'
import { GardenVoiceHud } from '@/garden/components/GardenVoiceHud'
import { GardenRuntimeProvider } from '@/garden/context/GardenRuntimeContext'
import { filterGardenSessions } from '@/garden/utils/sessionVisuals'

type GardenXrOverlayProps = {
    onClose: () => void
}

export default function GardenXrOverlay(props: GardenXrOverlayProps) {
    return (
        <GardenRuntimeProvider>
            <GardenXrOverlayContent onClose={props.onClose} />
        </GardenRuntimeProvider>
    )
}

function GardenXrOverlayContent(props: GardenXrOverlayProps) {
    const { api } = useAppContext()
    const { sessions, isLoading, error } = useSessions(api)
    const visible = filterGardenSessions(sessions)

    return (
        <div className="fixed inset-0 z-[100] bg-black">
            <GardenVoiceBridge />
            <div className="absolute top-3 left-3 right-3 z-[110] flex items-start justify-between gap-3 pointer-events-none">
                <div className="rounded-md border border-slate-700 bg-black/80 px-3 py-2 font-mono text-xs text-slate-200 pointer-events-auto">
                    <div className="text-sky-400">Garden · build {GARDEN_BUILD}</div>
                    <div className="text-slate-400">
                        {isLoading
                            ? 'Loading sessions…'
                            : error
                                ? `Sessions error: ${error}`
                                : `${visible.length} orb${visible.length === 1 ? '' : 's'} · ${sessions.length} total`}
                    </div>
                    {!isLoading && !error && visible.length === 0 && (
                        <div className="text-amber-300 mt-1">
                            No sessions in hub — spawn an agent in HAPI first.
                        </div>
                    )}
                    {!isLoading && !error && visible.length > 0 && (
                        <div className="text-slate-500 mt-1">
                            VR: dwell to focus · voice locks until next orb
                        </div>
                    )}
                    <button
                        type="button"
                        className="text-sky-300 underline mt-1"
                        onClick={props.onClose}
                    >
                        Back to HAPI
                    </button>
                </div>
                <div className="flex flex-col items-end gap-2 pointer-events-auto">
                    <button
                        type="button"
                        className="rounded-md border border-sky-700 bg-sky-950 px-3 py-2 text-sm text-sky-100"
                        onClick={() => void xrStore.enterVR()}
                    >
                        Enter VR
                    </button>
                    <button
                        type="button"
                        className="rounded-md border border-slate-700 bg-black/80 px-2 py-1 text-xs text-slate-300"
                        onClick={props.onClose}
                    >
                        Close
                    </button>
                </div>
            </div>
            <GardenVoiceHud />
            <GardenScene />
        </div>
    )
}
