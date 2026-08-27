export type VersionIdentityInput = {
    version: string
    generation: string | null
    hubTarget: string | null
    executable?: string
    durableTarget?: string | null
}

export function formatVersionIdentity(input: VersionIdentityInput): string {
    const generationLine = input.generation
        ? `generation: ${input.generation}`
        : 'generation: none (source/soup)'
    const hubLine = input.hubTarget
        ? `hub-target: ${input.hubTarget}`
        : 'hub-target: unreachable'
    let skew: 'yes' | 'no' | 'unknown' = 'unknown'
    if (input.generation && input.hubTarget) {
        skew = input.generation === input.hubTarget ? 'no' : 'yes'
    }
    const lines = [
        `hapi version: ${input.version}`,
        generationLine,
        hubLine,
        `skew: ${skew}`,
    ]
    if (input.executable) {
        lines.push(`executable: ${input.executable}`)
    }
    if (input.durableTarget && input.durableTarget !== input.executable) {
        lines.push(`durable-target: ${input.durableTarget}`)
        lines.push('note: PATH hapi.exe may lag the durable hub-artifact (Windows file lock). Prefer durable-target.')
    }
    return `${lines.join('\n')}\n`
}
