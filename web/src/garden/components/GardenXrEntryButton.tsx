import { useGardenXrLauncherOptional } from '@/garden/context/GardenXrLauncherContext'

function XrIcon(props: { className?: string }) {
    return (
        <svg
            className={props.className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            aria-hidden
        >
            <circle cx="12" cy="12" r="9" />
            <path d="M8 12h8M12 8v8" strokeLinecap="round" />
        </svg>
    )
}

type GardenXrEntryButtonProps = {
    className?: string
}

/** Header affordance on Quest Browser (sessions list + session chat). */
export function GardenXrEntryButton(props: GardenXrEntryButtonProps) {
    const launcher = useGardenXrLauncherOptional()
    if (!launcher || launcher.webXRSupported !== true || launcher.overlayOpen) {
        return null
    }

    return (
        <button
            type="button"
            onClick={launcher.openOverlay}
            aria-label="Open Garden XR"
            title="Garden XR"
            className={
                props.className
                ?? 'p-1.5 rounded-full text-[var(--app-hint)] hover:text-sky-400 hover:bg-[var(--app-subtle-bg)] transition-colors'
            }
        >
            <XrIcon className="h-5 w-5" />
        </button>
    )
}
