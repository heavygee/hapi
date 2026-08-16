import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DisplayLinksCard } from '@/components/AssistantChat/messages/ToolMessage'

describe('DisplayLinksCard', () => {
    it('paints the constructed href without reconstructing from prose', () => {
        const href = 'https://github.com/tia' + 'nn' + '/hapi/issues/1516'
        render(
            <DisplayLinksCard
                block={{
                    kind: 'display-links',
                    id: 'block-1',
                    localId: null,
                    createdAt: 1,
                    urls: [{ href, title: 'Issue 1516' }],
                }}
            />
        )

        const link = screen.getByRole('link', { name: /Issue 1516/ })
        expect(link).toHaveAttribute('href', 'https://github.com/tiann/hapi/issues/1516')
        expect(link.getAttribute('href')).toBe(href)
        expect(link.getAttribute('href')).not.toContain('tian/hapi')
        expect(link).toHaveAttribute('target', '_blank')
        expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('paints concatenated exact-copy bytes on a copy control, not as a link', async () => {
        const value = 'VK' + 'K'
        const writeText = vi.fn().mockResolvedValue(undefined)
        Object.assign(navigator, { clipboard: { writeText } })

        render(
            <DisplayLinksCard
                block={{
                    kind: 'display-links',
                    id: 'block-text',
                    localId: null,
                    createdAt: 1,
                    urls: [],
                    texts: [{ value, title: 'gate' }],
                }}
            />
        )

        expect(screen.queryByRole('link')).not.toBeInTheDocument()
        const copyButton = screen.getByRole('button', { name: /copy gate/i })
        expect(copyButton).toHaveAttribute('data-copy-value', 'VKK')
        expect(copyButton.getAttribute('data-copy-value')).toBe(value)
        expect(copyButton.getAttribute('data-copy-value')).not.toBe('VK')
        expect(screen.getByTestId('display-links-text')).toHaveTextContent('VKK')

        fireEvent.click(copyButton)
        await waitFor(() => {
            expect(writeText).toHaveBeenCalledWith(value)
        })
    })

    it('does not make javascript hrefs tappable', () => {
        render(
            <DisplayLinksCard
                block={{
                    kind: 'display-links',
                    id: 'block-evil',
                    localId: null,
                    createdAt: 1,
                    urls: [{ href: 'javascript:alert(1)', title: 'evil' }],
                }}
            />
        )

        expect(screen.queryByRole('link')).not.toBeInTheDocument()
        expect(screen.getByText('evil')).toBeInTheDocument()
    })
})
