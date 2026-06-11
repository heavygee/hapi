import { Link } from '@tanstack/react-router'
import { GardenScene, GARDEN_BUILD, xrStore } from '@/garden/GardenScene'
import { GardenVoiceBridge } from '@/garden/GardenVoiceBridge'
import { GardenVoiceHud } from '@/garden/components/GardenVoiceHud'
import { GardenRuntimeProvider } from '@/garden/context/GardenRuntimeContext'
import { useAppContext } from '@/lib/app-context'
import { useSessions } from '@/hooks/queries/useSessions'
import { filterGardenSessions } from '@/garden/utils/sessionVisuals'

export function GardenPage() {
    return (
        <GardenRuntimeProvider>
            <GardenPageContent />
        </GardenRuntimeProvider>
    )
}

function GardenPageContent() {
    const { api } = useAppContext()
    const { sessions, isLoading, error } = useSessions(api)
    const visible = filterGardenSessions(sessions)

    return (
        <div className="fixed inset-0 z-50 bg-black">
            <GardenVoiceBridge />
            <div className="absolute top-3 left-3 right-3 z-[60] flex items-start justify-between gap-3 pointer-events-none">
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
                    <Link to="/sessions" className="text-sky-300 underline">Back to HAPI</Link>
                </div>
                <button
                    type="button"
                    className="pointer-events-auto rounded-md border border-sky-700 bg-sky-950 px-3 py-2 text-sm text-sky-100"
                    onClick={() => void xrStore.enterVR()}
                >
                    Enter VR
                </button>
            </div>
            <GardenVoiceHud />
            <GardenScene />
        </div>
    )
}
