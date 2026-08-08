import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SharePage from './index'

const navigateMock = vi.fn()
const searchMock = vi.fn<() => Record<string, string | undefined>>(() => ({}))
const putShareTransferMock = vi.fn()
const getShareTransferMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigateMock,
    useSearch: () => searchMock(),
}))

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({ api: {} }),
}))

vi.mock('@/hooks/queries/useSessions', () => ({
    useSessions: () => ({ sessions: [], isLoading: false }),
}))

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/lib/shareTransfer', async () => {
    const actual = await vi.importActual<typeof import('@/lib/shareTransfer')>('@/lib/shareTransfer')
    return {
        ...actual,
        putShareTransfer: (...args: unknown[]) => putShareTransferMock(...args),
        getShareTransfer: (...args: unknown[]) => getShareTransferMock(...args),
        deleteShareTransfer: vi.fn(),
    }
})

describe('SharePage', () => {
    beforeEach(() => {
        navigateMock.mockReset()
        searchMock.mockReset()
        searchMock.mockReturnValue({})
        putShareTransferMock.mockReset()
        getShareTransferMock.mockReset()
    })

    it('uses paired button theme colors for the missing-share action', async () => {
        render(<SharePage />)

        const backButton = await screen.findByRole('button', { name: 'share.backToSessions' })
        expect(backButton).toHaveClass('bg-[var(--app-button)]')
        expect(backButton).toHaveClass('text-[var(--app-button-text)]')
        expect(backButton).not.toHaveClass('text-white')
    })

    it('empty search → no-id UX and does not put a transfer', async () => {
        searchMock.mockReturnValue({})
        render(<SharePage />)

        expect(await screen.findByText('share.error.noId')).toBeInTheDocument()
        expect(putShareTransferMock).not.toHaveBeenCalled()
    })

    it('url-only GET deep-link synthesizes a transfer then replaces to ?id=', async () => {
        searchMock.mockReturnValue({ url: 'https://example.com/clip' })
        putShareTransferMock.mockResolvedValue('xfer-url')

        render(<SharePage />)

        await waitFor(() => {
            expect(putShareTransferMock).toHaveBeenCalledTimes(1)
        })
        expect(putShareTransferMock.mock.calls[0][0]).toMatchObject({
            url: 'https://example.com/clip',
            text: '',
            title: '',
            files: [],
        })
        expect(navigateMock).toHaveBeenCalledWith({
            to: '/share',
            search: { id: 'xfer-url' },
            replace: true,
        })
    })

    it('text-only GET deep-link synthesizes a transfer', async () => {
        searchMock.mockReturnValue({ text: 'shared note' })
        putShareTransferMock.mockResolvedValue('xfer-text')

        render(<SharePage />)

        await waitFor(() => {
            expect(putShareTransferMock).toHaveBeenCalledWith(
                expect.objectContaining({ text: 'shared note', url: '', title: '' }),
            )
        })
        expect(navigateMock).toHaveBeenCalledWith({
            to: '/share',
            search: { id: 'xfer-text' },
            replace: true,
        })
    })

    it('url+text GET deep-link synthesizes both fields', async () => {
        searchMock.mockReturnValue({
            url: 'https://example.com',
            text: 'caption',
            title: 'Title',
        })
        putShareTransferMock.mockResolvedValue('xfer-both')

        render(<SharePage />)

        await waitFor(() => {
            expect(putShareTransferMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: 'https://example.com',
                    text: 'caption',
                    title: 'Title',
                }),
            )
        })
    })

    it('id present wins: loads IndexedDB transfer and ignores GET content fields', async () => {
        searchMock.mockReturnValue({
            id: 'xfer-existing',
            url: 'https://should-not-ingest.example',
            text: 'ignored',
        })
        getShareTransferMock.mockResolvedValue({
            title: 'from-idb',
            text: 'payload',
            url: 'https://idb.example',
            files: [],
            createdAt: 1,
        })

        render(<SharePage />)

        await waitFor(() => {
            expect(navigateMock).toHaveBeenCalledWith({
                to: '/share',
                search: { id: 'xfer-existing' },
                replace: true,
            })
        })
        expect(putShareTransferMock).not.toHaveBeenCalled()
        // After scrub navigate, search still has content in this mock (useSearch
        // is static); get is deferred until content fields are gone. Scrub is
        // the contract under test here.
        expect(getShareTransferMock).not.toHaveBeenCalled()
    })

    it('id-only loads IndexedDB transfer without scrub navigate', async () => {
        searchMock.mockReturnValue({ id: 'xfer-existing' })
        getShareTransferMock.mockResolvedValue({
            title: 'from-idb',
            text: 'payload',
            url: 'https://idb.example',
            files: [],
            createdAt: 1,
        })

        render(<SharePage />)

        expect(await screen.findByText('share.title')).toBeInTheDocument()
        expect(putShareTransferMock).not.toHaveBeenCalled()
        expect(getShareTransferMock).toHaveBeenCalledWith('xfer-existing')
        expect(navigateMock).not.toHaveBeenCalled()
    })
})
