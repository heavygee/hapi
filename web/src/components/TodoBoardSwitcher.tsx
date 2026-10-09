import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CheckIcon, FilterIcon } from '@/components/icons'
import { chipBaseClass, chipIdleClass, chipSelectedClass } from '@/components/filterChipStyles'
import { getMachineFilterMenuClampStyle } from '@/components/MachineFilterBar'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'

export type TodoBoardFilterItem = {
    id: string
    label: string
}

// Board switcher: same chip-row pattern as MachineFilterBar, minus the "All"
// pseudo-chip — board selection has no unfiltered state, exactly one board is
// always selected (hapi#235).
export function TodoBoardSwitcherBar(props: {
    boards: TodoBoardFilterItem[]
    value: string | null
    onChange: (id: string) => void
}) {
    const { t } = useTranslation()
    if (props.boards.length === 0) {
        return null
    }
    return (
        <div
            role="radiogroup"
            aria-label={t('todo.boardSwitcher.label')}
            className="flex flex-wrap items-center gap-1.5 px-2 pb-2 max-md:hidden"
        >
            {props.boards.map((board) => (
                <button
                    key={board.id}
                    type="button"
                    role="radio"
                    aria-checked={props.value === board.id}
                    onClick={() => props.onChange(board.id)}
                    className={cn(chipBaseClass, props.value === board.id ? chipSelectedClass : chipIdleClass)}
                >
                    <span className="max-w-48 truncate">{board.label}</span>
                </button>
            ))}
        </div>
    )
}

// Mobile (below md) counterpart: collapses the board switcher into a single
// header icon button with a dropdown, mirroring MachineFilterMenu.
export function TodoBoardSwitcherMenu(props: {
    boards: TodoBoardFilterItem[]
    value: string | null
    onChange: (id: string) => void
}) {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const wrapperRef = useRef<HTMLDivElement>(null)
    const menuRef = useRef<HTMLDivElement>(null)
    const [anchor, setAnchor] = useState<{ right: number; bottom: number } | null>(null)

    const close = useCallback(() => {
        setOpen(false)
        triggerRef.current?.focus()
    }, [])

    const select = (id: string) => {
        props.onChange(id)
        close()
    }

    useLayoutEffect(() => {
        if (!open) {
            setAnchor(null)
            return
        }
        const updateAnchor = () => {
            const rect = wrapperRef.current?.getBoundingClientRect()
            if (!rect) return
            setAnchor({ right: rect.right, bottom: rect.bottom })
        }
        updateAnchor()
        window.addEventListener('resize', updateAnchor)
        return () => window.removeEventListener('resize', updateAnchor)
    }, [open])

    useEffect(() => {
        if (!open) return

        const frame = window.requestAnimationFrame(() => {
            const selected = menuRef.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')
            const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitemradio"]')
            ;(selected ?? first)?.focus()
        })

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault()
                close()
                return
            }
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
            const items = Array.from(
                menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []
            )
            if (items.length === 0) return
            event.preventDefault()
            const delta = event.key === 'ArrowDown' ? 1 : -1
            const currentIndex = items.indexOf(document.activeElement as HTMLElement)
            const nextIndex = currentIndex === -1
                ? (delta === 1 ? 0 : items.length - 1)
                : (currentIndex + delta + items.length) % items.length
            items[nextIndex]?.focus()
        }

        document.addEventListener('keydown', handleKeyDown)
        return () => {
            window.cancelAnimationFrame(frame)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [open, close])

    if (props.boards.length === 0) {
        return null
    }

    return (
        <div ref={wrapperRef} className="relative shrink-0 md:hidden">
            <button
                ref={triggerRef}
                type="button"
                onClick={() => setOpen(value => !value)}
                aria-label={t('todo.boardSwitcher.label')}
                title={t('todo.boardSwitcher.label')}
                aria-haspopup="menu"
                aria-expanded={open}
                className="relative flex rounded-full p-1.5 text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
            >
                <FilterIcon className="h-5 w-5" />
            </button>
            {open ? (
                <>
                    <button
                        type="button"
                        aria-label={t('button.close')}
                        tabIndex={-1}
                        className="fixed inset-0 z-20 cursor-default"
                        onClick={close}
                    />
                    <div
                        ref={menuRef}
                        role="menu"
                        aria-label={t('todo.boardSwitcher.label')}
                        style={anchor ? getMachineFilterMenuClampStyle(anchor) : undefined}
                        className="absolute right-0 top-full z-30 mt-1 max-h-80 w-64 overflow-y-auto rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] p-1 shadow-xl"
                    >
                        {props.boards.map((board) => (
                            <button
                                key={board.id}
                                type="button"
                                role="menuitemradio"
                                aria-checked={props.value === board.id}
                                onClick={() => select(board.id)}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-[var(--app-subtle-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                            >
                                <span className="flex h-5 w-4 shrink-0 items-center justify-center text-[var(--app-link)]">
                                    {props.value === board.id ? <CheckIcon className="h-4 w-4" /> : null}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[var(--app-fg)]">{board.label}</span>
                            </button>
                        ))}
                    </div>
                </>
            ) : null}
        </div>
    )
}
