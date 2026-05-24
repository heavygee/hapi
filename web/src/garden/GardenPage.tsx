import { Link } from '@tanstack/react-router'
import { GardenScene, GARDEN_BUILD, xrStore } from '@/garden/GardenScene'

export function GardenPage() {
    return (
        <div className="fixed inset-0 z-50 bg-black">
            <div className="absolute top-3 left-3 right-3 z-[60] flex items-start justify-between gap-3 pointer-events-none">
                <div className="rounded-md border border-slate-700 bg-black/80 px-3 py-2 font-mono text-xs text-slate-200 pointer-events-auto">
                    <div className="text-sky-400">Garden · build {GARDEN_BUILD}</div>
                    <div className="text-slate-400">Head gaze to select · ~1.2s dwell · build {GARDEN_BUILD}</div>
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
            <GardenScene />
        </div>
    )
}
