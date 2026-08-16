/**
 * Cross-machine peer provenance diagnostics (#1203 operator tooling).
 */

import chalk from 'chalk'
import type {
    MachineProvenanceRow,
    ProvenanceDiagnostics,
    ProvenanceIssueCode,
    SessionProvenanceRow,
    UnverifiedPeerMessageRow,
} from '@hapi/protocol/provenanceDiagnostics'
import {
    DEFAULT_PROVENANCE_MESSAGE_LIMIT,
    DEFAULT_PROVENANCE_MESSAGE_SINCE_DAYS,
} from '@hapi/protocol/provenanceMessageAudit'
import { configuration } from '@/configuration'
import { buildHubRequestHeaders } from '@/api/hubExtraHeaders'
import { readSettings } from '@/persistence'

export type DoctorProvenanceOptions = {
    skipMessages?: boolean
    sinceDays?: number
    messageLimit?: number
    maxScan?: number
    /** Exit 1 when unverified peer messages exist in the scan window. */
    strictMessages?: boolean
}

const ISSUE_LABELS: Record<ProvenanceIssueCode, string> = {
    active_unproven: 'active but missing killSession RPC (unproven CLI)',
    archived_but_active: 'lifecycle archived but still heartbeating',
    machine_no_spawn_rpc: 'online machine missing spawn-happy-session RPC',
    machine_no_runner_proof: 'machine has no runner proof hash bound',
    machine_capability_skew: 'runner missing required machine capabilities',
    machine_cli_stale: 'runner started from older CLI binary than installed',
}

async function hubJwt(): Promise<string | null> {
    const settings = await readSettings()
    const token = process.env.CLI_API_TOKEN ?? settings.cliApiToken
    if (!token) {
        return null
    }
    const res = await fetch(`${configuration.apiUrl}/api/auth`, {
        method: 'POST',
        headers: buildHubRequestHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ accessToken: token }),
    })
    if (!res.ok) {
        return null
    }
    const body = (await res.json()) as { token?: string }
    return body.token ?? null
}

function buildProvenanceQuery(options: DoctorProvenanceOptions): string {
    const params = new URLSearchParams()
    if (options.skipMessages) {
        params.set('skipMessages', '1')
        return params.toString()
    }
    if (options.sinceDays !== undefined) {
        params.set('sinceDays', String(options.sinceDays))
    }
    if (options.messageLimit !== undefined) {
        params.set('messageLimit', String(options.messageLimit))
    }
    if (options.maxScan !== undefined) {
        params.set('maxScan', String(options.maxScan))
    }
    return params.toString()
}

export async function fetchProvenanceDiagnostics(
    jwt: string,
    options: DoctorProvenanceOptions = {}
): Promise<ProvenanceDiagnostics> {
    const query = buildProvenanceQuery(options)
    const url = `${configuration.apiUrl}/api/doctor/provenance${query ? `?${query}` : ''}`
    const res = await fetch(url, {
        headers: buildHubRequestHeaders({ Authorization: `Bearer ${jwt}` }),
    })
    if (!res.ok) {
        throw new Error(`provenance diagnostics failed: HTTP ${res.status}`)
    }
    return await res.json() as ProvenanceDiagnostics
}

/** Strip C0/C1 controls so stored peer/session labels cannot hijack the TTY (#1473). */
export function safeTerminalText(value: string): string {
    return Array.from(value, (char) => {
        const code = char.charCodeAt(0)
        return code < 0x20 || (code >= 0x7f && code <= 0x9f) ? ' ' : char
    }).join('')
}

function formatIssues(issues: ProvenanceIssueCode[]): string {
    if (issues.length === 0) {
        return chalk.green('ok')
    }
    return issues.map((issue) => chalk.red(ISSUE_LABELS[issue])).join('; ')
}

