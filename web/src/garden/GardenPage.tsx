import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useGardenXrLauncher } from '@/garden/GardenXrLauncher'

/** Deep link: open Garden overlay on Quest, land on flat sessions list. */
export function GardenPage() {
    const navigate = useNavigate()
    const { openOverlay, webXRSupported } = useGardenXrLauncher()

    useEffect(() => {
        if (webXRSupported === null) {
            return
        }
        if (webXRSupported) {
            openOverlay()
        }
        navigate({ to: '/sessions', replace: true })
    }, [openOverlay, navigate, webXRSupported])

    return null
}
