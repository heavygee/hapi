import { describe, expect, test } from 'bun:test'
import {
    collapseRepeats,
    extractAssistantPlainText,
    extractNotifySummary,
    isRedundantGoalStatusEventContent,
    matchNotifySummaryLine,
    NOTIFY_SUMMARY_TOKEN,
    type NotifySummary
} from './messages'

describe('extractAssistantPlainText', () => {
    test('returns null for non-objects', () => {
        expect(extractAssistantPlainText(null)).toBeNull()
        expect(extractAssistantPlainText(undefined)).toBeNull()
        expect(extractAssistantPlainText('string')).toBeNull()
        expect(extractAssistantPlainText(42)).toBeNull()
    })

    test('extracts codex/message text', () => {
        const content = {
            type: 'codex',
            data: {
                type: 'message',
                message: 'Hello there.'
            }
        }
        expect(extractAssistantPlainText(content)).toBe('Hello there.')
    })

    test('returns null for codex/tool-call (no text)', () => {
        const content = {
            type: 'codex',
            data: {
                type: 'tool-call',
                name: 'Edit',
                callId: 'x',
                input: {}
            }
        }
        expect(extractAssistantPlainText(content)).toBeNull()
    })

    test('returns null for codex/tool-call-result (no text)', () => {
        const content = {
            type: 'codex',
            data: {
                type: 'tool-call-result',
                output: {}
            }
        }
        expect(extractAssistantPlainText(content)).toBeNull()
    })

    test('returns null when codex/message string is empty', () => {
        const content = { type: 'codex', data: { type: 'message', message: '' } }
        expect(extractAssistantPlainText(content)).toBeNull()
    })

    test('extracts output/assistant text from claude SDK content array', () => {
        const content = {
            type: 'output',
            data: {
                type: 'assistant',
                message: {
                    content: [
                        { type: 'text', text: 'Line one.' },
                        { type: 'tool_use', name: 'Edit' },
                        { type: 'text', text: 'Line two.' }
                    ]
                }
            }
        }
        expect(extractAssistantPlainText(content)).toBe('Line one.\nLine two.')
    })

    test('returns null for output/assistant with no text blocks', () => {
        const content = {
            type: 'output',
            data: {
                type: 'assistant',
                message: { content: [{ type: 'tool_use', name: 'Edit' }] }
            }
        }
        expect(extractAssistantPlainText(content)).toBeNull()
    })

    test('returns null for output/user (not assistant)', () => {
        const content = { type: 'output', data: { type: 'user', message: { content: [] } } }
        expect(extractAssistantPlainText(content)).toBeNull()
    })

    test('returns null for unknown content shapes', () => {
        expect(extractAssistantPlainText({ type: 'event', data: {} })).toBeNull()
        expect(extractAssistantPlainText({ type: 'text' })).toBeNull()
    })
})

describe('extractNotifySummary', () => {
    const FULL_LINE = 'AGENT_NOTIFY_SUMMARY {"version":1,"agent":"hapi-monitor agent","project":"hapi-monitor","status":"done","action":"Revoke tokens","summary":"Published v0.1.0"}'

    test('returns null on non-string input', () => {
        expect(extractNotifySummary(null)).toBeNull()
        expect(extractNotifySummary(undefined)).toBeNull()
        expect(extractNotifySummary({})).toBeNull()
        expect(extractNotifySummary(42)).toBeNull()
        expect(extractNotifySummary('')).toBeNull()
    })

    test('parses a summary on its own line at the very end', () => {
        const result = extractNotifySummary(FULL_LINE)
        expect(result).not.toBeNull()
        const r = result as NotifySummary
        expect(r.version).toBe(1)
        expect(r.agent).toBe('hapi-monitor agent')
        expect(r.project).toBe('hapi-monitor')
        expect(r.status).toBe('done')
        expect(r.action).toBe('Revoke tokens')
        expect(r.summary).toBe('Published v0.1.0')
    })

    test('parses summary as last non-empty line after preceding prose', () => {
        const text = `Here is what I did.\n\nThings worked.\n\n${FULL_LINE}`
        const r = extractNotifySummary(text)
        expect(r?.summary).toBe('Published v0.1.0')
    })

    test('tolerates trailing whitespace and blank lines', () => {
        const r = extractNotifySummary(`prose\n\n${FULL_LINE}\n\n  \n`)
        expect(r?.summary).toBe('Published v0.1.0')
    })

    test('returns null when summary is not on the LAST non-empty line', () => {
        // Operator wrote prose AFTER the line - non-compliant.
        const text = `${FULL_LINE}\nOh, one more thing.`
        expect(extractNotifySummary(text)).toBeNull()
    })

    test('returns null when prefix is missing', () => {
        expect(extractNotifySummary('NOTIFY_SUMMARY {"summary":"x"}')).toBeNull()
        expect(extractNotifySummary('agent_notify_summary {"summary":"x"}')).toBeNull()
    })

    test('returns null when JSON is malformed', () => {
        expect(extractNotifySummary('AGENT_NOTIFY_SUMMARY {bogus}')).toBeNull()
        expect(extractNotifySummary('AGENT_NOTIFY_SUMMARY {"summary":')).toBeNull()
        expect(extractNotifySummary('AGENT_NOTIFY_SUMMARY not-json')).toBeNull()
    })

    test('drops fields with wrong types but keeps valid ones', () => {
        const text = 'AGENT_NOTIFY_SUMMARY {"version":"oops","summary":"x","action":42,"status":"done"}'
        const r = extractNotifySummary(text)
        expect(r?.summary).toBe('x')
        expect(r?.status).toBe('done')
        expect(r?.version).toBeUndefined()
        expect(r?.action).toBeUndefined()
    })

    test('ignores in-message quotes of the line - only the LAST line is parsed', () => {
        // This very test message contains the literal prefix in a quoted explanation,
        // but the trailing line is plain prose, so we return null.
        const text = `Earlier I described the format as 'AGENT_NOTIFY_SUMMARY {...}', but here is plain text.`
        expect(extractNotifySummary(text)).toBeNull()
    })

    test('returns null for whitespace-only input', () => {
        expect(extractNotifySummary('   \n\n  ')).toBeNull()
    })

    test('handles JSON with internal braces (escaped within strings)', () => {
        const text = 'AGENT_NOTIFY_SUMMARY {"summary":"thing {nested} thing","status":"done"}'
        const r = extractNotifySummary(text)
        expect(r?.summary).toBe('thing {nested} thing')
        expect(r?.status).toBe('done')
    })
})

