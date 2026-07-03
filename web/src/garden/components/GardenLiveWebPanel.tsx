import { Html } from '@react-three/drei'
import { useXR } from '@react-three/xr'
import { LIVE_WEB_PANEL_POSITION } from '@/garden/utils/sessionVisuals'

type GardenLiveWebPanelProps = {
    sessionId: string
}

/**
 * Real HAPI session chat in 3D space (flat browser only).
 * Quest immersive mode cannot host interactive DOM/iframes — VR falls back to text panels.
 */
export function GardenLiveWebPanel(props: GardenLiveWebPanelProps) {
    const isPresenting = useXR((state) => state.session !== undefined)

    if (isPresenting) {
        return null
    }

    const src = `/sessions/${encodeURIComponent(props.sessionId)}`

    return (
        <Html
            transform
            occlude
            distanceFactor={1.15}
            position={LIVE_WEB_PANEL_POSITION}
            style={{ pointerEvents: 'auto' }}
        >
            <div
                className="overflow-hidden rounded-lg border border-slate-600 bg-[#0b0f17] shadow-2xl"
                style={{ width: 400, height: 560 }}
            >
                <iframe
                    title={`Session ${props.sessionId}`}
                    src={src}
                    className="h-full w-full border-0 bg-[#0b0f17]"
                    allow="clipboard-read; clipboard-write"
                />
            </div>
        </Html>
    )
}
