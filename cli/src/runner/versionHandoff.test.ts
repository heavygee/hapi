import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
    isVersionHandoffDisabledByEnv,
    isVersionHandoffDisabledByRunnerState,
    isVersionHandoffDisabledBySettings,
    resolveVersionHandoffDisabledAtStart,
} from './versionHandoff';
import type { RunnerLocallyPersistedState } from '@/persistence';

describe('versionHandoff', () => {
    const originalEnv = process.env.HAPI_DISABLE_VERSION_HANDOFF;

    beforeEach(() => {
        delete process.env.HAPI_DISABLE_VERSION_HANDOFF;
    });

    afterEach(() => {
        if (originalEnv === undefined) {
            delete process.env.HAPI_DISABLE_VERSION_HANDOFF;
        } else {
            process.env.HAPI_DISABLE_VERSION_HANDOFF = originalEnv;
        }
    });

    it('detects env opt-out', () => {
        expect(isVersionHandoffDisabledByEnv()).toBe(false);
        process.env.HAPI_DISABLE_VERSION_HANDOFF = '1';
        expect(isVersionHandoffDisabledByEnv()).toBe(true);
    });

    it('detects settings opt-out', () => {
        expect(isVersionHandoffDisabledBySettings({})).toBe(false);
        expect(isVersionHandoffDisabledBySettings({ runnerDisableVersionHandoff: true })).toBe(true);
    });

    it('detects persisted runner state opt-out', () => {
        expect(isVersionHandoffDisabledByRunnerState(null)).toBe(false);
        const state = { startedWithVersionHandoffDisabled: true } as RunnerLocallyPersistedState;
        expect(isVersionHandoffDisabledByRunnerState(state)).toBe(true);
    });

    it('combines env and settings at runner start', () => {
        expect(resolveVersionHandoffDisabledAtStart({})).toBe(false);
        expect(resolveVersionHandoffDisabledAtStart({ runnerDisableVersionHandoff: true })).toBe(true);
        process.env.HAPI_DISABLE_VERSION_HANDOFF = '1';
        expect(resolveVersionHandoffDisabledAtStart({})).toBe(true);
    });
});
