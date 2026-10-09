import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'

export type SessionsMode = 'sessions' | 'todo'

// Global [Sessions] [To-Do] switch — one toggle for the whole left pane, not
// per-group (hapi#235 design doc: a per-group toggle would compound the
// orientation problem across 137+ existing session groups).
export function SessionsModeSwitch(props: {
    mode: SessionsMode
    onChange: (mode: SessionsMode) => void
}) {
    const { t } = useTranslation()
    return (
        <div
            role="radiogroup"
            aria-label={t('sessions.modeSwitch.label')}
            className="flex gap-1 px-2 pb-2"
        >
            {([
                { key: 'sessions' as const, label: t('sessions.modeSwitch.sessions') },
                { key: 'todo' as const, label: t('sessions.modeSwitch.todo') },
            ]).map((option) => (
                <button
                    key={option.key}
                    type="button"
                    role="radio"
                    aria-checked={props.mode === option.key}
                    onClick={() => props.onChange(option.key)}
                    className={cn(
                        'h-8 flex-1 rounded-full border text-sm font-medium transition-colors',
                        props.mode === option.key
                            ? 'border-[var(--app-link)] bg-[var(--app-subtle-bg)] text-[var(--app-link)]'
                            : 'border-[var(--app-border)] text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'
                    )}
                >
                    {option.label}
                </button>
            ))}
        </div>
    )
}
