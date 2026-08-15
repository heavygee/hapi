import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    buildNotifyRuleContent,
    HAPI_SESSION_RULE_SENTINEL,
    installCursorNotifyRuleOverlay
} from './cursorNotifyRuleOverlay';

describe('buildNotifyRuleContent', () => {
    it('includes alwaysApply frontmatter, sentinel, and the contract line', () => {
        const content = buildNotifyRuleContent();
        expect(content.startsWith('---\nalwaysApply: true\n---')).toBe(true);
        expect(content).toContain(HAPI_SESSION_RULE_SENTINEL);
        expect(content).toContain('AGENT_NOTIFY_SUMMARY {"version":1,');
        expect(content).toContain('"status":"done"');
        expect(content).toContain('Never emit "action":""');
        expect(content.toLowerCase()).toContain('omit the action key');
    });

    it('bakes in project and agent id when provided', () => {
        const content = buildNotifyRuleContent({ project: 'overseer-summary-emit', agentId: 'peer-7' });
        expect(content).toContain('"agent":"peer-7"');
        expect(content).toContain('"project":"overseer-summary-emit"');
    });

    it('falls back to placeholders and sanitizes hostile input', () => {
        const content = buildNotifyRuleContent({ project: '"}{evil', agentId: '   ' });
        expect(content).toContain('"agent":"<agent-id>"');
        // quotes/braces stripped, leaving only safe chars
        expect(content).toContain('"project":"evil"');
    });

    it('reads as benign session tracking, never surveillance', () => {
        const content = buildNotifyRuleContent().toLowerCase();
        expect(content).toContain('session tracking');
        expect(content).not.toContain('overseer');
        expect(content).not.toContain('surveillance');
        expect(content).not.toContain('monitor');
    });
});

describe('installCursorNotifyRuleOverlay', () => {
    let cwd: string;

    beforeEach(() => {
        cwd = mkdtempSync(join(tmpdir(), 'hapi-notify-rule-'));
    });

    afterEach(() => {
        rmSync(cwd, { recursive: true, force: true });
    });

    const rulePathOf = (root: string) => join(root, '.cursor', 'rules', 'hapi-session.mdc');

    it('writes the rule file and reports its path', () => {
        const overlay = installCursorNotifyRuleOverlay({ cwd });
        expect(overlay.rulePath).toBe(rulePathOf(cwd));
        expect(existsSync(overlay.rulePath)).toBe(true);
        expect(readFileSync(overlay.rulePath, 'utf-8')).toContain(HAPI_SESSION_RULE_SENTINEL);
    });

    it('cleanup removes our file and prunes dirs it created', () => {
        const overlay = installCursorNotifyRuleOverlay({ cwd });
        overlay.cleanup();
        expect(existsSync(overlay.rulePath)).toBe(false);
        expect(existsSync(join(cwd, '.cursor', 'rules'))).toBe(false);
        expect(existsSync(join(cwd, '.cursor'))).toBe(false);
    });

    it('backs up and restores a pre-existing user rule verbatim', () => {
        const rulePath = rulePathOf(cwd);
        mkdirSync(join(cwd, '.cursor', 'rules'), { recursive: true });
        const userContent = '---\nalwaysApply: false\n---\n# my own rule\n';
        writeFileSync(rulePath, userContent, 'utf-8');

        const overlay = installCursorNotifyRuleOverlay({ cwd });
        // ours is installed over it
        expect(readFileSync(rulePath, 'utf-8')).toContain(HAPI_SESSION_RULE_SENTINEL);

        overlay.cleanup();
        // user's file restored exactly, dirs preserved (we did not create them)
        expect(readFileSync(rulePath, 'utf-8')).toBe(userContent);
        expect(existsSync(join(cwd, '.cursor', 'rules'))).toBe(true);
    });

    it('does not prune a .cursor dir that has other content', () => {
        mkdirSync(join(cwd, '.cursor'), { recursive: true });
        writeFileSync(join(cwd, '.cursor', 'mcp.json'), '{}', 'utf-8');

        const overlay = installCursorNotifyRuleOverlay({ cwd });
        overlay.cleanup();

        // our rule + the rules dir we created are gone...
        expect(existsSync(overlay.rulePath)).toBe(false);
        expect(existsSync(join(cwd, '.cursor', 'rules'))).toBe(false);
        // ...but the pre-existing .cursor dir (with sibling content) survives
        expect(existsSync(join(cwd, '.cursor'))).toBe(true);
        expect(existsSync(join(cwd, '.cursor', 'mcp.json'))).toBe(true);
    });

    it('treats a sentinel-bearing file (prior/concurrent session) as ours, not a backup', () => {
        const rulePath = rulePathOf(cwd);
        mkdirSync(join(cwd, '.cursor', 'rules'), { recursive: true });
        writeFileSync(rulePath, buildNotifyRuleContent({ project: 'stale' }), 'utf-8');

        const overlay = installCursorNotifyRuleOverlay({ cwd });
        overlay.cleanup();
        // removed, not "restored" — the sentinel file was ours
        expect(existsSync(rulePath)).toBe(false);
    });

    it('does not clobber or delete a git-tracked hapi-session.mdc', () => {
        const rulePath = rulePathOf(cwd);
        mkdirSync(join(cwd, '.cursor', 'rules'), { recursive: true });
        const tracked = [
            '---',
            'alwaysApply: true',
            '---',
            HAPI_SESSION_RULE_SENTINEL,
            '',
            '# Session status summary',
            '',
            '## Operator-facing session identity (mandatory)',
            '',
            'Bare hashes forbidden.',
            ''
        ].join('\n');
        writeFileSync(rulePath, tracked, 'utf-8');
        execFileSync('git', ['init'], { cwd });
        execFileSync('git', ['add', '.cursor/rules/hapi-session.mdc'], { cwd });

        const overlay = installCursorNotifyRuleOverlay({ cwd, project: 'should-not-bake' });
        expect(readFileSync(rulePath, 'utf-8')).toBe(tracked);
        overlay.cleanup();
        expect(readFileSync(rulePath, 'utf-8')).toBe(tracked);
    });

    it('never deletes a user file that replaced ours mid-session', () => {
        const overlay = installCursorNotifyRuleOverlay({ cwd });
        const userContent = 'the user clobbered our rule with their own\n';
        writeFileSync(overlay.rulePath, userContent, 'utf-8');

        overlay.cleanup();
        expect(readFileSync(overlay.rulePath, 'utf-8')).toBe(userContent);
    });

    it('cleanup is idempotent', () => {
        const overlay = installCursorNotifyRuleOverlay({ cwd });
        overlay.cleanup();
        expect(() => overlay.cleanup()).not.toThrow();
        expect(existsSync(overlay.rulePath)).toBe(false);
    });
});
