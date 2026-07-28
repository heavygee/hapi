import type { MouseEvent } from 'react'
import { AgentFlavorIcon } from '@/components/AgentFlavorIcon'

export type SessionMentionChipModel = {
    id: string
    title: string
    active?: boolean
    flavor?: string | null
}

function RemoveIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <line x1="3" y1="3" x2="9" y2="9" />
            <line x1="9" y1="3" x2="3" y2="9" />
        </svg>
    )
}

/**
 * Compact session row chip for composer mentions / transcript session links.
 * Mirrors SessionList: flavor glyph + title + optional active dot.
 */
export function SessionMentionChip(props: {
    mention: SessionMentionChipModel
    href?: string
    onClick?: (event: MouseEvent<HTMLElement>) => void
    onRemove?: () => void
    className?: string
}) {
    const title = props.mention.title.trim() || props.mention.id.slice(0, 8)
    const className = [
        'inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[var(--app-border)]',
        'bg-[var(--app-subtle-bg)] px-2 py-1 text-sm text-[var(--app-fg)]',
        'align-middle no-underline',
        props.className ?? '',
    ].join(' ')

    const body = (
        <>
            <AgentFlavorIcon flavor={props.mention.flavor} className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 truncate font-medium">{title}</span>
            {props.mention.active ? (
                <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--app-accent,#7c5cff)]"
                    title="Active"
                    aria-label="Active"
                />
            ) : null}
            {props.onRemove ? (
                <button
                    type="button"
                    onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        props.onRemove?.()
                    }}
                    className="ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--app-hint)] transition-colors hover:text-[var(--app-fg)]"
                    aria-label={`Remove mention ${title}`}
                    title="Remove"
                >
                    <RemoveIcon />
                </button>
            ) : null}
        </>
    )

    if (props.href || props.onClick) {
        return (
            <a
                href={props.href}
                onClick={props.onClick}
                className={className}
                data-testid="session-mention-chip"
                data-session-id={props.mention.id}
            >
                {body}
            </a>
        )
    }

    return (
        <span className={className} data-testid="session-mention-chip" data-session-id={props.mention.id}>
            {body}
        </span>
    )
}
