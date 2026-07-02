import { useState } from 'react'
import { useTranslation } from '@/lib/use-translation'

// Minimal shape that both Metadata and SessionSummaryMetadata satisfy
export type ModelErrorHolder = {
    lastModelError?: {
        kind: string
        transient: boolean
        rawSnippet: string
        atTs: number
        priorAssistantClaimsDone: boolean
        bridgedForAtTs?: number
        retriedAndFailed?: boolean
        acknowledgedAt?: number
    }
    [key: string]: unknown
}

export function canShowModelErrorBridge(metadata: ModelErrorHolder | null | undefined): boolean {
    const err = metadata?.lastModelError
    if (!err || err.acknowledgedAt) {
        return false
    }
    if (!err.transient || err.retriedAndFailed) {
        return false
    }
    return err.bridgedForAtTs !== err.atTs
}

export function hasActiveModelError(metadata: ModelErrorHolder | null | undefined): boolean {
    if (!metadata?.lastModelError) return false
    return !metadata.lastModelError.acknowledgedAt
}

export function ModelErrorBanner({
    metadata,
    onDismiss,
    onBridge,
    isBridging = false,
    bridgeErrorReason = null
}: {
    metadata: ModelErrorHolder | null | undefined
    onDismiss: () => void
    onBridge?: () => void
    isBridging?: boolean
    bridgeErrorReason?: string | null
}) {
    const { t } = useTranslation()
    const [showRaw, setShowRaw] = useState(false)

    const err = metadata?.lastModelError
    if (!err || err.acknowledgedAt) {
        return null
    }

    const transientLabel = err.transient
        ? t('session.modelError.banner.subtitle.transient')
        : t('session.modelError.banner.subtitle.nonTransient')

    const title = t('session.modelError.banner.title', { kind: err.kind })

    const bodyText = err.priorAssistantClaimsDone
        ? t('session.modelError.banner.claimedDone')
        : t('session.modelError.banner.midExecution')

    const showBridge = canShowModelErrorBridge(metadata) && onBridge

    return (
        <div className="px-3 pt-3" data-testid="model-error-banner">
            <div
                role="alert"
                aria-live="assertive"
                className="mx-auto flex w-full max-w-content flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-[var(--app-text)]"
            >
                <div className="flex items-start gap-2">
                    <span aria-hidden="true" className="mt-0.5 shrink-0 text-amber-500">
                        &#9888;
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="font-semibold text-amber-600 dark:text-amber-400">
                            {title}{' '}
                            <span className="text-xs font-normal opacity-70">
                                ({transientLabel})
                            </span>
                        </div>
                        <div className="mt-0.5 text-xs text-[var(--app-hint)]">
                            {bodyText}
                        </div>
                        {showRaw && (
                            <pre className="mt-2 max-h-24 overflow-auto rounded bg-black/10 p-2 text-xs font-mono whitespace-pre-wrap break-all dark:bg-white/5">
                                {err.rawSnippet}
                            </pre>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2 pl-6">
                    {showBridge ? (
                        <button
                            type="button"
                            onClick={onBridge}
                            disabled={isBridging}
                            className="rounded px-2 py-0.5 text-xs font-medium border border-amber-500/50 text-amber-700 hover:bg-amber-500/10 disabled:opacity-50 dark:text-amber-300 transition-colors"
                        >
                            {isBridging
                                ? t('session.modelError.banner.bridging')
                                : t('session.modelError.banner.bridgeRetry')}
                        </button>
                    ) : null}
                    {bridgeErrorReason ? (
                        <span className="text-xs text-amber-700 dark:text-amber-300">
                            {t('session.modelError.banner.bridgeFailed')}
                        </span>
                    ) : null}
                    <button
                        type="button"
                        onClick={onDismiss}
                        className="rounded px-2 py-0.5 text-xs font-medium border border-[var(--app-border)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                    >
                        {t('session.modelError.banner.dismiss')}
                    </button>
                    <button
                        type="button"
                        onClick={() => setShowRaw((v) => !v)}
                        className="rounded px-2 py-0.5 text-xs font-medium text-[var(--app-hint)] hover:text-[var(--app-fg)] transition-colors"
                    >
                        {t('session.modelError.banner.viewRaw')}
                    </button>
                </div>
            </div>
        </div>
    )
}
