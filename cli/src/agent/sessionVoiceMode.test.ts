import { describe, expect, it, vi } from 'vitest'
import { applySessionVoiceMode } from './sessionVoiceMode'
import type { Metadata } from '@/api/types'

describe('sessionVoiceMode', () => {
    it('sets metadata.voiceMode when enabling', () => {
        let metadata: Metadata = { path: '/tmp/project', host: 'localhost' }
        const client = {
            updateMetadata: vi.fn((handler: (current: Metadata) => Metadata) => {
                metadata = handler(metadata)
            })
        }

        applySessionVoiceMode(client, true)
        expect(metadata.voiceMode).toBe(true)
        expect(client.updateMetadata).toHaveBeenCalledTimes(1)
    })

    it('sets metadata.voiceMode when disabling', () => {
        let metadata: Metadata = { path: '/tmp/project', host: 'localhost', voiceMode: true }
        const client = {
            updateMetadata: vi.fn((handler: (current: Metadata) => Metadata) => {
                metadata = handler(metadata)
            })
        }

        applySessionVoiceMode(client, false)
        expect(metadata.voiceMode).toBe(false)
    })

    it('skips the write when the value is already current', () => {
        let metadata: Metadata = { path: '/tmp/project', host: 'localhost', voiceMode: true }
        const client = {
            updateMetadata: vi.fn((handler: (current: Metadata) => Metadata) => {
                metadata = handler(metadata)
            })
        }

        applySessionVoiceMode(client, true)
        expect(metadata.voiceMode).toBe(true)
    })

    it('preserves other metadata fields', () => {
        let metadata: Metadata = { path: '/tmp/project', host: 'localhost', name: 'kept' }
        const client = {
            updateMetadata: vi.fn((handler: (current: Metadata) => Metadata) => {
                metadata = handler(metadata)
            })
        }

        applySessionVoiceMode(client, true)
        expect(metadata.name).toBe('kept')
        expect(metadata.voiceMode).toBe(true)
    })
})
