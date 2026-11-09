import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
    MachineFilterBar,
    MachineSummaryRow,
    getMachineFilterMenuClampStyle,
    getCenteredFilterMenuLeft,
    machineFilterMenuAlignsStart,
} from './MachineFilterBar'
import { I18nProvider } from '@/lib/i18n-context'

const defaultMachines: Parameters<typeof MachineFilterBar>[0]['machines'] = [
    { id: 'machine-1', label: 'Mint', sessionCount: 3, healthPresentation: null },
    {
        id: 'machine-2',
        label: 'Teemo',
        sessionCount: 2,
        healthPresentation: {
            metrics: [
                { id: 'cpu', shortLabel: 'CPU', percent: 12, tone: 'ok' },
                { id: 'ram', shortLabel: 'RAM', percent: 88, tone: 'warn' },
            ],
            overallTone: 'warn',
            status: 'elevated',
        },
    },
]

function renderBar(props: Partial<Parameters<typeof MachineFilterBar>[0]> = {}) {
    return render(
        <I18nProvider>
            <MachineFilterBar
                machines={defaultMachines}
                totalCount={5}
                value={null}
                onChange={vi.fn()}
                {...props}
            />
        </I18nProvider>
    )
}

describe('MachineFilterBar', () => {
    it('renders an "All" chip plus one chip per machine with counts', () => {
        renderBar()

        expect(screen.getByRole('button', { name: /All \(5\)/ })).toBeTruthy()
        expect(screen.getByRole('button', { name: /Mint \(3\)/ })).toBeTruthy()
        expect(screen.getByRole('button', { name: /Teemo \(2\)/ })).toBeTruthy()
    })

    it('marks the selected chip as pressed', () => {
        renderBar({ value: 'machine-1' })

        expect(screen.getByRole('button', { name: /Mint \(3\)/ }).getAttribute('aria-pressed')).toBe('true')
        expect(screen.getByRole('button', { name: /All \(5\)/ }).getAttribute('aria-pressed')).toBe('false')
    })

    it('reports machine selection and reset to All', () => {
        const onChange = vi.fn()
        renderBar({ value: 'machine-1', onChange })

        fireEvent.click(screen.getByRole('button', { name: /Teemo \(2\)/ }))
        expect(onChange).toHaveBeenCalledWith('machine-2')

        fireEvent.click(screen.getByRole('button', { name: /All \(5\)/ }))
        expect(onChange).toHaveBeenCalledWith(null)
    })

    it('shows machine health in a hover popup instead of reserving chip width', () => {
        renderBar()

        const chip = screen.getByRole('button', { name: /Teemo \(2\)/ })
        const describedBy = chip.getAttribute('aria-describedby')
        expect(describedBy).toBeTruthy()

        const tooltip = document.getElementById(describedBy!)
        expect(tooltip).toBeTruthy()
        expect(tooltip!.getAttribute('role')).toBe('tooltip')
        expect(tooltip!.textContent).toContain('Machine capacity')
        expect(tooltip!.textContent).toContain('CPU')
        expect(tooltip!.textContent).toContain('12%')
        // Popup is hidden below the md breakpoint (mobile shows nothing)
        expect(tooltip!.className).toContain('max-md:hidden')
        // A pseudo-element bridges the mt-1 gap so the popup stays open while entered
        expect(tooltip!.className).toContain('before:-top-1')
    })

    it('keeps the entire visible chip clickable', () => {
        const onChange = vi.fn()
        renderBar({ onChange })

        // Chip with health popup: the button carries the pill padding, the
        // bordered wrapper adds no inert padding around it.
        const teemo = screen.getByRole('button', { name: /Teemo \(2\)/ })
        expect(teemo.className).toContain('px-2.5')
        const pill = teemo.parentElement!.parentElement!
        expect(pill.className).toContain('rounded-full')
        expect(pill.className).toContain('border')
        expect(pill.className).not.toContain('px-2.5')

        // Chip without health: the button is the pill itself.
        const mint = screen.getByRole('button', { name: /Mint \(3\)/ })
        expect(mint.className).toContain('rounded-full')
        expect(mint.className).toContain('border')
    })

    it('is hidden below the md breakpoint (mobile uses MachineFilterMenu)', () => {
        renderBar()

        expect(screen.getByRole('group', { name: 'Filter by machine' }).className).toContain('max-md:hidden')
    })
})

describe('MachineSummaryRow', () => {
    function renderSummary(machine: Parameters<typeof MachineSummaryRow>[0]['machine']) {
        return render(
            <I18nProvider>
                <MachineSummaryRow machine={machine} />
            </I18nProvider>
        )
    }

    it('renders the machine, session count, and inline health without any filter button', () => {
        renderSummary(defaultMachines[1])

        expect(screen.getByText('Teemo')).toBeTruthy()
        expect(screen.getByText('(2)')).toBeTruthy()
        // Health is inline — no hover needed — so touch layouts see it too.
        expect(screen.getByText('CPU 12% · RAM 88%')).toBeTruthy()
        // Not a filter control: the inline row has no button (the only button
        // anywhere is the tooltip body's "?" help toggle).
        const content = screen.getByText('Teemo').parentElement!
        expect(within(content).queryByRole('button')).toBeNull()
    })

    it('keeps full capacity details in a hover popup like the filter chips', () => {
        renderSummary(defaultMachines[1])

        const content = screen.getByText('Teemo').parentElement!
        const describedBy = content.getAttribute('aria-describedby')
        expect(describedBy).toBeTruthy()

        const tooltip = document.getElementById(describedBy!)
        expect(tooltip).toBeTruthy()
        expect(tooltip!.getAttribute('role')).toBe('tooltip')
        expect(tooltip!.textContent).toContain('Machine capacity')
        expect(tooltip!.textContent).toContain('12%')
        // The inline metrics cover touch layouts; the popup itself is desktop-only
        expect(tooltip!.className).toContain('max-md:hidden')
        // A pseudo-element bridges the mt-1 gap so the popup stays open while entered
        expect(tooltip!.className).toContain('before:-top-1')
    })

    it('stays visible below the md breakpoint (health must not be desktop-only)', () => {
        const { container } = renderSummary(defaultMachines[1])

        expect(container.firstElementChild!.className).not.toContain('max-md:hidden')
    })

    it('renders label and count only when the machine reports no metrics', () => {
        renderSummary(defaultMachines[0])

        expect(screen.getByText('Mint')).toBeTruthy()
        expect(screen.getByText('(3)')).toBeTruthy()
        expect(screen.queryByText(/CPU/)).toBeNull()
        expect(screen.queryByText(/RAM/)).toBeNull()
    })
})

describe('centered content-sized menu positioning', () => {
    it('centers over its trigger when there is enough room', () => {
        expect(getCenteredFilterMenuLeft({ left: 200, width: 36 }, 140, 600)).toBe(-52)
    })
    it('retains an eight pixel viewport margin at either edge', () => {
        expect(getCenteredFilterMenuLeft({ left: 10, width: 36 }, 180, 393)).toBe(-2)
        expect(getCenteredFilterMenuLeft({ left: 350, width: 36 }, 180, 393)).toBe(-145)
    })
    it('allows centered content to use the full available width without a rem cap', () => {
        const style = getMachineFilterMenuClampStyle({ left: 200, right: 236, bottom: 40 }, { horizontal: 'center', maxHeightRem: null })
        expect(style.maxWidth).toBe('calc(100vw - 16px - env(safe-area-inset-left) - env(safe-area-inset-right))')
        expect(style.maxHeight).not.toContain('min(20rem')
    })
})
