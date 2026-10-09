import type { ExternalRef } from '@hapi/protocol/types'
import { chipBaseClass, chipIdleClass } from '@/components/filterChipStyles'
import { cn } from '@/lib/utils'

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
            onClick={(event) => event.stopPropagation()}
        >
            #{ref.number}
        </a>
    )
}
