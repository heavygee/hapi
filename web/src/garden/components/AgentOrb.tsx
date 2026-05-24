import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import * as THREE from 'three'
import { useQuery } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'
import { extractLastMessageText } from '@/garden/utils/messageText'
import { GardenYawBillboard } from '@/garden/components/GardenYawBillboard'
import { ATTENTION_COLOR, DWELL_SECONDS, sessionColor, sessionLabel } from '@/garden/utils/sessionVisuals'
import type { SessionSummary } from '@/types/api'

type AgentOrbProps = {
    session: SessionSummary
    seeking: boolean
    focused: boolean
    gazeTargeted: boolean
    onFocus: (sessionId: string) => void
    onBlur: (sessionId: string) => void
    onCueSound: (worldPosition: THREE.Vector3) => void
    onHitTarget: (sessionId: string, mesh: THREE.Mesh | null) => void
}

export function AgentOrb(props: AgentOrbProps) {
    const {
        session,
        seeking,
        focused,
        gazeTargeted,
        onFocus,
        onBlur,
        onCueSound,
        onHitTarget,
    } = props
    const groupRef = useRef<THREE.Group>(null)
    const hitRef = useRef<THREE.Mesh>(null)
    const meshRef = useRef<THREE.Mesh>(null)
    const [pointerHovered, setPointerHovered] = useState(false)
    const [dwell, setDwell] = useState(0)
    const targeted = pointerHovered || gazeTargeted
    const baseColor = sessionColor(session)
    const displayColor = useRef(new THREE.Color(baseColor))
    const targetColor = useRef(new THREE.Color(seeking ? ATTENTION_COLOR : baseColor))
    const cuePlayedRef = useRef(false)

    useEffect(() => {
        onHitTarget(session.id, hitRef.current)
        return () => onHitTarget(session.id, null)
    }, [onHitTarget, session.id])

    useEffect(() => {
        targetColor.current.set(seeking ? ATTENTION_COLOR : baseColor)
        if (!seeking) {
            cuePlayedRef.current = false
        }
    }, [seeking, baseColor])

    useEffect(() => {
        if (seeking && groupRef.current && !cuePlayedRef.current) {
            cuePlayedRef.current = true
            const world = new THREE.Vector3()
            groupRef.current.getWorldPosition(world)
            onCueSound(world)
        }
    }, [seeking, onCueSound])

    useFrame((_, delta) => {
        if (targeted && !focused) {
            setDwell((value) => Math.min(1, value + delta / DWELL_SECONDS))
        } else if (!focused) {
            setDwell(0)
        }

        displayColor.current.lerp(targetColor.current, Math.min(1, delta * 3))
        if (meshRef.current) {
            const mat = meshRef.current.material as THREE.MeshStandardMaterial
            mat.color.copy(displayColor.current)
            mat.emissive.copy(displayColor.current)
            mat.emissiveIntensity = seeking ? 1.1 : targeted ? 0.75 : 0.35
        }
    })

    useEffect(() => {
        if (dwell >= 1 && targeted) {
            onFocus(session.id)
        }
    }, [dwell, targeted, onFocus, session.id])

    useEffect(() => {
        if (!focused) {
            return
        }
        const onBlurCheck = () => {
            if (!targeted) {
                onBlur(session.id)
            }
        }
        const id = window.setInterval(onBlurCheck, 100)
        return () => window.clearInterval(id)
    }, [focused, targeted, onBlur, session.id])

    return (
        <group ref={groupRef}>
            <mesh
                ref={hitRef}
                visible={false}
                userData={{ gardenSessionId: session.id }}
                onPointerOver={(e) => {
                    e.stopPropagation()
                    setPointerHovered(true)
                }}
                onPointerOut={(e) => {
                    e.stopPropagation()
                    setPointerHovered(false)
                    if (!focused) {
                        onBlur(session.id)
                    }
                }}
            >
                <sphereGeometry args={[0.62, 16, 16]} />
            </mesh>

            {seeking && (
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                    <ringGeometry args={[0.34, 0.5, 32]} />
                    <meshBasicMaterial color={ATTENTION_COLOR} transparent opacity={0.55} side={THREE.DoubleSide} />
                </mesh>
            )}

            {targeted && !focused && (
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                    <ringGeometry args={[0.64, 0.68, 32, 1, 0, Math.PI * 2 * dwell]} />
                    <meshBasicMaterial color="#7dd3fc" transparent opacity={0.85} side={THREE.DoubleSide} />
                </mesh>
            )}

            <mesh ref={meshRef} scale={focused ? 1.35 : seeking ? 1.15 : 1}>
                <sphereGeometry args={[0.28, 24, 24]} />
                <meshStandardMaterial color={baseColor} emissive={baseColor} emissiveIntensity={0.35} />
            </mesh>

            <GardenYawBillboard position={[0, 0.52, 0]}>
                <Text fontSize={0.14} color="#e2e8f0" anchorX="center" anchorY="middle" maxWidth={1.4}>
                    {sessionLabel(session)}
                </Text>
            </GardenYawBillboard>

            {focused && <OrbContentPanel session={session} />}
        </group>
    )
}

function OrbContentPanel(props: { session: SessionSummary }) {
    const { api } = useAppContext()
    const { data: preview } = useQuery({
        queryKey: ['garden', 'preview', props.session.id],
        queryFn: async () => {
            const res = await api.getMessages(props.session.id, { limit: 24 })
            return extractLastMessageText(res.messages)
        },
        staleTime: 4000
    })

    const status = props.session.thinking
        ? 'working'
        : props.session.pendingRequestsCount > 0
            ? 'needs you'
            : 'idle'

    const body = preview ?? '(loading message…)'

    return (
        <GardenYawBillboard position={[0, 0.95, 0]}>
            <mesh position={[0, 0, -0.02]}>
                <planeGeometry args={[2.8, 1.5]} />
                <meshBasicMaterial color="#111827" transparent opacity={0.93} />
            </mesh>
            <Text
                position={[0, 0.35, 0.01]}
                fontSize={0.11}
                color="#f8fafc"
                anchorX="center"
                anchorY="top"
                maxWidth={2.5}
                textAlign="left"
            >
                {`${sessionLabel(props.session)}\nstatus: ${status}\n---\n${body.slice(0, 420)}`}
            </Text>
        </GardenYawBillboard>
    )
}
