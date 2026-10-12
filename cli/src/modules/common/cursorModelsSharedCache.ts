import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CursorModelsResponse } from '@hapi/protocol/apiTypes';
import { resolveHapiHomeDir } from '@/configuration';

function getHapiHomeDir(): string {
    return resolveHapiHomeDir();
}

function getSharedCachePath(): string {
    // Vitest runs CLI tests in a pool of workers that all share HAPI_HOME.
    // Isolate the on-disk catalog per worker so parallel suites cannot clobber
    // each other's writeSharedCursorModelsCache fixtures (flake: #1428 bare-ACP
    // spawn remap saw an empty cache mid-test and returned the raw wire id).
    const worker = process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID;
    const file = worker
        ? `cursor-models.vitest-${worker}.json`
        : 'cursor-models.json';
    return join(getHapiHomeDir(), 'cache', file);
}

function isUsableModelsResponse(response: CursorModelsResponse | null): response is CursorModelsResponse {
    return Boolean(
        response?.success
        && (response.availableModels?.length ?? 0) > 0
    );
}

/**
 * Bumped when a cached catalog can no longer be trusted. v1 carried synthesized
 * `[fast=…]` wire ids that Cursor rejects at `session/new`; `listCursorModels`
 * serves the on-disk cache without re-probing, so stale entries must not be read.
 */
const SHARED_CACHE_VERSION = 2;

type SharedCacheEnvelope = {
    version: number;
    response: CursorModelsResponse;
};

/** Cross-process catalog for New Session while an ACP lock blocks `agent --list-models`. */
export function readSharedCursorModelsCache(): CursorModelsResponse | null {
    const path = getSharedCachePath();
    if (!existsSync(path)) {
        return null;
    }

    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<SharedCacheEnvelope> | null;
        if (!parsed || parsed.version !== SHARED_CACHE_VERSION) {
            return null;
        }
        const response = parsed.response ?? null;
        return isUsableModelsResponse(response) ? response : null;
    } catch {
        return null;
    }
}

export function writeSharedCursorModelsCache(response: CursorModelsResponse): void {
    if (!isUsableModelsResponse(response)) {
        return;
    }

    const path = getSharedCachePath();
    try {
        mkdirSync(dirname(path), { recursive: true });
        const envelope: SharedCacheEnvelope = { version: SHARED_CACHE_VERSION, response };
        writeFileSync(path, JSON.stringify(envelope), 'utf8');
    } catch {
        // Best effort — in-process cache still works in the session child.
    }
}

export function _resetSharedCursorModelsCacheForTests(): void {
    const path = getSharedCachePath();
    if (existsSync(path)) {
        rmSync(path, { force: true });
    }
}
