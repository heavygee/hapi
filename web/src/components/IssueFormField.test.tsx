import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import { IssueFormFieldView } from './IssueFormField'
import type { IssueFormAnswer, IssueFormField } from '@/types/api'

function renderField(field: IssueFormField, answer: IssueFormAnswer | undefined, onChange = vi.fn()) {
    render(
        <I18nProvider>
            <IssueFormFieldView field={field} answer={answer} onChange={onChange} />
        </I18nProvider>
    )
    return onChange
}

describe('IssueFormFieldView', () => {
    it('renders a markdown field as display-only instructional text, no input', () => {
        renderField({ kind: 'markdown', value: 'Thanks for filing this bug report!' }, undefined)
        expect(screen.getByText('Thanks for filing this bug report!')).toBeInTheDocument()
        expect(screen.queryByRole('textbox')).toBeNull()
    })

    it('shows a required-field asterisk for input/textarea/dropdown but not for a markdown field', () => {
        renderField({ kind: 'input', id: 'contact', label: 'Contact', required: true }, undefined)
        expect(screen.getByText('*')).toBeInTheDocument()
    })

    it('fires onChange with the typed value for an input field', () => {
        const onChange = renderField({ kind: 'input', id: 'contact', label: 'Contact', required: false }, undefined)
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'me@example.com' } })
        expect(onChange).toHaveBeenCalledWith({ kind: 'input', id: 'contact', value: 'me@example.com' })
    })

    it('pre-fills a textarea from the field\'s own default value', () => {
        renderField({ kind: 'textarea', id: 'logs', label: 'Logs', required: false, value: 'default text' }, undefined)
        expect(screen.getByRole('textbox')).toHaveValue('default text')
    })

    it('renders a single-select dropdown and fires onChange with a single-element selected array', () => {
        const onChange = renderField(
            { kind: 'dropdown', id: 'version', label: 'Version', options: ['1.0', '2.0'], multiple: false, required: true },
            undefined
        )
        fireEvent.change(screen.getByRole('combobox'), { target: { value: '2.0' } })
        expect(onChange).toHaveBeenCalledWith({ kind: 'dropdown', id: 'version', selected: ['2.0'] })
    })

    it('renders a multi-select dropdown as checkboxes and toggles independently', () => {
        const onChange = renderField(
            { kind: 'dropdown', id: 'browsers', label: 'Browsers', options: ['Firefox', 'Chrome'], multiple: true, required: false },
            { kind: 'dropdown', id: 'browsers', selected: ['Firefox'] }
        )
        fireEvent.click(screen.getByText('Chrome'))
        expect(onChange).toHaveBeenCalledWith({ kind: 'dropdown', id: 'browsers', selected: ['Firefox', 'Chrome'] })
    })

    it('renders checkboxes with per-option required markers and toggles independently', () => {
        const onChange = renderField(
            {
                kind: 'checkboxes',
                id: 'terms',
                label: 'Code of Conduct',
                options: [{ label: 'I agree', required: true }, { label: 'Optional note', required: false }]
            },
            { kind: 'checkboxes', id: 'terms', checked: [] }
        )
        fireEvent.click(screen.getByText('I agree'))
        expect(onChange).toHaveBeenCalledWith({ kind: 'checkboxes', id: 'terms', checked: ['I agree'] })
    })

    it('unchecks a previously-checked checkbox option', () => {
        const onChange = renderField(
            { kind: 'checkboxes', id: 'terms', label: 'Terms', options: [{ label: 'Agree', required: true }] },
            { kind: 'checkboxes', id: 'terms', checked: ['Agree'] }
        )
        fireEvent.click(screen.getByText('Agree'))
        expect(onChange).toHaveBeenCalledWith({ kind: 'checkboxes', id: 'terms', checked: [] })
    })
})
