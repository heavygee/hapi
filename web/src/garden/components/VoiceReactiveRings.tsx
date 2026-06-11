import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getVoiceAudioLevels, smoothLevel } from '@/realtime/voiceAudioLevels'

const INNER_BASE = 0.58
const INNER_WIDTH = 0.05
const OUTER_BASE = 0.72
const OUTER_WIDTH = 0.06

/** Inner ring = mic in (cyan). Outer ring = agent out (emerald). */
export function VoiceReactiveRings() {
    const innerRef = useRef<THREE.Mesh>(null)
    const outerRef = useRef<THREE.Mesh>(null)
    const smoothInRef = useRef(0)
    const smoothOutRef = useRef(0)

    useFrame((_, delta) => {
        const factor = Math.min(1, delta * 14)
        const { input, output, isSpeaking } = getVoiceAudioLevels()
        const inTarget = clamp01(input)
        const outTarget = clamp01(output + (isSpeaking ? 0.1 : 0))

        smoothInRef.current = smoothLevel(smoothInRef.current, inTarget, factor)
        smoothOutRef.current = smoothLevel(smoothOutRef.current, outTarget, factor)

        const inLevel = smoothInRef.current
        const outLevel = smoothOutRef.current

        if (innerRef.current) {
            const scale = 1 + inLevel * 0.24
            innerRef.current.scale.set(scale, scale, 1)
            const mat = innerRef.current.material as THREE.MeshBasicMaterial
            mat.opacity = 0.28 + inLevel * 0.62
        }

        if (outerRef.current) {
            const scale = 1 + outLevel * 0.3
            outerRef.current.scale.set(scale, scale, 1)
            const mat = outerRef.current.material as THREE.MeshBasicMaterial
            mat.opacity = 0.24 + outLevel * 0.68
        }
    })

    return (
        <group>
            <mesh ref={innerRef} rotation={[Math.PI / 2, 0, 0]}>
                <ringGeometry args={[INNER_BASE, INNER_BASE + INNER_WIDTH, 48]} />
                <meshBasicMaterial color="#38bdf8" transparent opacity={0.35} side={THREE.DoubleSide} />
            </mesh>
            <mesh ref={outerRef} rotation={[Math.PI / 2, 0, 0]}>
                <ringGeometry args={[OUTER_BASE, OUTER_BASE + OUTER_WIDTH, 48]} />
                <meshBasicMaterial color="#34d399" transparent opacity={0.35} side={THREE.DoubleSide} />
            </mesh>
        </group>
    )
}

function clamp01(value: number): number {
    if (value <= 0) {
        return 0
    }
    if (value >= 1) {
        return 1
    }
    return value
}
