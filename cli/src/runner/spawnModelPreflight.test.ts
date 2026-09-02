import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setCursorAcpModelsSnapshot } from '@/cursor/utils/cursorAcpModelsBridge';
import { _resetCursorModelsCacheForTests, seedCursorModelsCache } from '@/modules/common/cursorModels';
import { checkSpawnModel } from './spawnModelPreflight';

// Isolate the on-disk cursor-models cache to this file's own HAPI_HOME so
// parallel vitest workers don't race on the shared $HAPI_HOME/cache path.
const previousHapiHome = process.env.HAPI_HOME;
const testHapiHome = mkdtempSync(join(tmpdir(), 'hapi-spawn-model-preflight-'));
process.env.HAPI_HOME = testHapiHome;

afterEach(() => {
    setCursorAcpModelsSnapshot(null);
    _resetCursorModelsCacheForTests();
});

afterAll(() => {
    if (previousHapiHome === undefined) delete process.env.HAPI_HOME;
    else process.env.HAPI_HOME = previousHapiHome;
    rmSync(testHapiHome, { recursive: true, force: true });
});

describe('checkSpawnModel', () => {
    it('rejects a Cursor model missing from the cached catalog (#1752)', () => {
        setCursorAcpModelsSnapshot({
            availableModels: [{ modelId: 'composer-2.5[thinking]' }, { modelId: 'gpt-5.1[reasoning=high]' }],
            currentModelId: 'composer-2.5[thinking]'
        });

        const result = checkSpawnModel('cursor', 'gpt-5');

        expect(result.ok).toBe(false);
        expect(result.ok === false && result.message).toContain("Model 'gpt-5' is not in the cursor model catalog");
        expect(result.ok === false && result.message).toContain('Accepted: gpt-5.1, composer-2.5');
    });

    it('accepts a model present in the cached catalog', () => {
        setCursorAcpModelsSnapshot({
            availableModels: [{ modelId: 'composer-2.5[thinking]' }],
            currentModelId: 'composer-2.5[thinking]'
        });

        expect(checkSpawnModel('cursor', 'composer-2.5[thinking]')).toEqual({ ok: true });
    });

    it('reads the on-disk shared catalog when no ACP snapshot is live', () => {
        seedCursorModelsCache({
            success: true,
            availableModels: [{ modelId: 'composer-2.5[thinking]' }],
            currentModelId: 'composer-2.5[thinking]'
        });

        expect(checkSpawnModel('cursor', 'composer-2.5')).toEqual({ ok: true });
        expect(checkSpawnModel('cursor', 'gpt-5').ok).toBe(false);
    });

    it('ignores a shared catalog older than the freshness bound', () => {
        seedCursorModelsCache({
            success: true,
            availableModels: [{ modelId: 'composer-2.5[thinking]' }],
            currentModelId: 'composer-2.5[thinking]'
        });
        // A catalog that predates a Cursor upgrade must not reject an id that is
        // now valid; the preflight goes dormant instead.
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        utimesSync(join(testHapiHome, 'cache', 'cursor-models.json'), twoDaysAgo, twoDaysAgo);

        expect(checkSpawnModel('cursor', 'gpt-5')).toEqual({ ok: true });
    });

    it('allows any model when no catalog is cached', () => {
        expect(checkSpawnModel('cursor', 'gpt-5')).toEqual({ ok: true });
    });

    it('allows flavors without a cached catalog', () => {
        expect(checkSpawnModel('claude', 'claude-opus-5')).toEqual({ ok: true });
        expect(checkSpawnModel('codex', 'gpt-5')).toEqual({ ok: true });
    });

    it('allows a spawn with no model', () => {
        setCursorAcpModelsSnapshot({
            availableModels: [{ modelId: 'composer-2.5[thinking]' }],
            currentModelId: 'composer-2.5[thinking]'
        });

        expect(checkSpawnModel('cursor', undefined)).toEqual({ ok: true });
    });
});
