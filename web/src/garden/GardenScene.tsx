import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Stars } from '@react-three/drei'
import { XROrigin, XR, createXRStore, useXR } from '@react-three/xr'
import * as THREE from 'three'
import { useAppContext } from '@/lib/app-context'
import { useSessions } from '@/hooks/queries/useSessions'
import { AgentOrb } from '@/garden/components/AgentOrb'
import { ExitPad } from '@/garden/components/ExitPad'
import { GardenHeadRaycaster, type GardenGazeTarget } from '@/garden/components/GardenHeadRaycaster'
import { GardenXrPresentingSync } from '@/garden/components/GardenXrPresentingSync'
import { useGardenFocus } from '@/garden/context/GardenRuntimeContext'
import { useGardenAttention } from '@/garden/hooks/useGardenAttention'
import { useGardenSpatialAudio } from '@/garden/hooks/useGardenSpatialAudio'
import { filterGardenSessions, GARDEN_BUILD, layoutPosition } from '@/garden/utils/sessionVisuals'

export const xrStore = createXRStore({
    gaze: false,
    hand: false,
    controller: false,
    screenInput: true,
})

function GardenWorld() {
    const { api } = useAppContext()
    const { camera } = useThree()
    const isPresenting = useXR((state) => state.session !== undefined)
    const { sessions } = useSessions(api)
    const visible = useMemo(() => filterGardenSessions(sessions), [sessions])
    const { focusedId, setFocusedId } = useGardenFocus()
    const { attentionIds, attentionCueTokens } = useGardenAttention(visible, focusedId)
    const [gazeTarget, setGazeTarget] = useState<GardenGazeTarget>(null)

    const orbHitTargets = useRef(new Map<string, THREE.Object3D>())
    const exitHitTarget = useRef<THREE.Object3D | null>(null)

    const playSpatialCue = useGardenSpatialAudio(isPresenting)

    const playCueSound = useCallback((worldPosition: THREE.Vector3) => {
        playSpatialCue(worldPosition, camera)
    }, [camera, playSpatialCue])

    const registerOrbHitTarget = useCallback((sessionId: string, mesh: THREE.Mesh | null) => {
        if (mesh) {
            orbHitTargets.current.set(sessionId, mesh)
            return
        }
        orbHitTargets.current.delete(sessionId)
    }, [])

    const registerExitHitTarget = useCallback((mesh: THREE.Mesh | null) => {
        exitHitTarget.current = mesh
    }, [])

    const gazeSessionId = gazeTarget?.kind === 'orb' ? gazeTarget.sessionId : null
    const gazeExitPad = gazeTarget?.kind === 'exit'

    useEffect(() => {
        if (focusedId && !visible.some((session) => session.id === focusedId)) {
            setFocusedId(null)
        }
    }, [focusedId, setFocusedId, visible])

    return (
        <>
            <color attach="background" args={['#07080f']} />
            <ambientLight intensity={0.55} />
            <directionalLight position={[4, 6, 2]} intensity={0.85} />
            <Stars radius={80} depth={40} count={1200} factor={3} saturation={0} fade speed={0.4} />

            <GardenHeadRaycaster
                orbHitTargetsRef={orbHitTargets}
                exitHitTargetRef={exitHitTarget}
                onGazeTarget={setGazeTarget}
            />

            <GardenXrPresentingSync />

            <XROrigin>
                <ExitPad gazeTargeted={gazeExitPad} onHitTarget={registerExitHitTarget} />
            </XROrigin>

            <group position={[0, 0.05, 0]}>
                {visible.map((session, index) => (
                    <group key={session.id} position={layoutPosition(index, visible.length)}>
                        <AgentOrb
                            session={session}
                            attention={attentionIds.has(session.id)}
                            attentionCueToken={attentionCueTokens[session.id] ?? 0}
                            focused={focusedId === session.id}
                            gazeTargeted={gazeSessionId === session.id}
                            onFocus={setFocusedId}
                            onCueSound={playCueSound}
                            onHitTarget={registerOrbHitTarget}
                        />
                    </group>
                ))}
            </group>
        </>
    )
}

export function GardenScene() {
    return (
        <Canvas
            camera={{ position: [0, 1.6, 0], fov: 70, near: 0.05, far: 200 }}
            style={{ width: '100%', height: '100%' }}
        >
            <Suspense fallback={null}>
                <XR store={xrStore}>
                    <GardenWorld />
                </XR>
            </Suspense>
        </Canvas>
    )
}

export { GARDEN_BUILD }
