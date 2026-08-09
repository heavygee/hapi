import { describe, expect, it } from 'bun:test'
import { looksLikeCliSubcommand, resolveCommand } from './registry'

describe('looksLikeCliSubcommand', () => {
    it('accepts lowercase kebab tokens', () => {
        expect(looksLikeCliSubcommand('job')).toBe(true)
        expect(looksLikeCliSubcommand('ping-peer')).toBe(true)
        expect(looksLikeCliSubcommand('auth')).toBe(true)
    })

    it('rejects flags and non-subcommand-shaped prompts', () => {
        expect(looksLikeCliSubcommand('--yolo')).toBe(false)
        expect(looksLikeCliSubcommand('-p')).toBe(false)
        expect(looksLikeCliSubcommand('Fix')).toBe(false)
        expect(looksLikeCliSubcommand('please fix this')).toBe(false)
    })
})

describe('resolveCommand', () => {
    it('routes registered commands', () => {
        const { command, context } = resolveCommand(['auth', 'status'])
        expect(command.name).toBe('auth')
        expect(context.commandArgs).toEqual(['status'])
    })

    it('defaults to Claude when there is no subcommand-shaped head', () => {
        expect(resolveCommand([]).command.name).toBe('default')
        expect(resolveCommand(['--yolo']).command.name).toBe('default')
        expect(resolveCommand(['-p', 'hi']).command.name).toBe('default')
        // Capitalized free text is not a subcommand token
        expect(resolveCommand(['Please']).command.name).toBe('default')
    })

    it('hard-fails unknown subcommand-shaped tokens instead of Claude fallthrough', () => {
        const { command, context } = resolveCommand(['job', 'set', 'x', 'y'])
        // Not yet registered on this base — must not become Claude default.
        expect(command.name).toBe('job')
        expect(command.name).not.toBe('default')
        expect(context.commandArgs).toEqual(['set', 'x', 'y'])
    })

    it('keeps the gemini tombstone registered (explicit error, not Claude)', () => {
        expect(resolveCommand(['gemini']).command.name).toBe('gemini')
    })
})
