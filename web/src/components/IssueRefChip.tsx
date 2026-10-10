import type { ExternalRef } from '@hapi/protocol/types'
import { chipBaseClass, chipIdleClass } from '@/components/filterChipStyles'
import { cn } from '@/lib/utils'

// Rendered inside SessionRowSummary, which the session-list row wraps in its
// own focusable control with long-press gesture handlers (useLongPress) bound
// to mouse/touch/key events on mousedown/touchstart, not just click. Stopping
// propagation only on click is too late — the row's handlers have already
// armed by then — so every event useLongPress listens for is stopped here,
// otherwise a click/tap on the chip also selects (or long-presses) the row
// instead of just following the link (hapi#238 Codex review).
function stopPropagation(event: { stopPropagation: () => void }): void {
    event.stopPropagation()
}

/** Always-on chip linking a session to the GitHub issue it was spawned from or linked to (hapi#235/#238). */
export function IssueRefChip(props: { ref: ExternalRef; className?: string }) {
    const { ref } = props
    return (
        <a
            href={ref.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`${ref.repo}#${ref.number}`}
            data-testid="issue-ref-chip"
            className={cn(chipBaseClass, chipIdleClass, 'h-5 shrink-0 px-1.5 font-mono text-[11px] leading-none', props.className)}
            onClick={stopPropagation}
            onMouseDown={stopPropagation}
            onMouseUp={stopPropagation}
            onTouchStart={stopPropagation}
            onTouchEnd={stopPropagation}
            onKeyDown={stopPropagation}
            onContextMenu={stopPropagation}
        >
            #{ref.number}
        </a>
    )
}
