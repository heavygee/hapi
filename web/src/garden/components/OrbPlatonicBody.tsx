import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { OrbShapeKind } from '@/garden/utils/orbShapes'

const RADIUS = 0.28

function geometryForKind(kind: OrbShapeKind): THREE.BufferGeometry {
    switch (kind) {
        case 'cube':
            return new THREE.BoxGeometry(RADIUS * 1.45, RADIUS * 1.45, RADIUS * 1.45)
        case 'octahedron':
            return new THREE.OctahedronGeometry(RADIUS * 1.05, 0)
        case 'tetrahedron':
            return new THREE.TetrahedronGeometry(RADIUS * 1.15, 0)
        case 'icosahedron':
            return new THREE.IcosahedronGeometry(RADIUS * 0.98, 0)
        case 'sphere':
        default:
            return new THREE.SphereGeometry(RADIUS, 24, 24)
    }
}

type OrbPlatonicBodyProps = {
    shapeKind: OrbShapeKind
    colorRef: RefObject<THREE.Color>
    emissiveIntensity: number
    scale: number
}

export function OrbPlatonicBody(props: OrbPlatonicBodyProps) {
    const meshRef = useRef<THREE.Mesh>(null)
    const morphRef = useRef(1)
    const prevKindRef = useRef(props.shapeKind)
    const spinRef = useRef(0)

    const geometry = useMemo(() => geometryForKind(props.shapeKind), [props.shapeKind])

    useEffect(() => {
        if (prevKindRef.current !== props.shapeKind) {
            prevKindRef.current = props.shapeKind
            morphRef.current = 0
        }
    }, [props.shapeKind])

    useEffect(() => () => geometry.dispose(), [geometry])

    useFrame((_, delta) => {
        const mesh = meshRef.current
        if (!mesh) {
            return
        }

        morphRef.current = Math.min(1, morphRef.current + delta * 5)
        const pop = 0.72 + morphRef.current * 0.28
        mesh.scale.setScalar(props.scale * pop)

        const mat = mesh.material as THREE.MeshStandardMaterial
        mat.color.copy(props.colorRef.current)
        mat.emissive.copy(props.colorRef.current)
        mat.emissiveIntensity = props.emissiveIntensity

        spinRef.current += delta
        if (props.shapeKind === 'icosahedron') {
            mesh.rotation.y += delta * 1.4
            mesh.rotation.x = Math.sin(spinRef.current * 0.8) * 0.15
        } else if (props.shapeKind === 'cube') {
            mesh.rotation.x = THREE.MathUtils.lerp(mesh.rotation.x, Math.sin(spinRef.current * 2) * 0.22, 0.08)
            mesh.rotation.y += delta * 0.35
        } else if (props.shapeKind === 'octahedron') {
            mesh.rotation.y += delta * 0.9
            mesh.rotation.z = Math.sin(spinRef.current * 1.6) * 0.12
        } else if (props.shapeKind === 'tetrahedron') {
            mesh.rotation.y += delta * 0.25
        }
    })

    return (
        <mesh ref={meshRef} geometry={geometry}>
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.35} />
        </mesh>
    )
}
