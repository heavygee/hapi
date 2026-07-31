import type { RefObject } from 'react'
import { useRef } from 'react'
import type { SessionType } from './types'
import { useTranslation } from '@/lib/use-translation'
import { disableAllFue, useFue } from '@/lib/use-fue'
import { FueCallout, FueDot } from '@/components/Fue'

export function SessionTypeSelector(props: {
    sessionType: SessionType
    worktreeName: string
    worktreeInputRef: RefObject<HTMLInputElement | null>
    isDisabled: boolean
    onSessionTypeChange: (value: SessionType) => void
    onWorktreeNameChange: (value: string) => void
}) {
    const { t } = useTranslation()
    // Just-in-time FUE: "Worktree" is a real alternative mode most new
    // operators won't know exists until they open this form for the first
    // time. Same useFue + FueDot + FueCallout wiring as the composer's
    // terminal/scratchlist FUEs (see use-fue.ts for the contract).
    const fue = useFue('create-session-worktree-option')
    // Anchored to the row, not the label span: the label swaps out for a
    // text input the instant "worktree" is selected (the same click that
    // engages the FUE), which would unmount a label-scoped ref before the
    // callout's first layout measurement ever runs. The row wrapping both
    // the radio and the label/input area stays mounted either way.
    const worktreeRowRef = useRef<HTMLDivElement>(null)

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.type')}
            </label>
            <div className="flex flex-col gap-1.5">
                {(['simple', 'worktree'] as const).map((type) => (
                    <div key={type} className="flex flex-col gap-2">
                        {type === 'worktree' ? (
                            <div ref={worktreeRowRef} className="flex items-center gap-2">
                                <input
                                    id="session-type-worktree"
                                    type="radio"
                                    name="sessionType"
                                    value="worktree"
                                    checked={props.sessionType === 'worktree'}
                                    onChange={() => {
                                        fue.engage()
                                        props.onSessionTypeChange('worktree')
                                    }}
                                    disabled={props.isDisabled}
                                    className="accent-[var(--app-link)]"
                                />
                                <div className="flex-1">
                                    <div className="min-h-[34px] flex items-center">
                                        {props.sessionType === 'worktree' ? (
                                            <input
                                                ref={props.worktreeInputRef}
                                                type="text"
                                                placeholder={t('newSession.type.worktree.placeholder')}
                                                value={props.worktreeName}
                                                onChange={(e) => props.onWorktreeNameChange(e.target.value)}
                                                disabled={props.isDisabled}
                                                className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-60"
                                            />
                                        ) : (
                                            <>
                                                <span className="relative">
                                                    <label
                                                        htmlFor="session-type-worktree"
                                                        className="text-sm capitalize cursor-pointer"
                                                    >
                                                        {t('newSession.type.worktree')}
                                                    </label>
                                                    {fue.status !== 'acknowledged' ? (
                                                        <FueDot
                                                            pulsing={fue.status === 'unseen'}
                                                            ariaLabel={t('fue.newFeatureDot')}
                                                        />
                                                    ) : null}
                                                </span>
                                                <span className="ml-2 text-xs text-[var(--app-hint)]">
                                                    {t('newSession.type.worktree.desc')}
                                                </span>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <label className="flex items-center gap-2 cursor-pointer min-h-[34px]">
                                <input
                                    id="session-type-simple"
                                    type="radio"
                                    name="sessionType"
                                    value="simple"
                                    checked={props.sessionType === 'simple'}
                                    onChange={() => props.onSessionTypeChange('simple')}
                                    disabled={props.isDisabled}
                                    className="accent-[var(--app-link)]"
                                />
                                <span className="text-sm capitalize">{t('newSession.type.simple')}</span>
                                <span className="text-xs text-[var(--app-hint)]">
                                    {t('newSession.type.simple.desc')}
                                </span>
                            </label>
                        )}
                    </div>
                ))}
            </div>
            {fue.status === 'engaging' ? (
                <FueCallout
                    title={t('newSessionWorktree.fueTitle')}
                    body={t('newSessionWorktree.fueBody')}
                    onDismiss={fue.dismiss}
                    dismissLabel={t('fue.gotIt')}
                    closeAriaLabel={t('fue.closeAriaLabel')}
                    anchorRef={worktreeRowRef}
                    onSecondaryAction={() => {
                        disableAllFue()
                        fue.dismiss()
                    }}
                    secondaryActionLabel={t('fue.dontShowAgain')}
                />
            ) : null}
        </div>
    )
}
