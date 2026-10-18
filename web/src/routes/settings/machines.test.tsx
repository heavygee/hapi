import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import type { Machine } from '@/types/api'
import SettingsMachinesPage from '@/routes/settings/machines'

const renameMachineMock = vi.fn()
const machinesMock = vi.fn()
const getHubSettingsMock = vi.fn()
const updateHubSettingsMock = vi.fn()
const tokenMock = vi.fn<() => string>()

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({
        api: {
            renameMachine: renameMachineMock,
            getHubSettings: getHubSettingsMock,
            updateHubSettings: updateHubSettingsMock,
        },
        token: tokenMock(),
    }),
}))

/** Minimal unsigned JWT shape — only the `ns` claim is read by the page. */
function tokenForNamespace(namespace: string): string {
    const payload = btoa(JSON.stringify({ ns: namespace })).replace(/=+$/, '')
    return `header.${payload}.signature`
}

function hubSettings(sessionStartTimeoutMs: number | null) {
    return { sessionSummaryContract: false, sessionSummaryInChat: false, sessionStartTimeoutMs }
}

vi.mock('@/hooks/queries/useMachines', () => ({
    useMachines: () => ({ machines: machinesMock(), isLoading: false, error: null, refetch: vi.fn() }),
}))

function makeMachine(overrides?: Partial<Machine>): Machine {
    return {
        id: 'machine-1',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: {
            host: 'workstation.local',
            platform: 'linux',
            happyCliVersion: '1.0.0',
        },
        ...overrides,
    } as Machine
}

function renderPage() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                <SettingsMachinesPage />
            </I18nProvider>
        </QueryClientProvider>,
    )
}

function startEditing(name: string) {
    fireEvent.click(screen.getByRole('button', { name: `Rename ${name}` }))
    return screen.getByRole('textbox')
}

describe('SettingsMachinesPage', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        renameMachineMock.mockResolvedValue(undefined)
        machinesMock.mockReturnValue([makeMachine()])
        tokenMock.mockReturnValue(tokenForNamespace('default'))
        getHubSettingsMock.mockResolvedValue(hubSettings(null))
        updateHubSettingsMock.mockImplementation(async (patch: { sessionStartTimeoutMs?: number | null }) =>
            hubSettings(patch.sessionStartTimeoutMs ?? null))
    })

    afterEach(() => {
        cleanup()
    })

    it('falls back to the hostname and always shows host and platform', () => {
        renderPage()

        expect(screen.getByRole('button', { name: 'Rename workstation.local' })).toBeTruthy()
        expect(screen.getByText('workstation.local · linux')).toBeTruthy()
    })

    it('shows the custom name while keeping the hostname visible', () => {
        machinesMock.mockReturnValue([makeMachine({
            metadata: { host: 'workstation.local', platform: 'linux', happyCliVersion: '1.0.0', displayName: 'Workstation' },
        } as Partial<Machine>)])

        renderPage()

        expect(screen.getByRole('button', { name: 'Rename Workstation' })).toBeTruthy()
        expect(screen.getByText('workstation.local · linux')).toBeTruthy()
    })

    it('seeds the input with the current custom name, not the hostname', () => {
        machinesMock.mockReturnValue([makeMachine({
            metadata: { host: 'workstation.local', platform: 'linux', happyCliVersion: '1.0.0', displayName: 'Workstation' },
        } as Partial<Machine>)])
        renderPage()

        expect((startEditing('Workstation') as HTMLInputElement).value).toBe('Workstation')
    })

    it('leaves the input empty when no custom name is set', () => {
        renderPage()

        expect((startEditing('workstation.local') as HTMLInputElement).value).toBe('')
    })

    it('saves a trimmed name on Enter', async () => {
        renderPage()
        const input = startEditing('workstation.local')

        fireEvent.change(input, { target: { value: '  Workstation  ' } })
        fireEvent.keyDown(input, { key: 'Enter' })

        await waitFor(() => expect(renameMachineMock).toHaveBeenCalledWith('machine-1', 'Workstation'))
    })

    it('saves on blur', async () => {
        renderPage()
        const input = startEditing('workstation.local')

        fireEvent.change(input, { target: { value: 'Workstation' } })
        fireEvent.blur(input)

        await waitFor(() => expect(renameMachineMock).toHaveBeenCalledWith('machine-1', 'Workstation'))
    })

    it('submits once when Enter is followed by a blur', async () => {
        // Disabling a focused control forces it to blur, so a real browser fires
        // blur right after Enter starts the save. jsdom does not reproduce that,
        // so the sequence is driven explicitly here.
        renderPage()
        const input = startEditing('workstation.local')

        fireEvent.change(input, { target: { value: 'Workstation' } })
        fireEvent.keyDown(input, { key: 'Enter' })
        fireEvent.blur(input)

        await waitFor(() => expect(renameMachineMock).toHaveBeenCalled())
        expect(renameMachineMock).toHaveBeenCalledTimes(1)
    })

    it('clears the name with an empty string', async () => {
        machinesMock.mockReturnValue([makeMachine({
            metadata: { host: 'workstation.local', platform: 'linux', happyCliVersion: '1.0.0', displayName: 'Workstation' },
        } as Partial<Machine>)])
        renderPage()
        const input = startEditing('Workstation')

        fireEvent.change(input, { target: { value: '   ' } })
        fireEvent.keyDown(input, { key: 'Enter' })

        await waitFor(() => expect(renameMachineMock).toHaveBeenCalledWith('machine-1', ''))
    })

    it('does not call the API when the name is unchanged', async () => {
        renderPage()
        const input = startEditing('workstation.local')

        fireEvent.keyDown(input, { key: 'Enter' })

        await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
        expect(renameMachineMock).not.toHaveBeenCalled()
    })

    it('cancels on Escape without calling the API', async () => {
        renderPage()
        const input = startEditing('workstation.local')

        fireEvent.change(input, { target: { value: 'Workstation' } })
        fireEvent.keyDown(input, { key: 'Escape' })

        await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
        expect(renameMachineMock).not.toHaveBeenCalled()
    })

    it('surfaces an error and keeps the editor open when the save fails', async () => {
        renameMachineMock.mockRejectedValue(new Error('HTTP 409'))
        renderPage()
        const input = startEditing('workstation.local')

        fireEvent.change(input, { target: { value: 'Workstation' } })
        fireEvent.keyDown(input, { key: 'Enter' })

        await waitFor(() => expect(screen.getByText('Could not rename this machine.')).toBeTruthy())
        expect(screen.getByRole('textbox')).toBeTruthy()
    })

    it('renders an empty state when no machines are online', () => {
        machinesMock.mockReturnValue([])
        renderPage()

        expect(screen.getByText('No machines online.')).toBeTruthy()
    })
})

