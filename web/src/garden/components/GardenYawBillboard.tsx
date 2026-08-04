import { useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

type GardenYawBillboardProps = {
    children?: ReactNode
    position?: [number, number, number]
}

/**
 * Y-axis-only billboard: fixed world position, yaw toward viewer, no pitch/roll from head tilt.
 */
export function GardenYawBillboard(props: GardenYawBillboardProps) {
    const { children, position } = props
    const groupRef = useRef<THREE.Group>(null)
    const lookTarget = useRef(new THREE.Vector3())
    const worldPos = useRef(new THREE.Vector3())

    useFrame(({ camera }) => {
        const group = groupRef.current
        if (!group) {
            return
        }
        group.getWorldPosition(worldPos.current)
        lookTarget.current.copy(camera.position)
        lookTarget.current.y = worldPos.current.y
        group.lookAt(lookTarget.current)
    })

    return (
        <group ref={groupRef} position={position}>
            {children}
        </group>
    )
}
