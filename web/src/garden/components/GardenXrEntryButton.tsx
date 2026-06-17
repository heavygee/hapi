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

/** Toolbar affordance for session list header (Quest / WebXR browsers). */
export function GardenXrEntryButton() {
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
            className="p-1.5 rounded-full text-[var(--app-hint)] hover:text-sky-400 hover:bg-[var(--app-subtle-bg)] transition-colors"
        >
            <XrIcon className="h-5 w-5" />
        </button>
    )
}