describe('SettingsMachinesPage session start timeout', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        machinesMock.mockReturnValue([makeMachine()])
        tokenMock.mockReturnValue(tokenForNamespace('default'))
        getHubSettingsMock.mockResolvedValue(hubSettings(null))
        updateHubSettingsMock.mockImplementation(async (patch: { sessionStartTimeoutMs?: number | null }) =>
            hubSettings(patch.sessionStartTimeoutMs ?? null))
    })

    afterEach(() => {
        cleanup()
    })

    /** The field stays disabled until hub settings load — wait that out. */
    async function findTimeoutInput() {
        const input = await screen.findByRole('spinbutton') as HTMLInputElement
        await waitFor(() => expect(input.disabled).toBe(false))
        return input
    }

    it('seeds the field in seconds from the stored milliseconds', async () => {
        getHubSettingsMock.mockResolvedValue(hubSettings(60_000))
        renderPage()

        await waitFor(async () => expect((await findTimeoutInput()).value).toBe('60'))
    })

    it('leaves the field empty when no override is stored', async () => {
        renderPage()

        const input = await findTimeoutInput()
        await waitFor(() => expect(input.value).toBe(''))
        expect(input.placeholder).toBe('15')
    })

    it('saves seconds as milliseconds', async () => {
        renderPage()
        const input = await findTimeoutInput()

        fireEvent.change(input, { target: { value: '90' } })
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))

        await waitFor(() => expect(updateHubSettingsMock).toHaveBeenCalledWith({ sessionStartTimeoutMs: 90_000 }))
    })

    it('clears the override when the field is emptied', async () => {
        getHubSettingsMock.mockResolvedValue(hubSettings(60_000))
        renderPage()
        const input = await findTimeoutInput()
        await waitFor(() => expect(input.value).toBe('60'))

        fireEvent.change(input, { target: { value: '' } })
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))

        await waitFor(() => expect(updateHubSettingsMock).toHaveBeenCalledWith({ sessionStartTimeoutMs: null }))
    })

    it('refuses an out-of-range value without calling the hub', async () => {
        renderPage()
        const input = await findTimeoutInput()

        fireEvent.change(input, { target: { value: '86400' } })
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))

        await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Between 5 and 300 seconds'))
        expect(updateHubSettingsMock).not.toHaveBeenCalled()
    })

    it('names the env override so operators can find it', async () => {
        renderPage()

        expect(await screen.findByText(/HAPI_RUNNER_WEBHOOK_TIMEOUT_MS/)).toBeTruthy()
    })

    it('is hidden for non-owner namespaces, which cannot write hub settings', async () => {
        tokenMock.mockReturnValue(tokenForNamespace('tenant'))
        renderPage()

        await waitFor(() => expect(screen.getByText('workstation.local · linux')).toBeTruthy())
        expect(screen.queryByRole('spinbutton')).toBeNull()
        expect(getHubSettingsMock).not.toHaveBeenCalled()
    })
})
