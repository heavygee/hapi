import { useEffect } from 'react'
import { useXR } from '@react-three/xr'
import { useGardenRuntime } from '@/garden/context/GardenRuntimeContext'

/** Mirrors WebXR presenting state into React DOM (voice bridge, HUD). */
export function GardenXrPresentingSync() {
    const isPresenting = useXR((state) => state.session !== undefined)
    const { setIsPresenting } = useGardenRuntime()

    useEffect(() => {
        setIsPresenting(isPresenting)
    }, [isPresenting, setIsPresenting])

    return null
}
