import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import * as THREE from 'three'
import { useXRStore } from '@react-three/xr'

const EXIT_HOLD_SECONDS = 2.5

type ExitPadProps = {
    gazeTargeted: boolean
    onHitTarget: (mesh: THREE.Mesh | null) => void
}

export function ExitPad(props: ExitPadProps) {
    const { gazeTargeted, onHitTarget } = props
    const store = useXRStore()
    const hitRef = useRef<THREE.Mesh>(null)
    const [pointerHovered, setPointerHovered] = useState(false)
    const [progress, setProgress] = useState(0)
    const progressRef = useRef(0)
    const triggeredRef = useRef(false)
    const targeted = pointerHovered || gazeTargeted

    useEffect(() => {
        onHitTarget(hitRef.current)
        return () => onHitTarget(null)
    }, [onHitTarget])

    useFrame((_, delta) => {
        if (targeted && !triggeredRef.current) {
            const next = Math.min(1, progressRef.current + delta / EXIT_HOLD_SECONDS)
            progressRef.current = next
            setProgress(next)
            if (next >= 1) {
                triggeredRef.current = true
                void store.getState().session?.end()
            }
        } else if (!targeted) {
            progressRef.current = 0
            setProgress(0)
            triggeredRef.current = false
        }
    })

    return (
        <group position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <mesh
                ref={hitRef}
                userData={{ gardenExitPad: true }}
                onPointerOver={(e) => {
                    e.stopPropagation()
                    setPointerHovered(true)
                }}
                onPointerOut={() => setPointerHovered(false)}
            >
                <circleGeometry args={[0.95, 48]} />
                <meshBasicMaterial color="#1e293b" transparent opacity={0.72} />
            </mesh>

            <mesh>
                <ringGeometry args={[0.98, 1.08, 64]} />
                <meshBasicMaterial color="#334155" transparent opacity={0.85} side={THREE.DoubleSide} />
            </mesh>

            {progress > 0 && (
                <mesh>
                    <ringGeometry args={[0.98, 1.08, 64, 1, 0, Math.PI * 2 * progress]} />
                    <meshBasicMaterial color="#38bdf8" transparent opacity={0.95} side={THREE.DoubleSide} />
                </mesh>
            )}

            <Text
                position={[0, 0, 0.02]}
                fontSize={0.12}
                color={targeted ? '#38bdf8' : '#94a3b8'}
                anchorX="center"
                anchorY="middle"
                maxWidth={1.8}
            >
                {progress > 0 ? `Exit VR ${Math.ceil((1 - progress) * EXIT_HOLD_SECONDS)}s` : 'Look down to exit VR'}
            </Text>
        </group>
    )
}
