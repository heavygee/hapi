import { readRunnerState, readSettings, type RunnerLocallyPersistedState } from '@/persistence';

export type VersionHandoffSettings = {
    runnerDisableVersionHandoff?: boolean;
};

/** Env var contract (systemd drop-in, operator rebuild scripts). */
export function isVersionHandoffDisabledByEnv(): boolean {
    return process.env.HAPI_DISABLE_VERSION_HANDOFF === '1';
}

/** Persisted operator opt-out in ~/.hapi/settings.json (survives env leaks). */
export function isVersionHandoffDisabledBySettings(settings: VersionHandoffSettings): boolean {
    return settings.runnerDisableVersionHandoff === true;
}

export function isVersionHandoffDisabledByRunnerState(state: RunnerLocallyPersistedState | null): boolean {
    return state?.startedWithVersionHandoffDisabled === true;
}

/** Resolve handoff opt-out from env, settings, or the live runner state file. */
export async function isVersionHandoffDisabled(): Promise<boolean> {
    if (isVersionHandoffDisabledByEnv()) {
        return true;
    }
    const settings = await readSettings();
    if (isVersionHandoffDisabledBySettings(settings)) {
        return true;
    }
    const state = await readRunnerState();
    return isVersionHandoffDisabledByRunnerState(state);
}

/** Snapshot for runner start / sync checks when settings are already loaded. */
export function resolveVersionHandoffDisabledAtStart(settings: VersionHandoffSettings): boolean {
    return isVersionHandoffDisabledByEnv() || isVersionHandoffDisabledBySettings(settings);
}
