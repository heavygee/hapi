import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import { NewCardDialog, type NewCardDialogProps } from './NewCardDialog'
import { ApiError } from '@/api/client'
import type { IssueTemplate } from '@/types/api'

function renderDialog(overrides: Partial<NewCardDialogProps> = {}) {
    const props: NewCardDialogProps = {
        isOpen: true,
        onClose: vi.fn(),
        knownRepos: [],
        templates: [],
        blankAllowed: true,
        githubNewIssueUrl: null,
        isLoadingTemplates: false,
        templatesError: null,
        onRepoChange: vi.fn(),
        onSubmit: vi.fn().mockResolvedValue('https://github.com/heavygee/hapi/issues/42'),
        ...overrides
    }
    return { ...render(<I18nProvider><NewCardDialog {...props} /></I18nProvider>), props }
}

afterEach(() => cleanup())

const FORM_TEMPLATE: IssueTemplate = {
    id: 'bug_report.yml',
    name: 'Bug report',
    description: 'File a bug',
    titlePrefix: '[Bug]: ',
    labels: ['bug'],
    assignees: ['octocat'],
    kind: 'form',
    fields: [
        { kind: 'markdown', value: 'Thanks for filing!' },
        { kind: 'input', id: 'contact', label: 'Contact', required: false }
    ]
}

const UNSUPPORTED_TEMPLATE: IssueTemplate = {
    id: 'weird.yml',
    name: 'Weird form',
    kind: 'unsupported',
    reason: 'Uses a form feature not supported yet'
}

