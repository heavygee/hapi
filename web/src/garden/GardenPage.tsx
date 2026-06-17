import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useGardenXrLauncher } from '@/garden/GardenXrLauncher'

/** Deep link: open Garden overlay, land on flat sessions list. */
export function GardenPage() {
    const navigate = useNavigate()
    const { openOverlay } = useGardenXrLauncher()

    useEffect(() => {
        openOverlay()
        navigate({ to: '/sessions', replace: true })
    }, [openOverlay, navigate])

    return null
}
