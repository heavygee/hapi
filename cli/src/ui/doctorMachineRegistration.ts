/**
 * Doctor probe for POST /cli/machines enrollment health (#2038 / heavygee#287).
 *
 * Sends machineTag from settings but deliberately omits runnerProof so a live
 * runner's bound proof hash is never cold-rebound by doctor. Interpret:
 * - 200 → registration path ok (untagged or tag-only row)
 * - 409 + proof mismatch/missing → tag verified; runner must present proof
 * - 409 + tag mismatch / legacy re-enroll → FAIL
 * - 5xx / auth errors → FAIL
 */

import axios from 'axios'
import chalk from 'chalk'
import { configuration } from '@/configuration'
import { buildHubRequestHeaders } from '@/api/hubExtraHeaders'
import { getAuthToken } from '@/api/auth'
import { readSettings } from '@/persistence'
import { buildMachineMetadata } from '@/agent/sessionFactory'
import { extractErrorInfo } from '@/utils/errorUtils'

export type MachineRegistrationProbeResult = {
    ok: boolean
    status?: number
    detail: string
    machineId?: string
    /** True when hub confirmed tag but requires runnerProof (expected for bound rows). */
    tagVerifiedProofRequired?: boolean
}

export function classifyMachineRegistrationProbe(opts: {
    httpStatus?: number
    responseErrorText: string
}): Omit<MachineRegistrationProbeResult, 'machineId'> {
    const status = opts.httpStatus
    const detail = opts.responseErrorText.trim()
    const lower = detail.toLowerCase()

    if (status !== undefined && status >= 200 && status < 300) {
        return { ok: true, status, detail: detail || 'registered' }
    }

    if (status === 409) {
        if (
            lower.includes('runner proof mismatch')
            || lower.includes('runner proof missing')
        ) {
            return {
                ok: true,
                status,
                detail,
                tagVerifiedProofRequired: true,
            }
        }
        return {
            ok: false,
            status,
            detail: detail || 'Machine enrollment conflict',
        }
    }

    return {
        ok: false,
        status,
        detail: detail || `Registration probe failed (HTTP ${status ?? 'n/a'})`,
    }
}

export async function probeMachineRegistration(): Promise<MachineRegistrationProbeResult> {
    const settings = await readSettings()
    const machineId = settings?.machineId?.trim()
    const machineTag = settings?.machineTag?.trim()
    if (!machineId) {
        return { ok: false, detail: 'No machineId in ~/.hapi/settings.json' }
    }
    if (!machineTag) {
        return { ok: false, detail: 'No machineTag in ~/.hapi/settings.json', machineId }
    }

    let token: string
    try {
        token = getAuthToken()
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false, detail: `Auth token unavailable: ${message}`, machineId }
    }

    try {
        const response = await axios.post(
            `${configuration.apiUrl}/cli/machines`,
            {
                id: machineId,
                tag: machineTag,
                // Omit runnerProof on purpose — see file header.
                // Non-runner metadata only (no capability ads) so we do not
                // paint over a live runner's identity fields.
                metadata: buildMachineMetadata(),
                runnerState: null,
            },
            {
                headers: buildHubRequestHeaders({
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                }),
                timeout: 15_000,
                validateStatus: () => true,
            }
        )
        const body = response.data
        const responseErrorText = body && typeof body === 'object' && typeof body.error === 'string'
            ? body.error
            : ''
        const classified = classifyMachineRegistrationProbe({
            httpStatus: response.status,
            responseErrorText,
        })
        return { ...classified, machineId }
    } catch (error) {
        const info = extractErrorInfo(error)
        return {
            ok: false,
            machineId,
            status: info.httpStatus,
            detail: info.responseErrorText || info.message,
        }
    }
}

export async function runDoctorMachineRegistrationProbe(): Promise<number> {
    console.log(chalk.bold('\n🏷️  Machine registration'))
    const result = await probeMachineRegistration()
    if (result.machineId) {
        console.log(`  Machine ID: ${chalk.blue(result.machineId)}`)
    }
    if (result.ok) {
        if (result.tagVerifiedProofRequired) {
            console.log(chalk.green('✓ machineTag matches hub (runnerProof required on runner start)'))
        } else {
            console.log(chalk.green('✓ POST /cli/machines succeeded with settings machineTag'))
        }
        if (result.status) {
            console.log(chalk.gray(`  HTTP ${result.status}: ${result.detail}`))
        }
        return 0
    }
    console.log(chalk.red('❌ Machine registration probe failed'))
    if (result.status) {
        console.log(chalk.red(`  HTTP ${result.status}: ${result.detail}`))
    } else {
        console.log(chalk.red(`  ${result.detail}`))
    }
    console.log(chalk.gray('  Fix: ensure settings.machineTag matches hub machines.tag; restart runner.'))
    return 1
}
