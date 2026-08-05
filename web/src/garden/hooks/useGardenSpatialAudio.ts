import { useCallback, useEffect, useRef } from 'react'
import type { Camera } from 'three'
import * as THREE from 'three'

const BOOP_HZ = 660
const BOOP_SECONDS = 0.35

function syncListener(ctx: AudioContext, camera: Camera): void {
    const listener = ctx.listener
    const forward = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)

    camera.getWorldDirection(forward)
    const quat = new THREE.Quaternion()
    camera.getWorldQuaternion(quat)
    up.set(0, 1, 0).applyQuaternion(quat)

    if (listener.positionX) {
        const t = ctx.currentTime
        listener.positionX.setValueAtTime(camera.position.x, t)
        listener.positionY.setValueAtTime(camera.position.y, t)
        listener.positionZ.setValueAtTime(camera.position.z, t)
        listener.forwardX.setValueAtTime(forward.x, t)
        listener.forwardY.setValueAtTime(forward.y, t)
        listener.forwardZ.setValueAtTime(forward.z, t)
        listener.upX.setValueAtTime(up.x, t)
        listener.upY.setValueAtTime(up.y, t)
        listener.upZ.setValueAtTime(up.z, t)
        return
    }

    listener.setPosition(camera.position.x, camera.position.y, camera.position.z)
    listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z)
}

export function useGardenSpatialAudio(isPresenting: boolean): (worldPosition: THREE.Vector3, camera: Camera) => void {
    const ctxRef = useRef<AudioContext | null>(null)

    useEffect(() => {
        if (!isPresenting) {
            return
        }
        const ctx = new AudioContext()
        ctxRef.current = ctx
        void ctx.resume()

        return () => {
            ctxRef.current = null
            void ctx.close()
        }
    }, [isPresenting])

    return useCallback((worldPosition: THREE.Vector3, camera: Camera) => {
        const ctx = ctxRef.current
        if (!ctx) {
            return
        }

        void ctx.resume()
        syncListener(ctx, camera)

        const panner = ctx.createPanner()
        panner.panningModel = 'HRTF'
        panner.distanceModel = 'inverse'
        panner.refDistance = 1.5
        panner.maxDistance = 30
        panner.positionX.setValueAtTime(worldPosition.x, ctx.currentTime)
        panner.positionY.setValueAtTime(worldPosition.y, ctx.currentTime)
        panner.positionZ.setValueAtTime(worldPosition.z, ctx.currentTime)

        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = BOOP_HZ
        gain.gain.value = 0.28
        osc.connect(gain)
        gain.connect(panner)
        panner.connect(ctx.destination)

        const endAt = ctx.currentTime + BOOP_SECONDS
        gain.gain.exponentialRampToValueAtTime(0.001, endAt)
        osc.start()
        osc.stop(endAt)
    }, [])
}
