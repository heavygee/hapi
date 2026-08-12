/**
 * Cross-machine peer provenance diagnostics (#1203 operator tooling).
 */

import chalk from 'chalk'
import type {
    MachineProvenanceRow,
    ProvenanceDiagnostics,
    ProvenanceIssueCode,
    SessionProvenanceRow,
} from '@hapi/protocol/provenanceDiagnostics'
import { configuration } from '@/configuration'
import { buildHubRequestHeaders } from '@/api/hubExtraHeaders'
import { readSettings } from '@/persistence'

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

export async function fetchProvenanceDiagnostics(jwt: string): Promise<ProvenanceDiagnostics> {
    const res = await fetch(`${configuration.apiUrl}/api/doctor/provenance`, {
        headers: buildHubRequestHeaders({ Authorization: `Bearer ${jwt}` }),
    })
    if (!res.ok) {
        throw new Error(`provenance diagnostics failed: HTTP ${res.status}`)
    }
    return await res.json() as ProvenanceDiagnostics
}

function formatIssues(issues: ProvenanceIssueCode[]): string {
    if (issues.length === 0) {
        return chalk.green('ok')
    }
    return issues.map((issue) => chalk.red(ISSUE_LABELS[issue])).join('; ')
}

function formatSessionRow(row: SessionProvenanceRow): string {
    const label = row.name ?? row.sessionId.slice(0, 8)
    const pid = row.hostPid !== null ? ` pid=${row.hostPid}` : ''
    const machine = row.machineId ? ` machine=${row.machineId.slice(0, 8)}` : ''
    const lifecycle = row.lifecycleState ? ` lifecycle=${row.lifecycleState}` : ''
    const kill = row.hasKillSessionRpc ? chalk.green('killSession') : chalk.red('no-kill')
    const active = row.active ? chalk.yellow('active') : chalk.gray('idle')
    return [
        `  ${active} ${chalk.cyan(label)}`,
        `    id=${row.sessionId}`,
        `    flavor=${row.flavor ?? '(unknown)'}${machine}${pid}${lifecycle}`,
        `  rpc=${kill}  ${formatIssues(row.issues)}`,
    ].join('\n')
}

function formatMachineRow(row: MachineProvenanceRow): string {
    const label = row.displayName ?? row.host ?? row.machineId.slice(0, 8)
    const spawn = row.hasSpawnRpc ? chalk.green('spawn') : chalk.red('no-spawn')
    const proof = row.hasRunnerProof ? chalk.green('proof') : chalk.red('no-proof')
    const version = row.happyCliVersion ? ` cli=${row.happyCliVersion}` : ''
    return [
        `  ${chalk.blue(label)} (${row.machineId.slice(0, 8)})`,
        `    host=${row.host ?? '(unknown)'}${version}`,
        `  rpc=${spawn} proof=${proof}  ${formatIssues(row.issues)}`,
    ].join('\n')
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

    return lines.join('\n')
}

export function provenanceDiagnosticsHasIssues(diagnostics: ProvenanceDiagnostics): boolean {
    return diagnostics.sessions.some((row) => row.issues.length > 0)
        || diagnostics.machines.some((row) => row.issues.length > 0)
}

export async function runDoctorProvenance(): Promise<number> {
    console.log(chalk.bold.cyan('\n🔎 hapi provenance doctor\n'))
    console.log(`Hub: ${chalk.blue(configuration.apiUrl)}`)

    const jwt = await hubJwt()
    if (!jwt) {
        console.log(chalk.red('❌ CLI_API_TOKEN missing or auth failed'))
        console.log(chalk.gray('  Run `hapi auth login` or set CLI_API_TOKEN, then retry.'))
        return 1
    }

    let diagnostics: ProvenanceDiagnostics
    try {
        diagnostics = await fetchProvenanceDiagnostics(jwt)
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.log(chalk.red(`❌ ${message}`))
        return 1
    }

    console.log('')
    console.log(formatProvenanceReport(diagnostics))
    console.log('')

    if (provenanceDiagnosticsHasIssues(diagnostics)) {
        console.log(chalk.yellow('⚠️  Provenance issues found.'))
        console.log(chalk.gray('  Unproven active sessions cannot be archived cleanly; restart the CLI on that machine.'))
        console.log(chalk.gray('  Inspect one session: hapi inspect-peer <session-id-prefix>'))
        return 1
    }

    console.log(chalk.green('✅ No provenance issues detected.'))
    return 0
}
