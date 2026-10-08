import type { ApiSessionClient } from '@/api/apiSession';
import type { Metadata } from '@/api/types';

type SessionVoiceModeClient = Pick<ApiSessionClient, 'updateMetadata'>;

/**
 * Explicit, session-scoped opt-in: set metadata.voiceMode. Read once at the
 * next session bootstrap (cli/src/api/api.ts), so flipping this mid-process
 * takes effect on the next resume, not immediately — same cadence as every
 * other system-prompt toggle in this codebase.
 */
export function applySessionVoiceMode(
    client: SessionVoiceModeClient,
    enabled: boolean
): void {
    client.updateMetadata((metadata: Metadata) => {
        if (metadata.voiceMode === enabled) {
            return metadata;
        }
        return {
            ...metadata,
            voiceMode: enabled
        };
    });
}
