import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import { useXR } from '@react-three/xr'
import * as THREE from 'three'
import { useQuery } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'
import { useVoiceOptional } from '@/lib/voice-context'
import { extractLastMessageText } from '@/garden/utils/messageText'
import { GardenLiveWebPanel } from '@/garden/components/GardenLiveWebPanel'
import { GardenYawBillboard } from '@/garden/components/GardenYawBillboard'
import { OrbPlatonicBody } from '@/garden/components/OrbPlatonicBody'
import { VoiceReactiveRings } from '@/garden/components/VoiceReactiveRings'
import {
    ATTENTION_COLOR,
    DWELL_SECONDS,
    ORB_HIT_RADIUS,
    ORB_LABEL_POSITION,
    SNIPPET_COMPACT_POSITION,
    SNIPPET_FOCUS_POSITION,
    sessionColor,
    sessionLabel,
} from '@/garden/utils/sessionVisuals'
import { resolveOrbShapeKind } from '@/garden/utils/orbShapes'
import type { SessionSummary } from '@/types/api'

type AgentOrbProps = {
    session: SessionSummary
    attention: boolean
    attentionCueToken: number
    focused: boolean
    gazeTargeted: boolean
    onFocus: (sessionId: string) => void
    onCueSound: (worldPosition: THREE.Vector3) => void
    onHitTarget: (sessionId: string, mesh: THREE.Mesh | null) => void
}

export function AgentOrb(props: AgentOrbProps) {
    const {
        session,
        attention,
        attentionCueToken,
        focused,
        gazeTargeted,
        onFocus,
        onCueSound,
        onHitTarget,
    } = props
    const voice = useVoiceOptional()
    const isPresenting = useXR((state) => state.session !== undefined)
    const voiceLinked = voice?.currentSessionId === session.id && voice.status === 'connected'
    const shapeKind = resolveOrbShapeKind(session, attention)
    const groupRef = useRef<THREE.Group>(null)
    const hitRef = useRef<THREE.Mesh>(null)
    const [pointerHovered, setPointerHovered] = useState(false)
    const [dwell, setDwell] = useState(0)
    const targeted = pointerHovered || gazeTargeted
    const baseColor = sessionColor(session)
    const displayColor = useRef(new THREE.Color(baseColor))
    const targetColor = useRef(new THREE.Color(attention ? ATTENTION_COLOR : baseColor))
    const lastCueTokenRef = useRef(0)

    useEffect(() => {
        onHitTarget(session.id, hitRef.current)
        return () => onHitTarget(session.id, null)
    }, [onHitTarget, session.id])

    useEffect(() => {
        targetColor.current.set(attention ? ATTENTION_COLOR : baseColor)
    }, [attention, baseColor])

    useEffect(() => {
        if (!attention || attentionCueToken <= lastCueTokenRef.current || !groupRef.current) {
            return
        }
        lastCueTokenRef.current = attentionCueToken
        const world = new THREE.Vector3()
        groupRef.current.getWorldPosition(world)
        onCueSound(world)
    }, [attention, attentionCueToken, onCueSound])

    useFrame((_, delta) => {
        if (targeted && !focused) {
            setDwell((value) => Math.min(1, value + delta / DWELL_SECONDS))
        } else if (!focused) {
            setDwell(0)
        }

        displayColor.current.lerp(targetColor.current, Math.min(1, delta * 3))
    })

    useEffect(() => {
        if (dwell >= 1 && targeted) {
            onFocus(session.id)
        }
    }, [dwell, targeted, onFocus, session.id])

    const showLiveWeb = focused && !isPresenting

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
                }}
            >
                <sphereGeometry args={[ORB_HIT_RADIUS, 16, 16]} />
            </mesh>

            {voiceLinked && <VoiceReactiveRings />}

            {attention && (
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

            <OrbPlatonicBody
                shapeKind={shapeKind}
                colorRef={displayColor}
                emissiveIntensity={attention ? 1.1 : targeted ? 0.75 : 0.35}
                scale={focused ? 1.35 : attention ? 1.15 : 1}
            />

            {!focused && (
                <GardenYawBillboard position={ORB_LABEL_POSITION}>
                    <Text fontSize={0.13} color="#cbd5e1" anchorX="center" anchorY="middle" maxWidth={1.3}>
                        {sessionLabel(session)}
                    </Text>
                </GardenYawBillboard>
            )}

            {!showLiveWeb && <OrbSnippet session={session} compact={!focused} />}

            {showLiveWeb && <GardenLiveWebPanel sessionId={session.id} />}
        </group>
    )
}

function sessionStatus(session: SessionSummary): string {
    if (session.pendingRequestKinds.length > 0) {
        return 'needs you'
    }
    if (session.thinking) {
        return 'working'
    }
    if (session.active) {
        return 'live'
    }
    return 'idle'
}

function useOrbPreview(sessionId: string) {
    const { api } = useAppContext()
    return useQuery({
        queryKey: ['garden', 'preview', sessionId],
        queryFn: async () => {
            const res = await api.getMessages(sessionId, { limit: 24 })
            return extractLastMessageText(res.messages)
        },
        staleTime: 4000,
        refetchInterval: 8000,
    })
}

function OrbSnippet(props: { session: SessionSummary; compact: boolean }) {
    const { data: preview, isLoading, isError } = useOrbPreview(props.session.id)
    const status = sessionStatus(props.session)
    const body = isError
        ? '(could not load messages)'
        : isLoading
            ? '…'
            : preview ?? '(no speakable messages yet)'

    const position = props.compact ? SNIPPET_COMPACT_POSITION : SNIPPET_FOCUS_POSITION
    const fontSize = props.compact ? 0.08 : 0.11
    const maxWidth = props.compact ? 1.8 : 2.5
    const limit = props.compact ? 96 : 420

    return (
        <GardenYawBillboard position={position}>
            {!props.compact && (
                <mesh position={[0, 0, -0.02]}>
                    <planeGeometry args={[2.8, 1.5]} />
                    <meshBasicMaterial color="#111827" transparent opacity={0.93} />
                </mesh>
            )}
            <Text
                position={props.compact ? [0, 0, 0.01] : [0, 0.35, 0.01]}
                fontSize={fontSize}
                color={props.compact ? '#94a3b8' : '#f8fafc'}
                anchorX="center"
                anchorY={props.compact ? 'middle' : 'top'}
                maxWidth={maxWidth}
                textAlign="left"
            >
                {props.compact
                    ? `[${status}] ${body.slice(0, limit)}`
                    : `${sessionLabel(props.session)}\nstatus: ${status}\n---\n${body.slice(0, limit)}`}
            </Text>
        </GardenYawBillboard>
    )
}
