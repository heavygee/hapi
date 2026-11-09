import { useId } from 'react'
import type { CSSProperties } from 'react'
import type { MachineHealthPresentation } from '@/lib/machineHealth'
import { MachineHealthTooltipBody } from '@/components/MachineHealthIndicator'
import { HoverTooltip } from '@/components/HoverTooltip'
import { CheckIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'
import { chipBaseClass, chipIdleClass, chipSelectedClass } from '@/components/filterChipStyles'

export type MachineFilterItem = {
    id: string
    label: string
    sessionCount: number
    healthPresentation: MachineHealthPresentation | null
}

function MachineFilterChip(props: {
    machine: MachineFilterItem
    selected: boolean
    onSelect: (id: string) => void
}) {
    const { machine, selected, onSelect } = props
    const tooltipId = useId()
    const hasHealth = machine.healthPresentation && machine.healthPresentation.metrics.length > 0

    // The button carries the pill's padding so the entire visible chip is
    // clickable; when a health popup wraps it, the wrapper only draws the border.
    const button = (
        <button
            type="button"
            onClick={() => onSelect(machine.id)}
            aria-pressed={selected}
            aria-describedby={hasHealth ? tooltipId : undefined}
            title={machine.label}
            className="flex h-7 min-w-0 items-center gap-1.5 rounded-full px-2.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
        >
            <span className="max-w-32 truncate">{machine.label}</span>
            <span className="tabular-nums opacity-70">({machine.sessionCount})</span>
        </button>
    )

    if (!hasHealth) {
        return (
            <button
                type="button"
                onClick={() => onSelect(machine.id)}
                aria-pressed={selected}
                title={machine.label}
                className={cn(chipBaseClass, selected ? chipSelectedClass : chipIdleClass)}
            >
                <span className="max-w-32 truncate">{machine.label}</span>
                <span className="tabular-nums opacity-70">({machine.sessionCount})</span>
            </button>
        )
    }

    return (
        // CPU/RAM details live in a hover popup so the chip stays compact;
        // hidden below the md breakpoint (touch devices). The `before:` bridge
        // spans the mt-1 gap so the popup stays open while the pointer enters it.
        <HoverTooltip
            id={tooltipId}
            target={button}
            side="bottom"
            align="start"
            className={cn('shrink-0 rounded-full border transition-colors', selected ? chipSelectedClass : chipIdleClass)}
            tooltipClassName="pointer-events-auto before:absolute before:inset-x-0 before:-top-1 before:h-1 before:content-[''] px-3 py-2 min-w-[16rem] max-md:hidden"
        >
            <MachineHealthTooltipBody presentation={machine.healthPresentation!} />
        </HoverTooltip>
    )
}

export function MachineFilterBar(props: {
    machines: MachineFilterItem[]
    totalCount: number
    value: string | null
    onChange: (id: string | null) => void
}) {
    const { t } = useTranslation()
    return (
        <div
            role="group"
            aria-label={t('sessions.machineFilter.label')}
            className="flex flex-wrap items-center gap-1.5 px-2 pb-2 max-md:hidden"
        >
            <button
                type="button"
                onClick={() => props.onChange(null)}
                aria-pressed={props.value === null}
                className={cn(chipBaseClass, props.value === null ? chipSelectedClass : chipIdleClass)}
            >
                <span className="truncate">{t('sessions.machineFilter.all')}</span>
                <span className="tabular-nums opacity-70">({props.totalCount})</span>
            </button>
            {props.machines.map((machine) => (
                <MachineFilterChip
                    key={machine.id}
                    machine={machine}
                    selected={props.value === machine.id}
                    onSelect={props.onChange}
                />
            ))}
        </div>
    )
}

// Single-machine counterpart of MachineFilterBar: with nothing to filter,
// chips would be meaningless, but the machine's health and session count
// still belong in the sidebar. Renders a compact non-interactive row —
// health metrics are inline so touch layouts need no hover, and pointer
// users get the same capacity popup as the filter chips.
export function MachineSummaryRow(props: { machine: MachineFilterItem }) {
    const tooltipId = useId()
    const hasHealth = Boolean(props.machine.healthPresentation?.metrics.length)

    const content = (
        <span
            className="flex min-w-0 items-center gap-1.5"
            aria-describedby={hasHealth ? tooltipId : undefined}
        >
            <span className="max-w-32 truncate text-[var(--app-fg)]">{props.machine.label}</span>
            <span className="shrink-0 tabular-nums text-[var(--app-hint)]">({props.machine.sessionCount})</span>
            {hasHealth ? (
                <span className="min-w-0 truncate tabular-nums text-[var(--app-hint)]">
                    {props.machine.healthPresentation!.metrics
                        .map((metric) => `${metric.shortLabel} ${metric.percent}%`)
                        .join(' · ')}
                </span>
            ) : null}
        </span>
    )

    return (
        <div className="flex items-center px-2 pb-2 text-xs">
            {hasHealth ? (
                // Same popup treatment as the filter chips: hidden below md
                // (the inline metrics above already cover touch layouts).
                <HoverTooltip
                    id={tooltipId}
                    target={content}
                    side="bottom"
                    align="start"
                    tooltipClassName="pointer-events-auto before:absolute before:inset-x-0 before:-top-1 before:h-1 before:content-[''] px-3 py-2 min-w-[16rem] max-md:hidden"
                >
                    <MachineHealthTooltipBody presentation={props.machine.healthPresentation!} />
                </HoverTooltip>
            ) : content}
        </div>
    )
}

export function MachineFilterMenuRow(props: {
    label: string
    count: number
    selected: boolean
    healthPresentation: MachineHealthPresentation | null
    onSelect: () => void
}) {
    const hasHealth = props.healthPresentation && props.healthPresentation.metrics.length > 0
    return (
        <button
            type="button"
            role="menuitemradio"
            aria-checked={props.selected}
            onClick={props.onSelect}
            className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-[var(--app-subtle-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
        >
            <span className="flex h-5 w-4 shrink-0 items-center justify-center text-[var(--app-link)]">
                {props.selected ? <CheckIcon className="h-4 w-4" /> : null}
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5">
                    <span className="truncate text-[var(--app-fg)]">{props.label}</span>
                    <span className="shrink-0 tabular-nums text-xs text-[var(--app-hint)]">({props.count})</span>
                </span>
                {hasHealth ? (
                    <span className="mt-0.5 block truncate text-xs tabular-nums text-[var(--app-hint)]">
                        {props.healthPresentation!.metrics.map((metric) => `${metric.shortLabel} ${metric.percent}%`).join(' · ')}
                    </span>
                ) : null}
            </span>
        </button>
    )
}

// Clamp the menu to the larger horizontal pocket around the trigger and the
// space below it. Right-only clamping collapsed to a few dozen px when More
// parked the trigger near the left edge (tiann/hapi#2039 / #2040).
const MENU_VIEWPORT_MARGIN_PX = 8
const MENU_TOP_GAP_PX = 4 // mt-1

export type MachineFilterMenuAnchor = {
    left: number
    right: number
    bottom: number
}

/** Center around the trigger, then keep the menu inside the viewport. */
export function getCenteredFilterMenuLeft(
    anchor: { left: number; width: number },
    menuWidth: number,
    viewportWidth: number,
    margin = MENU_VIEWPORT_MARGIN_PX
): number {
    const desiredLeft = anchor.left + anchor.width / 2 - menuWidth / 2
    const maxLeft = Math.max(margin, viewportWidth - margin - menuWidth)
    return Math.min(maxLeft, Math.max(margin, desiredLeft)) - anchor.left
}

export function getMachineFilterMenuClampStyle(
    anchor: MachineFilterMenuAnchor,
    options: { widthRem?: number; maxHeightRem?: number | null; horizontal?: 'center' } = {}
): CSSProperties {
    const spaceOpeningLeft = Math.max(0, anchor.right - MENU_VIEWPORT_MARGIN_PX)
    const availableHeight = `calc(var(--tg-viewport-stable-height, var(--app-viewport-height, 100dvh)) - ${anchor.bottom + MENU_TOP_GAP_PX}px - ${MENU_VIEWPORT_MARGIN_PX}px - env(safe-area-inset-bottom))`
    return {
        // Wider of: room to the left of the trigger's right edge, or room to the
        // right of the trigger's left edge (so a left-edge More trigger still
        // gets a readable menu when we flip to left-align).
        maxWidth: options.horizontal === 'center'
            ? 'calc(100vw - 16px - env(safe-area-inset-left) - env(safe-area-inset-right))'
            : `min(${options.widthRem ?? 16}rem, max(calc(${spaceOpeningLeft}px - env(safe-area-inset-left)), calc(100vw - ${anchor.left}px - ${MENU_VIEWPORT_MARGIN_PX}px - env(safe-area-inset-right))))`,
        maxHeight: options.maxHeightRem === null
            ? availableHeight
            : `min(${options.maxHeightRem ?? 20}rem, ${availableHeight})`
    }
}

/** Left-align (open rightward) when that pocket is at least as wide as right-align. */
export function machineFilterMenuAlignsStart(
    anchor: Pick<MachineFilterMenuAnchor, 'left' | 'right'>,
    viewportWidth: number
): boolean {
    const spaceOpeningRight = Math.max(0, viewportWidth - anchor.left)
    const spaceOpeningLeft = Math.max(0, anchor.right)
    return spaceOpeningRight >= spaceOpeningLeft
}

