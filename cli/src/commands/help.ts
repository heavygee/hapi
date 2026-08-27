import { formatHapiCliHelp } from './cliHelp'
import type { CommandDefinition } from './types'

export const helpCommand: CommandDefinition = {
    name: 'help',
    requiresRuntimeAssets: false,
    run: async () => {
        console.log(formatHapiCliHelp())
        process.exit(0)
    },
}
