import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    applyCanonicalCursorApiKeyToProcessEnv,
    cursorApiKeyLogPrefix,
    loadCanonicalCursorApiKey
} from './cursorCredentialEnv';

describe('cursorCredentialEnv', () => {
    let dir: string;
    let envPath: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'cursor-cred-'));
        envPath = join(dir, 'cursor.env');
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('loads the uncommented CURSOR_API_KEY line', () => {
        writeFileSync(
            envPath,
            '#CURSOR_API_KEY=crsr_oldoldoldoldoldoldoldoldoldoldoldoldoldoldoldoldold\nCURSOR_API_KEY=crsr_7f4d5beaa3deadbeefdeadbeefdeadbeefdeadbeefdeadbeefde\n'
        );
        expect(loadCanonicalCursorApiKey(envPath)).toBe(
            'crsr_7f4d5beaa3deadbeefdeadbeefdeadbeefdeadbeefdeadbeefde'
        );
    });

    it('returns null when the file is missing or has no key', () => {
        expect(loadCanonicalCursorApiKey(join(dir, 'missing.env'))).toBeNull();
        writeFileSync(envPath, '# only comments\n');
        expect(loadCanonicalCursorApiKey(envPath)).toBeNull();
    });

    it('apply updates process env only when the key changes', () => {
        const good = 'crsr_7f4d5beaa3deadbeefdeadbeefdeadbeefdeadbeefdeadbeefde';
        const bad = 'crsr_025e71d9f1deadbeefdeadbeefdeadbeefdeadbeefdeadbeefde';
        writeFileSync(envPath, `CURSOR_API_KEY=${good}\n`);
        const env: NodeJS.ProcessEnv = { CURSOR_API_KEY: bad };

        const first = applyCanonicalCursorApiKeyToProcessEnv(env, envPath);
        expect(first).toEqual({
            applied: true,
            keyPrefix: 'crsr_7f4d5be',
            previousPrefix: 'crsr_025e71d'
        });
        expect(env.CURSOR_API_KEY).toBe(good);

        const second = applyCanonicalCursorApiKeyToProcessEnv(env, envPath);
        expect(second).toEqual({
            applied: false,
            reason: 'unchanged',
            keyPrefix: 'crsr_7f4d5be'
        });
    });

    it('cursorApiKeyLogPrefix is stable and short', () => {
        expect(cursorApiKeyLogPrefix('crsr_7f4d5beaa3xxxxxxxx')).toBe('crsr_7f4d5be');
        expect(cursorApiKeyLogPrefix('nope')).toBe('invalid');
    });
});
