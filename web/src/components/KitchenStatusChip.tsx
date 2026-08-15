import { useId } from 'react'
import type { KitchenStatusResponse } from '@hapi/protocol/apiTypes'
import type { ApiClient } from '@/api/client'
import { useKitchenStatus } from '@/hooks/queries/useKitchenStatus'
import { HoverTooltip } from '@/components/HoverTooltip'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

function KitchenIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
            aria-hidden="true"
        >
            <path d="M4 21h16" />
            <path d="M6 21V10a6 6 0 0 1 12 0v11" />
            <path d="M9 4V2" />
            <path d="M15 4V2" />
        </svg>
    )
}

/** True once the script reports anything other than plain green (dirty / hold / busy / rule-chop). */
export function isKitchenStatusDirty(status: KitchenStatusResponse | null): boolean {
    return Boolean(status?.available && status.status !== 'green')
}

/** Amber for a hygiene/busy nudge, red once a remat hold is actively blocking rebuilds. */
export function kitchenStatusSeverity(status: KitchenStatusResponse | null): 'warning' | 'error' | null {
    if (!isKitchenStatusDirty(status) || !status?.available) return null
    return status.holdActive ? 'error' : 'warning'
}

/**
 * Fork-only estate affordance (see docs/tooling/driver-soup.md): a compact,
 * hover-revealed nudge in the session list header so tooling-meta-bot /
 * remat-owner operators notice a dirty mirror or an active remat hold without
 * shelling `hapi-kitchen-status`. Renders nothing when clean, unavailable
 * (non-fork installs), or not the hub owner (403 collapses to unavailable).
 */
export function KitchenStatusChip(props: { api: ApiClient | null }) {
    const { t } = useTranslation()
    const tooltipId = useId()
    const { status } = useKitchenStatus(props.api)
    const severity = kitchenStatusSeverity(status)

    if (!severity || !status?.available) {
        return null
    }

    const colorClass = severity === 'error'
        ? 'text-[var(--app-badge-error-text)] bg-[var(--app-badge-error-bg)] border-[var(--app-badge-error-border)]'
        : 'text-[var(--app-badge-warning-text)] bg-[var(--app-badge-warning-bg)] border-[var(--app-badge-warning-border)]'

    return (
        <HoverTooltip
            id={tooltipId}
            target={
                <span
                    className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-full border transition-colors',
                        colorClass
                    )}
                    aria-label={t('sessions.kitchenStatus.label')}
                >
                    <KitchenIcon className="h-4 w-4" />
                </span>
            }
            side="bottom"
            align="end"
        >
            <span className="block font-medium">{t('sessions.kitchenStatus.label')}</span>
            <span className="mt-1 block text-[var(--app-hint)]">{status.oneliner}</span>
        </HoverTooltip>
    )
}
