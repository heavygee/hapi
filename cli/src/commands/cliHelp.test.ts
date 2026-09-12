import { describe, expect, it } from 'vitest'
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

describe('resolveCommand help vs agent dispatch', () => {
    it('routes hapi help subcommand to the help command', () => {
        expect(resolveCommand(['help'])!.command.name).toBe('help')
    })

    it('does not treat top-level --help as a subcommand (runCli handles it)', () => {
        expect(resolveCommand(['--help'])).toBeNull()
        expect(resolveCommand(['-h'])).toBeNull()
    })

    it('keeps hapi job --help on the job command', () => {
        expect(resolveCommand(['job', '--help'])!.command.name).toBe('job')
        expect(resolveCommand(['ping-peer', '--help'])!.command.name).toBe('ping-peer')
    })

    it('returns null for bare argv (runCli agent picker fills the agent)', () => {
        expect(resolveCommand([])).toBeNull()
    })

    it('routes hapi version to the version command', () => {
        expect(resolveCommand(['version'])!.command.name).toBe('version')
    })
})