describe('extractNotifySummary + extractAssistantPlainText (integration)', () => {
    test('codex assistant text containing a trailing summary line', () => {
        const content = {
            type: 'codex',
            data: {
                type: 'message',
                message: 'Did the work.\n\nAGENT_NOTIFY_SUMMARY {"summary":"Done","status":"done"}'
            }
        }
        const text = extractAssistantPlainText(content)
        expect(text).not.toBeNull()
        const r = extractNotifySummary(text!)
        expect(r?.summary).toBe('Done')
    })

    test('claude SDK output with summary in the last text block', () => {
        const content = {
            type: 'output',
            data: {
                type: 'assistant',
                message: {
                    content: [
                        { type: 'text', text: 'Quick update.' },
                        { type: 'text', text: 'AGENT_NOTIFY_SUMMARY {"summary":"All checks green","status":"done","action":"Merge PR"}' }
                    ]
                }
            }
        }
        const text = extractAssistantPlainText(content)
        const r = extractNotifySummary(text!)
        expect(r?.summary).toBe('All checks green')
        expect(r?.action).toBe('Merge PR')
    })
})

describe('collapseRepeats (corruption normalizer)', () => {
    test('collapses runs of a repeated character to one', () => {
        expect(collapseRepeats('SUMMARY')).toBe('SUMARY')
        expect(collapseRepeats('aaa-bb-c')).toBe('a-b-c')
        expect(collapseRepeats('')).toBe('')
        expect(collapseRepeats('abc')).toBe('abc')
    })

    test('the correct token and the Cursor dup-drop collapse to the same form', () => {
        // AGENT_NOTIFY_SUMMARY -> AGENT_NOTIFY_SUMARY (drop one M);
        // both must normalize equal so a corrupted line still matches.
        expect(collapseRepeats(NOTIFY_SUMMARY_TOKEN)).toBe(collapseRepeats('AGENT_NOTIFY_SUMARY'))
    })
})

describe('matchNotifySummaryLine (corruption-tolerant detector)', () => {
    test('matches the correct token line and returns the JSON', () => {
        expect(matchNotifySummaryLine('AGENT_NOTIFY_SUMMARY {"status":"done"}')).toBe('{"status":"done"}')
    })

    test('matches the Cursor dup-dropped token (SUMARY)', () => {
        expect(matchNotifySummaryLine('AGENT_NOTIFY_SUMARY {"status":"done"}')).toBe('{"status":"done"}')
    })

    test('tolerates trailing/leading whitespace on the line', () => {
        expect(matchNotifySummaryLine('  AGENT_NOTIFY_SUMMARY {"a":1}  ')).toBe('{"a":1}')
    })

    test('rejects a token embedded in prose (not a bare token)', () => {
        expect(matchNotifySummaryLine('see the AGENT_NOTIFY_SUMMARY {"x":1}')).toBeNull()
    })

    test('rejects lines with no JSON or no leading token', () => {
        expect(matchNotifySummaryLine('AGENT_NOTIFY_SUMMARY not json')).toBeNull()
        expect(matchNotifySummaryLine('{"x":1}')).toBeNull()
        expect(matchNotifySummaryLine('')).toBeNull()
    })

    test('rejects a non-dup deletion (NOTFY) - acceptable residual loss', () => {
        // Non-adjacent-duplicate corruption is not recoverable by collapse-norm;
        // observed rate in the wild is ~2 in 5800. Documented as acceptable.
        expect(matchNotifySummaryLine('AGENT_NOTFY_SUMMARY {"x":1}')).toBeNull()
    })
})

describe('extractNotifySummary (corruption-tolerant end-to-end)', () => {
    test('parses a corrupted (SUMARY) trailing line into a summary object', () => {
        const text = 'Did the thing.\n\nAGENT_NOTIFY_SUMARY {"version":1,"status":"blocked","summary":"needs key"}'
        const r = extractNotifySummary(text)
        expect(r?.status).toBe('blocked')
        expect(r?.summary).toBe('needs key')
    })
})

describe('isRedundantGoalStatusEventContent (regression-guard for messages.ts edits)', () => {
    test('still detects goal-active events', () => {
        const value = {
            role: 'agent',
            content: {
                type: 'event',
                data: { type: 'message', message: 'Goal active · build the thing' }
            }
        }
        expect(isRedundantGoalStatusEventContent(value)).toBe(true)
    })
})