function formatSessionRow(row: SessionProvenanceRow): string {
    const label = safeTerminalText(row.name ?? row.sessionId.slice(0, 8))
    const pid = row.hostPid !== null ? ` pid=${row.hostPid}` : ''
    const machine = row.machineId ? ` machine=${safeTerminalText(row.machineId).slice(0, 8)}` : ''
    const lifecycle = row.lifecycleState ? ` lifecycle=${safeTerminalText(row.lifecycleState)}` : ''
    const kill = row.hasKillSessionRpc ? chalk.green('killSession') : chalk.red('no-kill')
    const active = row.active ? chalk.yellow('active') : chalk.gray('idle')
    return [
        `  ${active} ${chalk.cyan(label)}`,
        `    id=${safeTerminalText(row.sessionId)}`,
        `    flavor=${safeTerminalText(row.flavor ?? '(unknown)')}${machine}${pid}${lifecycle}`,
        `  rpc=${kill}  ${formatIssues(row.issues)}`,
    ].join('\n')
}

function formatMachineRow(row: MachineProvenanceRow): string {
    const label = safeTerminalText(row.displayName ?? row.host ?? row.machineId.slice(0, 8))
    const spawn = row.hasSpawnRpc ? chalk.green('spawn') : chalk.red('no-spawn')
    const proof = row.hasRunnerProof ? chalk.green('proof') : chalk.red('no-proof')
    const version = row.happyCliVersion ? ` cli=${safeTerminalText(row.happyCliVersion)}` : ''
    return [
        `  ${chalk.blue(label)} (${safeTerminalText(row.machineId).slice(0, 8)})`,
        `    host=${safeTerminalText(row.host ?? '(unknown)')}${version}`,
        `  rpc=${spawn} proof=${proof}  ${formatIssues(row.issues)}`,
    ].join('\n')
}

function formatUnverifiedMessageRow(row: UnverifiedPeerMessageRow): string {
    const sessionLabel = safeTerminalText(row.sessionName ?? row.sessionId.slice(0, 8))
    const claimed = row.claimedPeerHeaderInText ? chalk.yellow(' prose-From:') : ''
    const preview = row.textPreview
        ? ` "${safeTerminalText(row.textPreview)}"`
        : ''
    return [
        `  ${chalk.yellow('peer?')} ${chalk.cyan(sessionLabel)} seq=${row.seq}`,
        `    session=${safeTerminalText(row.sessionId)}`,
        `    message=${safeTerminalText(row.messageId)}${claimed}`,
        `    ${preview}`,
    ].join('\n')
}

function formatMessageScanNote(diagnostics: ProvenanceDiagnostics): string | null {
    const scan = diagnostics.messageScan
    if (!scan) {
        return null
    }
    const since = new Date(scan.sinceMs).toISOString().slice(0, 10)
    const truncated = scan.scanTruncated ? chalk.yellow(' (scan cap hit — raise --max-scan)') : ''
    return `  window since ${since}; scanned ${scan.messagesScanned} msgs; `
        + `unverified peer total ${scan.unverifiedTotal}; showing ${diagnostics.unverifiedPeerMessages.length}${truncated}`
}

export function formatProvenanceReport(diagnostics: ProvenanceDiagnostics): string {
    const lines: string[] = [
        chalk.bold('Summary'),
        `  active sessions: ${diagnostics.summary.activeSessions}`,
        `  unproven active: ${diagnostics.summary.unprovenActiveSessions}`,
        `  archived-but-active: ${diagnostics.summary.archivedButActiveSessions}`,
        `  online machines: ${diagnostics.summary.onlineMachines}`,
        `  machines with issues: ${diagnostics.summary.machinesWithIssues}`,
    ]

    if (diagnostics.messageScan) {
        const note = formatMessageScanNote(diagnostics)
        if (note) {
            lines.push(`  unverified peer messages: ${diagnostics.messageScan.unverifiedTotal}`)
            lines.push(note)
        }
    }

    const flaggedSessions = diagnostics.sessions.filter((row) => row.active || row.issues.length > 0)
    lines.push('', chalk.bold('Sessions'))
    if (flaggedSessions.length === 0) {
        lines.push('  (no active or flagged sessions)')
    } else {
        for (const row of flaggedSessions) {
            lines.push(formatSessionRow(row))
        }
    }

    lines.push('', chalk.bold('Machines'))
    if (diagnostics.machines.length === 0) {
        lines.push('  (no online machines)')
    } else {
        for (const row of diagnostics.machines) {
            lines.push(formatMachineRow(row))
        }
    }

    if (diagnostics.messageScan) {
        lines.push('', chalk.bold('Unverified peer messages (sentFrom=peer, no sourceSessionId)'))
        if (diagnostics.unverifiedPeerMessages.length === 0) {
            lines.push('  (none in scan window)')
        } else {
            for (const row of diagnostics.unverifiedPeerMessages) {
                lines.push(formatUnverifiedMessageRow(row))
            }
        }
    }

    return lines.join('\n')
}

