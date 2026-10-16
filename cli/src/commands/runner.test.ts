import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
    checkIfRunnerRunningAndCleanupStaleStateMock,
    listRunnerSessionsMock,
    stopRunnerMock,
    stopRunnerSessionMock,
    spawnHappyCLIMock,
    startRunnerMock,
    getLatestRunnerLogMock,
    runDoctorCommandMock,
    initializeTokenMock,
    existsSyncMock,
    statSyncMock,
    readRunnerStateMock,
    isProcessAliveMock,
} = vi.hoisted(() => ({
    checkIfRunnerRunningAndCleanupStaleStateMock: vi.fn(),
    listRunnerSessionsMock: vi.fn(async () => []),
    stopRunnerMock: vi.fn(async () => {}),
    stopRunnerSessionMock: vi.fn(async (_sessionId: string): Promise<'stopped' | 'already_gone' | 'still_alive'> => 'stopped'),
    spawnHappyCLIMock: vi.fn(() => ({ unref: vi.fn(), pid: 4242 })),
    startRunnerMock: vi.fn(async () => {}),
    getLatestRunnerLogMock: vi.fn(async () => null),
    runDoctorCommandMock: vi.fn(async () => {}),
    initializeTokenMock: vi.fn(async () => {}),
    existsSyncMock: vi.fn(() => true),
    statSyncMock: vi.fn(() => ({ isDirectory: () => true })),
    readRunnerStateMock: vi.fn(async () => ({ pid: 4242, hubReadyAt: 1 })),
    isProcessAliveMock: vi.fn(() => true),
}))

vi.mock('node:fs', async () => {
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
    return {
        ...actual,
        existsSync: existsSyncMock,
        statSync: statSyncMock
    }
})

vi.mock('@/persistence', () => ({
    readRunnerState: readRunnerStateMock,
}))

vi.mock('@/utils/process', () => ({
    isProcessAlive: isProcessAliveMock,
}))

vi.mock('@/runner/controlClient', () => ({
    checkIfRunnerRunningAndCleanupStaleState: checkIfRunnerRunningAndCleanupStaleStateMock,
    listRunnerSessions: listRunnerSessionsMock,
    stopRunner: stopRunnerMock,
    stopRunnerSession: stopRunnerSessionMock
}))

vi.mock('@/utils/spawnHappyCLI', () => ({
    spawnHappyCLI: spawnHappyCLIMock
}))

vi.mock('@/runner/run', () => ({
    startRunner: startRunnerMock
}))

vi.mock('@/ui/logger', () => ({
    getLatestRunnerLog: getLatestRunnerLogMock
}))

vi.mock('@/ui/doctor', () => ({
    runDoctorCommand: runDoctorCommandMock
}))

vi.mock('@/ui/tokenInit', () => ({
    initializeToken: initializeTokenMock
}))

import { detachedRunnerHubReady, runnerCommand } from './runner'

function createContext(commandArgs: string[]) {
    return {
        args: ['runner', ...commandArgs],
        commandArgs
    }
}

describe('detachedRunnerHubReady', () => {
    it('requires the child pid and a post-registration hubReadyAt', () => {
        expect(detachedRunnerHubReady({ pid: 4242, hubReadyAt: 5 }, 4242)).toBe(true)
        expect(detachedRunnerHubReady({ pid: 4242 }, 4242)).toBe(false)
        expect(detachedRunnerHubReady({ pid: 1, hubReadyAt: 5 }, 4242)).toBe(false)
        expect(detachedRunnerHubReady(null, 4242)).toBe(false)
    })
})

describe('runnerCommand start', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        existsSyncMock.mockReturnValue(true)
        statSyncMock.mockReturnValue({ isDirectory: () => true })
        checkIfRunnerRunningAndCleanupStaleStateMock.mockReset()
        checkIfRunnerRunningAndCleanupStaleStateMock.mockResolvedValue(false)
        readRunnerStateMock.mockReset()
        readRunnerStateMock.mockResolvedValue({ pid: 4242, hubReadyAt: 1 })
        isProcessAliveMock.mockReset()
        isProcessAliveMock.mockReturnValue(true)
    })

    it('stops an existing runner before starting a new detached runner', async () => {
        const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`process.exit:${code ?? 'undefined'}`)
        }) as never)
        checkIfRunnerRunningAndCleanupStaleStateMock
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true)

        try {
            await expect(runnerCommand.run(createContext(['start', '--workspace-root', '/workspace']))).rejects.toThrow('process.exit:0')

            expect(stopRunnerMock).toHaveBeenCalledOnce()
            expect(spawnHappyCLIMock).toHaveBeenCalledWith(['runner', 'start-sync', '--workspace-root', '/workspace'], {
                detached: true,
                stdio: 'ignore',
                env: process.env
            })
            expect(stopRunnerMock.mock.invocationCallOrder[0]).toBeLessThan(spawnHappyCLIMock.mock.invocationCallOrder[0])
            expect(consoleLogSpy).toHaveBeenCalledWith('Existing runner detected, stopping it before starting a new one...')
            expect(consoleLogSpy).toHaveBeenCalledWith('Runner started successfully')
        } finally {
            consoleLogSpy.mockRestore()
            exitSpy.mockRestore()
        }
    })

    it('starts directly when no runner is already running', async () => {
        const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`process.exit:${code ?? 'undefined'}`)
        }) as never)
        checkIfRunnerRunningAndCleanupStaleStateMock
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true)

        try {
            await expect(runnerCommand.run(createContext(['start']))).rejects.toThrow('process.exit:0')

            expect(stopRunnerMock).not.toHaveBeenCalled()
            expect(spawnHappyCLIMock).toHaveBeenCalledOnce()
            expect(consoleLogSpy).toHaveBeenCalledWith('Runner started successfully')
        } finally {
            consoleLogSpy.mockRestore()
            exitSpy.mockRestore()
        }
    })

    it('fails when the child dies before hub registration', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`process.exit:${code ?? 'undefined'}`)
        }) as never)
        checkIfRunnerRunningAndCleanupStaleStateMock.mockResolvedValue(false)
        readRunnerStateMock.mockResolvedValue({ pid: 4242, hubReadyAt: 0 })
        isProcessAliveMock.mockReturnValue(false)

        try {
            await expect(runnerCommand.run(createContext(['start']))).rejects.toThrow('process.exit:1')
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Failed to start runner (hub registration did not complete)'
            )
        } finally {
            consoleErrorSpy.mockRestore()
            exitSpy.mockRestore()
        }
    })
})

describe('runnerCommand stop-session', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it.each([
        ['stopped', 'Session stopped'],
        ['already_gone', 'Session was already stopped'],
        ['still_alive', 'Failed to stop session'],
    ] as const)('renders the %s runner result', async (status, expected) => {
        const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        stopRunnerSessionMock.mockResolvedValueOnce(status)
        try {
            await runnerCommand.run(createContext(['stop-session', 'session-1']))
            expect(stopRunnerSessionMock).toHaveBeenCalledWith('session-1')
            expect(consoleLogSpy).toHaveBeenCalledWith(expected)
        } finally {
            consoleLogSpy.mockRestore()
        }
    })
})