describe('NewCardDialog', () => {
    it('walks repo -> template -> form -> review -> submit for a structured form template', async () => {
        const onRepoChange = vi.fn()
        const onSubmit = vi.fn().mockResolvedValue('https://github.com/heavygee/hapi/issues/42')
        const { props } = renderDialog({ templates: [FORM_TEMPLATE], onRepoChange, onSubmit })

        fireEvent.change(screen.getByPlaceholderText('owner/repo'), { target: { value: 'heavygee/hapi' } })
        fireEvent.click(screen.getByRole('button', { name: 'Next' }))
        expect(onRepoChange).toHaveBeenCalledWith('heavygee/hapi')

        fireEvent.click(await screen.findByText('Bug report'))

        expect(screen.getByText('Thanks for filing!')).toBeInTheDocument()
        fireEvent.change(screen.getByPlaceholderText('[Bug]: …'), { target: { value: 'Everything is broken' } })
        fireEvent.change(screen.getAllByRole('textbox')[1]!, { target: { value: 'me@example.com' } })
        fireEvent.click(screen.getByRole('button', { name: 'Next' }))

        expect(screen.getByText('[Bug]: Everything is broken')).toBeInTheDocument()
        expect(screen.getByText('bug')).toBeInTheDocument()
        expect(screen.getByText('octocat')).toBeInTheDocument()
        expect(screen.getByText(/### Contact/)).toBeInTheDocument()
        expect(screen.getByText(/me@example.com/)).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Create issue' }))

        await waitFor(() => {
            expect(onSubmit).toHaveBeenCalledWith({
                repo: 'heavygee/hapi',
                title: '[Bug]: Everything is broken',
                body: '### Contact\n\nme@example.com',
                labels: ['bug'],
                assignees: ['octocat']
            })
            expect(props.onClose).toHaveBeenCalledOnce()
        })
    })

    it('offers "Open a blank issue" when allowed, with a free-text body', async () => {
        const onSubmit = vi.fn().mockResolvedValue('https://github.com/heavygee/hapi/issues/43')
        renderDialog({ templates: [], blankAllowed: true, onSubmit })

        fireEvent.change(screen.getByPlaceholderText('owner/repo'), { target: { value: 'heavygee/hapi' } })
        fireEvent.click(screen.getByRole('button', { name: 'Next' }))
        fireEvent.click(await screen.findByText('Open a blank issue'))

        const titleInput = screen.getAllByRole('textbox')[0]!
        fireEvent.change(titleInput, { target: { value: 'A plain title' } })
        const bodyTextarea = screen.getByLabelText('Description')
        fireEvent.change(bodyTextarea, { target: { value: 'Plain body text' } })
        fireEvent.click(screen.getByRole('button', { name: 'Next' }))
        fireEvent.click(screen.getByRole('button', { name: 'Create issue' }))

        await waitFor(() => {
            expect(onSubmit).toHaveBeenCalledWith({
                repo: 'heavygee/hapi',
                title: 'A plain title',
                body: 'Plain body text',
                labels: [],
                assignees: []
            })
        })
    })

    it('does not offer "Open a blank issue" when blankAllowed is false but a usable template exists', async () => {
        renderDialog({ templates: [FORM_TEMPLATE], blankAllowed: false })

        fireEvent.change(screen.getByPlaceholderText('owner/repo'), { target: { value: 'heavygee/hapi' } })
        fireEvent.click(screen.getByRole('button', { name: 'Next' }))

        await screen.findByText('Bug report')
        expect(screen.queryByText('Open a blank issue')).toBeNull()
    })

    it('blocks creation and offers GitHub\'s own chooser when blank is disabled and nothing parsed as usable', async () => {
        renderDialog({
            templates: [UNSUPPORTED_TEMPLATE],
            blankAllowed: false,
            githubNewIssueUrl: 'https://github.com/heavygee/hapi/issues/new/choose'
        })

        fireEvent.change(screen.getByPlaceholderText('owner/repo'), { target: { value: 'heavygee/hapi' } })
        fireEvent.click(screen.getByRole('button', { name: 'Next' }))

        expect(await screen.findByText('This repository does not accept blank issues.')).toBeInTheDocument()
        expect(screen.getByText('Weird form')).toBeInTheDocument()
        expect(screen.getByText('Uses a form feature not supported yet')).toBeInTheDocument()
        expect(screen.queryByText('Bug report')).toBeNull()
        expect(screen.queryByText('Open a blank issue')).toBeNull()
        const link = screen.getByRole('link', { name: 'Open on GitHub instead' })
        expect(link).toHaveAttribute('href', 'https://github.com/heavygee/hapi/issues/new/choose')
    })

    it('shows a no-templates message in the blocked state when the repo has none at all', async () => {
        renderDialog({ templates: [], blankAllowed: false, githubNewIssueUrl: null })

        fireEvent.change(screen.getByPlaceholderText('owner/repo'), { target: { value: 'heavygee/hapi' } })
        fireEvent.click(screen.getByRole('button', { name: 'Next' }))

        expect(await screen.findByText('No issue templates were found in this repository.')).toBeInTheDocument()
        expect(screen.queryByRole('link', { name: 'Open on GitHub instead' })).toBeNull()
    })

    it('lists an unsupported template disabled with its reason, not selectable', async () => {
        renderDialog({ templates: [FORM_TEMPLATE, UNSUPPORTED_TEMPLATE] })

        fireEvent.change(screen.getByPlaceholderText('owner/repo'), { target: { value: 'heavygee/hapi' } })
        fireEvent.click(screen.getByRole('button', { name: 'Next' }))

        await screen.findByText('Bug report')
        expect(screen.getByText('Weird form')).toBeInTheDocument()
        expect(screen.getByText('Uses a form feature not supported yet')).toBeInTheDocument()
        // Unsupported entries render as a plain div (no onClick), not a button.
        expect(screen.getByText('Weird form').closest('button')).toBeNull()
    })

    it('disables Next on the repo step until something is typed', () => {
        renderDialog()
        expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
        fireEvent.change(screen.getByPlaceholderText('owner/repo'), { target: { value: 'a/b' } })
        expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled()
    })

    it('offers a dropdown of known repos plus an "Other repository" free-text fallback', () => {
        renderDialog({ knownRepos: ['heavygee/hapi', 'heavygee/other'] })
        expect(screen.getByRole('combobox')).toBeInTheDocument()
        expect(screen.getByRole('option', { name: 'heavygee/hapi' })).toBeInTheDocument()
        fireEvent.change(screen.getByRole('combobox'), { target: { value: '__other__' } })
        expect(screen.getByPlaceholderText('owner/repo')).toBeInTheDocument()
    })

    it('shows the templates error and does not crash when the fetch failed', async () => {
        renderDialog({ templatesError: 'rate limited' })
        fireEvent.change(screen.getByPlaceholderText('owner/repo'), { target: { value: 'heavygee/hapi' } })
        fireEvent.click(screen.getByRole('button', { name: 'Next' }))
        expect(await screen.findByText('rate limited')).toBeInTheDocument()
    })

    it('surfaces a submit failure inline on the review step without closing the dialog', async () => {
        const onSubmit = vi.fn().mockRejectedValue(new Error('gh issue create failed'))
        const { props } = renderDialog({ templates: [], blankAllowed: true, onSubmit })

        fireEvent.change(screen.getByPlaceholderText('owner/repo'), { target: { value: 'heavygee/hapi' } })
        fireEvent.click(screen.getByRole('button', { name: 'Next' }))
        fireEvent.click(await screen.findByText('Open a blank issue'))
        fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'T' } })
        fireEvent.click(screen.getByRole('button', { name: 'Next' }))
        fireEvent.click(screen.getByRole('button', { name: 'Create issue' }))

        await waitFor(() => expect(screen.getByText('gh issue create failed')).toBeInTheDocument())
        expect(props.onClose).not.toHaveBeenCalled()
    })

    it('surfaces the orphaned issue\'s own URL as a link when the issue was created but adding it to the board failed', async () => {
        const apiError = new ApiError('HTTP 502', 502, undefined, JSON.stringify({
            error: 'Issue created at https://github.com/heavygee/hapi/issues/42 but could not be added to the board: boom',
            url: 'https://github.com/heavygee/hapi/issues/42'
        }))
        const onSubmit = vi.fn().mockRejectedValue(apiError)
        const { props } = renderDialog({ templates: [], blankAllowed: true, onSubmit })

        fireEvent.change(screen.getByPlaceholderText('owner/repo'), { target: { value: 'heavygee/hapi' } })
        fireEvent.click(screen.getByRole('button', { name: 'Next' }))
        fireEvent.click(await screen.findByText('Open a blank issue'))
        fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'T' } })
        fireEvent.click(screen.getByRole('button', { name: 'Next' }))
        fireEvent.click(screen.getByRole('button', { name: 'Create issue' }))

        const link = await screen.findByRole('link', { name: 'https://github.com/heavygee/hapi/issues/42' })
        expect(link).toHaveAttribute('href', 'https://github.com/heavygee/hapi/issues/42')
        expect(props.onClose).not.toHaveBeenCalled()
    })
})