export function provenanceDiagnosticsHasIssues(diagnostics: ProvenanceDiagnostics): boolean {
    return diagnostics.sessions.some((row) => row.issues.length > 0)
        || diagnostics.machines.some((row) => row.issues.length > 0)
}

export function provenanceDiagnosticsHasUnverifiedMessages(diagnostics: ProvenanceDiagnostics): boolean {
    return (diagnostics.messageScan?.unverifiedTotal ?? 0) > 0
}

export function parseDoctorProvenanceArgs(args: string[]): DoctorProvenanceOptions {
    const options: DoctorProvenanceOptions = {}
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i]
        if (arg === '--no-messages' || arg === '--skip-messages') {
            options.skipMessages = true
            continue
        }
        if (arg === '--strict-messages') {
            options.strictMessages = true
            continue
        }
        if (arg === '--since-days' && args[i + 1]) {
            options.sinceDays = Number.parseInt(args[++i]!, 10)
            continue
        }
        if (arg === '--message-limit' && args[i + 1]) {
            options.messageLimit = Number.parseInt(args[++i]!, 10)
            continue
        }
        if (arg === '--max-scan' && args[i + 1]) {
            options.maxScan = Number.parseInt(args[++i]!, 10)
            continue
        }
    }
    return options
}

export async function runDoctorProvenance(cliArgs: string[] = []): Promise<number> {
    const options = parseDoctorProvenanceArgs(cliArgs)
    console.log(chalk.bold.cyan('\n🔎 hapi provenance doctor\n'))
    console.log(`Hub: ${chalk.blue(configuration.apiUrl)}`)
    if (!options.skipMessages) {
        const sinceDays = options.sinceDays ?? DEFAULT_PROVENANCE_MESSAGE_SINCE_DAYS
        const limit = options.messageLimit ?? DEFAULT_PROVENANCE_MESSAGE_LIMIT
        console.log(chalk.gray(`Message audit: last ${sinceDays}d, limit ${limit} rows`))
    }

    const jwt = await hubJwt()
    if (!jwt) {
        console.log(chalk.red('❌ CLI_API_TOKEN missing or auth failed'))
        console.log(chalk.gray('  Run `hapi auth login` or set CLI_API_TOKEN, then retry.'))
        return 1
    }

    let diagnostics: ProvenanceDiagnostics
    try {
        diagnostics = await fetchProvenanceDiagnostics(jwt, options)
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.log(chalk.red(`❌ ${message}`))
        return 1
    }

    console.log('')
    console.log(formatProvenanceReport(diagnostics))
    console.log('')

    const controlPlaneIssues = provenanceDiagnosticsHasIssues(diagnostics)
    const messageIssues = options.strictMessages && provenanceDiagnosticsHasUnverifiedMessages(diagnostics)

    if (controlPlaneIssues || messageIssues) {
        if (controlPlaneIssues) {
            console.log(chalk.yellow('⚠️  Provenance control-plane issues found.'))
            console.log(chalk.gray('  Unproven active sessions cannot be archived cleanly; restart the CLI on that machine.'))
        }
        if (messageIssues) {
            console.log(chalk.yellow('⚠️  Unverified peer messages in scan window (--strict-messages).'))
            console.log(chalk.gray('  Fix: use attributed ping_peer/spawn_peer (session capability path), not x-hapi-peer-delivery alone.'))
        }
        console.log(chalk.gray('  Inspect one session: hapi inspect-peer <session-id-prefix>'))
        return 1
    }

    if (provenanceDiagnosticsHasUnverifiedMessages(diagnostics)) {
        console.log(chalk.yellow('ℹ️  Unverified peer messages listed above (informational; use --strict-messages to fail).'))
    }

    console.log(chalk.green('✅ No provenance control-plane issues detected.'))
    return 0
}
