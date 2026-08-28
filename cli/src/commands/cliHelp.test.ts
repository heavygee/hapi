import { describe, expect, it } from 'bun:test'
import { formatHapiCliHelp } from './cliHelp'
import { resolveCommand } from './registry'

describe('formatHapiCliHelp', () => {
    it('lists soup operator commands so hapi --help is not Claude-only', () => {
        const help = formatHapiCliHelp()
        expect(help).toContain('hapi job')
        expect(help).toContain('hapi ping-peer')
        expect(help).toContain('hapi version')
        expect(help).toContain('hapi auth')
        expect(help).toContain('hapi runner')
        expect(help).not.toContain('Claude Code On the Go')
    })
})

describe('resolveCommand help vs default Claude', () => {
    it('routes bare --help / -h / help to the help command, not Claude', () => {
        expect(resolveCommand(['--help']).command.name).toBe('help')
        expect(resolveCommand(['-h']).command.name).toBe('help')
        expect(resolveCommand(['help']).command.name).toBe('help')
    })

    it('keeps hapi job --help on the job command', () => {
        expect(resolveCommand(['job', '--help']).command.name).toBe('job')
        expect(resolveCommand(['ping-peer', '--help']).command.name).toBe('ping-peer')
    })

    it('still defaults bare hapi (no args) to Claude', () => {
        expect(resolveCommand([]).command.name).toBe('default')
    })

    it('routes hapi version to the version command, not Claude', () => {
        expect(resolveCommand(['version']).command.name).toBe('version')
    })
})
