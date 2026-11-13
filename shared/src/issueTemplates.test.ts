import { describe, expect, it } from 'bun:test'
import { formatIssueBody } from './issueTemplates'
import type { IssueFormAnswer, IssueFormField } from './issueTemplates'

describe('formatIssueBody', () => {
    // Review finding (heavygee/hapi#238): trimming the whole textarea value
    // removes indentation from only the FIRST line of a multi-line code
    // sample, since .trim() strips leading whitespace contiguous with the
    // start of the string — every other line keeps its indentation,
    // corrupting the reproduction actually submitted to GitHub.
    it('preserves internal indentation in a rendered textarea, trimming only surrounding blank lines', () => {
        const fields: IssueFormField[] = [
            { kind: 'textarea', id: 'repro', label: 'Reproduction', render: 'python', required: true }
        ]
        const answers: IssueFormAnswer[] = [
            { kind: 'textarea', id: 'repro', value: '\n    if x:\n        do_thing()\n    else:\n        other_thing()\n' }
        ]
        const body = formatIssueBody(fields, answers)
        expect(body).toBe('### Reproduction\n\n```python\n\n    if x:\n        do_thing()\n    else:\n        other_thing()\n\n```')
    })

    it('reports an all-whitespace textarea answer as unanswered', () => {
        const fields: IssueFormField[] = [
            { kind: 'textarea', id: 'notes', label: 'Notes', required: false }
        ]
        const answers: IssueFormAnswer[] = [
            { kind: 'textarea', id: 'notes', value: '   \n  ' }
        ]
        const body = formatIssueBody(fields, answers)
        expect(body).toBe('### Notes\n\n_No response_')
    })

    it('still trims a single-line input field', () => {
        const fields: IssueFormField[] = [
            { kind: 'input', id: 'title', label: 'Title', required: true }
        ]
        const answers: IssueFormAnswer[] = [
            { kind: 'input', id: 'title', value: '  padded title  ' }
        ]
        const body = formatIssueBody(fields, answers)
        expect(body).toBe('### Title\n\npadded title')
    })
})
