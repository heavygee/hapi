import { useEffect, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useXR } from '@react-three/xr'
import * as THREE from 'three'

export type GardenGazeTarget =
    | { kind: 'orb'; sessionId: string }
    | { kind: 'exit' }
    | null

type GardenHeadRaycasterProps = {
    orbHitTargetsRef: React.RefObject<Map<string, THREE.Object3D>>
    exitHitTargetRef: React.RefObject<THREE.Object3D | null>
    onGazeTarget: (target: GardenGazeTarget) => void
}

function hasActiveControllers(inputSourceStates: ReadonlyArray<{ type: string }>): boolean {
    return inputSourceStates.some((state) => state.type === 'controller')
}

/**
 * 3DOF head-forward gaze ray. Disabled when XR controllers are active (future: pointer fallback).
 */
export function GardenHeadRaycaster(props: GardenHeadRaycasterProps) {
    const { orbHitTargetsRef, exitHitTargetRef, onGazeTarget } = props
    const { camera } = useThree()
    const isPresenting = useXR((state) => state.session !== undefined)
    const inputSourceStates = useXR((state) => state.inputSourceStates)
    const raycaster = useRef(new THREE.Raycaster())
    const direction = useRef(new THREE.Vector3())
    const lastTarget = useRef<GardenGazeTarget | undefined>(undefined)

    useEffect(() => {
        if (!isPresenting) {
            lastTarget.current = null
            onGazeTarget(null)
        }
    }, [isPresenting, onGazeTarget])

    useFrame(() => {
        if (!isPresenting || hasActiveControllers(inputSourceStates)) {
            if (lastTarget.current !== null) {
                lastTarget.current = null
                onGazeTarget(null)
            }
            return
        }

        camera.getWorldDirection(direction.current)
        raycaster.current.set(camera.position, direction.current)

        const orbHitTargets = orbHitTargetsRef.current
        const exitHitTarget = exitHitTargetRef.current
        const orbMeshes = orbHitTargets ? [...orbHitTargets.values()].filter(Boolean) : []
        const candidates: THREE.Object3D[] = [...orbMeshes]
        if (exitHitTarget) {
            candidates.push(exitHitTarget)
        }

        if (candidates.length === 0) {
            if (lastTarget.current !== null) {
                lastTarget.current = null
                onGazeTarget(null)
            }
            return
        }

        const hits = raycaster.current.intersectObjects(candidates, false)
        const hit = hits[0]?.object ?? null

        let next: GardenGazeTarget = null
        if (hit) {
            const sessionId = hit.userData.gardenSessionId as string | undefined
            if (sessionId) {
                next = { kind: 'orb', sessionId }
            } else if (hit.userData.gardenExitPad) {
                next = { kind: 'exit' }
            }
        }

        const prev = lastTarget.current
        const changed =
            prev?.kind !== next?.kind
            || (prev?.kind === 'orb' && next?.kind === 'orb' && prev.sessionId !== next.sessionId)

        if (changed) {
            lastTarget.current = next
            onGazeTarget(next)
        }
    })

    return null
}
