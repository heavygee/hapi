import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'

const mermaidMocks = vi.hoisted(() => ({
    initializeMock: vi.fn(),
    parseMock: vi.fn(),
    renderMock: vi.fn(),
    setParseErrorHandlerMock: vi.fn(),
}))

vi.mock('mermaid', () => ({
    default: {
        initialize: mermaidMocks.initializeMock,
        parse: mermaidMocks.parseMock,
        render: mermaidMocks.renderMock,
        setParseErrorHandler: mermaidMocks.setParseErrorHandlerMock,
    }
}))

import { MermaidDiagram } from '@/components/assistant-ui/mermaid-diagram'
import { MARKDOWN_COMPONENTS_BY_LANGUAGE } from '@/components/assistant-ui/markdown-text'

function renderMermaid(code: string) {
    return render(
        <MermaidDiagram
            code={code}
            language="mermaid"
            components={{
                Pre: (props) => <pre {...props} />,
                Code: (props) => <code {...props} />,
            }}
        />
    )
}

describe('MermaidDiagram', () => {
    beforeEach(() => {
        mermaidMocks.initializeMock.mockClear()
        mermaidMocks.setParseErrorHandlerMock.mockClear()
        mermaidMocks.parseMock.mockReset()
        mermaidMocks.parseMock.mockResolvedValue({ diagramType: 'flowchart-v2' })
        mermaidMocks.renderMock.mockReset()
        mermaidMocks.renderMock.mockResolvedValue({
            svg: '<svg data-testid="mock-mermaid"></svg>'
        })
    })

    afterEach(() => {
        cleanup()
        document.documentElement.removeAttribute('data-theme')
    })

    it('is wired into the shared markdown language overrides and renders svg output', async () => {
        renderMermaid('graph TD\nA --> B')

        await waitFor(() => {
            const diagram = document.querySelector('[data-mermaid-diagram][data-rendered="true"]')
            expect(diagram).toBeTruthy()
            expect(diagram?.querySelector('[data-testid="mock-mermaid"]')).toBeTruthy()
        })

        expect(mermaidMocks.initializeMock).toHaveBeenCalled()
        expect(mermaidMocks.initializeMock).toHaveBeenCalledWith(expect.objectContaining({
            securityLevel: 'strict',
            suppressErrorRendering: true,
        }))
        expect(mermaidMocks.parseMock).toHaveBeenCalledWith('graph TD\nA --> B', { suppressErrors: true })
        expect(mermaidMocks.renderMock).toHaveBeenCalledWith(expect.stringContaining('mermaid-'), 'graph TD\nA --> B')
        expect(MARKDOWN_COMPONENTS_BY_LANGUAGE.mermaid.SyntaxHighlighter).toBe(MermaidDiagram)
    })

    it('shows error placeholder (not raw source) when parse returns false', async () => {
        document.documentElement.dataset.theme = 'dark'
        mermaidMocks.parseMock.mockResolvedValueOnce(false)

        renderMermaid('graph TD\nA --')

        await waitFor(() => {
            const placeholder = document.querySelector('.aui-mermaid-render-error')
            expect(placeholder).toBeTruthy()
            expect(placeholder?.getAttribute('data-rendered')).toBe('false')
            // raw markup must NOT be exposed to the user
            expect(placeholder?.textContent).not.toContain('graph TD')
        })

        expect(mermaidMocks.parseMock).toHaveBeenCalledWith('graph TD\nA --', { suppressErrors: true })
        expect(mermaidMocks.renderMock).not.toHaveBeenCalled()
        expect(mermaidMocks.setParseErrorHandlerMock).toHaveBeenCalled()
    })

    it('shows error placeholder (not raw source) and suppresses Mermaid error SVG when render throws', async () => {
        mermaidMocks.renderMock.mockRejectedValueOnce(new Error('render failed'))
        const code = 'gantt\ndateFormat YYYY-MM-DD\nsection A\nTask :a, 2024-01-01'

        renderMermaid(code)

        await waitFor(() => {
            const placeholder = document.querySelector('.aui-mermaid-render-error')
            expect(placeholder).toBeTruthy()
            expect(placeholder?.getAttribute('data-rendered')).toBe('false')
            expect(placeholder?.textContent).not.toContain('gantt')
        })

        expect(mermaidMocks.renderMock).toHaveBeenCalled()
        expect(mermaidMocks.initializeMock).toHaveBeenCalledWith(expect.objectContaining({
            suppressErrorRendering: true,
        }))
    })

})
