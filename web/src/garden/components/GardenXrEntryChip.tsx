import { useGardenXrLauncherOptional } from '@/garden/context/GardenXrLauncherContext'

function HeadsetIcon(props: { className?: string }) {
    return (
        <svg
            className={props.className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
        >
            <path d="M4 12v-2a8 8 0 0 1 16 0v2" />
            <path d="M4 12a3 3 0 0 0 3 3h1v-6H7a3 3 0 0 0-3 3z" />
            <path d="M20 12a3 3 0 0 1-3 3h-1V9h1a3 3 0 0 1 3 3z" />
        </svg>
    )
}

/** Quest-only labeled chip — mode switch, not a toolbar file action. */
export function GardenXrEntryChip() {
    const launcher = useGardenXrLauncherOptional()
    if (!launcher || launcher.webXRSupported !== true || launcher.overlayOpen) {
        return null
    }

    return (
        <button
            type="button"
            onClick={launcher.openOverlay}
            aria-label="Open Garden spatial view"
            title="Garden spatial view"
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-sky-800/60 bg-sky-950/40 px-2 py-0.5 text-xs font-medium text-sky-200 transition-colors hover:border-sky-600 hover:bg-sky-950/70 hover:text-sky-100"
        >
            <HeadsetIcon className="h-3.5 w-3.5" />
            <span>Garden</span>
        </button>
    )
}
