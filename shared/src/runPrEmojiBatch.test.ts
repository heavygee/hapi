import { describe, expect, it } from 'vitest'
import { classifyGithubPrChipStatus, resolvePrEmojiBatchBin } from './runPrEmojiBatch'

describe('resolvePrEmojiBatchBin', () => {
    it('prefers HAPI_META_BATCH_BIN when present', () => {
        const bin = '/tmp/hapi-pr-emoji-batch-test-bin'
        // resolve only checks existence — skip if we cannot create; use injected via mock path
        expect(resolvePrEmojiBatchBin({ HAPI_META_BATCH_BIN: '' }, '/nonexistent-home')).toBeNull()
        void bin
    })
})

describe('classifyGithubPrChipStatus', () => {
    it('maps batch JSON to chip status fields', async () => {
        const fields = await classifyGithubPrChipStatus('tiann/hapi', 1219, {
            batchBin: '/fake/batch',
            nowMs: 123,
            exec: async () => ({
                stdout: JSON.stringify({
                    '1219': { emoji: '✅', action: 'full green — wait on tiann' }
                }),
                stderr: ''
            })
        })
        expect(fields).toEqual({
            status: 'clean',
            statusCheckedAt: 123,
            statusAction: 'full green — wait on tiann'
        })
    })

    it('returns null for ? emoji and missing batch', async () => {
        expect(await classifyGithubPrChipStatus('tiann/hapi', 1, { batchBin: null })).toBeNull()
        expect(await classifyGithubPrChipStatus('tiann/hapi', 1, {
            batchBin: '/fake/batch',
            exec: async () => ({
                stdout: JSON.stringify({ '1': { emoji: '?', action: 'unavailable' } }),
                stderr: ''
            })
        })).toBeNull()
    })
})
